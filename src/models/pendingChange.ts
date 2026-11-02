// A change another page asks for on an agent's draft ("keep this call as a test", "fix this call", and later "use this
// voice", "add this connection"). The page queues it and opens the agent; the agent's workspace takes it once its
// draft has loaded, puts it in the editor as an ordinary edit (unsaved, undoable) and says so. One change waits at a
// time, in this tab only (sessionStorage); it never holds a secret.
import type { AgentConfig } from '../types/studio';
import type { PageTarget } from './agentPages';
import type { TestScenario } from './replayRun';

/** One edit to the draft, kept as data so it can wait in storage and be applied to whatever draft loads. */
export type DraftEdit =
  /** Adds a test scenario to `tests`; a scenario whose id is taken by then gets a fresh one. */
  | { op: 'add_test'; scenario: TestScenario }
  /** Adds rules to "how it speaks" (persona.style_rules), each once. */
  | { op: 'add_style_rules'; rules: string[] }
  /** Sets a model (defaults.models.<stage>.model, and the provider when given). */
  | { op: 'set_model'; stage: 'llm' | 'stt' | 'tts'; model: string; provider?: string }
  /**
   * Sets the voice (defaults.models.tts provider + voice_id). `model` is the provider's model, used when the provider
   * changes or no model is set; the same provider keeps the model chosen.
   */
  | { op: 'set_voice'; provider: string; voiceId: string; model?: string }
  /**
   * Adds a connection under `id` (or id_2, id_3… when taken). Its sign-in names a server secret ({ secret: NAME }),
   * never a key.
   */
  | { op: 'add_connection'; id: string; connection: Record<string, unknown> }
  /** Lays a whole configuration (a saved template) over the draft, keeping the draft's own meta (id, name, version). */
  | { op: 'use_template'; config: AgentConfig };

export interface PendingChange {
  /** What the person is told when it lands, e.g. "Added the test “x” to the draft." */
  note: string;
  edits: DraftEdit[];
  /** Where to open the agent once it is applied. */
  target?: PageTarget;
}

const KEY = 'weave_pending_change';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Queues a change for an agent's draft (replacing any other waiting change). */
export function queueChange(agentId: string, change: PendingChange): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ agentId, ...change }));
  } catch {
    // Storage is off: the change is simply not carried over, and the agent opens as it is.
  }
}

/** The change waiting for this agent, removed from the queue; null when there is none (or it is for another agent). */
export function takeChange(agentId: string): PendingChange | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isObj(parsed) || parsed.agentId !== agentId || !Array.isArray(parsed.edits)) return null;
    window.sessionStorage.removeItem(KEY);
    return { note: typeof parsed.note === 'string' ? parsed.note : '', edits: parsed.edits as DraftEdit[], ...(isObj(parsed.target) ? { target: parsed.target as unknown as PageTarget } : {}) };
  } catch {
    return null;
  }
}

const taken = (tests: unknown[], id: string) => tests.some((t) => isObj(t) && t.id === id);

/** The config with one edit made; the same object when the edit changes nothing. */
export function applyEdit(config: AgentConfig, edit: DraftEdit): AgentConfig {
  switch (edit.op) {
    case 'add_test': {
      const tests: unknown[] = Array.isArray(config.tests) ? config.tests : [];
      let id = edit.scenario.id;
      for (let n = 2; taken(tests, id); n += 1) id = `${edit.scenario.id}_${n}`;
      return { ...config, tests: [...tests, { ...edit.scenario, id }] };
    }
    case 'add_style_rules': {
      const rules: string[] = Array.isArray(config.persona?.style_rules) ? config.persona.style_rules : [];
      const fresh = edit.rules.filter((r) => r && !rules.includes(r));
      if (!fresh.length) return config;
      return { ...config, persona: { ...(config.persona ?? {}), style_rules: [...rules, ...fresh] } };
    }
    case 'set_model': {
      const models = config.defaults?.models ?? {};
      const found: unknown = models[edit.stage];
      const current: Record<string, unknown> = isObj(found) ? found : {};
      if (current.model === edit.model && (!edit.provider || current.provider === edit.provider)) return config;
      const next = { ...current, ...(edit.provider ? { provider: edit.provider } : {}), model: edit.model };
      return { ...config, defaults: { ...(config.defaults ?? {}), models: { ...models, [edit.stage]: next } } };
    }
    case 'set_voice': {
      const models = config.defaults?.models ?? {};
      const found: unknown = models.tts;
      const current: Record<string, unknown> = isObj(found) ? found : {};
      const provider = edit.provider.trim().toLowerCase();
      const sameProvider = current.provider === provider;
      if (sameProvider && current.voice_id === edit.voiceId && (current.model || !edit.model)) return config;
      const model = sameProvider && current.model ? current.model : edit.model;
      const next: Record<string, unknown> = { ...current, provider, voice_id: edit.voiceId };
      if (model) next.model = model;
      else delete next.model;
      return { ...config, defaults: { ...(config.defaults ?? {}), models: { ...models, tts: next } } };
    }
    case 'add_connection': {
      const connections: Record<string, unknown> = isObj(config.connections) ? config.connections : {};
      if (Object.values(connections).some((c) => JSON.stringify(c) === JSON.stringify(edit.connection))) return config;
      let id = edit.id;
      for (let n = 2; id in connections; n += 1) id = `${edit.id}_${n}`;
      return { ...config, connections: { ...connections, [id]: edit.connection } };
    }
    case 'use_template': {
      const next = { ...edit.config, meta: { ...(isObj(edit.config.meta) ? edit.config.meta : {}), ...(config.meta ?? {}) } };
      return JSON.stringify(next) === JSON.stringify(config) ? config : next;
    }
    default:
      return config;
  }
}

/** True when the edit would change nothing (it is already in the config). */
export const isApplied = (config: AgentConfig, edit: DraftEdit): boolean => applyEdit(config, edit) === config;

/** The config with every edit of a change made, in order. */
export const applyChange = (config: AgentConfig, change: Pick<PendingChange, 'edits'>): AgentConfig => change.edits.reduce(applyEdit, config);
