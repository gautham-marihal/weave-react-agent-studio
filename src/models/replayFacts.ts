// A call's records read as a conversation: the caller's turns, the agent's answers, tools, hand-overs, how it ended.
// Real calls, test conversations and scenario runs write the same records, so a replay can sit beside any of them.
// Pure: no network, no DOM.

export type CallEvent = Record<string, unknown> & { event?: string; seq?: number; elapsed_s?: number };

export interface ToolUse {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error: string;
  /** The agent it handed the conversation to, when it did. */
  handoff: string;
}

export interface CallTurn {
  /** What the caller said. */
  say: string;
  at?: number;
  /** What the agent said back. */
  said: string[];
  tools: ToolUse[];
  /** How long the caller waited for the first words of the answer; null when not known. */
  waitMs: number | null;
}

export interface CallFacts {
  channelId: string;
  startAgent: string;
  finalAgent: string;
  finalState: Record<string, unknown>;
  ended: boolean;
  handoffs: number;
  /** What the agent said before the caller spoke (the greeting, a recording notice). */
  opening: string[];
  turns: CallTurn[];
  /** Records of kind "error", and tools that failed. */
  errors: string[];
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clean = (text: unknown): string => (typeof text === 'string' ? text : text === null || text === undefined ? '' : JSON.stringify(text));

export const emptyFacts = (): CallFacts => ({ channelId: '', startAgent: '', finalAgent: '', finalState: {}, ended: false, handoffs: 0, opening: [], turns: [], errors: [] });

/** A call's records (GET /calls/{id} `events`, or a run's `events`) as facts. */
export function readCall(records: unknown): CallFacts {
  const events = list(records)
    .filter(isObj)
    .slice()
    .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0)) as CallEvent[];
  const facts = emptyFacts();
  let turn: CallTurn | null = null;
  let lastTool: ToolUse | null = null;
  let calledAt: number | null = null;
  events.forEach((e) => {
    switch (e.event) {
      case 'call_started':
        facts.channelId = isObj(e.channel) ? str(e.channel.id) : '';
        break;
      case 'agent_entered': {
        const agent = str(e.agent);
        if (!facts.startAgent) facts.startAgent = agent;
        facts.finalAgent = agent || facts.finalAgent;
        if (e.first === false && lastTool && !lastTool.handoff) {
          lastTool.handoff = agent;
          facts.handoffs += 1;
        }
        break;
      }
      case 'user_said':
        turn = { say: clean(e.text), at: typeof e.elapsed_s === 'number' ? e.elapsed_s : undefined, said: [], tools: [], waitMs: null };
        calledAt = typeof e.elapsed_s === 'number' ? e.elapsed_s : null;
        facts.turns.push(turn);
        lastTool = null;
        break;
      case 'agent_said': {
        const text = clean(e.text);
        if (!text) break;
        if (turn) {
          turn.said.push(text);
          if (turn.waitMs === null && calledAt !== null && typeof e.elapsed_s === 'number') turn.waitMs = Math.max(0, Math.round((e.elapsed_s - calledAt) * 1000));
        } else facts.opening.push(text);
        break;
      }
      case 'tool_called': {
        const tool: ToolUse = {
          tool: str(e.tool) || str(e.name),
          args: isObj(e.args) ? e.args : {},
          result: e.result ?? e.output,
          error: e.error ? clean(e.error) : '',
          handoff: str(e.handoff),
        };
        if (turn) turn.tools.push(tool);
        lastTool = tool;
        if (tool.error) facts.errors.push(`The tool “${tool.tool}” failed: ${tool.error}`);
        if (tool.handoff) facts.handoffs += 1;
        break;
      }
      case 'error':
        facts.errors.push(clean(e.message || e.detail || e.error || 'An error was recorded.'));
        break;
      case 'state_changed':
        if (isObj(e.state)) facts.finalState = { ...facts.finalState, ...e.state };
        else if (e.name !== undefined || e.variable !== undefined) facts.finalState = { ...facts.finalState, [String(e.name ?? e.variable)]: e.value ?? e.to };
        break;
      case 'call_ended':
        facts.ended = true;
        if (isObj(e.state)) facts.finalState = { ...e.state };
        break;
      default:
    }
  });
  return facts;
}

interface TranscriptInput {
  transcript?: unknown;
  tools?: unknown;
  finalAgent?: string;
  finalState?: unknown;
  ended?: boolean;
  channelId?: string;
}

const toolOf = (t: Record<string, unknown>): ToolUse => ({
  tool: str(t.tool) || str(t.name),
  args: isObj(t.args) ? t.args : {},
  result: t.output ?? t.result,
  error: t.error ? clean(t.error) : '',
  handoff: str(t.handoff),
});

/** The same facts from { role, text } lines and a tool list, when a run gives no records. */
export function readTranscript({ transcript = [], tools = [], finalAgent = '', finalState = {}, ended = false, channelId = '' }: TranscriptInput = {}): CallFacts {
  const facts: CallFacts = { ...emptyFacts(), channelId, finalAgent, finalState: isObj(finalState) ? finalState : {}, ended };
  let turn: CallTurn | null = null;
  list(transcript)
    .filter(isObj)
    .forEach((m) => {
      const role = str(m.role).toLowerCase();
      const text = clean(m.text);
      if (role === 'user' || role === 'caller') {
        turn = { say: text, said: [], tools: [], waitMs: null };
        facts.turns.push(turn);
      } else if (text && (role === 'assistant' || role === 'agent' || role === 'bot')) {
        if (turn) turn.said.push(text);
        else facts.opening.push(text);
        list(m.tools)
          .filter(isObj)
          .forEach((t) => turn?.tools.push(toolOf(t)));
      }
    });
  // Tool records the lines did not carry: spread over the turns in order, so at least the set of tools is right.
  const toolList = list(tools).filter(isObj);
  if (toolList.length && !facts.turns.some((t) => t.tools.length)) {
    toolList.forEach((t, i) => {
      const target = facts.turns[Math.min(i, facts.turns.length - 1)];
      if (target) target.tools.push(toolOf(t));
    });
  }
  facts.handoffs = facts.turns.reduce((n, t) => n + t.tools.filter((x) => x.handoff).length, 0);
  facts.turns.forEach((t) =>
    t.tools.forEach((x) => {
      if (x.error) facts.errors.push(`The tool “${x.tool}” failed: ${x.error}`);
    }),
  );
  return facts;
}
