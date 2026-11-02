// "Try it" for one tool: the server's POST /preview/result answer, read tolerantly (a missing part is left out, never
// an error), the arguments it starts with, and the body it is asked with. Nothing is called or spent there, and the
// sample answer typed on the page is never saved. Pure: no React, no network.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

export interface PreviewTask {
  id: string;
  steps: string[];
  wouldRun: boolean | null;
  why: string;
}

export interface ResultPreview {
  request: { method: string; url: string; query: Json; headers: Json; body: unknown; auth: { type: string; secrets: string[] } | null } | null;
  preconditions: { holds: boolean; message: string } | null;
  argsProblems: string[];
  hasAnswer: boolean;
  modelSees: unknown;
  modelSeesText: string;
  storedInState: Json;
  keptFromModel: string[];
  effects: string[];
  task: PreviewTask | null;
  /** What the server says about its own answer, as it says it. */
  note: string;
}

function taskOf(raw: unknown): PreviewTask | null {
  if (typeof raw === 'string') return raw ? { id: raw, steps: [], wouldRun: null, why: '' } : null;
  if (!isObj(raw)) return null;
  const id = text(raw.id || raw.task);
  if (!id) return null;
  const run = [raw.would_run, raw.runs, raw.runs_now].find((v): v is boolean => typeof v === 'boolean');
  return {
    id,
    steps: list(raw.steps ?? raw.step_ids)
      .map((s) => (isObj(s) ? text(s.id) : text(s)))
      .filter(Boolean),
    wouldRun: run ?? (raw.skipped_now === true ? false : raw.skipped_now === false ? true : null),
    why: text(raw.reason || raw.why_not || raw.why),
  };
}

/** The answer parts may sit under `result` or at the top level. */
export function normalizeResultPreview(raw: unknown): ResultPreview {
  const r = (isObj(raw) ? raw : {}) as Json;
  const request = isObj(r.request) ? r.request : null;
  const result = isObj(r.result) ? r.result : null;
  const pick = (key: string) => (result && key in result ? result[key] : r[key]);
  const hasAnswer = result !== null || 'model_sees' in r || 'model_sees_text' in r;
  const auth = request && isObj(request.auth) ? request.auth : null;
  const stored = pick('stored_in_state');
  return {
    request: request && {
      method: text(request.method),
      url: text(request.url || request.path),
      query: isObj(request.query) ? request.query : {},
      headers: isObj(request.headers) ? request.headers : {},
      body: request.body ?? null,
      auth: auth ? { type: text(auth.type), secrets: list(auth.secrets).map(text) } : null,
    },
    preconditions: isObj(r.preconditions) ? { holds: r.preconditions.holds !== false, message: text(r.preconditions.message) } : null,
    argsProblems: list(r.args_problems).map((p) => (typeof p === 'string' ? p : isObj(p) ? text(p.message) : text(p))),
    hasAnswer,
    modelSees: hasAnswer ? pick('model_sees') : undefined,
    modelSeesText: hasAnswer ? text(pick('model_sees_text')) : '',
    storedInState: isObj(stored) ? stored : {},
    keptFromModel: list(pick('kept_from_the_model')).map(text),
    effects: list(pick('effects')).map((e) => (typeof e === 'string' ? e : isObj(e) ? text(e.text || e.description) : text(e))),
    task: taskOf(r.task),
    note: text(r.note),
  };
}

/** "Starts the task “verify_identity” (3 steps: ask_dob, ask_postcode, check). It would run now." */
export function taskWords(task: PreviewTask | null): string {
  if (!task) return '';
  const steps = task.steps.length ? ` (${task.steps.length} step${task.steps.length === 1 ? '' : 's'}: ${task.steps.join(', ')})` : '';
  const run =
    task.wouldRun === true
      ? ' It would run now.'
      : task.wouldRun === false
        ? ` It would not run now${task.why ? `: ${task.why.replace(/\.$/, '')}` : ', because it is already done'}.`
        : '';
  return `Starts the task “${task.id}”${steps}.${run}`;
}

/** Starting arguments: a value for each parameter, from its example, default, first choice or kind. */
export function sampleArgs(parameters: unknown): Json {
  const props = isObj(parameters) && isObj(parameters.properties) ? parameters.properties : {};
  return Object.fromEntries(
    Object.entries(props).map(([name, p]) => {
      const spec = (isObj(p) ? p : {}) as Json;
      const example = list(spec.examples)[0] ?? spec.example ?? spec.default;
      if (example !== undefined) return [name, example];
      if (list(spec.enum).length) return [name, list(spec.enum)[0]];
      const t = spec.type;
      return [name, t === 'integer' || t === 'number' ? 1 : t === 'boolean' ? true : t === 'array' ? [] : t === 'object' ? {} : `a ${name.replace(/_/g, ' ')}`];
    })
  );
}

/** Text typed as JSON: the value, or what is wrong with it. `object` asks for an object (the arguments). */
export function readJson(typed: string, { object = false }: { object?: boolean } = {}): { value?: unknown; error?: string } {
  if (!typed.trim()) return object ? { value: {} } : {};
  try {
    const value: unknown = JSON.parse(typed);
    if (object && !isObj(value)) return { error: 'The arguments must be a JSON object, like { "order_id": "A-1" }.' };
    return { value };
  } catch (error: unknown) {
    return { error: `Not valid JSON (${error instanceof Error ? error.message : String(error)}).` };
  }
}

/** The body POST /preview/result is asked with: the config in the editor, saved or not. */
export function resultPreviewBody(config: unknown, tool: string, args: Json, response?: unknown): Json {
  const body: Json = { config, tool, args };
  if (response !== undefined) body.response = response;
  return body;
}
