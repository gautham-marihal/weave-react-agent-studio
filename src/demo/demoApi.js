// The Agent Builder API, imitated in memory, for demo mode (and for the end-to-end test, which runs without a backend). It answers the
// endpoints the studio uses with the shapes in the API's FRONTEND_GUIDE: agents with drafts (revision-locked), versions, deployments, a
// diff. It is a FAKE: its validator is a handful of simple rules (demoValidate.js), publishing and deploying only move records around,
// and it has no LiveKit, so a "test session" is refused (the studio uses a simulated conversation instead).
// `handle(method, path, body)` resolves to { status, body }. Pure apart from the `storage` it is given.

import { applyStarter } from '../studio/starters.js';
import { diffConfigs } from './diff.js';
import { secretsIn, validateDemo } from './demoValidate.js';

export const ENVIRONMENTS = ['development', 'staging', 'production'];
export const RESERVED_IDS = ['transcripts', 'metrics', 'logs', 'sessions', 'tmp'];
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const DEMO_USER = 'demo';
export const STORAGE_KEY = 'weave_demo_state';

const clone = (value) => JSON.parse(JSON.stringify(value));
const ok = (body, status = 200) => ({ status, body });
const fail = (status, detail, extra = {}) => ({ status, body: { detail, ...extra } });

export const minimalConfig = (id, name) => ({
  schema_version: '1.2',
  meta: { id, name, version: '0.1.0', status: 'draft' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } }, conversation: {} },
  persona: { name },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: `${id}-widget` }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hello! How can I help you today?' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name, kind: 'standalone', instructions: { role: 'You are a helpful assistant. Answer briefly and politely.' }, tools: [] }] },
});

export const bumpVersion = (version, kind = 'patch') => {
  const [major, minor, patch] = String(version).split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

export const memoryStorage = (initial = null) => { let state = initial; return { load: () => state, save: (next) => { state = clone(next); } }; };

export function browserStorage(key = STORAGE_KEY) {
  let fallback = null;
  return {
    load() { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } },
    save(state) { fallback = state; try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* storage full or unavailable: kept for this page view */ } },
  };
}

export function createDemoApi({ storage = memoryStorage(), loadSchema = async () => ({}), now = () => new Date().toISOString(), seed = true } = {}) {
  let counter = 0;
  const uid = (prefix) => { counter += 1; return `${prefix}${Date.now().toString(36)}${counter}`; };

  const newBot = (id, name, config) => ({ id, name, revision: 1, savedAt: now(), savedBy: DEMO_USER, config: config || minimalConfig(id, name), versions: [], deployments: [], deployed: {} });

  function seedState() {
    const state = { v: 1, bots: {} };
    const make = (id, name, starter) => { state.bots[id] = newBot(id, name); state.bots[id].config = applyStarter(state.bots[id].config, starter); return state.bots[id]; };
    const support = make('acme-support', 'Acme Support', 'support');
    const front = make('front-desk', 'Front Desk', 'receptionist');
    make('bookings', 'Bookings', 'appointment');
    // a little history, so the Versions and Deploy screens have something to show
    const publish = (bot, version) => {
      bot.versions.unshift({ version, published_at: now(), published_by: DEMO_USER, checksum: uid('c'), config: { ...clone(bot.config), meta: { ...bot.config.meta, version } } });
      bot.config.meta.version = bumpVersion(version);
      bot.revision += 1;
    };
    const deploy = (bot, environment, version) => {
      const previous = bot.deployed[environment] || null;
      bot.deployments.push({ id: uid('d'), status: 'active', environment, version, previous_version: previous, deployed_at: now(), deployed_by: DEMO_USER, note: '' });
      bot.deployed[environment] = version;
    };
    publish(support, '0.1.0'); deploy(support, 'development', '0.1.0'); deploy(support, 'staging', '0.1.0');
    support.config.persona = { ...support.config.persona, tone: 'warm, patient, plain language, and a little more concise' };
    publish(support, '0.1.1'); deploy(support, 'development', '0.1.1');
    publish(front, '0.1.0'); deploy(front, 'development', '0.1.0');
    return state;
  }

  const read = () => { let state = storage.load(); if (!state && seed) { state = seedState(); storage.save(state); } return state || { v: 1, bots: {} }; };
  const summary = (bot) => ({ id: bot.id, name: bot.name, draft_revision: bot.revision, draft_saved_at: bot.savedAt, latest_version: bot.versions[0]?.version || null, deployed: bot.deployed });
  const draftOf = (bot) => ({ bot_id: bot.id, revision: bot.revision, saved_at: bot.savedAt, saved_by: bot.savedBy, config: bot.config });

  async function handle(method, rawPath, body = {}) {
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
          { name: 'google', stages: ['stt', 'llm', 'tts', 'realtime'], installed: false, realtime_runnable: false, default_secret: 'GOOGLE_API_KEY', key_available: false },
          { name: 'groq', stages: ['stt', 'llm', 'tts'], installed: false, realtime_runnable: false, default_secret: 'GROQ_API_KEY', key_available: false },
          { name: 'openai', stages: ['stt', 'llm', 'tts', 'realtime'], installed: true, realtime_runnable: true, default_secret: 'OPENAI_API_KEY', key_available: false },
          { name: 'openai_compatible', stages: ['stt', 'llm', 'tts'], installed: true, realtime_runnable: false, default_secret: null, key_available: false },
          { name: 'silero', stages: ['vad'], installed: true, realtime_runnable: false, default_secret: null, key_available: false },
        ],
        stages: { stt: 'Speech-to-text', llm: 'Language model', tts: 'Text-to-speech', realtime: 'Realtime', vad: 'Voice activity' },
        turn_detectors: [],
        note: 'Demo mode: this is a made-up list of what a server could offer, not a real server.',
      });
    }
    if (path === '/validate' && method === 'POST') return ok(validateDemo(body));

    if (path === '/bots' && method === 'GET') return ok(Object.values(state.bots).map(summary));
    if (path === '/bots' && method === 'POST') {
      const { id, name } = body || {};
      if (!ID_PATTERN.test(String(id || ''))) return fail(400, 'An agent id starts with a lowercase letter and then has lowercase letters, digits, - or _ (up to 64 characters).');
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
        if (body.base_revision !== undefined && body.base_revision !== null && body.base_revision !== bot.revision) return fail(409, 'The draft was saved by someone else after you opened it.');
        if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) return fail(422, 'The configuration must be a JSON object.', { errors: [{ path: null, message: 'The configuration must be a JSON object.' }] });
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
        const record = { version, published_at: now(), published_by: DEMO_USER, checksum: uid('c'), config: { ...clone(bot.config), meta: { ...bot.config.meta, version } } };
        bot.versions.unshift(record);
        bot.config = { ...bot.config, meta: { ...bot.config.meta, version: bumpVersion(version) } };
        bot.revision += 1;
        bot.savedAt = now();
        commit();
        return ok({ bot_id: bot.id, version, published_at: record.published_at, published_by: DEMO_USER, checksum: record.checksum, warnings: report.warnings, secrets_required: report.secrets_required }, 201);
      }
      if (rest === '/versions' && method === 'GET') return ok(bot.versions.map(({ config, ...v }) => v));
      if ((m = rest.match(/^\/versions\/([^/]+)$/)) && method === 'GET') {
        const found = bot.versions.find((v) => v.version === decodeURIComponent(m[1]));
        return found ? ok({ bot_id: bot.id, ...found }) : fail(404, `Version ${m[1]} is not published.`);
      }
      if (rest === '/diff' && method === 'GET') {
        const pick = (ref) => (ref === 'draft' ? bot.config : bot.versions.find((v) => v.version === ref)?.config);
        const a = params.get('a'); const b = params.get('b');
        const left = pick(a); const right = pick(b);
        if (!left || !right) return fail(404, 'One of those versions is not published.');
        return ok({ from: a, to: b, changes: diffConfigs(left, right) });
      }

      if (rest === '/deploy' && method === 'POST') {
        const { version, environment, note } = body || {};
        if (!ENVIRONMENTS.includes(environment)) return fail(400, `environment must be one of ${ENVIRONMENTS.join(', ')}.`);
        const target = bot.versions.find((v) => v.version === version);
        if (!target) return fail(404, `Version ${version} is not published.`);
        const previous = bot.deployed[environment] || null;
        const deployment = { id: uid('d'), status: 'active', environment, version, previous_version: previous, deployed_at: now(), deployed_by: DEMO_USER, note: note || '' };
        bot.deployments.push(deployment);
        bot.deployed[environment] = version;
        commit();
        const report = validateDemo(target.config, bot.id);
        return ok({ deployment, preflight: { secrets_required: [...secretsIn(target.config)].sort(), secrets_missing: [], unsupported: report.unsupported } });
      }
      if (rest === '/deployments' && method === 'GET') {
        const current = Object.fromEntries(Object.entries(bot.deployed).map(([env, version]) => {
          const d = [...bot.deployments].reverse().find((x) => x.environment === env && x.version === version);
          return [env, { id: d.id, version, deployed_at: d.deployed_at, deployed_by: d.deployed_by }];
        }));
        return ok({ current, history: bot.deployments });
      }
      if ((m = rest.match(/^\/deployments\/([^/]+)$/)) && method === 'GET') {
        const found = bot.deployments.find((d) => d.id === m[1]);
        return found ? ok(found) : fail(404, 'No such deployment.');
      }
      if (rest === '/sessions' && method === 'POST') return fail(503, 'Demo mode has no LiveKit server, so there is no real conversation to join. Use the simulated preview.');
    }
    return fail(404, `Demo mode has no ${method} ${path}.`);
  }

  return { handle, reset: () => storage.save(seed ? seedState() : { v: 1, bots: {} }) };
}

// ---- the instance the app uses in demo mode: kept in this browser, with the schema served from the app's own public copy
let instance = null;
const loadPublicSchema = async () => {
  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
  const response = await fetch(`${base}config/agent-config.schema.json`);
  if (!response.ok) throw new Error('The bundled schema could not be loaded.');
  return response.json();
};
export const getDemoApi = () => { instance ||= createDemoApi({ storage: browserStorage(), loadSchema: loadPublicSchema }); return instance; };
export const resetDemoData = () => { getDemoApi().reset(); };
