// "Getting it ready": the steps between a new agent and one that is live, each pointing at the page where it is done.
// Built only from real data: the draft, the server's checks, the tests and their latest run, the knowledge index, the
// published versions and what is deployed. It informs and never blocks. Home, the agent list, the header, Overview and
// Release all read it, so one agent shows one status everywhere. Pure: no React, no network.
import type { AgentConfig, ValidationReport } from '../types/studio';
import type { PageTarget } from './agentPages';
import { languageName } from './languages';

export type StepState = 'done' | 'todo' | 'blocked' | 'optional';

export interface ReadinessStep {
  id: string;
  label: string;
  text: string;
  state: StepState;
  target: PageTarget;
}

export interface Readiness {
  steps: ReadinessStep[];
  /** The first blocked step, else the first one to do; null when everything is done. */
  next: ReadinessStep | null;
  /** Counted steps (optional ones are not counted). */
  done: number;
  total: number;
}

/** The newest finished test run on the saved draft: status and counts. */
export interface LatestRun {
  status: 'passed' | 'failed' | 'error' | 'skipped';
  passed?: number;
  total?: number;
  startedAt?: string;
}

/** A gate's answer (1.3 "tests must pass before publishing"); null when the gate is off. */
export interface GateAnswer {
  ok: boolean;
  why: string;
  action: 'scenarios' | 'tests' | '';
}

/** What the server says about one knowledge base (GET /bots/{id}/knowledge). */
export interface KnowledgeBaseState {
  id: string;
  index?: unknown;
  build?: { status?: string } | null;
  problems?: unknown[];
}

export interface ReadinessInput {
  config: AgentConfig | null | undefined;
  /** The draft could not be read from the server: nothing else can be said. */
  loadError?: string;
  /** The server's checks on the draft; null while they are not known. */
  report?: ValidationReport | null;
  scenarioCount?: number;
  /** The newest finished run on the draft: null = never run, undefined = not known. */
  latestRun?: LatestRun | null;
  gate?: GateAnswer | null;
  /** The bases as the server reports them; null/undefined = not known. */
  knowledge?: KnowledgeBaseState[] | null;
  latestVersion?: string | null;
  /** Environment -> version running there. */
  deployed?: Partial<Record<string, string>>;
}

const list = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const words = (text: unknown) => (typeof text === 'string' ? text.trim().match(/\S+/g)?.length ?? 0 : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The agent that answers first (agents.entry, else the first). */
export function entryAgent(config: AgentConfig | null | undefined) {
  const items = list(config?.agents?.items);
  return items.find((a) => a.id === config?.agents?.entry) ?? items[0] ?? null;
}

/** The first greeting a channel says (a literal line, or a reference into messages, read as its text). */
export function firstGreeting(config: AgentConfig | null | undefined): string {
  for (const ch of list(config?.channels)) {
    if (!isObj(ch) || ch.enabled === false) continue;
    const say = ch.greeting?.say;
    if (typeof say === 'string' && say.trim()) return say.trim();
    if (isObj(say) && typeof say.message === 'string') {
      const msg = list(config?.messages as Array<{ id?: string; text?: unknown }>).find((m) => m?.id === say.message);
      if (typeof msg?.text === 'string' && msg.text.trim()) return msg.text.trim();
      if (msg) return `(message “${say.message}”)`;
    }
  }
  return '';
}

/** Whether people talk to it (a phone line or a voice channel that is on). */
export function hasVoiceChannel(config: AgentConfig | null | undefined): boolean {
  return list(config?.channels).some(
    (c) => isObj(c) && c.enabled !== false && (c.type === 'sip_voice' || c.type === 'web_voice' || list(c.modalities?.output as string[]).includes('audio'))
  );
}

/** How far the server has read a base's documents, the worst first. */
export type KnowledgeReading = 'failed' | 'reading' | 'unread' | 'changed' | 'ready' | 'unknown';

export function readingOf(base: KnowledgeBaseState | undefined): KnowledgeReading {
  if (!base) return 'unread';
  const status = base.build?.status;
  if (status === 'running' || status === 'pending') return 'reading';
  if (status === 'failed' && !base.index) return 'failed';
  if (!base.index) return 'unread';
  if (list(base.problems).length) return 'changed';
  return 'ready';
}

const KNOWLEDGE_TODO: Record<Exclude<KnowledgeReading, 'ready' | 'unknown'>, string> = {
  failed: 'Reading its documents failed.',
  reading: 'Its documents are being read.',
  unread: 'Its documents are saved but not read yet.',
  changed: 'Its documents changed since they were read.',
};
const WORST_FIRST: KnowledgeReading[] = ['failed', 'changed', 'unread', 'reading'];

export function runWords(run: LatestRun): string {
  return run.status === 'error' ? 'broke' : run.status === 'skipped' ? 'skipped everything' : 'failed';
}

export function readinessSteps(input: ReadinessInput): Readiness {
  const steps: ReadinessStep[] = [];
  const add = (s: ReadinessStep) => steps.push(s);

  if (input.loadError) {
    add({ id: 'load', label: 'Read the draft', text: `The draft could not be read from the server: ${input.loadError}`, state: 'blocked', target: { stage: 'overview' } });
    return finish(steps);
  }
  const config = input.config;
  if (!config || !isObj(config)) return { steps, next: null, done: 0, total: 0 };

  const role = entryAgent(config)?.instructions?.role;
  const n = words(role);
  add({
    id: 'prompt',
    label: 'Say what it should do',
    text: n >= 8 ? `${n} words of instructions.` : n ? `Only ${plural(n, 'word')} so far. Say who it helps, what it does and what it must not do.` : 'Write the instructions it follows: who it helps, what it does, what it must not do.',
    state: n >= 8 ? 'done' : 'todo',
    target: { stage: 'build', section: 'agent', focus: 'instructions' },
  });

  const greeting = firstGreeting(config);
  add({
    id: 'hello',
    label: 'Choose what it says first',
    text: greeting ? `“${greeting.length > 60 ? `${greeting.slice(0, 59)}…` : greeting}”` : 'Nothing is said when a conversation starts yet.',
    state: greeting ? 'done' : 'todo',
    target: { stage: 'build', section: 'channels', focus: 'greeting' },
  });

  const voice = hasVoiceChannel(config);
  const primary = config.defaults?.language?.primary;
  const voiceId = config.defaults?.models?.tts?.voice_id;
  const voiceOk = !!primary && (!voice || !!voiceId);
  add({
    id: 'voice',
    label: voice ? 'Pick a language and a voice' : 'Pick its language',
    text: voiceOk ? `${languageName(primary)}${voice ? ', with a voice chosen' : ''}.` : !primary ? 'No main language is set.' : 'A voice channel needs a voice.',
    state: voiceOk ? 'done' : 'todo',
    target: { stage: 'build', section: 'agent', focus: !primary ? 'language' : 'voice' },
  });

  const llm = config.defaults?.models?.llm;
  add({
    id: 'model',
    label: 'Choose the AI model',
    text: llm?.provider && llm.model ? `${llm.provider} · ${llm.model}` : 'The language model that decides what to say is not chosen yet.',
    state: llm?.provider && llm.model ? 'done' : 'todo',
    target: { stage: 'build', section: 'agent', focus: 'model' },
  });

  const tools = list(config.tools).filter((t) => isObj(t) && String(t.type) !== 'builtin');
  const bases = list(config.knowledge as Array<{ id?: string; type?: string }>).filter(isObj);
  add({
    id: 'abilities',
    label: 'Give it tools or knowledge',
    text: tools.length || bases.length ? [tools.length ? plural(tools.length, 'tool') : '', bases.length ? plural(bases.length, 'knowledge base') : ''].filter(Boolean).join(', ') + '.' : 'Optional: let it look something up, pass people on, or answer from your documents.',
    state: tools.length || bases.length ? 'done' : 'optional',
    target: { stage: 'build', section: 'tools' },
  });

  const readable = bases.filter((b) => b.type === 'vector_store');
  if (readable.length) {
    const states = input.knowledge ? readable.map((b) => readingOf(input.knowledge?.find((s) => s.id === b.id))) : [];
    const worst = WORST_FIRST.find((s) => states.includes(s)) as keyof typeof KNOWLEDGE_TODO | undefined;
    add({
      id: 'knowledge',
      label: 'Let it read its documents',
      text: worst ? KNOWLEDGE_TODO[worst] : input.knowledge ? 'Read, and ready to answer from.' : 'Its documents and web pages.',
      state: worst ? 'todo' : 'done',
      target: { stage: 'build', section: 'knowledge' },
    });
  }

  if (input.report) {
    const errors = input.report.errors.length;
    add({
      id: 'checks',
      label: errors ? 'Fix what the checks found' : 'The checks pass',
      text: errors ? `${plural(errors, 'problem')} to fix before the server will publish it.` : 'The server found nothing wrong.',
      state: errors ? 'blocked' : 'done',
      target: { stage: 'build', focus: 'problems' },
    });
  }

  const count = input.scenarioCount ?? 0;
  const run = input.latestRun;
  const testTarget: PageTarget = { stage: 'test', focus: 'scenarios' };
  if (input.gate && !input.gate.ok) add({ id: 'tests', label: 'Pass the tests', text: input.gate.why, state: 'blocked', target: input.gate.action === 'scenarios' ? { stage: 'build', focus: 'tests' } : testTarget });
  else if (count === 0) add({ id: 'tests', label: 'Write a test', text: 'Optional: a conversation it must always get right, checked every time it changes.', state: 'optional', target: { stage: 'build', focus: 'tests' } });
  else if (run === undefined) add({ id: 'tests', label: 'Write a test', text: `${plural(count, 'test')} written.`, state: 'done', target: testTarget });
  else if (run === null) add({ id: 'tests', label: 'Run the tests', text: `${plural(count, 'test')} written, not run yet.`, state: 'todo', target: testTarget });
  else if (run.status === 'passed') add({ id: 'tests', label: 'Run the tests', text: `The latest run passed (${run.passed ?? count} of ${run.total ?? count}).`, state: 'done', target: testTarget });
  else add({ id: 'tests', label: 'Fix the failing tests', text: `The latest run ${runWords(run)}${run.total ? ` (${run.passed ?? 0} of ${run.total} passed)` : ''}.`, state: 'blocked', target: testTarget });

  const latest = input.latestVersion;
  add({
    id: 'publish',
    label: 'Publish a version',
    text: latest ? `v${latest} is published.` : 'Freeze the draft as a version you can put live.',
    state: latest ? 'done' : 'todo',
    target: { stage: 'release' },
  });

  const live = Object.entries(input.deployed ?? {}).filter(([, v]) => !!v);
  add({
    id: 'deploy',
    label: 'Put it live',
    text: live.length ? `Running in ${live.map(([env]) => env).join(' and ')}.` : latest ? 'Choose where this version runs.' : 'Publish first, then choose where it runs.',
    // to do either way (never optional, only not possible yet), so the number of steps stays the same once published
    state: live.length ? 'done' : 'todo',
    target: { stage: 'release', focus: 'deploy' },
  });

  return finish(steps);
}

function finish(steps: ReadinessStep[]): Readiness {
  const counted = steps.filter((s) => s.state !== 'optional');
  const next = steps.find((s) => s.state === 'blocked') ?? steps.find((s) => s.state === 'todo') ?? null;
  return { steps, next, done: counted.filter((s) => s.state === 'done').length, total: counted.length };
}

/** Steps still to do on a page (for the ring on its nav item). */
export function openStepsOn(readiness: Readiness, match: (t: PageTarget) => boolean): ReadinessStep[] {
  return readiness.steps.filter((s) => (s.state === 'todo' || s.state === 'blocked') && match(s.target));
}
