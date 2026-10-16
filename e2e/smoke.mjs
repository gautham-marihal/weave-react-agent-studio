// An end-to-end smoke test of the studio, in a real browser: sign in, create an agent from a starter, edit a field, save, publish,
// deploy to development, and have a test conversation. Run it with the dev server up (npm run dev) in either mode:
//
//   E2E_MODE=mock  (default) the API is the imitation one the app uses in demo mode (src/demo/demoApi.js), so no backend is needed.
//   E2E_MODE=live  talks to the real API through the dev server's /api proxy. It WRITES: it creates an agent named e2e-<time>.
//                  Use a local API (uv run uvicorn builder_api.app:create_app --factory --port 8100), never a shared one.
//
// The conversation is always mocked (livekit-client is replaced by e2e/fakeLivekit.js): a real one needs a LiveKit server and an agent.
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge; else the installed Chrome or Edge is used),
// E2E_HEADED=1 to watch.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createMockApi } from './mockApi.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const MODE = process.env.E2E_MODE === 'live' ? 'live' : 'mock';
const FAKE_LIVEKIT = fs.readFileSync(new URL('./fakeLivekit.js', import.meta.url), 'utf8');

let failures = 0;
const step = (name, ok, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`);
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
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await context.addInitScript(() => {
  if (sessionStorage.getItem('e2e-seeded')) return;
  sessionStorage.setItem('e2e-seeded', '1');
  localStorage.setItem('weave_tech_names', '1'); // the raw JSON view is offered with technical names
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E Tester', email: 'e2e@example.com', workspaceName: 'E2E', role: 'dev' }));
});
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !/Failed to load resource/.test(m.text())) problems.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

const mock = MODE === 'mock' ? createMockApi() : null;
// only the API's own paths (not Vite's /src/api/... modules)
if (mock)
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => mock.handle(route),
  );
await page.route('**/livekit-client.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_LIVEKIT }));

const agentName = MODE === 'live' ? `E2E ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}` : 'Smoke Test';
const agentId = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const tone = 'calm, brief and kind';

try {
  console.log(`Smoke test, ${MODE} API, ${BASE}`);
  await page.goto(BASE);
  await page
    .getByRole('button', { name: /sign in|get started|start/i })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill('e2e@example.com');
  await page.getByPlaceholder('Enter your password').fill('any-password');
  await page.getByRole('button', { name: /continue to workspace/i }).click();
  await page.waitForSelector('.dashMain');
  step('signs in and reaches the workspace', true);

  // ---- create an agent from a starter
  await page
    .getByRole('button', { name: /^\W*Agents/ })
    .first()
    .click();
  // a fresh server has no agents yet: the list is then the empty state, not rows, and both are a loaded list
  await page.waitForSelector('.agentRow, .emptyPanel');
  await page
    .getByRole('button', { name: /Create agent/ })
    .first()
    .click();
  await page.getByPlaceholder('e.g. Acme Support').fill(agentName);
  await page.getByRole('radio', { name: /Customer care/ }).check();
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await page.waitForSelector('.stHeader h1');
  step('creates an agent from the Customer care starter', (await page.locator('.stHeader h1').innerText()).trim() === agentName);

  // ---- the starter is in the draft; edit a field and save
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const area = page.locator('.stTextarea');
  const config = JSON.parse(await area.inputValue());
  step(
    'the starter filled in the agent (instructions, goodbye, inactivity)',
    /customer care/i.test(config.agents.items[0].instructions.role) &&
      config.tools.some((t) => t.id === 'end_call') &&
      !!config.defaults.conversation.inactivity,
    JSON.stringify(Object.keys(config)),
  );
  config.persona.tone = tone;
  await area.fill(JSON.stringify(config, null, 2));
  await page.getByRole('button', { name: 'Save draft' }).first().click();
  await page.waitForSelector('text=/Saved|saved/', { timeout: 15000 });
  step('edits a field and saves the draft', true);

  // ---- publish, then deploy to development
  await page.getByRole('button', { name: 'Publish', exact: true }).first().click();
  const dialog = page.locator('.stPublishPanel'); // publishing is a step on the Versions page
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await dialog.getByText(/is published/).waitFor({ timeout: 15000 });
  const published = (await dialog.getByRole('heading', { name: /is published/ }).innerText())
    .replace(/^Version\s+/, '')
    .replace(/\s+is published.*/, '')
    .trim();
  step('publishes a version', /^\d+\.\d+\.\d+$/.test(published), published);
  await dialog.getByRole('button', { name: 'Deploy it' }).click();
  await page.getByRole('button', { name: /^Deploy to Development/ }).click();
  await page.waitForSelector('.stLast .stStatus.active', { timeout: 15000 });
  step('deploys it to development', /Active/.test(await page.locator('.stLast').innerText()));

  // ---- a test conversation (the conversation itself is mocked)
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await page.waitForSelector('.stTStatus.live', { timeout: 15000 });
  await page.getByText('Hello there!').first().waitFor({ timeout: 10000 });
  step('starts a test conversation and the agent greets', true);
  await page.locator('.stTComposer textarea').fill('Hi, are you there?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('You said: Hi, are you there?').waitFor({ timeout: 10000 });
  step('sends a message and gets a reply', true);

  // ---- what reached the API (mock mode knows)
  if (mock) {
    const calls = mock.log.filter((line) => !line.startsWith('GET '));
    const order = [
      'POST /bots',
      `PUT /bots/${agentId}/draft`,
      `POST /bots/${agentId}/publish`,
      `POST /bots/${agentId}/deploy`,
      `POST /bots/${agentId}/sessions`,
    ];
    const at = order.map((wanted) => calls.findIndex((line) => line === wanted));
    step(
      'the API saw create, save, publish, deploy and session, in that order',
      at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]),
      calls.join(' | '),
    );
    const saved = await mock.bots.get(agentId);
    step('the saved draft carries the edit', saved?.config?.persona?.tone === tone, JSON.stringify(saved?.config?.persona));
    step('the deployed version is the published one', saved?.deployed?.development === published, JSON.stringify(saved?.deployed));
  }
} catch (error) {
  step('the flow ran to the end', false, `${error.message.split('\n')[0]}`);
  await page.screenshot({ path: 'e2e-failure.png', fullPage: true }).catch(() => {});
  console.log('      A screenshot was saved to e2e-failure.png');
}

step('no console errors or page errors', problems.length === 0, problems.slice(0, 4).join('\n      '));
await browser.close();
console.log(failures ? `\n${failures} step(s) failed` : '\nAll steps passed');
process.exit(failures ? 1 : 0);
