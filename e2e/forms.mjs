// A form the agent asks for during a test conversation, shown wherever the conversation is: the Test panel beside the agent's pages and the guided
// setup's "Try it" step (FRONTEND_GUIDE section 1, job d: "show forms the bot asks for"; the messages are in section 7). The API is the imitation one
// (e2e/mockApi.mjs) and livekit-client is the fake in e2e/fakeLivekit.js, so the agent's form is sent from here, as the runtime would send it on the
// topic agent-builder.form; the answer must go back on agent-builder.form.submit.
//
// Run it with the dev server up WITHOUT demo mode, signing in from e2e/credentials.txt:
//   CREDENTIALS_FILE=e2e/credentials.txt npx vite --port 5181 --strictPort
//   E2E_BASE=http://localhost:5181 node e2e/forms.mjs
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createMockApi } from './mockApi.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS || '';
const EMAIL = process.env.E2E_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'any-password';
const FAKE_LIVEKIT = fs.readFileSync(new URL('./fakeLivekit.js', import.meta.url), 'utf8');
const BOT = 'acme-support';

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
// the user's window size: nothing may be cut off there
const context = await browser.newContext({ viewport: { width: 1536, height: 730 } });
await context.addInitScript((email) => {
  if (sessionStorage.getItem('e2e-seeded')) return;
  sessionStorage.setItem('e2e-seeded', '1');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E Tester', email, workspaceName: 'E2E', role: 'dev' }));
}, EMAIL);
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !/Failed to load resource/.test(m.text())) problems.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
const mock = createMockApi();
await page.route(
  (url) => url.pathname.startsWith('/api/'),
  (route) => mock.handle(route),
);
await page.route('**/livekit-client.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_LIVEKIT }));

const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const until = async (check, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await page.waitForTimeout(150);
  }
  return false;
};

// the agent asks for a form: the message the runtime sends (FRONTEND_GUIDE section 7), on the newest room's form topic
const askForm = (requestId) =>
  page.evaluate((id) => {
    const room = window.__fake.rooms[window.__fake.rooms.length - 1];
    const message = JSON.stringify({
      type: 'form',
      request_id: id,
      title: 'Leave your details',
      description: 'So a colleague can call you back.',
      submit_label: 'Send',
      fields: [
        { name: 'name', label: 'Your name', type: 'text', required: true, options: null, pattern: null },
        { name: 'phone', label: 'Phone', type: 'phone', required: true, options: null, pattern: null },
        { name: 'topic', label: 'What it is about', type: 'select', required: false, options: ['Billing', 'Orders'], pattern: null },
      ],
    });
    const stream = {
      info: { id: `form-${id}`, attributes: {} },
      async *[Symbol.asyncIterator]() {
        yield message;
      },
    };
    room.streams['agent-builder.form'](stream, { identity: 'agent-1' });
  }, requestId);
const submitted = (requestId) =>
  page.evaluate(
    (id) => window.__fake.sent.some((s) => s.topic === 'agent-builder.form.submit' && JSON.parse(s.text || '{}').request_id === id) || false,
    requestId,
  );

// the form card sits fully inside the window and inside the panel that holds it
const fitsIn = (holder) =>
  page.evaluate((sel) => {
    const card = document.querySelector(`${sel} .stTForm`);
    const box = document.querySelector(sel);
    if (!card || !box) return 'no card';
    const c = card.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (c.width < 50 || c.height < 50) return `too small ${c.width}x${c.height}`;
    if (c.left < b.left - 1 || c.right > b.right + 1)
      return `wider than its panel (${Math.round(c.left)}–${Math.round(c.right)} in ${Math.round(b.left)}–${Math.round(b.right)})`;
    if (c.right > window.innerWidth + 1) return 'past the right edge of the window';
    // the box to type in stays in view while a form is open (the form scrolls with the conversation)
    const composer = box.querySelector('.pvComposer');
    const k = composer?.getBoundingClientRect();
    if (!k || k.height < 10) return 'no box to type in';
    if (k.bottom > window.innerHeight + 1 || k.bottom > b.bottom + 1)
      return `the box to type in is pushed out of view (bottom ${Math.round(k.bottom)}, window ${window.innerHeight}, panel ${Math.round(b.bottom)})`;
    return '';
  }, holder);

// the agent answers on the form's topic, as the runtime does
const reply = (message) =>
  page.evaluate((text) => {
    const room = window.__fake.rooms[window.__fake.rooms.length - 1];
    const stream = {
      info: { id: `reply-${Math.random()}`, attributes: {} },
      async *[Symbol.asyncIterator]() {
        yield text;
      },
    };
    room.streams['agent-builder.form'](stream, { identity: 'agent-1' });
  }, JSON.stringify(message));
const sentFor = (requestId) =>
  page.evaluate(
    (id) => window.__fake.sent.filter((s) => s.topic === 'agent-builder.form.submit' && JSON.parse(s.text || '{}').request_id === id).length,
    requestId,
  );

async function answer(holder, requestId) {
  const card = page.locator(`${holder} .stTForm`);
  await card.getByLabel('Your name').fill('Sam Tan');
  await card.getByLabel('Phone').fill('+65 8123 4567');
  await card.getByRole('button', { name: 'Send' }).click();
  return until(() => submitted(requestId));
}

try {
  console.log(`Forms the agent asks for, ${BASE}`);
  await page.goto(BASE);
  await page
    .getByRole('button', { name: /sign in|get started|start/i })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill(EMAIL);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: /continue to workspace/i }).click();
  await page.waitForSelector('.dashMain');

  // ---- 1. the Test panel beside the agent's pages
  await page.evaluate((id) => (location.hash = `#/bots/${id}/agent`), BOT);
  await page.waitForSelector('.dtPart', { timeout: 15000 });
  await page.locator('.nlBar').getByRole('button', { name: /^Test/ }).click();
  const panel = '.pvPanel';
  await page.waitForSelector(panel);
  await page
    .locator(panel)
    .getByRole('button', { name: /Start a (conversation|call)/ })
    .first()
    .click();
  step('Test panel: the conversation starts and the agent greets', await until(async () => /Hello there/.test(await page.locator(panel).innerText())));
  await askForm('f_panel');
  step('Test panel: the form the agent asks for is shown', await until(async () => (await page.locator(`${panel} .stTForm`).count()) === 1));
  await page.waitForTimeout(900);
  await shot('forms-1-panel');
  const fit1 = await fitsIn(panel);
  step('Test panel: the form fits, nothing cut off', fit1 === '', fit1);
  step('Test panel: the answers go back to the agent on agent-builder.form.submit', await answer(panel, 'f_panel'));
  // the server checks again: a field it refuses is said under that field, and the form stays open to fix and resend
  await reply({ type: 'form_errors', request_id: 'f_panel', errors: { phone: 'Enter a valid phone number.' } });
  step(
    'Test panel: an error from the agent shows under its field, and the form stays open',
    await until(async () =>
      /Enter a valid phone number\./.test(
        await page
          .locator(`${panel} .stTForm`)
          .innerText()
          .catch(() => ''),
      ),
    ),
  );
  await page.locator(`${panel} .stTForm`).getByLabel('Phone').fill('+65 8123 4568');
  await page.locator(`${panel} .stTForm`).getByRole('button', { name: 'Send' }).click();
  step('Test panel: fixed and sent again', await until(async () => (await sentFor('f_panel')) === 2));
  await reply({ type: 'form_accepted', request_id: 'f_panel' });
  step(
    'Test panel: once the agent accepts it, the form closes and the conversation says so',
    await until(async () => (await page.locator(`${panel} .stTForm`).count()) === 0 && /Form sent\./.test(await page.locator(panel).innerText())),
  );
  await askForm('f_cancel');
  await until(async () => (await page.locator(`${panel} .stTForm`).count()) === 1);
  await page
    .locator(`${panel} .stTForm`)
    .getByRole('button', { name: /close|cancel|dismiss/i })
    .first()
    .click();
  step(
    'Test panel: closing the form tells the agent it was cancelled',
    await until(() =>
      page.evaluate(() =>
        window.__fake.sent.some(
          (s) => s.topic === 'agent-builder.form.submit' && JSON.parse(s.text || '{}').cancelled === true && JSON.parse(s.text).request_id === 'f_cancel',
        ),
      ),
    ),
  );
  // FORM_PROTOCOL: several forms can be open at once, matched by request_id; a repeat of one already shown is ignored;
  // an optional field left blank is left out of the answer
  await askForm('f_one');
  await askForm('f_two');
  await askForm('f_one');
  await until(async () => (await page.locator(`${panel} .stTForm`).count()) === 1);
  step('Test panel: with two forms open, one shows at a time', (await page.locator(`${panel} .stTForm`).count()) === 1);
  await answer(panel, 'f_one');
  const sentOne = await page.evaluate(() =>
    window.__fake.sent
      .filter((s) => s.topic === 'agent-builder.form.submit' && JSON.parse(s.text || '{}').request_id === 'f_one')
      .map((s) => JSON.parse(s.text)),
  );
  step('Test panel: the repeat of the first form was ignored (one answer sent)', sentOne.length === 1, JSON.stringify(sentOne));
  step('Test panel: an optional field left blank is left out', sentOne.length === 1 && !('topic' in sentOne[0].values), JSON.stringify(sentOne[0]?.values));
  await reply({ type: 'form_errors', request_id: 'f_one', errors: { form: 'This form has expired.' } });
  step(
    'Test panel: an error for no field of the form is still shown',
    await until(async () => /This form has expired\./.test(await page.locator(`${panel} .stTForm`).innerText())),
  );
  await reply({ type: 'form_accepted', request_id: 'f_one' });
  await page.waitForTimeout(400);
  step('Test panel: once the first is accepted, the second form shows', (await page.locator(`${panel} .stTForm`).count()) === 1);
  await page
    .locator(`${panel} .stTForm`)
    .getByRole('button', { name: /close|cancel|dismiss/i })
    .first()
    .click();
  step(
    'Test panel: the second is answered by its own id',
    await until(() =>
      page.evaluate(() =>
        window.__fake.sent.some(
          (s) => s.topic === 'agent-builder.form.submit' && JSON.parse(s.text || '{}').cancelled === true && JSON.parse(s.text).request_id === 'f_two',
        ),
      ),
    ),
  );
  await page.locator(panel).getByRole('button', { name: 'End', exact: true }).click();

  // ---- 2. the guided setup's "Try it" step
  await page.evaluate((id) => (location.hash = `#/bots/${id}/setup?step=try`), BOT);
  await page.waitForSelector('.suPage .pvPanel', { timeout: 15000 });
  const setupPanel = '.suPage .pvPanel';
  await page
    .locator(setupPanel)
    .getByRole('button', { name: /Start a (conversation|call)/ })
    .first()
    .click();
  await until(async () => /Hello there/.test(await page.locator(setupPanel).innerText()));
  await askForm('f_setup');
  step('setup: the form the agent asks for is shown on the Try it step', await until(async () => (await page.locator(`${setupPanel} .stTForm`).count()) === 1));
  await page.waitForTimeout(900);
  await shot('forms-2-setup');
  const fit2 = await fitsIn(setupPanel);
  step('setup: the form fits, nothing cut off', fit2 === '', fit2);
  step('setup: the answers go back to the agent', await answer(setupPanel, 'f_setup'));

  step('no console errors', problems.length === 0, problems.slice(0, 5).join('\n      '));
} catch (error) {
  step('ran to the end', false, error.stack || String(error));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exitCode = failures ? 1 : 0;
