// How long is the first run? From a clean browser to the first test conversation, counting what a person has to do: clicks, and fields to fill. It
// runs in demo mode (nothing reaches an API) in a real browser, and it counts in the page itself, so it measures what a hand would do, not what a script
// happens to call.
//
//   npm run build -- --mode demo   then   npx vite preview --mode demo --port 4180   then   E2E_BASE=http://localhost:4180 npm run e2e:firstrun
//
// The review's target: sign-in to the first test conversation in 8 clicks or fewer once real sign-in replaces the demo's (its screen and profile step are
// counted apart, because they are the demo's own), and no technical term on the way. It prints the count and fails when the target is missed.
// Environment: E2E_BASE (default http://localhost:4180), E2E_BROWSER (a Chrome or Edge path), E2E_MAX_CLICKS (default 8).
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:4180';
const MAX_CLICKS = Number(process.env.E2E_MAX_CLICKS || 8);
// words that mean something only to the people who built the product: none may be on screen along the way
const JARGON = [
  /\bLiveKit\b/,
  /\bLIVEKIT_[A-Z_]+/,
  /\bJSON\b/,
  /\bschema\b/i,
  /\bOPENAI_API_KEY\b/,
  /\bsip_voice\b/,
  /\bendpoint\b/i,
  /\bwebhook\b/i,
  /\bid:\s*[a-z_-]+/,
];

async function launch() {
  if (process.env.E2E_BROWSER) return chromium.launch({ executablePath: process.env.E2E_BROWSER, headless: true });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try the next */
    }
  }
  throw new Error('No Chrome or Edge found. Set E2E_BROWSER to the path of one.');
}

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(() => {
  window.__clicks = [];
  window.__typed = new Set();
  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted) return;
      const el = event.target.closest('button, a, [role=button], [role=tab], input, label, summary, select') || event.target;
      window.__clicks.push((el.getAttribute?.('aria-label') || el.innerText || el.tagName || '').trim().replace(/\s+/g, ' ').slice(0, 60));
    },
    true,
  );
  document.addEventListener(
    'input',
    (event) => {
      if (event.isTrusted) window.__typed.add(event.target.getAttribute('aria-label') || event.target.placeholder || event.target.name || event.target.tagName);
    },
    true,
  );
});
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text().slice(0, 200));
});
await page.route(
  (url) => url.pathname.startsWith('/api/'),
  (r) => r.abort(),
);

const mark = async () => page.evaluate(() => ({ clicks: window.__clicks.length, typed: window.__typed.size }));
const seen = [];
const scan = async () => {
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '');
  JARGON.forEach((re) => {
    const hit = text.match(re);
    if (hit) seen.push(hit[0]);
  });
};

await page.goto(BASE);
await page.waitForLoadState('domcontentloaded');
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill('asha@harbour.example');
await page.getByPlaceholder('Enter your password').fill('a-demo-password');
await page.getByRole('button', { name: /continue to workspace/i }).click();
// the demo's own profile step (real sign-in brings the person's details with it)
await page.getByPlaceholder('e.g. Gautham Marrihal').waitFor();
await page.getByPlaceholder('e.g. Gautham Marrihal').fill('Asha Rao');
await page.getByPlaceholder('e.g. Customer Support AI').fill('Harbour Plumbing');
await page.locator('select').selectOption({ label: 'Customer Support' });
await page.getByRole('button', { name: /continue to my workspace/i }).click();
await page.waitForSelector('.dashMain');
const afterSignIn = await mark();

await scan();
await page
  .getByRole('button', { name: /Create agent/ })
  .first()
  .click();
await page.getByPlaceholder('e.g. Acme Support').waitFor();
await scan();
await page.getByPlaceholder('e.g. Acme Support').fill('Harbour Plumbing');
await page.getByRole('button', { name: 'Create agent', exact: true }).click();
await page.waitForSelector('.stHeader h1');
await scan();
await page.getByRole('button', { name: /Start a simulated chat/ }).click();
await page
  .locator('.pvLive, .stTMessages, [data-status=live], .pvMessages')
  .first()
  .waitFor({ timeout: 15000 })
  .catch(() => {});
await scan();
const done = await mark();

const afterTheSignIn = { clicks: done.clicks - afterSignIn.clicks, fields: done.typed - afterSignIn.typed };
console.log(`demo sign-in and profile: ${afterSignIn.clicks} clicks, ${afterSignIn.typed} fields (the demo's own; real sign-in replaces them)`);
console.log(`from the workspace to the first test conversation: ${afterTheSignIn.clicks} clicks, ${afterTheSignIn.fields} fields`);
console.log(`counted: ${(await page.evaluate(() => window.__clicks)).slice(afterSignIn.clicks).join(' > ')}`);
const jargon = [...new Set(seen)];
let failed = false;
if (afterTheSignIn.clicks > MAX_CLICKS) {
  console.log(`FAIL: more than ${MAX_CLICKS} clicks`);
  failed = true;
}
if (jargon.length) {
  console.log(`FAIL: technical terms on the way: ${jargon.join(', ')}`);
  failed = true;
}
if (problems.length) {
  console.log(`FAIL: page problems: ${problems.slice(0, 3).join(' | ')}`);
  failed = true;
}
if (!failed) console.log(`PASS: ${afterTheSignIn.clicks} clicks (target ${MAX_CLICKS} or fewer), no technical term on screen`);
await browser.close();
process.exit(failed ? 1 : 0);
