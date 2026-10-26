// The Voices page in a real browser, on the demo: every voice shows its provider id, an ElevenLabs voice plays that voice's own recorded sample (a man and a woman
// are different recordings), and so does a Cartesia voice (two different recordings for a woman and a man).
//
//   npm run dev:demo      (in one terminal)
//   node e2e/voices.mjs
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch.
import { chromium } from 'playwright-core';
import { pick } from './pick.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
};
async function launch() {
  const headless = process.env.E2E_HEADED !== '1';
  if (process.env.E2E_BROWSER) return chromium.launch({ executablePath: process.env.E2E_BROWSER, headless });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless });
    } catch {
      /* try the next one */
    }
  }
  throw new Error('No Chrome or Edge found. Set E2E_BROWSER to the path of one.');
}
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  if (sessionStorage.getItem('voices')) return;
  sessionStorage.setItem('voices', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
});
const page = await context.newPage();
const problems = [];
const samples = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});
// the samples are somebody else's server: answer with a tiny silent sound so the test needs no network, and note which address was asked for
await page.route(
  (url) => /storage\.googleapis\.com|elevenlabs\.io|creativeclaw\.co/.test(url.hostname),
  (route) => {
    samples.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=', 'base64'),
    });
  },
);
await page.route(
  (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
  (route) => route.abort(),
);
await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill('e2e@example.test');
await page.getByPlaceholder('Enter your password').fill('x12345678');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');
await page
  .getByRole('button', { name: /^\s*\S?\s*Voices/ })
  .first()
  .click();
await page.waitForSelector('.voiceLibraryTable');

const rows = page.locator('.voiceLibraryTable tbody tr');
if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/voices.png` });
check('each voice shows its provider id under its name', (await page.locator('.voiceNameStack .voiceIdCell code').count()) > 0);
const sarah = rows.filter({ hasText: 'Sarah' }).first();
check('each voice shows its real provider id (Sarah: EXAVITQu4vr4xnSDxMaL)', (await sarah.innerText()).includes('EXAVITQu4vr4xnSDxMaL'));
await pick(page, page.getByLabel('Filter by provider'), 'Cartesia');
check('a Cartesia voice shows its UUID', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(await rows.first().innerText()));
await pick(page, page.getByLabel('Filter by provider'), 'All providers');
const every = await rows.count();
const ids = await page.locator('.voiceIdCell code').allInnerTexts();
check('every voice has a different id', ids.length === every && new Set(ids).size === every, `${ids.length} ids for ${every} rows`);

// an ElevenLabs voice plays its own recording; two voices are two different recordings
await rows
  .filter({ hasText: 'Sarah' })
  .first()
  .getByRole('button', { name: /Listen to Sarah/ })
  .click();
await page.waitForTimeout(500);
await rows
  .filter({ hasText: 'Adam' })
  .first()
  .getByRole('button', { name: /Listen to Adam/ })
  .click();
await page.waitForTimeout(500);
check(
  'a female and a male ElevenLabs voice ask for two different recordings',
  samples.length >= 2 &&
    new Set(samples).size >= 2 &&
    samples.some((u) => u.includes('EXAVITQu4vr4xnSDxMaL')) &&
    samples.some((u) => u.includes('pNInz6obpgDQGcFmaJgB')),
  samples.join(' | '),
);
check(
  'an ElevenLabs voice does not say it is an approximation',
  !/approximation|browser’s voice reading it/.test((await page.locator('.voicePreviewNote').allInnerTexts()).join(' ')),
);

// Cartesia voices have a recording of their own too: a woman and a man ask for two different ones, and the browser's voice is not used
await pick(page, page.getByLabel('Filter by provider'), 'Cartesia');
const before = samples.length;
await rows
  .filter({ hasText: 'Skylar' })
  .first()
  .getByRole('button', { name: /Listen to Skylar/ })
  .click();
await page.waitForTimeout(500);
await rows
  .filter({ hasText: 'Daniel' })
  .first()
  .getByRole('button', { name: /Listen to Daniel/ })
  .click();
await page.waitForTimeout(500);
const cartesia = samples.slice(before);
check('a female and a male Cartesia voice ask for two different recordings', cartesia.length >= 2 && new Set(cartesia).size >= 2, cartesia.join(' | '));
check(
  'and neither says it is the browser’s voice',
  !/browser’s voice reading it|approximation/.test((await page.locator('.voicePreviewNote').allInnerTexts()).join(' ')),
);
check('no errors in the console', problems.length === 0, problems.slice(0, 2).join(' | '));
await browser.close();
console.log(failed ? `FAIL  ${failed} check${failed === 1 ? '' : 's'} failed` : 'PASS  all checks passed');
process.exitCode = failed ? 1 : 0;
