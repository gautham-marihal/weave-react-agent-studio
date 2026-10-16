// The Agent Builder API, imitated in memory, for demo mode (and for the end-to-end test, which runs without a backend). It answers the
// endpoints the studio uses with the shapes in the API's FRONTEND_GUIDE: agents with drafts (revision-locked), versions, deployments, a
// diff. It is a FAKE: its validator is a handful of simple rules (demoValidate.js), publishing and deploying only move records around,
// and it has no LiveKit, so a "test session" is refused (the studio uses a simulated conversation instead).
// `handle(method, path, body)` resolves to { status, body }. Pure apart from the `storage` it is given.

import { applyStarter } from '../studio/starters.js';
import { diffConfigs } from './diff.js';
import { secretsIn, validateDemo } from './demoValidate.js';
import {
  baseStatus,
  overview as knowledgeOverview,
  preflightKnowledge,
  removeFile,
  searchBase,
  settle,
  startBuild,
  upload as uploadFile,
} from './demoKnowledge.js';
import { previewPromptDemo, previewResultDemo } from './demoPreview.js';
import { demoEntities, tryPreviewDemo } from './demoTryPreviews.js';
import { routeNumbers } from './demoNumbers.js';
import { minimalConfig } from './minimalConfig.js';
import { callFromConversation, followCallOf, getCallOf, listCallsOf, seedCalls, transcriptOf } from './demoCalls.js';
import { STEP_MS, checksumOf, createRun, headlineOf, scenarioListOf, viewRun } from './demoTests.js';

export const ENVIRONMENTS = ['development', 'staging', 'production'];
export const RESERVED_IDS = ['transcripts', 'metrics', 'logs', 'sessions', 'tmp'];
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const DEMO_USER = 'demo';
export const STORAGE_KEY = 'weave_demo_state';

const clone = (value) => JSON.parse(JSON.stringify(value));
const ok = (body, status = 200) => ({ status, body });
const fail = (status, detail, extra = {}) => ({ status, body: { detail, ...extra } });

export { minimalConfig };

export const bumpVersion = (version, kind = 'patch') => {
  const [major, minor, patch] = String(version).split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

export const memoryStorage = (initial = null) => {
  let state = initial;
  return {
    load: () => state,
    save: (next) => {
      state = clone(next);
    },
  };
};

export function browserStorage(key = STORAGE_KEY) {
  let fallback = null;
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    save(state) {
      fallback = state;
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        /* storage full or unavailable: kept for this page view */
      }
    },
  };
}

export function createDemoApi({
  storage = memoryStorage(),
  loadSchema = async () => ({}),
  now = () => new Date().toISOString(),
  seed = true,
  stepMs = STEP_MS,
  history = true,
} = {}) {
  let counter = 0;
  const uid = (prefix) => {
    counter += 1;
    return `${prefix}${Date.now().toString(36)}${counter}`;
  };

  const newBot = (id, name, config) => ({
    id,
    name,
    revision: 1,
    savedAt: now(),
    savedBy: DEMO_USER,
    config: config || minimalConfig(id, name),
    versions: [],
    deployments: [],
    deployed: {},
  });

  function seedState() {
    const state = { v: 1, bots: {} };
    const make = (id, name, starter) => {
      state.bots[id] = newBot(id, name);
      state.bots[id].config = applyStarter(state.bots[id].config, starter);
      return state.bots[id];
    };
    const support = make('acme-support', 'Acme Support', 'support');
    const front = make('front-desk', 'Front Desk', 'receptionist');
    make('bookings', 'Bookings', 'appointment');
    // a little history, so the Versions and Deploy screens have something to show
    const publish = (bot, version) => {
      {
        const config = { ...clone(bot.config), meta: { ...bot.config.meta, version } };
        bot.versions.unshift({ version, published_at: now(), published_by: DEMO_USER, checksum: checksumOf(config), config });
      }
      bot.config.meta.version = bumpVersion(version);
      bot.revision += 1;
    };
    const deploy = (bot, environment, version) => {
      const previous = bot.deployed[environment] || null;
      bot.deployments.push({
        id: uid('d'),
        status: 'active',
        environment,
        version,
        previous_version: previous,
        deployed_at: now(),
        deployed_by: DEMO_USER,
        note: '',
      });
      bot.deployed[environment] = version;
    };
    publish(support, '0.1.0');
    deploy(support, 'development', '0.1.0');
    deploy(support, 'staging', '0.1.0');
    support.config.persona = { ...support.config.persona, tone: 'warm, patient, plain language, and a little more concise' };
    publish(support, '0.1.1');
    deploy(support, 'development', '0.1.1');
    publish(front, '0.1.0');
    deploy(front, 'development', '0.1.0');
    return state;
  }

  const read = () => {
    let state = storage.load();
    if (!state && seed) {
      state = seedState();
      storage.save(state);
    }
    return state || { v: 1, bots: {} };
  };
  const summary = (bot) => ({
    id: bot.id,
    name: bot.name,
    draft_revision: bot.revision,
    draft_saved_at: bot.savedAt,
    latest_version: bot.versions[0]?.version || null,
    deployed: bot.deployed,
  });
  const draftOf = (bot) => ({ bot_id: bot.id, revision: bot.revision, saved_at: bot.savedAt, saved_by: bot.savedBy, config: bot.config });

  // Every answer is a copy: the screens and tests may change what they are given, and that must never change what is stored here.
  async function handle(method, rawPath, body = {}) {
    const answer = await route(method, rawPath, body);
    return { status: answer.status, body: answer.body === undefined ? undefined : clone(answer.body) };
  }

  async function route(method, rawPath, body = {}) {
    const [path, query = ''] = String(rawPath).split('?');
    const params = new URLSearchParams(query);
    const state = read();
    const commit = () => storage.save(state);
    let m;

    if (path === '/health' && method === 'GET') return ok({ ok: true, demo: true });
    if (path === '/schema' && method === 'GET') return ok(await loadSchema());
    if (path === '/environments' && method === 'GET') return ok(ENVIRONMENTS);
    if (path === '/providers' && method === 'GET') {
      return ok({
        providers: [
          { name: 'anthropic', stages: ['llm'], installed: true, realtime_runnable: false, default_secret: 'ANTHROPIC_API_KEY', key_available: false },
          { name: 'assemblyai', stages: ['stt'], installed: false, realtime_runnable: false, default_secret: 'ASSEMBLYAI_API_KEY', key_available: false },
          { name: 'cartesia', stages: ['stt', 'tts'], installed: true, realtime_runnable: false, default_secret: 'CARTESIA_API_KEY', key_available: false },
          { name: 'deepgram', stages: ['stt', 'tts'], installed: true, realtime_runnable: false, default_secret: 'DEEPGRAM_API_KEY', key_available: false },
          { name: 'elevenlabs', stages: ['stt', 'tts'], installed: true, realtime_runnable: false, default_secret: 'ELEVEN_API_KEY', key_available: false },
          {
            name: 'google',
            stages: ['stt', 'llm', 'tts', 'realtime'],
            installed: false,
            realtime_runnable: false,
            default_secret: 'GOOGLE_API_KEY',
            key_available: false,
          },
          { name: 'groq', stages: ['stt', 'llm', 'tts'], installed: false, realtime_runnable: false, default_secret: 'GROQ_API_KEY', key_available: false },
          {
            name: 'openai',
            stages: ['stt', 'llm', 'tts', 'realtime'],
            installed: true,
            realtime_runnable: true,
            default_secret: 'OPENAI_API_KEY',
            key_available: false,
          },
          { name: 'openai_compatible', stages: ['stt', 'llm', 'tts'], installed: true, realtime_runnable: false, default_secret: null, key_available: false },
          { name: 'silero', stages: ['vad'], installed: true, realtime_runnable: false, default_secret: null, key_available: false },
        ],
        stages: { stt: 'Speech-to-text', llm: 'Language model', tts: 'Text-to-speech', realtime: 'Realtime', vad: 'Voice activity' },
        turn_detectors: [],
        note: 'Demo mode: this is a made-up list of what a server could offer, not a real server.',
      });
    }
    if (path === '/validate' && method === 'POST') return ok(validateDemo(body));
    // previews: send `config` (what is in the editor) or name a saved agent (`bot`, `ref`)
    if (path === '/redaction/entities' && method === 'GET') return ok({ entities: demoEntities() });
    if (
      ['/preview/prompt', '/preview/result', '/preview/speech', '/preview/guardrails', '/preview/redaction', '/preview/task'].includes(path) &&
      method === 'POST'
    ) {
      const named = body.bot ? state.bots[body.bot] : null;
      if (body.bot && !named) return fail(404, 'No such agent.');
      const ref = body.ref || 'draft';
      const config =
        body.config ||
        (named
          ? ref === 'draft'
            ? named.config
            : (named.versions.find((v) => v.version === ref || v.version === named.deployed[ref]) || named.versions[0])?.config
          : null);
      if (!config) return fail(422, 'Send a config, or name a bot.', { errors: [] });
      const answer =
        path === '/preview/prompt'
          ? previewPromptDemo(config, body)
          : path === '/preview/result'
            ? previewResultDemo(config, body)
            : tryPreviewDemo(path, config, body);
      return answer.status === 200 ? ok(answer.body) : fail(answer.status, answer.body.detail);
    }

    if (/^\/numbers(\/|$)/.test(path) || /^\/bots\/[^/]+\/numbers(\/|$)/.test(path)) {
      const answer = routeNumbers(method, path, body || {}, state, { params, commit, id: uid });
      if (answer) return answer;
    }

    if (path === '/bots' && method === 'GET') return ok(Object.values(state.bots).map(summary));
    if (path === '/bots' && method === 'POST') {
      const { id, name } = body || {};
      if (!ID_PATTERN.test(String(id || '')))
        return fail(400, 'An agent id starts with a lowercase letter and then has lowercase letters, digits, - or _ (up to 64 characters).');
      if (RESERVED_IDS.includes(id)) return fail(400, `'${id}' is reserved and cannot be used as an agent id.`);
      if (state.bots[id]) return fail(409, `An agent with the id '${id}' already exists.`);
      state.bots[id] = newBot(id, String(name || id));
      commit();
      return ok(draftOf(state.bots[id]), 201);
    }

    if ((m = path.match(/^\/bots\/([^/]+)(\/.*)?$/))) {
      const bot = state.bots[decodeURIComponent(m[1])];
      const rest = m[2] || '';
      if (!bot) return fail(404, 'No such agent.');
      if (rest === '' && method === 'GET') return ok(summary(bot));

      if (rest === '/draft' && method === 'GET') return ok(draftOf(bot));
      if (rest === '/draft' && method === 'PUT') {
        if (body.base_revision !== undefined && body.base_revision !== null && body.base_revision !== bot.revision)
          return fail(409, 'The draft was saved by someone else after you opened it.');
        if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config))
          return fail(422, 'The configuration must be a JSON object.', { errors: [{ path: null, message: 'The configuration must be a JSON object.' }] });
        bot.config = clone(body.config);
        bot.revision += 1;
        bot.savedAt = now();
        bot.savedBy = DEMO_USER;
        if (typeof bot.config.meta?.name === 'string' && bot.config.meta.name) bot.name = bot.config.meta.name;
        commit();
        return ok({ draft: draftOf(bot), validation: validateDemo(bot.config, bot.id) });
      }

      if (rest === '/publish' && method === 'POST') {
        const report = validateDemo(bot.config, bot.id);
        if (!report.valid) return fail(422, 'This draft has errors, so it cannot be published.', { errors: report.errors });
        const latest = bot.versions[0]?.version;
        let version;
        if (body.bump) {
          if (!latest) return fail(400, 'Nothing is published yet, so there is no version to count from. Publish the draft’s own version first.');
          if (!['major', 'minor', 'patch'].includes(body.bump)) return fail(400, 'bump must be major, minor or patch.');
          version = bumpVersion(latest, body.bump);
        } else version = bot.config.meta.version;
        if (bot.versions.some((v) => v.version === version)) return fail(409, `Version ${version} is already published.`);
        const published = { ...clone(bot.config), meta: { ...bot.config.meta, version } };
        const record = { version, published_at: now(), published_by: DEMO_USER, checksum: checksumOf(published), config: published };
        bot.versions.unshift(record);
        bot.config = { ...bot.config, meta: { ...bot.config.meta, version: bumpVersion(version) } };
        bot.revision += 1;
        bot.savedAt = now();
        commit();
        return ok(
          {
            bot_id: bot.id,
            version,
            published_at: record.published_at,
            published_by: DEMO_USER,
            checksum: record.checksum,
            warnings: report.warnings,
            secrets_required: report.secrets_required,
          },
          201,
        );
      }
      if (rest === '/versions' && method === 'GET') return ok(bot.versions.map(({ config, ...v }) => v));
      if ((m = rest.match(/^\/versions\/([^/]+)$/)) && method === 'GET') {
        const found = bot.versions.find((v) => v.version === decodeURIComponent(m[1]));
        return found ? ok({ bot_id: bot.id, ...found }) : fail(404, `Version ${m[1]} is not published.`);
      }
      if (rest === '/diff' && method === 'GET') {
        const pick = (ref) => (ref === 'draft' ? bot.config : bot.versions.find((v) => v.version === ref)?.config);
        const a = params.get('a');
        const b = params.get('b');
        const left = pick(a);
        const right = pick(b);
        if (!left || !right) return fail(404, 'One of those versions is not published.');
        return ok({ from: a, to: b, changes: diffConfigs(left, right) });
      }

      if (rest === '/deploy' && method === 'POST') {
        const { version, environment, note } = body || {};
        if (!ENVIRONMENTS.includes(environment)) return fail(400, `environment must be one of ${ENVIRONMENTS.join(', ')}.`);
        const target = bot.versions.find((v) => v.version === version);
        if (!target) return fail(404, `Version ${version} is not published.`);
        const previous = bot.deployed[environment] || null;
        const deployment = {
          id: uid('d'),
          status: 'active',
          environment,
          version,
          previous_version: previous,
          deployed_at: now(),
          deployed_by: DEMO_USER,
          note: note || '',
        };
        bot.deployments.push(deployment);
        bot.deployed[environment] = version;
        commit();
        const report = validateDemo(target.config, bot.id);
        return ok({
          deployment,
          preflight: {
            secrets_required: [...secretsIn(target.config)].sort(),
            secrets_missing: [],
            unsupported: report.unsupported,
            knowledge: preflightKnowledge(bot, target.config, Date.parse(now())),
          },
        });
      }
      if (rest === '/deployments' && method === 'GET') {
        const current = Object.fromEntries(
          Object.entries(bot.deployed).map(([env, version]) => {
            const d = [...bot.deployments].reverse().find((x) => x.environment === env && x.version === version);
            return [env, { id: d.id, version, deployed_at: d.deployed_at, deployed_by: d.deployed_by }];
          }),
        );
        return ok({ current, history: bot.deployments });
      }
      if ((m = rest.match(/^\/deployments\/([^/]+)$/)) && method === 'GET') {
        const found = bot.deployments.find((d) => d.id === m[1]);
        return found ? ok(found) : fail(404, 'No such deployment.');
      }
      // ---- knowledge (imitated: see demoKnowledge.js). Builds finish by the clock, so they are settled before every answer.
      if (/^\/knowledge(\/|$)/.test(rest)) {
        const nowMs = Date.parse(now());
        if (settle(bot, nowMs)) commit();
        const ref = params.get('ref') || body?.ref || 'draft';
        const knowledgeConfig =
          ref === 'draft'
            ? bot.config
            : bot.versions.find((v) => v.version === ref || v.version === bot.deployed[ref])?.config || (ref === 'latest' ? bot.versions[0]?.config : null);
        if (!knowledgeConfig) return fail(404, `There is no '${ref}' to read the knowledge from.`);
        if (rest === '/knowledge' && method === 'GET') return ok(knowledgeOverview(bot, knowledgeConfig, ref, nowMs));
        if (rest === '/knowledge/files' && method === 'GET') return ok(knowledgeOverview(bot, knowledgeConfig, ref, nowMs).files);
        const fileMatch = rest.match(/^\/knowledge\/files\/(.+)$/);
        if (fileMatch && method === 'PUT') {
          const name = decodeURIComponent(fileMatch[1]);
          if (!/\.(txt|md|markdown|html?|pdf|csv|json)$/i.test(name))
            return fail(400, `'${name}' is not a kind of file knowledge can read: use text, markdown, HTML, PDF, CSV or JSON.`);
          const file = body && body.__file;
          const content = typeof file === 'string' ? file : file && typeof file.text === 'function' ? await file.text() : '';
          const size = typeof file === 'string' ? file.length : (file?.size ?? content.length);
          if (size > 20 * 1024 * 1024) return fail(413, 'That file is larger than this server accepts (20 MB).');
          const row = uploadFile(bot, name, content, size, now());
          commit();
          return ok(row, 201);
        }
        if (fileMatch && method === 'DELETE') {
          const answer = removeFile(bot, bot.config, decodeURIComponent(fileMatch[1]), params.get('force') === 'true');
          if (answer.status === 204) {
            commit();
            return { status: 204, body: undefined };
          }
          return fail(answer.status, answer.detail);
        }
        const baseMatch = rest.match(/^\/knowledge\/([^/]+)\/(build|status|search)$/);
        if (baseMatch) {
          const baseId = decodeURIComponent(baseMatch[1]);
          if (baseMatch[2] === 'status' && method === 'GET') {
            const answer = baseStatus(bot, knowledgeConfig, baseId, nowMs);
            return answer ? ok(answer) : fail(404, `There is no knowledge base '${baseId}'.`);
          }
          if (baseMatch[2] === 'build' && method === 'POST') {
            const answer = startBuild(bot, knowledgeConfig, baseId, nowMs, stepMs === 0 ? 0 : undefined);
            if (answer.status !== 202) return fail(answer.status, answer.detail);
            commit();
            return ok(answer.job, 202);
          }
          if (baseMatch[2] === 'search' && method === 'POST') {
            const answer = searchBase(bot, knowledgeConfig, baseId, body || {});
            return answer.status === 200 ? ok(answer.body) : fail(answer.status, answer.detail);
          }
        }
      }
      // ---- call records (imitated: see demoCalls.js). Seeded the first time they are asked for, so older demo data gets some too.
      if (/^\/calls(\/|$)/.test(rest)) {
        if (!bot.calls) {
          bot.calls = seedCalls(bot.id, bot.config, now(), { history });
          commit();
        }
        if (rest === '/calls' && method === 'GET') return ok(listCallsOf(bot.calls, params, Date.parse(now())));
        const callMatch = rest.match(/^\/calls\/([^/]+)(\/transcript)?$/);
        if (callMatch && method === 'GET') {
          const key = decodeURIComponent(callMatch[1]);
          const found =
            bot.calls.find((c) => c.summary.id === key) ||
            bot.calls.filter((c) => c.summary.room === key).sort((x, y) => Date.parse(y.summary.started_at) - Date.parse(x.summary.started_at))[0];
          if (!found) return fail(404, 'No such call.');
          return ok(callMatch[2] ? transcriptOf(found) : getCallOf(found, params));
        }
      }
      // ---- test scenarios (imitated: see demoTests.js)
      const configAt = (ref) =>
        ref === 'draft'
          ? bot.config
          : ref === 'latest'
            ? bot.versions[0]?.config
            : bot.versions.find((v) => v.version === ref)?.config || bot.versions.find((v) => v.version === bot.deployed[ref])?.config;
      if (rest === '/tests' && method === 'GET') {
        const ref = params.get('ref') || 'draft';
        const config = configAt(ref);
        if (!config) return fail(404, `There is no '${ref}' to read the scenarios from.`);
        return ok({ bot: bot.id, ref, scenarios: scenarioListOf(config, bot.testRuns || [], Date.parse(now())), network_allowed: false });
      }
      if (rest === '/tests/run' && method === 'POST') {
        const nowMs = Date.parse(now());
        bot.testRuns ||= [];
        if (bot.testRuns.some((r) => viewRun(r, nowMs).status === 'running')) return fail(409, 'A test run is already in progress for this agent.');
        const ref = body.config ? 'unsaved' : body.ref || 'draft';
        const config = body.config || configAt(ref);
        if (!config) return fail(404, `There is no '${ref}' to test.`);
        if (!Array.isArray(config.tests) || !config.tests.length) return fail(400, 'This configuration has no test scenarios to run.');
        const unknown = (body.scenarios || []).filter((id) => !config.tests.some((s) => s?.id === id));
        if (unknown.length) return fail(400, `There is no scenario ${unknown.map((id) => `'${id}'`).join(', ')}.`);
        const run = createRun({ id: uid('run_'), config: clone(config), ref, body, startedAt: now(), stepMs });
        bot.testRuns.unshift(run);
        bot.testRuns = bot.testRuns.slice(0, 20);
        commit();
        return ok(viewRun(run, nowMs), 202);
      }
      if (rest === '/tests/runs' && method === 'GET') {
        const limit = Number(params.get('limit')) || 20;
        return ok((bot.testRuns || []).slice(0, limit).map((r) => headlineOf(r, Date.parse(now()))));
      }
      if ((m = rest.match(/^\/tests\/runs\/([^/]+)$/)) && method === 'GET') {
        const found = (bot.testRuns || []).find((r) => r.id === decodeURIComponent(m[1]));
        return found ? ok(viewRun(found, Date.parse(now()))) : fail(404, 'No such test run.');
      }
      if (rest === '/sessions' && method === 'POST')
        return fail(503, 'Demo mode has no LiveKit server, so there is no real conversation to join. Use the simulated preview.');
    }
    return fail(404, `Demo mode has no ${method} ${path}.`);
  }

  // Follows a call one record at a time, the way the stream endpoint does (the studio's followCall uses this in demo mode).
  function follow(botId, callId, handlers) {
    const bot = read().bots[botId];
    const call = bot?.calls?.find((c) => c.summary.id === callId || c.summary.room === callId);
    if (!call) {
      return () => {};
    }
    return followCallOf(call, handlers);
  }

  // A conversation had in the simulated preview becomes a call, so Sessions and the trace have it. Returns its id.
  function recordConversation(botId, conversation) {
    const state = read();
    const bot = state.bots[botId];
    if (!bot) return null;
    if (!bot.calls) bot.calls = seedCalls(bot.id, bot.config, now(), { history });
    const call = callFromConversation(botId, { ...conversation, startedAt: conversation.startedAt || now(), version: conversation.version || 'draft' });
    bot.calls.unshift(call);
    bot.calls = bot.calls.slice(0, 60);
    storage.save(state);
    return call.summary.id;
  }

  return { handle, follow, recordConversation, reset: () => storage.save(seed ? seedState() : { v: 1, bots: {} }) };
}

// ---- the instance the app uses in demo mode: kept in this browser, with the schema served from the app's own public copy
let instance = null;
const loadPublicSchema = async () => {
  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
  const response = await fetch(`${base}config/agent-config.schema.json`);
  if (!response.ok) throw new Error('The bundled schema could not be loaded.');
  return response.json();
};
// weave_demo_history = 'off' leaves out the two weeks of earlier made-up calls (a switch for tests, and for a demo with only the newest few calls)
const historyOn = () => {
  try {
    return window.localStorage.getItem('weave_demo_history') !== 'off';
  } catch {
    return true;
  }
};
export const getDemoApi = () => {
  instance ||= createDemoApi({ storage: browserStorage(), loadSchema: loadPublicSchema, history: historyOn() });
  return instance;
};
export const resetDemoData = () => {
  getDemoApi().reset();
};
