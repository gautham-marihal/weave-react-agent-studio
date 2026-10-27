// Puts the six business-banking agents on the Agent Builder server, pointed at the mock bank API: creates each agent the first time, saves the
// built configuration as its draft, publishes it (1.0.0 the first time, then the next patch version) and deploys that version to Development.
// It WRITES to the server: run it only against the server these agents belong on. Run build.mjs with the same MOCK_BANK_URL first.
//   node mock-bank/agents/deploy.mjs           (API_BASE, default http://localhost:5191/api: the studio's dev server, which adds the API key)
import { readFileSync } from 'node:fs';
import { AGENTS } from './build.mjs';

const API = process.env.API_BASE || 'http://localhost:5191/api';

async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

const ids = AGENTS.map((make) => make('').meta.id); // only the ids are read here
const existing = new Map((await api('GET', '/bots')).map((b) => [b.id, b]));
for (const id of ids) {
  const config = JSON.parse(readFileSync(new URL(`./out/${id}.json`, import.meta.url), 'utf8'));
  const known = existing.get(id);
  if (!known) await api('POST', '/bots', { id, name: config.meta.name });
  const draft = await api('GET', `/bots/${id}/draft`);
  // the server's own meta (created_at…) stays; the version is the server's to move on after a publish
  const meta = { ...draft.config?.meta, ...config.meta, ...(known?.latest_version ? { version: draft.config?.meta?.version } : {}) };
  await api('PUT', `/bots/${id}/draft`, { config: { ...config, meta }, base_revision: draft.revision });
  const published = await api('POST', `/bots/${id}/publish`, known?.latest_version ? { bump: 'patch' } : {});
  await api('POST', `/bots/${id}/deploy`, { version: published.version, environment: 'development', note: 'Business banking agents with the mock bank API' });
  console.log(`${id}: ${known ? 'updated' : 'created'}, published ${published.version}, live in Development`);
}
