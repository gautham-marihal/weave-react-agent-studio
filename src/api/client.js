// @ts-check
// Thin client for the Agent Builder API. The browser calls /api; the Vite server proxies it to the
// real API and adds the bearer key (see vite.config.js), so no credential lives in this code.

/** @typedef {import('./types').AgentConfig} AgentConfig */
/** @typedef {import('./types').RequestOptions} RequestOptions */

import { isDemoMode } from '../demo/demoMode.js';

// import.meta.env only exists under Vite; the unit tests import this file in plain Node.
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '/api';

// The signed-in person. The API guide asks for it on every request as `X-User`, so saves, publishes, deploys and phone-number changes say who made them.
// It is only a claim (a browser can send any header): in production the proxy in front of the API replaces it with the verified sign-in
// (docs/PRODUCTION.md). VITE_SEND_USER_HEADER=false stops the browser sending it, where the proxy is the only source.
let currentUser = '';
export const setApiUser = (name, fallback = '') => {
  currentUser = headerSafe(name) || headerSafe(fallback);
};
export const getApiUser = () => currentUser;
const SEND_USER_HEADER = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SEND_USER_HEADER) !== 'false';

// A header carries printable Latin-1 only: a name in another script (or with a line break) can't be sent as it is, so the email is used instead, or nothing.
export function headerSafe(value) {
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
//   server      anything else
export class ApiError extends Error {
  constructor({ status, kind, message, errors = [], body = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.errors = errors;
    this.body = body;
  }
}

export function classify(status, body) {
  const detail = body && typeof body === 'object' ? body.detail : undefined;
  // A 5xx with no JSON `detail` did not come from the API itself: the dev proxy or a gateway answered
  // because the API is down or restarting.
  if (status >= 500 && detail === undefined) {
    return { kind: 'network', message: 'The server isn’t responding.', errors: [] };
  }
  if (status === 422 && Array.isArray(detail)) {
    const where = detail.map((item) => `${(item.loc || []).join('.')}: ${item.msg}`).join('; ');
    return { kind: 'client_bug', message: `The app sent a malformed request (${where}).`, errors: [] };
  }
  const message = typeof detail === 'string' ? detail : `Request failed (${status}).`;
  if (status === 422) return { kind: 'invalid', message, errors: Array.isArray(body?.errors) ? body.errors : [] };
  if (status === 401) return { kind: 'auth', message, errors: [] };
  if (status === 404) return { kind: 'not_found', message, errors: [] };
  if (status === 409) return { kind: 'conflict', message, errors: [] };
  if (status === 503) return { kind: 'unavailable', message, errors: [] };
  return { kind: 'server', message, errors: [] };
}

/**
 * @param {string} method
 * @param {string} path
 * @param {{ body?: unknown, signal?: AbortSignal }} [options]
 * @returns {Promise<any>}
 */
async function request(method, path, options = {}) {
  try {
    return await send(method, path, options);
  } catch (error) {
    // A read that failed because the connection was dropped on the way (a proxy or the server closing an idle connection) is asked once more: it changes
    // nothing, and the second try nearly always works. Writes are never repeated, and a person who cancelled is not asked again.
    if (method !== 'GET' || error?.kind !== 'network' || options.signal?.aborted) throw error;
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    if (options.signal?.aborted) throw error;
    return send(method, path, options);
  }
}

async function send(method, path, { body, signal, raw } = {}) {
  if (isDemoMode()) return demoRequest(method, path, raw !== undefined ? { __file: raw } : body, signal);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (SEND_USER_HEADER && currentUser) headers['X-User'] = currentUser;
  let response;
  try {
    // `raw` is a file: the body IS the file (knowledge uploads), not JSON and not a form
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      signal,
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError({ status: 0, kind: 'network', message: 'Couldn’t reach the server.' });
  }
  const text = await response.text();
  let data = null;
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

// Demo mode: the same call, answered by the imitation API in the browser (see src/demo/demoApi.js). It is loaded only when needed.
async function demoRequest(method, path, body, signal) {
  const aborted = () => new DOMException('Aborted', 'AbortError');
  if (signal?.aborted) throw aborted();
  const { getDemoApi } = await import('../demo/demoApi.js');
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  }); // a moment, so loading states are real
  if (signal?.aborted) throw aborted();
  // a file for a knowledge upload is kept as it is; everything else is copied so the imitation can't change the caller's objects
  const payload = body === undefined ? undefined : body && body.__file !== undefined ? body : JSON.parse(JSON.stringify(body));
  const { status, body: data } = await getDemoApi().handle(method, path, payload);
  if (status >= 400) {
    const { kind, message, errors } = classify(status, data);
    throw new ApiError({ status, kind, message, errors, body: data });
  }
  return data;
}

const enc = encodeURIComponent;

// The address of a path on the API as the browser sees it (for a plain link, such as a file download). In demo mode there is none.
export const apiUrl = (path) => (isDemoMode() ? null : `${BASE}${path}`);

export const api = {
  /** @returns {Promise<{ ok: boolean }>} */
  health: (opts) => request('GET', '/health', opts),
  /** @param {RequestOptions} [opts] @returns {Promise<object>} the JSON Schema of an agent configuration */
  schema: (opts) => request('GET', '/schema', opts),
  /** @param {RequestOptions} [opts] @returns {Promise<string[]>} */
  environments: (opts) => request('GET', '/environments', opts),
  // The model providers the runtime can run: [{name, stages, installed, default_secret, key_available, ...}].
  /** @param {RequestOptions} [opts] @returns {Promise<import('./types').ProvidersAnswer>} */
  providers: (opts) => request('GET', '/providers', opts),
  /** @param {AgentConfig} config @param {RequestOptions} [opts] @returns {Promise<import('./types').ValidationReport>} */
  validate: (config, opts) => request('POST', '/validate', { ...opts, body: config }),

  // Only real agents are listed (each has a draft); the server no longer lists the folders it writes call data to.
  /** @param {RequestOptions} [opts] @returns {Promise<import('./types').BotSummary[]>} */
  listBots: async (opts) => {
    const list = await request('GET', '/bots', opts);
    return Array.isArray(list) ? list : [];
  },
  // Answers with the new bot's first draft ({bot_id, revision, saved_at, saved_by, config}).
  /** @param {{ id: string, name: string }} bot @param {RequestOptions} [opts] @returns {Promise<import('./types').Draft>} */
  createBot: ({ id, name }, opts) => request('POST', '/bots', { ...opts, body: { id, name } }),
  /** @param {string} id @param {RequestOptions} [opts] @returns {Promise<import('./types').BotSummary>} */
  getBot: (id, opts) => request('GET', `/bots/${enc(id)}`, opts),

  /** @param {string} id @param {RequestOptions} [opts] @returns {Promise<import('./types').Draft>} */
  getDraft: (id, opts) => request('GET', `/bots/${enc(id)}/draft`, opts),
  // Omit baseRevision to overwrite; send it to get a 409 if someone saved in between.
  /** @param {string} id @param {AgentConfig} config @param {number | null} [baseRevision] @param {RequestOptions} [opts] @returns {Promise<import('./types').SavedDraft>} */
  saveDraft: (id, config, baseRevision, opts) =>
    request('PUT', `/bots/${enc(id)}/draft`, {
      ...opts,
      body: baseRevision === undefined || baseRevision === null ? { config } : { config, base_revision: baseRevision },
    }),

  // `bump` ("major" | "minor" | "patch") is counted from the latest published version; the server refuses it
  // until something has been published. Without it the draft's own meta.version is published.
  /** @param {string} id @param {'major' | 'minor' | 'patch'} [bump] @param {RequestOptions} [opts] @returns {Promise<import('./types').Published>} */
  publish: (id, bump, opts) => request('POST', `/bots/${enc(id)}/publish`, { ...opts, body: bump ? { bump } : {} }),
  /** @param {string} id @param {RequestOptions} [opts] @returns {Promise<import('./types').VersionSummary[]>} newest first */
  listVersions: (id, opts) => request('GET', `/bots/${enc(id)}/versions`, opts),
  /** @param {string} id @param {string} version @param {RequestOptions} [opts] @returns {Promise<import('./types').Version>} */
  getVersion: (id, version, opts) => request('GET', `/bots/${enc(id)}/versions/${enc(version)}`, opts),
  // a and b are versions ("0.1.0") or "draft".
  /** @param {string} id @param {string} a @param {string} b @param {RequestOptions} [opts] @returns {Promise<import('./types').Diff>} */
  diff: (id, a, b, opts) => request('GET', `/bots/${enc(id)}/diff?a=${enc(a)}&b=${enc(b)}`, opts),

  // Answers 200 today; may become 202 with status "pending" (poll getDeployment until active / failed).
  /** @param {string} id @param {{ version: string, environment: string, note?: string }} deployment @param {RequestOptions} [opts] @returns {Promise<import('./types').DeployResult>} */
  deploy: (id, { version, environment, note }, opts) =>
    request('POST', `/bots/${enc(id)}/deploy`, {
      ...opts,
      body: { version, environment, ...(note ? { note } : {}) },
    }),
  // history is oldest first.
  /** @param {string} id @param {RequestOptions} [opts] @returns {Promise<import('./types').Deployments>} oldest first */
  listDeployments: (id, opts) => request('GET', `/bots/${enc(id)}/deployments`, opts),
  /** @param {string} id @param {string} deploymentId @param {RequestOptions} [opts] @returns {Promise<import('./types').Deployment | import('./types').DeployResult>} */
  getDeployment: (id, deploymentId, opts) => request('GET', `/bots/${enc(id)}/deployments/${enc(deploymentId)}`, opts),

  // ref: "draft" (default), "latest", a version, or an environment name.
  /** @param {string} id @param {{ ref?: string, identity?: string, channel?: string }} [session] @param {RequestOptions} [opts] @returns {Promise<import('./types').Session>} */
  startSession: (id, { ref, identity, channel } = {}, opts) =>
    request('POST', `/bots/${enc(id)}/sessions`, {
      ...opts,
      // `channel` is the id of the web channel the visitor chose, when the bot offers more than one (chat and voice side by side)
      body: { ...(ref ? { ref } : {}), ...(identity ? { identity } : {}), ...(channel ? { channel } : {}) },
    }),

  // ---- test scenarios (the real runner): scripted scenarios replace the model with a script, live ones use a real model and cost money
  // `{ scenarios, ref, network_allowed }`: each scenario with the result of its last run.
  /** @param {string} id @param {{ ref?: string }} [query] @param {RequestOptions} [opts] @returns {Promise<any>} */
  listTests: (id, { ref } = {}, opts) => request('GET', `/bots/${enc(id)}/tests${ref ? `?ref=${enc(ref)}` : ''}`, opts),
  // Answers 202 with a run to poll. `config` tests what is in the editor without saving it (the run's ref is "unsaved"); `scenarios` is a
  // list of ids; `live` also runs the scenarios that have no model_script against a real model (costs money); `judge` grades `judge` checks.
  /** @param {string} id @param {{ ref?: string, config?: AgentConfig, scenarios?: string[], live?: boolean, judge?: boolean, allow_network?: boolean }} [run] @param {RequestOptions} [opts] @returns {Promise<any>} */
  runTests: (id, run = {}, opts) => request('POST', `/bots/${enc(id)}/tests/run`, { ...opts, body: run }),
  /** @param {string} id @param {number} [limit] @param {RequestOptions} [opts] @returns {Promise<any[]>} headlines only, newest first */
  listTestRuns: (id, limit, opts) => request('GET', `/bots/${enc(id)}/tests/runs${limit ? `?limit=${limit}` : ''}`, opts),
  /** @param {string} id @param {string} runId @param {RequestOptions} [opts] @returns {Promise<any>} */
  getTestRun: (id, runId, opts) => request('GET', `/bots/${enc(id)}/tests/runs/${enc(runId)}`, opts),

  // ---- call records: what callers said and what the bot did (these logs hold caller speech)
  /** @param {string} id @param {{ limit?: number, cursor?: string, since?: string, until?: string, caller?: string, channel?: string, status?: string }} [filters] @param {RequestOptions} [opts] @returns {Promise<{ calls: any[], next: string | null }>} */
  listCalls: (id, filters = {}, opts) => request('GET', `/bots/${enc(id)}/calls${queryOf(filters)}`, opts),
  /** @param {string} id @param {string} callId @param {{ after?: number, limit?: number, kinds?: string }} [query] @param {RequestOptions} [opts] @returns {Promise<any>} */
  getCall: (id, callId, query = {}, opts) => request('GET', `/bots/${enc(id)}/calls/${enc(callId)}${queryOf(query)}`, opts),
  /** @param {string} id @param {string} callId @param {RequestOptions} [opts] @returns {Promise<any>} */
  getTranscript: (id, callId, opts) => request('GET', `/bots/${enc(id)}/calls/${enc(callId)}/transcript`, opts),

  // ---- previews: what the model would be told and shown (they call nothing and spend nothing; send `config` for what is in the editor)
  /** @param {{ config?: AgentConfig, bot?: string, ref?: string, agent?: string, channel?: string, state?: object, caller_phone?: string, now?: string }} body @param {RequestOptions} [opts] @returns {Promise<any>} */
  previewPrompt: (body, opts) => request('POST', '/preview/prompt', { ...opts, body }),
  /** @param {{ config?: AgentConfig, bot?: string, ref?: string, tool: string, args?: object, response?: unknown, state?: object, channel?: string, now?: string }} body @param {RequestOptions} [opts] @returns {Promise<any>} */
  previewResult: (body, opts) => request('POST', '/preview/result', { ...opts, body }),
  // How a line would be said, what the safety rules do with a line, what redaction would hide, and a task step by step. All four read the config in the editor.
  /** @param {{ config?: AgentConfig, bot?: string, ref?: string, text: string, agent?: string, channel?: string, source?: 'model' | 'fixed', chunks?: string[] }} body @param {RequestOptions} [opts] @returns {Promise<any>} */
  previewSpeech: (body, opts) => request('POST', '/preview/speech', { ...opts, body }),
  /** @param {{ config?: AgentConfig, bot?: string, ref?: string, text: string }} body @param {RequestOptions} [opts] @returns {Promise<any>} */
  previewGuardrails: (body, opts) => request('POST', '/preview/guardrails', { ...opts, body }),
  /** @param {{ config?: AgentConfig, bot?: string, ref?: string, text: string, state?: object }} body @param {RequestOptions} [opts] @returns {Promise<any>} */
  previewRedaction: (body, opts) => request('POST', '/preview/redaction', { ...opts, body }),
  /** @param {{ config?: AgentConfig, bot?: string, ref?: string, task: string, state?: object, channel?: string, caller_phone?: string, now?: string }} body @param {RequestOptions} [opts] @returns {Promise<any>} */
  previewTask: (body, opts) => request('POST', '/preview/task', { ...opts, body }),
  // The kinds of value redaction can find and how each is recognised (a read: it needs no config).
  /** @param {RequestOptions} [opts] @returns {Promise<{ entities: { kind: string, how: string }[] }>} */
  redactionEntities: (opts) => request('GET', '/redaction/entities', opts),

  // What each kind of channel may carry and offer: the source for which options a screen shows. A read.
  /** @param {RequestOptions} [opts] @returns {Promise<{ types: any[], note?: string }>} */
  channelTypes: (opts) => request('GET', '/channel-types', opts),

  // ---- phone numbers: the number is the person's; the API checks it is free and sets up the LiveKit trunk and dispatch rule. Reads are safe; the three writes
  // (create, change, release) change the phone system, so they are only ever sent on a person's click.
  /** @param {RequestOptions} [opts] @returns {Promise<any>} */
  numberSettings: (opts) => request('GET', '/numbers/settings', opts),
  /** @param {RequestOptions} [opts] @returns {Promise<any[]>} */
  listNumbers: (opts) => request('GET', '/numbers', opts),
  /** @param {string} number @param {RequestOptions} [opts] @returns {Promise<{ status: string, owner?: any, warnings?: string[], reason?: string }>} */
  checkNumber: (number, opts) => request('GET', `/numbers/check?number=${enc(number)}`, opts),
  /** @param {string} id @param {RequestOptions} [opts] @returns {Promise<any[]>} */
  listBotNumbers: (id, opts) => request('GET', `/bots/${enc(id)}/numbers`, opts),
  /** @param {string} id @param {{ number: string, environment: string, record_audio?: boolean, krisp?: boolean, allowed_addresses?: string[], max_call_duration_s?: number }} body @param {RequestOptions} [opts] @returns {Promise<any>} */
  createNumber: (id, body, opts) => request('POST', `/bots/${enc(id)}/numbers`, { ...opts, body }),
  /** @param {string} id @param {string} number @param {{ environment?: string, record_audio?: boolean, krisp?: boolean, allowed_addresses?: string[], max_call_duration_s?: number }} body @param {RequestOptions} [opts] @returns {Promise<any>} */
  changeNumber: (id, number, body, opts) => request('PATCH', `/bots/${enc(id)}/numbers/${enc(number)}`, { ...opts, body }),
  /** @param {string} id @param {string} number @param {RequestOptions} [opts] @returns {Promise<{ removed: any[] }>} */
  releaseNumber: (id, number, opts) => request('DELETE', `/bots/${enc(id)}/numbers/${enc(number)}`, opts),

  // ---- knowledge: the files a `vector_store` base reads, its index, and a test search
  /** @param {string} id @param {{ ref?: string }} [query] @param {RequestOptions} [opts] @returns {Promise<any>} */
  getKnowledge: (id, { ref } = {}, opts) => request('GET', `/bots/${enc(id)}/knowledge${ref ? `?ref=${enc(ref)}` : ''}`, opts),
  /** @param {string} id @param {RequestOptions} [opts] @returns {Promise<any[]>} */
  listKnowledgeFiles: (id, opts) => request('GET', `/bots/${enc(id)}/knowledge/files`, opts),
  // The body IS the file (`fetch(url, { method: 'PUT', body: file })`), not a form. 400 wrong type, 413 too big.
  /** @param {string} id @param {string} name @param {Blob | string} file @param {RequestOptions} [opts] @returns {Promise<any>} */
  uploadKnowledgeFile: (id, name, file, opts) => request('PUT', `/bots/${enc(id)}/knowledge/files/${enc(name)}`, { ...opts, raw: file }),
  // 409 when a base reads the file, unless force.
  /** @param {string} id @param {string} name @param {boolean} [force] @param {RequestOptions} [opts] @returns {Promise<any>} */
  deleteKnowledgeFile: (id, name, force, opts) => request('DELETE', `/bots/${enc(id)}/knowledge/files/${enc(name)}${force ? '?force=true' : ''}`, opts),
  // Answers 202 with a job to poll with knowledgeStatus; one build per base at a time (409).
  /** @param {string} id @param {string} base @param {string} [ref] @param {RequestOptions} [opts] @returns {Promise<any>} */
  buildKnowledge: (id, base, ref, opts) => request('POST', `/bots/${enc(id)}/knowledge/${enc(base)}/build`, { ...opts, body: ref ? { ref } : {} }),
  /** @param {string} id @param {string} base @param {string} [ref] @param {RequestOptions} [opts] @returns {Promise<any>} */
  knowledgeStatus: (id, base, ref, opts) => request('GET', `/bots/${enc(id)}/knowledge/${enc(base)}/status${ref ? `?ref=${enc(ref)}` : ''}`, opts),
  /** @param {string} id @param {string} base @param {{ query: string, top_k?: number, previous_reply?: string, ref?: string }} search @param {RequestOptions} [opts] @returns {Promise<any>} */
  searchKnowledge: (id, base, search, opts) => request('POST', `/bots/${enc(id)}/knowledge/${enc(base)}/search`, { ...opts, body: search }),
};

// ?a=1&b=2 from an object, leaving out what is empty
function queryOf(values) {
  const query = new URLSearchParams();
  Object.entries(values || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

// Follows a call that is in progress: one record at a time through server-sent events (the API's `/calls/{id}/stream`). `EventSource`
// cannot set headers, so this relies on the proxy adding the key, and the proxy must not buffer this path. Demo mode follows an
// imitation call instead. Returns a function that stops following.
/**
 * @param {string} id
 * @param {string} callId
 * @param {{ onOpen?: (call: any) => void, onRecord: (record: any) => void, onEnd?: () => void, onError?: () => void, after?: number }} handlers
 */
export function followCall(id, callId, { onOpen, onRecord, onEnd, onError, after } = { onRecord() {} }) {
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
  const parse = (event) => {
    try {
      return JSON.parse(event.data);
    } catch {
      return null;
    }
  };
  source.addEventListener('open', (event) => {
    const call = parse(event);
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

// A validation report (POST /validate, or `validation` in a saved draft) addresses a problem by `path`
// ([] or null mean "general message"). Turns it into one flat list the editor can show per field.
export function groupIssues(report) {
  const toIssue = (severity) => (item) => ({
    severity,
    path: Array.isArray(item.path) && item.path.length ? item.path : null,
    message: item.message,
  });
  return [...(report?.errors || []).map(toIssue('error')), ...(report?.warnings || []).map(toIssue('warning'))];
}
