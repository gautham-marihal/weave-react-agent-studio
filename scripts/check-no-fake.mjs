import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isSkipped, violations } from './no-fake-rules.mjs';

// Scans the app source, the banking gateway's production source (its mock/ folder is deliberately outside the scan:
// it is the one sanctioned place for mock data; src/sandbox/ is the app's: Sandbox, and Live's labelled mock bank), the files that configure
// where the app talks to, then the build.
const ROOTS = ['src', 'services/banking-gateway/src'];
const FILES = ['vite.config.ts', 'index.html', '.env.example'];

const walk = (d) => {
  try {
    return readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  } catch {
    return [];
  }
};

const toPosix = (p) => relative(process.cwd(), p).split(sep).join('/');

let bad = 0;

const scanned = [...ROOTS.flatMap(walk), ...FILES.filter((f) => existsSync(f))]
  .map(toPosix)
  .filter((f) => !isSkipped(f));

for (const f of scanned) {
  for (const { re, why } of violations(f, readFileSync(f, 'utf8'))) {
    console.error(`FORBIDDEN ${re} in ${f}: ${why}`);
    bad++;
  }
}

for (const f of walk('dist')) {
  if (/\.(js|html|map)$/.test(f) && /\bsetupWorker\b|mockServiceWorker|@mswjs/.test(readFileSync(f, 'utf8'))) {
    console.error(`MOCK CODE IN BUILD: ${f}`);
    bad++;
  }
}

if (bad === 0) {
  console.log(`✓ check-no-fake: clean. ${scanned.length} files scanned; no mock, demo, simulated or hardcoded-address code outside src/sandbox.`);
}

process.exit(bad ? 1 : 0);
