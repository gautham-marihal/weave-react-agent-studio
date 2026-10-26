// Builds the six business-banking agent configurations, pointed at the mock bank API, into mock-bank/agents/out/<id>.json.
//   MOCK_BANK_URL=https://… node mock-bank/agents/build.mjs            (the address the agents' runtime reaches the mock API at)
//   … --validate                                                        also checks each with the Agent Builder API's POST /validate,
//                                                                        through the studio's dev server (API_BASE, default http://localhost:5191/api)
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sgBusinessBanking } from './sgBusinessBanking.mjs';
import { sgVip } from './sgVip.mjs';
import { sgInvestigations } from './sgInvestigations.mjs';
import { sgServiceManagerSurvey } from './sgServiceManagerSurvey.mjs';
import { myBusinessBanking } from './myBusinessBanking.mjs';
import { myConsumer } from './myConsumer.mjs';

export const AGENTS = [sgBusinessBanking, sgVip, sgInvestigations, sgServiceManagerSurvey, myBusinessBanking, myConsumer];

export function buildAll(mockUrl) {
  return AGENTS.map((make) => make(mockUrl));
}

async function main() {
  const mockUrl = process.env.MOCK_BANK_URL || 'http://localhost:4300';
  const out = new URL('./out/', import.meta.url);
  mkdirSync(out, { recursive: true });
  const configs = buildAll(mockUrl);
  for (const config of configs) writeFileSync(new URL(`${config.meta.id}.json`, out), `${JSON.stringify(config, null, 2)}\n`);
  console.log(`built ${configs.length} agents for ${mockUrl}`);
  if (!process.argv.includes('--validate')) return;
  const api = process.env.API_BASE || 'http://localhost:5191/api';
  let failed = 0;
  for (const config of configs) {
    const res = await fetch(`${api}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) });
    const report = await res.json();
    const errors = report.errors || [];
    const warnings = report.warnings || [];
    const unsupported = report.unsupported || [];
    if (!report.valid) failed += 1;
    console.log(
      `\n${config.meta.id}: ${report.valid ? 'valid' : 'NOT VALID'} · ${errors.length} errors · ${warnings.length} warnings · ${unsupported.length} unsupported`,
    );
    for (const e of errors) console.log(`  error   ${e.path || ''}: ${e.message}`);
    for (const w of warnings) console.log(`  warning ${w.path || ''}: ${w.message}`);
    for (const u of unsupported) console.log(`  unsupported ${u.feature || ''} at ${u.where || ''}`);
  }
  process.exitCode = failed ? 1 : 0;
}

// run directly (not imported, as the deploy script and the tests do)
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
