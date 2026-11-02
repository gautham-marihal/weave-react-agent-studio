// Sandbox's "Describe it": nothing in Sandbox may leave the browser, so no AI model is asked. What the person writes is
// read by simple built-in rules instead (generateDraft, Weave React's demo/draftAssistant.js): they are not an AI model,
// they only look for keywords, and they make a first draft that replaces what is there. The screen says all of this.
// Loaded with import() by src/components/assistant/DescribeIt.tsx, only in Sandbox.
import { ASSISTANT, MIN_DESCRIPTION, generateDraft } from './sandboxEngine.js';
import type { AgentConfig, Issue } from '../types/studio';
import type { Proposal } from '../models/assistant';

export { MIN_DESCRIPTION };

export const RULES_BADGE = 'Built-in rules, not AI';
export const RULES_TITLE = 'Sandbox doesn’t use an AI model';
export const RULES_NOTE =
  'Sandbox keeps everything in this browser, so nothing is sent to an AI service. What you write here is read by simple built-in rules instead: they are not an AI model, they only look for keywords, and they make a first draft that replaces what is there.';
/** What the rules are, in a sentence (for a tooltip). */
export const RULES_DESCRIPTION = ASSISTANT.description;

/** The smallest valid agent (one web chat channel, one brief agent), which the rules build on (React's demo/minimalConfig.js). */
export const minimalConfig = (id: string, name: string): AgentConfig =>
  ({
    schema_version: '1.2',
    meta: { id, name, version: '0.1.0', status: 'draft' },
    runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
    defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } }, conversation: {} },
    persona: { name },
    channels: [
      {
        id: 'web-chat',
        type: 'web_chat',
        enabled: true,
        entry: { widget_id: `${id}-widget` },
        modalities: { input: ['text'], output: ['text'] },
        greeting: { say: 'Hello! How can I help you today?' },
      },
    ],
    agents: {
      entry: 'assistant',
      items: [{ id: 'assistant', name, kind: 'standalone', instructions: { role: 'You are a helpful assistant. Answer briefly and politely.' }, tools: [] }],
    },
  }) as unknown as AgentConfig;

interface DraftSummary {
  kind?: string;
  name?: string;
  channels?: string[];
  tone?: string;
}

/** The rules' summary in a sentence: "A first draft of a Booking concierge agent called Maya on phone and web-chat, in a friendly tone." */
export function summarySentence(s: DraftSummary): string {
  return `A first draft of a ${s.kind || 'support'} agent${s.name ? ` called ${s.name}` : ''}${s.channels?.length ? ` on ${s.channels.join(' and ')}` : ''}${s.tone ? `, in a ${s.tone} tone` : ''}.`;
}

/**
 * A first draft from the description, made by the rules from a minimal agent with this agent's id and name, then
 * checked like any draft. Throws an Error with a sentence a person can read when the rules can't make one.
 */
export async function proposeWithRules(
  request: string,
  before: AgentConfig,
  {
    validate,
    signal,
  }: { validate: (config: AgentConfig, signal?: AbortSignal) => Promise<{ errors?: Issue[]; warnings?: Issue[] }>; signal?: AbortSignal }
): Promise<Proposal> {
  const meta = ((before as { meta?: { id?: string; name?: string } } | null)?.meta ?? {}) as { id?: string; name?: string };
  const made = generateDraft(request, minimalConfig(meta.id || 'agent', meta.name || 'New agent'));
  if (!made.ok) throw new Error(made.problem || 'The built-in rules could not make a draft from that.');
  const config = made.config as unknown as AgentConfig;
  const checked = await validate(config, signal).catch((error: unknown) => {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    return { errors: [], warnings: [] };
  });
  return {
    config,
    summary: summarySentence(made.summary as unknown as DraftSummary),
    assumptions: made.assumptions ?? [],
    questions: made.questions ?? [],
    toolUseId: '',
    issues: { errors: checked.errors ?? [], warnings: checked.warnings ?? [] },
    repairs: 0,
    usage: { input: 0, output: 0, cached: 0 },
  };
}

/** Descriptions to start from (the rules make a new agent, so these describe one; from React's AssistantTab). */
export const RULES_EXAMPLES = [
  'A friendly receptionist for a dental clinic. It answers the phone and the website chat, books appointments, and passes anything urgent to a person. It should never give medical advice.',
  'A customer care assistant for a phone company that helps with bills. Calm, short sentences. Never promise a refund. Spanish and English.',
  'A web chat helper for an online shop. It tells customers where their order is and explains the returns policy. If the customer asks for a person, hand over.',
];
