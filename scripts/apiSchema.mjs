// Reads the Agent Builder API's address and key (from the environment or .env.local) and fetches its JSON Schema.
// Shared by `npm run sync-fixtures` and the schema drift test.
import { readFileSync, existsSync } from 'node:fs';

export function readEnv() {
  const env = { ...process.env };
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !env[match[1]]) env[match[1]] = match[2];
    }
  }
  return env;
}

export async function fetchSchema(env = readEnv()) {
  const base = (env.AGENT_BUILDER_URL || 'http://localhost:8100').replace(/\/$/, '');
  const headers = env.AGENT_BUILDER_API_KEY ? { Authorization: `Bearer ${env.AGENT_BUILDER_API_KEY}` } : {};
  const response = await fetch(`${base}/schema`, { headers });
  if (!response.ok) throw new Error(`GET ${base}/schema answered ${response.status}`);
  return response.json();
}
