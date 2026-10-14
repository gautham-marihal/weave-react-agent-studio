// @ts-check
// Thin client for the Agent Builder API. The browser calls /api; the Vite server proxies it to the
// real API and adds the bearer key (see vite.config.js), so no credential lives in this code.

/** @typedef {import('./types').AgentConfig} AgentConfig */
/** @typedef {import('./types').RequestOptions} RequestOptions */

import { isDemoMode } from '../demo/demoMode.js';

// import.meta.env only exists under Vite; the unit tests import this file in plain Node.
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '/api';

// The name typed on the demo sign-in. It labels things on screen (a test conversation's participant); it is NOT sent as
// the user: who saved, published or deployed is decided by the proxy in front of the API from the verified sign-in,
// never by the browser (anyone can set a header). For development only, VITE_SEND_USER_HEADER=true sends it anyway.
let currentUser = '';
export const setApiUser = (name) => { currentUser = String(name || '').trim(); };
export const getApiUser = () => currentUser;
const SEND_USER_HEADER = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SEND_USER_HEADER) === 'true';

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
    return { kind: 'network', message: 'The Agent Builder API isn’t responding.', errors: [] };
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
async function request(method, path, { body, signal } = {}) {
  if (isDemoMode()) return demoRequest(method, path, body, signal);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (SEND_USER_HEADER && currentUser) headers['X-User'] = currentUser;
  let response;
  try {
    response = await fetch(`${BASE}${path}`, { method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError({ status: 0, kind: 'network', message: 'Could not reach the Agent Builder API.' });
  }
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
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
  await new Promise((resolve) => { setTimeout(resolve, 30); }); // a moment, so loading states are real
  if (signal?.aborted) throw aborted();
  const { status, body: data } = await getDemoApi().handle(method, path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
  if (status >= 400) {
    const { kind, message, errors } = classify(status, data);
    throw new ApiError({ status, kind, message, errors, body: data });
  }
  return data;
}

const enc = encodeURIComponent;

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
  saveDraft: (id, config, baseRevision, opts) => request('PUT', `/bots/${enc(id)}/draft`, {
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
  deploy: (id, { version, environment, note }, opts) => request('POST', `/bots/${enc(id)}/deploy`, {
    ...opts,
    body: { version, environment, ...(note ? { note } : {}) },
  }),
  // history is oldest first.
  /** @param {string} id @param {RequestOptions} [opts] @returns {Promise<import('./types').Deployments>} oldest first */
  listDeployments: (id, opts) => request('GET', `/bots/${enc(id)}/deployments`, opts),
  /** @param {string} id @param {string} deploymentId @param {RequestOptions} [opts] @returns {Promise<import('./types').Deployment | import('./types').DeployResult>} */
  getDeployment: (id, deploymentId, opts) => request('GET', `/bots/${enc(id)}/deployments/${enc(deploymentId)}`, opts),

  // ref: "draft" (default), "latest", a version, or an environment name.
  /** @param {string} id @param {{ ref?: string, identity?: string }} [session] @param {RequestOptions} [opts] @returns {Promise<import('./types').Session>} */
  startSession: (id, { ref, identity } = {}, opts) => request('POST', `/bots/${enc(id)}/sessions`, {
    ...opts,
    body: { ...(ref ? { ref } : {}), ...(identity ? { identity } : {}) },
  }),
};

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
