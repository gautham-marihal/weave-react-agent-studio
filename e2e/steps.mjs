// Build › Steps in a real browser, on the demo (no backend): the part sits at the top of Call flow; an agent with no steps
// starts from a common call; a step is added from its kinds and written in place; the call in words turns into steps;
// a sample with a form shows the form's own steps under it. Each change lands where the agent already keeps it (its
// instructions' "Step N:" rules, its on_enter, its hand-overs), so it is saved with the draft. Nothing is cut off or
// scrolls sideways at the user's window sizes, in light and dark. Nothing is written anywhere but the demo.
//
//   npx vite --mode demo --port 5199 --strictPort      (in one terminal)
//   E2E_BASE=http://localhost:5199 node e2e/steps.mjs
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder to save pictures.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const OUT = process.env.E2E_SHOTS || '';
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
const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 } });
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('steps')) return;
  sessionStorage.setItem('steps', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'Sam', email: 'sam@example.test', workspaceName: 'Clinic', role: 'Operations' }));
  localStorage.removeItem('weave_demo_state');
  localStorage.removeItem('weave_steps_view');
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
await page.route(
  (u) => u.pathname.startsWith('/api/') || u.pathname.startsWith('/llm'),
  (r) => r.abort(),
);
const wait = (ms = 600) => page.waitForTimeout(ms);
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
};
const go = async (h) => {
  await page.evaluate((x) => (location.hash = x), h);
  await wait(1700);
};
const draft = (id) => page.evaluate((bot) => JSON.parse(localStorage.getItem('weave_demo_state') || '{}').bots?.[bot]?.config, id);
const save = async () => {
  await page
    .locator('.nlBar')
    .getByRole('button', { name: /^Save$/ })
    .click();
  await wait(1200);
};
const sideways = () => page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
const shot = async (name) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` });
};

await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill('sam@example.test');
await page.getByPlaceholder('Enter your password').fill('x12345678');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');

// ---- the place in the side list, and the steps the agent already has (read from it: nothing added)
await go('#/bots/acme-support/steps');
await page.waitForSelector('nav[aria-label="Build"] [aria-labelledby="build-group-flow"] [data-page]');
const flow = page.locator('nav[aria-label="Build"] [aria-labelledby="build-group-flow"] [data-page]');
const flowIds = await flow.evaluateAll((els) => els.map((e) => e.dataset.page));
check(
  'Steps is the first part of Call flow, then Workflow and Subagents',
  JSON.stringify(flowIds) === JSON.stringify(['steps', 'workflow', 'subagents']),
  JSON.stringify(flowIds),
);
check('the Steps part is open', (await page.locator('.dtPart[data-part="steps"] h1').textContent()) === 'Steps');
const said = await page.locator('.bsLane').first().innerText();
check(
  'its greeting, where it passes callers and its ending, read from the agent',
  /Says the greeting/.test(said) && /Decide where they go/.test(said) && /End (with|the call)/.test(said),
  said.slice(0, 200),
);
check('a person’s condition reads as a condition (no “If use when”)', !/If use when/i.test(said));
await shot('steps-read');

// ---- adding a step from its kinds, and writing it in place
await page
  .locator('.bsLane')
  .first()
  .getByRole('button', { name: /^Add a step$/ })
  .click();
await wait(300);
check('the kinds of step open where it is added', await page.locator('.bsAdd').isVisible());
await shot('steps-add');
await page.locator('.bsAdd .bsKindBtn', { hasText: 'Let the agent handle it' }).click();
await wait(300);
const box = page.locator('.bsStep.open .bsEditor textarea');
check('the new step opens to be written', await box.isVisible());
await box.fill('Offer a call-back if they would rather be called.');
await shot('steps-edit');
await page.locator('.bsStep.open').getByRole('button', { name: 'Done' }).click();
await wait(300);
await save();
const rules = (await draft('acme-support'))?.agents?.items?.[0]?.instructions?.rules || [];
check(
  'saved as a numbered guided step in the agent’s instructions',
  rules.some((r) => /^Step 1: Offer a call-back if they would rather be called\.$/.test(r)),
  JSON.stringify(rules),
);

// ---- the call in words
await page.locator('.apSeg').getByRole('button', { name: 'In your words', exact: true }).click();
await wait(400);
const words = page.locator('.bsWordsIn textarea');
check('the steps as numbered lines', /Offer a call-back if they would rather be called\./.test(await words.inputValue()));
await words.fill('1. Find out what they need.\n2. Take their order number.\n3. Check the order and say where it is.\n4. Say goodbye.');
await page.getByRole('button', { name: /Turn into steps/ }).click();
await wait(400);
check('the lines become steps, shown before anything changes', /4 lines became 4 steps/.test(await page.locator('.bsWordsOut').textContent()));
await shot('steps-words');
await page.getByRole('button', { name: /^Use these/ }).click();
await wait(500);
await save();
const after = (await draft('acme-support'))?.agents?.items?.[0]?.instructions?.rules || [];
check(
  'the guided steps are the new ones, in order',
  JSON.stringify(after.filter((r) => /^Step \d/.test(r))) ===
    JSON.stringify(['Step 1: Find out what they need.', 'Step 2: Take their order number.', 'Step 3: Check the order and say where it is.']),
  JSON.stringify(after),
);
check('Undo is offered right after', (await page.getByRole('button', { name: 'Undo' }).count()) === 1);

// ---- a sample with a form: its own steps under it, at both window sizes, light and dark
await go('#/bots/unbound-onboarding/steps');
await page.locator('.apSeg').getByRole('button', { name: 'Step by step', exact: true }).click();
await wait(500);
check('a lane per subagent', (await page.locator('.bsLane').count()) >= 2);
check('a form shows its own steps under it', (await page.locator('.bsChildren .bsStep').count()) >= 5);
check('nothing scrolls sideways at 1536×730', (await sideways()) <= 0, String(await sideways()));
await shot('steps-form-light');
await page.setViewportSize({ width: 1366, height: 650 });
await wait(400);
check('nothing scrolls sideways at 1366×650', (await sideways()) <= 0, String(await sideways()));
await page.evaluate(() => {
  localStorage.setItem('weave_theme', 'dark');
  document.documentElement.dataset.theme = 'dark';
});
await go('#/bots/unbound-onboarding/steps');
await shot('steps-form-dark');
check('dark: the page still draws', (await page.locator('.bsLane').count()) >= 2);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
