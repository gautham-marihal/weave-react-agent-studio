// Readiness checks: does a saved configuration (the draft or a published version) cover everyday situations? A
// greeting, a way to end the call, reaching a person, a caller who goes quiet. They only read the configuration:
// nothing is run, sent to the runtime or placed as a call. Pure: no network, no DOM.

import type { AgentConfig } from '../types/studio';
import { isObj, type Obj } from './scenario';

type Config = AgentConfig | null | undefined;
const list = <T = Obj>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const channelsOf = (c: AgentConfig) => list(c.channels).filter((channel) => isObj(channel) && channel.enabled !== false);
const toolsOf = (c: AgentConfig) => list(c.tools).filter(isObj);
const entryAgent = (c: AgentConfig) => {
  const items = list(c.agents?.items).filter(isObj);
  return items.find((agent) => agent.id === c.agents?.entry) ?? items[0];
};
const hasVoiceChannel = (c: AgentConfig) =>
  channelsOf(c).some((channel) => {
    const m = isObj(channel.modalities) ? channel.modalities : {};
    return list<string>(m.input).includes('audio') || list<string>(m.output).includes('audio') || channel.type === 'web_voice' || channel.type === 'sip_voice';
  });

/** Can the agent pass a caller to a person? A transfer-or-callback tool, a defined transfer, or an escalation rule. */
export function hasHumanHandoff(config: Config): boolean {
  const c = config ?? {};
  return (
    toolsOf(c).some((tool) => tool.builtin === 'transfer_or_callback') ||
    list(c.telephony?.transfers).length > 0 ||
    list(c.guardrails?.escalation).some((rule) => isObj(rule) && (rule.action === 'tool' || rule.action === 'handoff'))
  );
}

export interface ReadinessCheck {
  id: string;
  name: string;
  check: (c: AgentConfig) => boolean;
  pass: string;
  fail: string;
}

export const READINESS_CHECKS: ReadinessCheck[] = [
  {
    id: 'greet',
    name: 'Caller says hello',
    check: (c) =>
      channelsOf(c).some((ch) => isObj(ch.greeting) && !!ch.greeting.say) || list(c.messages).some((m) => /greet|welcome/i.test(String(m?.id ?? ''))),
    pass: 'Greets the caller with a greeting you set.',
    fail: 'No channel has a greeting.',
  },
  {
    id: 'goal',
    name: 'Caller explains why they called',
    check: (c) => {
      const agent = entryAgent(c);
      return !!text(isObj(agent?.instructions) ? agent?.instructions.role : '');
    },
    pass: 'The agent that answers first has instructions to work from.',
    fail: 'The agent that answers first has no instructions.',
  },
  {
    id: 'person',
    name: 'Caller asks for a person',
    check: hasHumanHandoff,
    pass: 'Can hand the caller to a person or take a callback.',
    fail: 'No transfer, callback tool or escalation rule is set.',
  },
  {
    id: 'silent',
    name: 'Caller goes quiet',
    check: (c) => {
      const i = c.defaults?.conversation?.inactivity;
      return isObj(i) && i.enabled !== false && (list(i.nudges).length > 0 || !!i.on_exhausted);
    },
    pass: 'Nudges a silent caller, then closes politely.',
    fail: 'Handling a silent caller is off or not set.',
  },
  {
    id: 'bye',
    name: 'Caller says goodbye',
    check: (c) => toolsOf(c).some((tool) => tool.builtin === 'end_call') || list(c.messages).some((m) => /bye|goodbye/i.test(String(m?.id ?? ''))),
    pass: 'Can end the call with a goodbye.',
    fail: 'No end-call tool or goodbye message.',
  },
  {
    id: 'speech',
    name: 'Caller speaks instead of typing',
    check: (c) => hasVoiceChannel(c) && !!c.defaults?.models?.stt?.provider,
    pass: 'A voice channel and speech-to-text are set.',
    fail: 'No voice channel, or no speech-to-text model.',
  },
  {
    id: 'voice',
    name: 'Agent replies by voice',
    check: (c) => !!c.defaults?.models?.tts?.provider && !!text(c.defaults?.models?.tts?.voice_id),
    pass: 'A text-to-speech provider and voice are set.',
    fail: 'No text-to-speech voice is set.',
  },
  {
    id: 'offtopic',
    name: 'Caller goes off topic',
    check: (c) => {
      const g = isObj(c.guardrails) ? c.guardrails : {};
      const topics = isObj(g.topics) ? g.topics : {};
      return list(g.input).length + list(g.output).length > 0 || list(topics.blocked).length + list(topics.allowed).length > 0;
    },
    pass: 'Safety rules keep it on topic.',
    fail: 'No safety rules or topic limits are set.',
  },
  {
    id: 'lookup',
    name: 'Caller asks about their account',
    check: (c) => toolsOf(c).some((tool) => ['http', 'mcp', 'knowledge', 'task', 'code'].includes(String(tool.type))),
    pass: 'Has tools to look things up.',
    fail: 'No tool can look anything up.',
  },
  {
    id: 'chat',
    name: 'Caller switches to chat',
    check: (c) => channelsOf(c).some((ch) => ch.type === 'web_chat'),
    pass: 'A web chat channel is on.',
    fail: 'No web chat channel is on.',
  },
  {
    id: 'hijack',
    name: 'A caller tries to take over the agent',
    check: (c) => list(c.guardrails?.input).some((rule) => isObj(rule) && rule.type === 'prompt_injection'),
    pass: 'A safety rule against instructions hidden in what the caller says is set.',
    fail: 'No safety rule against instructions hidden in what the caller says.',
  },
  {
    id: 'record',
    name: 'Conversation is kept for review',
    check: (c) => !!c.post_call?.recording?.transcript || list(c.post_call?.artifacts).some((a) => isObj(a) && a.kind === 'transcript' && a.enabled !== false),
    pass: 'Transcripts are kept.',
    fail: 'Transcripts are not kept.',
  },
];

export interface CheckResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

/** Reads a configuration against every check. A check that cannot read its part counts as not passed. */
export function runReadinessChecks(config: Config): CheckResult[] {
  return READINESS_CHECKS.map((item) => {
    let passed = false;
    try {
      passed = !!(config && item.check(config));
    } catch {
      passed = false;
    }
    return { id: item.id, name: item.name, passed, detail: config ? (passed ? item.pass : item.fail) : 'The configuration couldn’t be read.' };
  });
}

/** One run of the checks, as kept in the history. */
export interface CheckRun {
  id: string;
  agentId: string;
  /** "draft" or a version number. */
  target: string;
  targetLabel: string;
  ranAt: string;
  total: number;
  passed: number;
  results: CheckResult[];
}

/** A run record for these results. `id` is made by the caller (any unique text). */
export function checkRunOf(agentId: string, target: string, targetLabel: string, results: CheckResult[], ranAt: string, id: string): CheckRun {
  return { id, agentId, target, targetLabel, ranAt, total: results.length, passed: results.filter((r) => r.passed).length, results };
}

/** Kept runs, newest first, at most `max`; anything that is not a run record is dropped. */
export function keepRuns(runs: unknown, max = 20): CheckRun[] {
  return list(runs)
    .filter((r): r is CheckRun & Obj => isObj(r) && typeof r.id === 'string' && typeof r.agentId === 'string' && Array.isArray(r.results))
    .sort((a, b) => String(b.ranAt).localeCompare(String(a.ranAt)))
    .slice(0, max);
}
