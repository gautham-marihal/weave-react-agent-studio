// Typed client for the Agent Builder API
// Browser calls /api; the Vite dev server/gateway proxies to the real backend and adds the bearer key.

import type {
  AgentConfig,
  BotSummary,
  CallsResponse,
  CallTranscriptResponse,
  Deployment,
  DeployResult,
  Deployments,
  Diff,
  Draft,
  KnowledgeBase,
  KnowledgeFile,
  KnowledgeSearchResult,
  KnowledgeStatus,
  NumberCheck,
  NumberSettings,
  PhoneNumber,
  PromptPreview,
  ProvidersAnswer,
  Published,
  RequestOptions,
  SavedDraft,
  Scenario,
  Session,
  TestRun,
  ValidationIssue,
  ValidationReport,
  Version,
  VersionSummary,
} from './types';
import { isSandbox } from '../sandbox/mode';
import type { ZodMiniType } from 'zod/mini';
import * as S from './schemas';

const BASE = (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE || '/api';
/** Where the browser sends API calls (the gateway or dev proxy); the backend address itself is server config. */
export const API_BASE = BASE;

// The signed-in person, sent as `X-User` so saves, publishes and deploys say who made them. Only a claim: the proxy
// replaces it in production; VITE_SEND_USER_HEADER=false stops the browser sending it.
let currentUser = '';
export const setApiUser = (name: unknown, fallback: unknown = '') => {
  currentUser = headerSafe(name) || headerSafe(fallback);
};
export const getApiUser = () => currentUser;
const SEND_USER_HEADER = (import.meta as ImportMeta & { env?: { VITE_SEND_USER_HEADER?: string } }).env?.VITE_SEND_USER_HEADER !== 'false';

/** A header carries printable Latin-1 only: a name in another script (or with a line break) can't be sent as it is. */
export function headerSafe(value: unknown): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return /^[\x20-\x7e\xa0-\xff]{1,200}$/.test(text) ? text : '';
}

export type ApiErrorKind =
  | 'network'
  | 'auth'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'client_bug'
  | 'unavailable'
  /** an answer of another shape than the studio reads (schemas.ts): the message names the field */
  | 'unexpected'
  | 'server';

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
  const responseBody = isRecord(body) ? body : undefined;
  const detail = responseBody?.detail;

  // A 5xx with no JSON `detail` didn't come from the API's handlers: empty (dev proxy) or 502/503/504 means the API is
  // down or restarting; anything else means the API itself failed, so a change may be half made.
  if (status >= 500 && detail === undefined) {
    if (body === null || body === '' || [502, 503, 504].includes(status)) {
      return { kind: 'network', message: 'The Agent Builder API is not responding.', errors: [] };
    }
    return { kind: 'server', message: `The server had an error (${status}). If you were saving or deploying, check whether it went through.`, errors: [] };
  }
  if (status === 422 && Array.isArray(detail)) {
    const where = detail.map((item: unknown) => {
      if (!isRecord(item)) return String(item);
      const location = Array.isArray(item.loc) ? item.loc.join('.') : '';
      const message = typeof item.msg === 'string' ? item.msg : 'Invalid request';
      return `${location}: ${message}`;
    }).join('; ');
    return { kind: 'client_bug', message: `Malformed request (${where}).`, errors: [] };
  }
  const message = typeof detail === 'string' ? detail : `Request failed (${status}).`;
  if (status === 422) return { kind: 'invalid', message, errors: Array.isArray(responseBody?.errors) ? responseBody.errors as ValidationIssue[] : [] };
  if (status === 401) return { kind: 'auth', message, errors: [] };
  if (status === 404) return { kind: 'not_found', message, errors: [] };
  if (status === 409) return { kind: 'conflict', message, errors: [] };
  if (status === 503) return { kind: 'unavailable', message, errors: [] };
  return { kind: 'server', message, errors: [] };
}

async function request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await send<T>(method, path, options);
  } catch (error: unknown) {
    // Retry once for idempotent GET network failures
    if (method !== 'GET' || !(error instanceof ApiError) || error.kind !== 'network' || options.signal?.aborted) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (options.signal?.aborted) throw error;
    return send<T>(method, path, options);
  }
}

async function send<T = unknown>(method: string, path: string, { body, signal, raw, headers: extraHeaders }: RequestOptions = {}): Promise<T> {
  if (isSandbox()) return sandboxSend<T>(method, path, raw !== undefined ? { __file: raw } : body, signal);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extraHeaders,
  };

  if (body !== undefined && raw === undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (SEND_USER_HEADER && currentUser) {
    headers['X-User'] = currentUser;
  }

  let requestBody: BodyInit | null | undefined;
  if (raw !== undefined) {
    requestBody = raw;
  } else if (body !== undefined) {
    requestBody = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      signal,
      body: requestBody,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      status: 0,
      kind: 'network',
      message: 'Could not reach the Agent Builder API.',
    });
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

  return data as T;
}

// Sandbox: the same call answered in this browser by the imitation API (src/sandbox), loaded only when Sandbox is on.
async function sandboxSend<T>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const aborted = () => new DOMException('Aborted', 'AbortError');
  if (signal?.aborted) throw aborted();
  const { sandboxAnswer } = await import('../sandbox/sandboxApi');
  const { status, body: data } = await sandboxAnswer(method, path, body);
  if (signal?.aborted) throw aborted();
  if (status >= 400) {
    const { kind, message, errors } = classify(status, data);
    throw new ApiError({ status, kind, message, errors, body: data });
  }
  return data as T;
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

/** The answer as it came if it has the shape `schema` expects; otherwise an ApiError (kind "unexpected") naming the field. */
export function checked<T>(schema: ZodMiniType, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (result.success) return data as T;
  const first = result.error.issues[0] as unknown as { path: PropertyKey[]; code: string; expected?: string };
  throw new ApiError({
    status: 200,
    kind: 'unexpected',
    message: `The server sent something unexpected (${what}: ${describeIssue(first)}).`,
    body: data,
  });
}

// a read whose answer is checked
async function read<T>(schema: ZodMiniType, method: string, path: string, options: RequestOptions = {}): Promise<T> {
  return checked<T>(schema, await request(method, path, options), `${method} ${path.split('?')[0]}`);
}

const enc = encodeURIComponent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function queryOf(values: Record<string, unknown>): string {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** The body of PUT /bots/{id}/draft: the config exactly as the editor holds it (what the JSON view shows), nothing added. */
export function draftBody(config: AgentConfig, baseRevision?: number | null): { config: AgentConfig; base_revision?: number } {
  return baseRevision === undefined || baseRevision === null ? { config } : { config, base_revision: baseRevision };
}

export const api = {
  // 1. System status
  health: (opts?: RequestOptions): Promise<{ ok: boolean }> => read(S.Health, 'GET', '/health', opts),

  // 2. Schema
  schema: (opts?: RequestOptions): Promise<Record<string, unknown>> => read(S.JsonSchema, 'GET', '/schema', opts),

  // 3. Environments
  environments: (opts?: RequestOptions): Promise<string[]> => read(S.Environments, 'GET', '/environments', opts),

  // 4. Providers
  providers: (opts?: RequestOptions): Promise<ProvidersAnswer> => read(S.ProvidersAnswer, 'GET', '/providers', opts),

  // 5. Validate config
  validate: (config: AgentConfig, opts?: RequestOptions): Promise<ValidationReport> =>
    read(S.ValidationReport, 'POST', '/validate', { ...opts, body: config }),

  // 6. List bots
  listBots: (opts?: RequestOptions): Promise<BotSummary[]> => read(S.BotList, 'GET', '/bots', opts),

  // 7. Create bot
  createBot: ({ id, name }: { id: string; name: string }, opts?: RequestOptions): Promise<Draft> =>
    request('POST', '/bots', { ...opts, body: { id, name } }),

  // 8. Get bot summary
  getBot: (id: string, opts?: RequestOptions): Promise<BotSummary> =>
    read(S.BotSummary, 'GET', `/bots/${enc(id)}`, opts),

  // 9. Get draft
  getDraft: (id: string, opts?: RequestOptions): Promise<Draft> =>
    read(S.Draft, 'GET', `/bots/${enc(id)}/draft`, opts),

  // 10. Save draft
  saveDraft: (id: string, config: AgentConfig, baseRevision?: number | null, opts?: RequestOptions): Promise<SavedDraft> => {
    return request('PUT', `/bots/${enc(id)}/draft`, {
      ...opts,
      body: draftBody(config, baseRevision),
    });
  },

  // 11. Publish version
  publish: (id: string, bump?: 'major' | 'minor' | 'patch', opts?: RequestOptions): Promise<Published> =>
    request('POST', `/bots/${enc(id)}/publish`, { ...opts, body: bump ? { bump } : {} }),

  // 12. List versions
  listVersions: (id: string, opts?: RequestOptions): Promise<VersionSummary[]> =>
    read(S.VersionList, 'GET', `/bots/${enc(id)}/versions`, opts),

  // 13. Get specific version
  getVersion: (id: string, version: string, opts?: RequestOptions): Promise<Version> =>
    read(S.Version, 'GET', `/bots/${enc(id)}/versions/${enc(version)}`, opts),

  // 14. Diff versions / draft
  diff: (id: string, a: string, b: string, opts?: RequestOptions): Promise<Diff> =>
    read(S.Diff, 'GET', `/bots/${enc(id)}/diff?a=${enc(a)}&b=${enc(b)}`, opts),

  // 15. Deploy
  deploy: (id: string, deployment: { version: string; environment: string; note?: string }, opts?: RequestOptions): Promise<DeployResult> =>
    request('POST', `/bots/${enc(id)}/deploy`, {
      ...opts,
      body: deployment,
    }),

  // 16. List deployments
  listDeployments: (id: string, opts?: RequestOptions): Promise<Deployments> =>
    read(S.Deployments, 'GET', `/bots/${enc(id)}/deployments`, opts),

  // 17. Get deployment
  getDeployment: (id: string, deploymentId: string, opts?: RequestOptions): Promise<Deployment> =>
    read(S.DeploymentAnswer, 'GET', `/bots/${enc(id)}/deployments/${enc(deploymentId)}`, opts),

  // 18. Start session (LiveKit voice/chat)
  startSession: (id: string, session?: { ref?: string; identity?: string; channel?: string }, opts?: RequestOptions): Promise<Session> =>
    request('POST', `/bots/${enc(id)}/sessions`, {
      ...opts,
      body: session || {},
    }),

  // 19. Preview prompt
  previewPrompt: (body: Record<string, unknown>, opts?: RequestOptions): Promise<PromptPreview> =>
    request('POST', '/preview/prompt', { ...opts, body }),

  // 20. Preview tool result
  previewResult: (body: Record<string, unknown>, opts?: RequestOptions): Promise<unknown> =>
    request('POST', '/preview/result', { ...opts, body }),

  // 21. Knowledge bases
  getKnowledge: (id: string, query?: { ref?: string }, opts?: RequestOptions): Promise<{ bases: KnowledgeBase[] } | KnowledgeBase[]> => {
    const queryString = query?.ref ? `?ref=${enc(query.ref)}` : '';
    return request('GET', `/bots/${enc(id)}/knowledge${queryString}`, opts);
  },

  // 22. Knowledge files
  listKnowledgeFiles: (id: string, opts?: RequestOptions): Promise<KnowledgeFile[]> =>
    request('GET', `/bots/${enc(id)}/knowledge/files`, opts),

  // 23. Upload knowledge file (raw file)
  uploadKnowledgeFile: (id: string, name: string, file: Blob | string | File, opts?: RequestOptions): Promise<unknown> =>
    request('PUT', `/bots/${enc(id)}/knowledge/files/${enc(name)}`, { ...opts, raw: file }),

  // 24. Delete knowledge file
  deleteKnowledgeFile: (id: string, name: string, force?: boolean, opts?: RequestOptions): Promise<unknown> =>
    request('DELETE', `/bots/${enc(id)}/knowledge/files/${enc(name)}${force ? '?force=true' : ''}`, opts),

  // 25. Build knowledge base
  buildKnowledge: (id: string, base: string, ref?: string, opts?: RequestOptions): Promise<unknown> =>
    request('POST', `/bots/${enc(id)}/knowledge/${enc(base)}/build`, { ...opts, body: ref ? { ref } : {} }),

  // 26. Knowledge status
  knowledgeStatus: (id: string, base: string, ref?: string, opts?: RequestOptions): Promise<KnowledgeStatus> => {
    const queryString = ref ? `?ref=${enc(ref)}` : '';
    return request('GET', `/bots/${enc(id)}/knowledge/${enc(base)}/status${queryString}`, opts);
  },

  // 27. Search knowledge
  searchKnowledge: (id: string, base: string, search: { query: string; top_k?: number; previous_reply?: string; ref?: string }, opts?: RequestOptions): Promise<KnowledgeSearchResult> =>
    request('POST', `/bots/${enc(id)}/knowledge/${enc(base)}/search`, { ...opts, body: search }),

  // 28. Calls list
  listCalls: (id: string, filters: Record<string, unknown> = {}, opts?: RequestOptions): Promise<CallsResponse> =>
    read(S.CallPage, 'GET', `/bots/${enc(id)}/calls${queryOf(filters)}`, opts),

  // 29. Call detail
  getCall: (id: string, callId: string, query: Record<string, unknown> = {}, opts?: RequestOptions): Promise<unknown> =>
    read(S.CallRecords, 'GET', `/bots/${enc(id)}/calls/${enc(callId)}${queryOf(query)}`, opts),

  // 30. Call transcript
  getTranscript: (id: string, callId: string, opts?: RequestOptions): Promise<CallTranscriptResponse> =>
    request('GET', `/bots/${enc(id)}/calls/${enc(callId)}/transcript`, opts),

  // 31. Download call
  downloadCallUrl: (id: string, callId: string): string =>
    `${BASE}/bots/${enc(id)}/calls/${enc(callId)}/download`,

  // 33. List tests
  listTests: (id: string, query?: { ref?: string }, opts?: RequestOptions): Promise<{ scenarios: Scenario[]; ref?: string }> => {
    const queryString = query?.ref ? `?ref=${enc(query.ref)}` : '';
    return request('GET', `/bots/${enc(id)}/tests${queryString}`, opts);
  },

  // 34. Run tests
  runTests: (id: string, run: Record<string, unknown> = {}, opts?: RequestOptions): Promise<{ run_id: string; status: string }> =>
    request('POST', `/bots/${enc(id)}/tests/run`, { ...opts, body: run }),

  // 35. List test runs
  listTestRuns: (id: string, limit?: number, opts?: RequestOptions): Promise<TestRun[]> =>
    request('GET', `/bots/${enc(id)}/tests/runs${limit ? `?limit=${limit}` : ''}`, opts),

  // 36. Get test run
  getTestRun: (id: string, runId: string, opts?: RequestOptions): Promise<TestRun> =>
    request('GET', `/bots/${enc(id)}/tests/runs/${enc(runId)}`, opts),

  // Additional endpoints
  channelTypes: (opts?: RequestOptions): Promise<{ types: unknown[]; note?: string }> =>
    request('GET', '/channel-types', opts),

  previewSpeech: (body: Record<string, unknown>, opts?: RequestOptions): Promise<unknown> =>
    request('POST', '/preview/speech', { ...opts, body }),

  previewGuardrails: (body: Record<string, unknown>, opts?: RequestOptions): Promise<unknown> =>
    request('POST', '/preview/guardrails', { ...opts, body }),

  previewRedaction: (body: Record<string, unknown>, opts?: RequestOptions): Promise<unknown> =>
    request('POST', '/preview/redaction', { ...opts, body }),

  previewTask: (body: Record<string, unknown>, opts?: RequestOptions): Promise<unknown> =>
    request('POST', '/preview/task', { ...opts, body }),

  redactionEntities: (opts?: RequestOptions): Promise<{ entities: Array<{ kind: string; how: string }> }> =>
    request('GET', '/redaction/entities', opts),

  numberSettings: (opts?: RequestOptions): Promise<NumberSettings> =>
    request('GET', '/numbers/settings', opts),

  listNumbers: (opts?: RequestOptions): Promise<{ numbers: PhoneNumber[] }> =>
    request('GET', '/numbers', opts),

  checkNumber: (number: string, opts?: RequestOptions): Promise<NumberCheck> =>
    request('GET', `/numbers/check?number=${enc(number)}`, opts),

  listBotNumbers: (id: string, opts?: RequestOptions): Promise<{ numbers: PhoneNumber[] }> =>
    request('GET', `/bots/${enc(id)}/numbers`, opts),

  createNumber: (id: string, body: { number: string; environment: string; record_audio?: boolean }, opts?: RequestOptions): Promise<unknown> =>
    request('POST', `/bots/${enc(id)}/numbers`, { ...opts, body }),

  changeNumber: (id: string, number: string, body: Record<string, unknown>, opts?: RequestOptions): Promise<unknown> =>
    request('PATCH', `/bots/${enc(id)}/numbers/${enc(number)}`, { ...opts, body }),

  releaseNumber: (id: string, number: string, opts?: RequestOptions): Promise<{ removed: unknown[] }> =>
    request('DELETE', `/bots/${enc(id)}/numbers/${enc(number)}`, opts),
};

export function followCall(
  id: string,
  callId: string,
  {
    onOpen,
    onRecord,
    onEnd,
    onError,
    after,
  }: {
    onOpen?: (call: unknown) => void;
    onRecord?: (record: unknown) => void;
    onEnd?: () => void;
    onError?: () => void;
    after?: number;
  }
): () => void {
  if (isSandbox()) {
    // Sandbox: the imitation plays the call's records as the server's stream would
    let stop: (() => void) | null = null;
    let stopped = false;
    void import('../sandbox/sandboxApi').then(({ sandboxFollow }) => {
      if (!stopped) stop = sandboxFollow(id, callId, { onOpen, onRecord, onEnd, after });
    });
    return () => {
      stopped = true;
      stop?.();
    };
  }
  const afterQuery = after ? `?after=${after}` : '';
  const source = new EventSource(`${BASE}/bots/${enc(id)}/calls/${enc(callId)}/stream${afterQuery}`);

  const parse = (event: MessageEvent<string>): unknown => {
    try {
      return JSON.parse(event.data);
    } catch {
      return null;
    }
  };

  source.addEventListener('open', (event: Event) => {
    const call = parse(event as MessageEvent<string>);
    if (call && onOpen) onOpen(call);
  });

  source.onmessage = (event: MessageEvent) => {
    const record = parse(event);
    if (record && onRecord) onRecord(record);
  };

  source.addEventListener('end', () => {
    source.close();
    if (onEnd) onEnd();
  });

  source.addEventListener('error', (event: Event) => {
    // The server's own `error` event (no call appeared within `wait`) carries data; stop instead of reconnecting.
    if (event instanceof MessageEvent && event.data !== undefined) {
      source.close();
      if (onError) onError();
      return;
    }
    if (source.readyState === EventSource.CLOSED && onError) onError();
  });

  return () => source.close();
}

export function groupIssues(report?: ValidationReport): Array<{ severity: 'error' | 'warning'; path: Array<string | number> | null; message: string }> {
  const toIssue = (severity: 'error' | 'warning') => (item: ValidationIssue) => ({
    severity,
    path: Array.isArray(item.path) && item.path.length ? item.path : null,
    message: item.message,
  });

  return [
    ...(report?.errors || []).map(toIssue('error')),
    ...(report?.warnings || []).map(toIssue('warning')),
  ];
}
