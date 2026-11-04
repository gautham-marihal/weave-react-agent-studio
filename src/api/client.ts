// Thin client for the Agent Builder API. The browser calls /api; the Vite server proxies it to the
// real API and adds the bearer key (see vite.config.js), so no credential lives in this code.

import type {
  AgentConfig,
  BotSummary,
  CallPage,
  CallRecords,
  DeployResult,
  Deployment,
  Deployments,
  Diff,
  Draft,
  Published,
  ProvidersAnswer,
  RequestOptions,
  SavedDraft,
  Session,
  ValidationIssue,
  ValidationReport,
  Version,
  VersionSummary,
} from './types.ts';
import { isDemoMode } from '../demo/demoMode.js';
import type { ZodMiniType } from 'zod/mini';
import * as S from './schemas.ts';

// import.meta.env only exists under Vite; the unit tests import this file in plain Node.
const env: Record<string, string | undefined> | undefined = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
const BASE: string = env?.VITE_API_BASE || '/api';

// The signed-in person, sent as `X-User` so saves, deploys and number changes say who made them. Only a claim: in
// production the proxy replaces it (docs/PRODUCTION.md); VITE_SEND_USER_HEADER=false stops the browser sending it.
let currentUser = '';
export const setApiUser = (name: unknown, fallback: unknown = ''): void => {
  currentUser = headerSafe(name) || headerSafe(fallback);
};
export const getApiUser = (): string => currentUser;
const SEND_USER_HEADER = env?.VITE_SEND_USER_HEADER !== 'false';

// A header carries printable Latin-1 only: a name in another script (or with a line break) can't be sent as it is, so
// the email is used instead, or nothing.
export function headerSafe(value: unknown): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^[\x20-\x7e\xa0-\xff]{1,200}$/.test(text) ? text : '';
}

// `kind` tells the UI what to do with a failure:
//   network     the request never got an answer, or a proxy/gateway answered because the API is down
//   auth        401, wrong or missing key
//   not_found   404
//   conflict    409 (someone else saved the draft, or the id is taken)
//   invalid     422 {detail, errors:[{path,message}]}: a config that cannot be published / tried. Show `errors`.
//   client_bug  422 {detail:[{loc,msg}]}: we sent a malformed request. Never show this to a user.
//   unavailable 503, e.g. LiveKit not configured
//   unexpected  an answer of another shape than the studio reads (schemas.ts): the message names the field
//   server      anything else
type ApiErrorKind = 'network' | 'auth' | 'not_found' | 'conflict' | 'invalid' | 'client_bug' | 'unavailable' | 'unexpected' | 'server';

export class ApiError extends Error {
  status: number;
  kind: ApiErrorKind;
  errors: ValidationIssue[];
  body: unknown;
  constructor({
    status,
    kind,
    message,
    errors = [],
    body = null,
  }: {
    status: number;
    kind: ApiErrorKind;
    message: string;
    errors?: ValidationIssue[];
    body?: unknown;
  }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.errors = errors;
    this.body = body;
  }
}

export function classify(status: number, body: unknown): { kind: ApiErrorKind; message: string; errors: ValidationIssue[] } {
  const detail = body && typeof body === 'object' ? (body as { detail?: unknown }).detail : undefined;
  // A 5xx with no JSON `detail` didn't come from the API's handlers: empty (dev proxy) or 502/503/504 means the API is
  // down or restarting; anything else means the API itself failed, so a change may be half made.
  if (status >= 500 && detail === undefined) {
    if (body === null || body === '' || [502, 503, 504].includes(status)) return { kind: 'network', message: 'The server isn’t responding.', errors: [] };
    return { kind: 'server', message: `The server had an error (${status}). If you were saving or deploying, check whether it went through.`, errors: [] };
  }
  if (status === 422 && Array.isArray(detail)) {
    const where = detail.map((item: { loc?: unknown[]; msg?: string }) => `${(item.loc || []).join('.')}: ${item.msg}`).join('; ');
    return { kind: 'client_bug', message: `The app sent a malformed request (${where}).`, errors: [] };
  }
  const message = typeof detail === 'string' ? detail : `Request failed (${status}).`;
  if (status === 422) {
    const errors = (body as { errors?: unknown } | null)?.errors;
    return { kind: 'invalid', message, errors: Array.isArray(errors) ? (errors as ValidationIssue[]) : [] };
  }
  if (status === 401) return { kind: 'auth', message, errors: [] };
  if (status === 404) return { kind: 'not_found', message, errors: [] };
  if (status === 409) return { kind: 'conflict', message, errors: [] };
  if (status === 503) return { kind: 'unavailable', message, errors: [] };
  return { kind: 'server', message, errors: [] };
}

type SendOptions = RequestOptions & { body?: unknown; raw?: Blob | string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each endpoint below says what it answers; this is the untyped wire
async function request(method: string, path: string, options: SendOptions = {}): Promise<any> {
  try {
    return await send(method, path, options);
  } catch (error) {
    // A read dropped on the way (a proxy or server closing an idle connection) is retried once: it changes nothing and
    // the retry nearly always works. Writes are never repeated, nor a request the person cancelled.
    if (method !== 'GET' || (error as ApiError)?.kind !== 'network' || options.signal?.aborted) throw error;
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    if (options.signal?.aborted) throw error;
    return send(method, path, options);
  }
}

async function send(method: string, path: string, { body, signal, raw }: SendOptions = {}): Promise<unknown> {
  if (isDemoMode()) return demoRequest(method, path, raw !== undefined ? { __file: raw } : body, signal);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (SEND_USER_HEADER && currentUser) headers['X-User'] = currentUser;
  let response: Response;
  try {
    // `raw` is a file: the body IS the file (knowledge uploads), not JSON and not a form
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      signal,
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError({ status: 0, kind: 'network', message: 'Couldn’t reach the server.' });
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const { kind, message, errors } = classify(response.status, data);
    throw new ApiError({ status: response.status, kind, message, errors, body: data });
  }
  return data;
}

// A read's answer is checked against schemas.ts before use and returned as it came (unknown fields kept); another shape
// is an error naming the field. Only reads are checked, so a write that succeeded is never reported as failed.
function describeIssue(issue: { path: PropertyKey[]; code: string; expected?: string }): string {
  const where = issue.path.length
    ? issue.path.map((part, i) => (typeof part === 'number' ? `[${part}]` : `${i ? '.' : ''}${String(part)}`)).join('')
    : 'the answer';
  if (issue.code === 'invalid_type' && issue.expected) {
    if (issue.expected === 'nonoptional') return `${where} is missing`;
    return `${where} should be ${/^[aeiou]/.test(issue.expected) ? 'an' : 'a'} ${issue.expected}`;
  }
  if (issue.code === 'invalid_value') return `${where} has a value the studio doesn’t know`;
  return `${where} is not as expected`;
}

export function checked<T>(schema: ZodMiniType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (result.success) return data as T;
  const first = result.error.issues[0] as { path: PropertyKey[]; code: string; expected?: string };
  throw new ApiError({
    status: 200,
    kind: 'unexpected',
    message: `The server sent something unexpected (${what}: ${describeIssue(first)}).`,
    body: data,
  });
}

// a read whose answer is checked
async function read<T>(schema: ZodMiniType<T>, method: string, path: string, options: SendOptions = {}): Promise<T> {
  return checked(schema, await request(method, path, options), `${method} ${path.split('?')[0]}`);
}

// Demo mode: the same call answered by the in-browser imitation API (src/demo/demoApi.js), loaded only when needed.
async function demoRequest(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const aborted = () => new DOMException('Aborted', 'AbortError');
  if (signal?.aborted) throw aborted();
  const { getDemoApi } = await import('../demo/demoApi.js');
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  }); // a moment, so loading states are real
  if (signal?.aborted) throw aborted();
  // a knowledge upload's file is kept as it is; the rest is copied so the imitation can't change the caller's objects
  const isFile = !!body && typeof body === 'object' && (body as { __file?: unknown }).__file !== undefined;
  const payload = body === undefined ? undefined : isFile ? body : JSON.parse(JSON.stringify(body));
  const { status, body: data } = await getDemoApi().handle(method, path, payload);
  if (status >= 400) {
    const { kind, message, errors } = classify(status, data);
    throw new ApiError({ status, kind, message, errors, body: data });
  }
  return data;
}

const enc = encodeURIComponent;

// The browser's address for an API path (for a plain link, such as a file download). None in demo mode.
export const apiUrl = (path: string): string | null => (isDemoMode() ? null : `${BASE}${path}`);

type Opts = RequestOptions | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers the API has not pinned down yet (tests, numbers, knowledge, previews)
type Loose = any;

export const api = {
  health: (opts?: Opts): Promise<{ ok: boolean }> => read(S.Health, 'GET', '/health', opts),
  /** the JSON Schema of an agent configuration */
  schema: (opts?: Opts): Promise<Record<string, unknown>> => read(S.JsonSchema, 'GET', '/schema', opts),
  environments: (opts?: Opts): Promise<string[]> => read(S.Environments, 'GET', '/environments', opts),
  // The model providers the runtime can run: [{name, stages, installed, default_secret, key_available, ...}].
  providers: (opts?: Opts): Promise<ProvidersAnswer> => read(S.ProvidersAnswer, 'GET', '/providers', opts),
  // a read too: it checks the config and changes nothing
  validate: (config: AgentConfig | unknown, opts?: Opts): Promise<ValidationReport> => read(S.ValidationReport, 'POST', '/validate', { ...opts, body: config }),

  // Only real agents are listed (each has a draft); the server no longer lists the folders it writes call data to.
  listBots: (opts?: Opts): Promise<BotSummary[]> => read(S.BotList, 'GET', '/bots', opts),
  // Answers with the new bot's first draft ({bot_id, revision, saved_at, saved_by, config}).
  createBot: ({ id, name }: { id: string; name: string }, opts?: Opts): Promise<Draft> => request('POST', '/bots', { ...opts, body: { id, name } }),
  getBot: (id: string, opts?: Opts): Promise<BotSummary> => read(S.BotSummary, 'GET', `/bots/${enc(id)}`, opts),

  getDraft: (id: string, opts?: Opts): Promise<Draft> => read(S.Draft, 'GET', `/bots/${enc(id)}/draft`, opts),
  // Omit baseRevision to overwrite; send it to get a 409 if someone saved in between.
  saveDraft: (id: string, config: AgentConfig | unknown, baseRevision?: number | null, opts?: Opts): Promise<SavedDraft> =>
    request('PUT', `/bots/${enc(id)}/draft`, {
      ...opts,
      body: baseRevision === undefined || baseRevision === null ? { config } : { config, base_revision: baseRevision },
    }),

  // `bump` ("major" | "minor" | "patch") is counted from the latest published version; the server refuses it
  // until something has been published. Without it the draft's own meta.version is published.
  publish: (id: string, bump?: 'major' | 'minor' | 'patch', opts?: Opts): Promise<Published> =>
    request('POST', `/bots/${enc(id)}/publish`, { ...opts, body: bump ? { bump } : {} }),
  /** newest first */
  listVersions: (id: string, opts?: Opts): Promise<VersionSummary[]> => read(S.VersionList, 'GET', `/bots/${enc(id)}/versions`, opts),
  getVersion: (id: string, version: string, opts?: Opts): Promise<Version> => read(S.Version, 'GET', `/bots/${enc(id)}/versions/${enc(version)}`, opts),
  // a and b are versions ("0.1.0") or "draft".
  diff: (id: string, a: string, b: string, opts?: Opts): Promise<Diff> => read(S.Diff, 'GET', `/bots/${enc(id)}/diff?a=${enc(a)}&b=${enc(b)}`, opts),

  // Answers 200 today; may become 202 with status "pending" (poll getDeployment until active / failed).
  deploy: (id: string, { version, environment, note }: { version: string; environment: string; note?: string }, opts?: Opts): Promise<DeployResult> =>
    request('POST', `/bots/${enc(id)}/deploy`, {
      ...opts,
      body: { version, environment, ...(note ? { note } : {}) },
    }),
  /** history is oldest first */
  listDeployments: (id: string, opts?: Opts): Promise<Deployments> => read(S.Deployments, 'GET', `/bots/${enc(id)}/deployments`, opts),
  getDeployment: (id: string, deploymentId: string, opts?: Opts): Promise<Deployment | DeployResult> =>
    read(S.DeploymentAnswer, 'GET', `/bots/${enc(id)}/deployments/${enc(deploymentId)}`, opts),

  // ref: "draft" (default), "latest", a version, or an environment name.
  startSession: (id: string, { ref, identity, channel }: { ref?: string; identity?: string; channel?: string } = {}, opts?: Opts): Promise<Session> =>
    request('POST', `/bots/${enc(id)}/sessions`, {
      ...opts,
      // `channel`: the web channel the visitor chose, when the bot offers more than one (chat and voice side by side)
      body: { ...(ref ? { ref } : {}), ...(identity ? { identity } : {}), ...(channel ? { channel } : {}) },
    }),

  // ---- test scenarios: scripted ones replace the model with a script, live ones use a real model (costs money)
  // `{ scenarios, ref, network_allowed }`: each scenario with the result of its last run.
  listTests: (id: string, { ref }: { ref?: string } = {}, opts?: Opts): Promise<Loose> =>
    request('GET', `/bots/${enc(id)}/tests${ref ? `?ref=${enc(ref)}` : ''}`, opts),
  // Answers 202 with a run to poll. `config` tests the unsaved editor (ref "unsaved"); `scenarios` is a list of ids;
  // `live` also runs scenarios without a model_script on a real model (costs money); `judge` grades `judge` checks.
  runTests: (
    id: string,
    run: { ref?: string; config?: AgentConfig | unknown; scenarios?: string[]; live?: boolean; judge?: boolean; allow_network?: boolean } = {},
    opts?: Opts,
  ): Promise<Loose> => request('POST', `/bots/${enc(id)}/tests/run`, { ...opts, body: run }),
  /** headlines only, newest first */
  listTestRuns: (id: string, limit?: number, opts?: Opts): Promise<Loose[]> =>
    request('GET', `/bots/${enc(id)}/tests/runs${limit ? `?limit=${limit}` : ''}`, opts),
  getTestRun: (id: string, runId: string, opts?: Opts): Promise<Loose> => request('GET', `/bots/${enc(id)}/tests/runs/${enc(runId)}`, opts),

  // ---- call records: what callers said and what the bot did (these logs hold caller speech)
  listCalls: (
    id: string,
    filters: { limit?: number; cursor?: string; since?: string; until?: string; caller?: string; channel?: string; status?: string } = {},
    opts?: Opts,
  ): Promise<CallPage> => read(S.CallPage, 'GET', `/bots/${enc(id)}/calls${queryOf(filters)}`, opts),
  getCall: (id: string, callId: string, query: { after?: number; limit?: number; kinds?: string } = {}, opts?: Opts): Promise<CallRecords> =>
    read(S.CallRecords, 'GET', `/bots/${enc(id)}/calls/${enc(callId)}${queryOf(query)}`, opts),
  getTranscript: (id: string, callId: string, opts?: Opts): Promise<Loose> => request('GET', `/bots/${enc(id)}/calls/${enc(callId)}/transcript`, opts),

  // ---- previews: what the model would be told and shown (they call and spend nothing; send `config` for the editor's)
  previewPrompt: (
    body: { config?: AgentConfig | unknown; bot?: string; ref?: string; agent?: string; channel?: string; state?: object; caller_phone?: string; now?: string },
    opts?: Opts,
  ): Promise<Loose> => request('POST', '/preview/prompt', { ...opts, body }),
  previewResult: (
    body: {
      config?: AgentConfig | unknown;
      bot?: string;
      ref?: string;
      tool: string;
      args?: object;
      response?: unknown;
      state?: object;
      channel?: string;
      now?: string;
    },
    opts?: Opts,
  ): Promise<Loose> => request('POST', '/preview/result', { ...opts, body }),
  // How a line would be said, what the safety rules do with a line, what redaction would hide, and a task step by step.
  // All four read the config in the editor.
  previewSpeech: (
    body: {
      config?: AgentConfig | unknown;
      bot?: string;
      ref?: string;
      text: string;
      agent?: string;
      channel?: string;
      source?: 'model' | 'fixed';
      chunks?: string[];
    },
    opts?: Opts,
  ): Promise<Loose> => request('POST', '/preview/speech', { ...opts, body }),
  previewGuardrails: (body: { config?: AgentConfig | unknown; bot?: string; ref?: string; text: string }, opts?: Opts): Promise<Loose> =>
    request('POST', '/preview/guardrails', { ...opts, body }),
  previewRedaction: (body: { config?: AgentConfig | unknown; bot?: string; ref?: string; text: string; state?: object }, opts?: Opts): Promise<Loose> =>
    request('POST', '/preview/redaction', { ...opts, body }),
  previewTask: (
    body: { config?: AgentConfig | unknown; bot?: string; ref?: string; task: string; state?: object; channel?: string; caller_phone?: string; now?: string },
    opts?: Opts,
  ): Promise<Loose> => request('POST', '/preview/task', { ...opts, body }),
  // The kinds of value redaction can find and how each is recognised (a read: it needs no config).
  redactionEntities: (opts?: Opts): Promise<{ entities: { kind: string; how: string }[] }> => request('GET', '/redaction/entities', opts),

  // What each kind of channel may carry and offer: the source for which options a screen shows. A read.
  channelTypes: (opts?: Opts): Promise<{ types: Loose[]; note?: string }> => request('GET', '/channel-types', opts),

  // ---- phone numbers: the API checks a number is free and sets up the LiveKit trunk and dispatch rule. The three
  // writes (create, change, release) change the phone system, so they are only ever sent on a person's click.
  numberSettings: (opts?: Opts): Promise<Loose> => request('GET', '/numbers/settings', opts),
  listNumbers: (opts?: Opts): Promise<Loose[]> => request('GET', '/numbers', opts),
  checkNumber: (number: string, opts?: Opts): Promise<{ status: string; owner?: Loose; warnings?: string[]; reason?: string }> =>
    request('GET', `/numbers/check?number=${enc(number)}`, opts),
  listBotNumbers: (id: string, opts?: Opts): Promise<Loose[]> => request('GET', `/bots/${enc(id)}/numbers`, opts),
  createNumber: (
    id: string,
    body: { number: string; environment: string; record_audio?: boolean; krisp?: boolean; allowed_addresses?: string[]; max_call_duration_s?: number },
    opts?: Opts,
  ): Promise<Loose> => request('POST', `/bots/${enc(id)}/numbers`, { ...opts, body }),
  changeNumber: (
    id: string,
    number: string,
    body: { environment?: string; record_audio?: boolean; krisp?: boolean; allowed_addresses?: string[]; max_call_duration_s?: number },
    opts?: Opts,
  ): Promise<Loose> => request('PATCH', `/bots/${enc(id)}/numbers/${enc(number)}`, { ...opts, body }),
  releaseNumber: (id: string, number: string, opts?: Opts): Promise<{ removed: Loose[] }> => request('DELETE', `/bots/${enc(id)}/numbers/${enc(number)}`, opts),

  // ---- knowledge: the files a `vector_store` base reads, its index, and a test search
  getKnowledge: (id: string, { ref }: { ref?: string } = {}, opts?: Opts): Promise<Loose> =>
    request('GET', `/bots/${enc(id)}/knowledge${ref ? `?ref=${enc(ref)}` : ''}`, opts),
  listKnowledgeFiles: (id: string, opts?: Opts): Promise<Loose[]> => request('GET', `/bots/${enc(id)}/knowledge/files`, opts),
  // The body IS the file (`fetch(url, { method: 'PUT', body: file })`), not a form. 400 wrong type, 413 too big.
  uploadKnowledgeFile: (id: string, name: string, file: Blob | string, opts?: Opts): Promise<Loose> =>
    request('PUT', `/bots/${enc(id)}/knowledge/files/${enc(name)}`, { ...opts, raw: file }),
  // 409 when a base reads the file, unless force.
  deleteKnowledgeFile: (id: string, name: string, force?: boolean, opts?: Opts): Promise<Loose> =>
    request('DELETE', `/bots/${enc(id)}/knowledge/files/${enc(name)}${force ? '?force=true' : ''}`, opts),
  // Answers 202 with a job to poll with knowledgeStatus; one build per base at a time (409).
  buildKnowledge: (id: string, base: string, ref?: string, opts?: Opts): Promise<Loose> =>
    request('POST', `/bots/${enc(id)}/knowledge/${enc(base)}/build`, { ...opts, body: ref ? { ref } : {} }),
  knowledgeStatus: (id: string, base: string, ref?: string, opts?: Opts): Promise<Loose> =>
    request('GET', `/bots/${enc(id)}/knowledge/${enc(base)}/status${ref ? `?ref=${enc(ref)}` : ''}`, opts),
  searchKnowledge: (id: string, base: string, search: { query: string; top_k?: number; previous_reply?: string; ref?: string }, opts?: Opts): Promise<Loose> =>
    request('POST', `/bots/${enc(id)}/knowledge/${enc(base)}/search`, { ...opts, body: search }),
};

// ?a=1&b=2 from an object, leaving out what is empty
function queryOf(values: Record<string, unknown> | null | undefined): string {
  const query = new URLSearchParams();
  Object.entries(values || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

type FollowHandlers = {
  onOpen?: (call: Loose) => void;
  onRecord: (record: Loose) => void;
  onEnd?: () => void;
  onError?: () => void;
  after?: number;
};

// Follows a call in progress one record at a time over server-sent events (`/calls/{id}/stream`). EventSource can't
// set headers, so the proxy must add the key and not buffer this path. Demo mode follows an imitation. Returns a stop.
export function followCall(id: string, callId: string, { onOpen, onRecord, onEnd, onError, after }: FollowHandlers = { onRecord() {} }): () => void {
  if (isDemoMode()) {
    let stop = () => {};
    let stopped = false;
    import('../demo/demoApi.js').then(({ getDemoApi }) => {
      if (!stopped) stop = getDemoApi().follow(id, callId, { onOpen, onRecord, onEnd, after });
    });
    return () => {
      stopped = true;
      stop();
    };
  }
  const source = new EventSource(`${BASE}/bots/${enc(id)}/calls/${enc(callId)}/stream${after ? `?after=${after}` : ''}`);
  const parse = (event: MessageEvent) => {
    try {
      return JSON.parse(event.data);
    } catch {
      return null;
    }
  };
  source.addEventListener('open', (event) => {
    const call = parse(event as MessageEvent);
    if (call && onOpen) onOpen(call);
  });
  source.onmessage = (event) => {
    const record = parse(event);
    if (record) onRecord(record);
  };
  source.addEventListener('end', () => {
    source.close();
    if (onEnd) onEnd();
  });
  source.addEventListener('error', () => {
    if (source.readyState === EventSource.CLOSED && onError) onError();
  });
  return () => source.close();
}

type FlatIssue = { severity: 'error' | 'warning'; path: Array<string | number> | null; message: string };

// A validation report (POST /validate, or `validation` in a saved draft) addresses a problem by `path`
// ([] or null mean "general message"). Turns it into one flat list the editor can show per field.
export function groupIssues(report: Partial<ValidationReport> | null | undefined): FlatIssue[] {
  const toIssue =
    (severity: FlatIssue['severity']) =>
    (item: ValidationIssue): FlatIssue => ({
      severity,
      path: Array.isArray(item.path) && item.path.length ? item.path : null,
      message: item.message,
    });
  return [...(report?.errors || []).map(toIssue('error')), ...(report?.warnings || []).map(toIssue('warning'))];
}
