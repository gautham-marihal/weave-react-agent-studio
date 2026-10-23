// "Try a line" in a real browser, on the demo (no backend, nothing real is called): under the pronunciation rules, the redaction settings, the safety rules and
// a task, type a sample and see what the setting would do with it. The demo answers with an imitation and says so; the real server's answers are exact.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/tryline.mjs
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder to save pictures.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS || '';
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addInitScript(() => {
  if (sessionStorage.getItem('tryline')) return;
  sessionStorage.setItem('tryline', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
});
const page = await context.newPage();
const problems = [];
const requests = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});
// the demo answers in the browser: nothing may leave it
await page.route(
  (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
  (route) => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  },
);
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tryline-${name}.png`, fullPage: false });
};

await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill('e2e@example.test');
await page.getByPlaceholder('Enter your password').fill('x12345678');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');

// set-up: an agent with pronunciation rules, redaction, safety rules, a sensitive value and a task (through the JSON editor of the new layout)
await page.evaluate(() => {
  location.hash = '#/bots/acme-support/settings';
});
await page.waitForSelector('.nlWorkspace');
await page.locator('.nlPageActions button', { hasText: 'Edit as JSON' }).click();
const box = page.locator('.nlPage textarea').first();
await page.waitForFunction(() => (document.querySelector('.nlPage textarea')?.value || '').length > 20);
const config = JSON.parse(await box.inputValue());
config.schema_version = '1.2';
config.defaults = config.defaults || {};
config.defaults.conversation = {
  ...(config.defaults.conversation || {}),
  speech: {
    apply_to: 'model',
    pronunciation: [
      { type: 'currency', symbols: ['$'], major_unit: 'dollars', minor_unit: 'cents' },
      { type: 'time', style: 'spoken_12h' },
      { type: 'dictionary', entries: { Nimbus: 'Nim-bus' }, whole_word: true },
    ],
  },
};
config.channels = [
  ...config.channels.filter((c) => c.id !== 'phone'),
  { id: 'phone', type: 'sip_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } },
];
config.state = {
  ...(config.state || {}),
  variables: { ...(config.state?.variables || {}), pin: { type: 'string', sensitive: true }, verified: { type: 'boolean', initial: false } },
};
config.post_call = { ...(config.post_call || {}), redaction: { enabled: true, entities: ['card_number', 'email'], replacement: '[X]' } };
config.guardrails = {
  ...(config.guardrails || {}),
  input: [
    { id: 'no_injection', type: 'prompt_injection', enforcement: 'code', on_trigger: { action: 'deflect' } },
    { id: 'no_cards', type: 'pii_detect', entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } },
  ],
};
config.tasks = [
  {
    id: 'verify',
    skip_if: { state: 'verified', equals: true },
    attempts_scope: 'task',
    steps: [
      { id: 'ask_dob', type: 'collect', ask: 'What is your date of birth?', store_in: 'dob' },
      { id: 'ask_pin', type: 'collect', input: 'dtmf', ask: 'Please key in your PIN.', dtmf: { num_digits: 4 } },
    ],
    on_success: { outcome: 'ok', tell_model: 'The caller is verified.' },
  },
];
await box.fill(JSON.stringify(config, null, 2));
await page.waitForTimeout(600);
await page
  .locator('.nlBar')
  .getByRole('button', { name: /^Save$/ })
  .click();
await page.waitForTimeout(1000);

// each box is on the page that holds its settings
const goTo = async (hash) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForSelector('.nlPage');
  await page.waitForTimeout(1200);
};

// ---- how a line is said: Settings › Conversation flow
await goTo('#/bots/acme-support/settings');
// the configuration was written as JSON above: back to the settings themselves
const back = page.getByRole('button', { name: 'Back to the settings' });
if (await back.count()) await back.click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Conversation flow' }).first().click();
await page.waitForTimeout(400);
await page.getByText('How the voice reads things', { exact: true }).first().click();
await page.waitForTimeout(300);
let panel = page.locator('section[aria-label="Try how a line is said"]');
await panel.scrollIntoViewIfNeeded().catch(() => {});
check('pronunciation: the “Try a line” panel is under the voice settings', (await panel.count()) === 1);
await panel.getByLabel('On which channel').selectOption('phone');
await panel.getByLabel('A line the agent might say').fill('Nimbus says it costs $12.50 at 4:30 PM.');
await panel.getByRole('button', { name: 'Try it' }).click();
await page.waitForSelector('section[aria-label="Try how a line is said"] [data-block="spoken"]');
const spoken = await panel.locator('pre[aria-label="What the voice is given"]').innerText();
check('pronunciation: the voice is given the rewritten line', spoken === 'Nim-bus says it costs 12 dollars and 50 cents at 4 30 P M.', spoken);
check('pronunciation: each change names its rule', (await panel.locator('[aria-label="What was changed"] li').count()) === 3);
check('pronunciation: the demo says it is an imitation', /demo imitation/.test(await panel.innerText()));
await panel.getByLabel('Whose words').selectOption('fixed');
await panel.getByRole('button', { name: 'Try it' }).click();
await page.waitForTimeout(500);
check('pronunciation: a fixed line is not changed, and it says why', /Fixed lines you wrote yourself are not changed/.test(await panel.innerText()));
await panel.getByLabel('Whose words').selectOption('model');
await panel.locator('summary', { hasText: 'Type it as it streams' }).click();
await panel.getByLabel('Pieces, separated by |').fill('at 4|:30 P|M');
await panel.getByRole('button', { name: 'Try it' }).click();
await page.waitForSelector('section[aria-label="Try how a line is said"] [data-block="streaming"]');
check('pronunciation: the pieces are shown as they arrive', (await panel.locator('[data-block="streaming"] li').count()) >= 2);
await shot('speech');

// ---- what redaction hides: After the call, in the settings below the cards
await goTo('#/bots/acme-support/aftercall');
// opened when it is folded (an agent that hides details has it open already)
const redaction = page.locator('.stForm .stFGroup[data-path="post_call.redaction"]');
if (!(await redaction.getAttribute('class')).includes('open')) await redaction.locator('> header .stFGroupToggle').click();
await page.waitForTimeout(500);
panel = page.locator('section[aria-label="Try what redaction hides"]');
check('redaction: the panel is under the redaction settings', (await panel.count()) === 1);
await panel.getByLabel('A line a caller might say').fill('My card is 4111 1111 1111 1111 and my email is sam@example.com');
await panel.getByRole('button', { name: 'Try it' }).click();
await page.waitForSelector('section[aria-label="Try what redaction hides"] [data-block="after"]');
const saved = await panel.locator('pre[aria-label="What would be saved"]').innerText();
check('redaction: the saved version hides both', saved === 'My card is [X] and my email is [X]', saved);
check('redaction: the hits are marked in the line', (await panel.locator('mark').count()) === 2);
check('redaction: it says what the agent still hears', /still hears/.test(await panel.innerText()));
check('redaction: it names each kind in plain words', /a card number/.test(await panel.innerText()) && /an email address/.test(await panel.innerText()));
await panel.locator('summary', { hasText: 'How each kind is recognised' }).click();
check(
  'redaction: how each kind is recognised comes from the list of kinds',
  /Card numbers?|a card number/i.test(await panel.locator('details', { hasText: 'How each kind is recognised' }).innerText()),
);
// changing the agent after a try marks the answer as old
await page.locator('input[value="[X]"]').first().fill('[HIDDEN]');
await page.waitForSelector('[data-stale]');
check('redaction: once the agent changes, the answer says it may be out of date', /has changed since this was tried/.test(await panel.innerText()));
await shot('redaction');

// ---- a task: Tools › Multi-step tasks
await goTo('#/bots/acme-support/tools');
await page.locator('.nlRow', { hasText: 'Multi-step tasks' }).click();
await page.waitForSelector('.nlDrawer');
await page.waitForTimeout(800);
// each task is a card of the panel: the folded ones are opened (only the tasks themselves, not their parts)
await page.evaluate(() =>
  document.querySelectorAll('.nlDrawer .stFGroup:not(.open):not(.drill)').forEach((g) => {
    if (/^tasks\[\d+\]$/.test(g.dataset.path || '')) g.querySelector(':scope > header .stFGroupToggle')?.click();
  }),
);
await page.waitForTimeout(500);
panel = page.locator('section[aria-label="Try this task"]');
check('task: the panel is under the task', (await panel.count()) >= 1);
await panel.first().getByRole('button', { name: 'Show the steps' }).click();
await page.waitForSelector('[data-step="ask_dob"]');
check('task: both steps are shown', (await panel.first().locator('[data-step]').count()) === 2);
check(
  'task: the keypad step says the agent never sees the digits',
  /never sees the digits/.test(await panel.first().locator('[data-step="ask_pin"]').innerText()),
);
check('task: the endings are told', /The agent is told: “The caller is verified\.”/.test(await panel.first().innerText()));
await panel.first().getByLabel('What if these were already remembered').fill('{"verified": true}');
await panel.first().getByRole('button', { name: 'Show the steps' }).click();
await page.waitForTimeout(500);
check('task: with the caller already verified, the whole task is skipped', /already satisfied/.test(await panel.first().innerText()));
await shot('task');

// ---- the safety rules: the Guardrails page has its own box
await page.locator('.nlDrawer .nlDrawerFoot').getByRole('button', { name: 'Cancel' }).click();
await page.evaluate(() => {
  location.hash = '#/bots/acme-support/guardrails';
});
await page.waitForSelector('.nlPage');
panel = page.locator('section[aria-label="Try the safety rules"]');
// the page's frame is drawn before the agent's draft is read, and the box with it
await panel
  .first()
  .waitFor({ timeout: 10000 })
  .catch(() => {});
check('safety rules: the Guardrails page has the box', (await panel.count()) === 1);
await panel.getByRole('button', { name: 'Try it' }).click();
await page.waitForSelector('section[aria-label="Try the safety rules"] [data-block="rule"]');
check('safety rules: and it answers there', /caught this line/.test(await panel.innerText()));
await shot('guardrails-new');

check('nothing was sent to a server (the demo answers in the browser)', requests.length === 0, requests.join(', '));
check('no errors in the console', problems.length === 0, problems.slice(0, 2).join(' | '));
await browser.close();
console.log(failed ? `FAIL  ${failed} check${failed === 1 ? '' : 's'} failed` : 'PASS  all checks passed');
process.exitCode = failed ? 1 : 0;
