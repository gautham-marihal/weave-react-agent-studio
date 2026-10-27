// Dragging the items of a list into another order, in a real browser, on the demo (no backend): the fixed lines (a list of cards, in a side panel) and a
// tool's rules and the steps of a rule. By mouse, and from the keyboard (Space, the arrows, Space); Escape during either puts the item back and closes
// nothing else; a click on the handle moves nothing; a screen reader is told what was picked up, by name; what is saved is the new order.
// Nothing is written anywhere but the demo.
//
//   npm run dev:demo      (in one terminal)
//   npm run e2e:reorder
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('reorder')) return;
  sessionStorage.setItem('reorder', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'Sam', email: 'sam@example.test', workspaceName: 'Clinic', role: 'Operations' }));
  localStorage.removeItem('weave_demo_state');
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const go = async (h) => {
  await page.evaluate((x) => (location.hash = x), h);
  await wait(2000);
};
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('weave_demo_state') || '{}').bots?.['acme-support']?.config);
// a drag by mouse from the middle of `handle` to just inside the top of `target`, in small moves (as a hand does); both measured once in sight
const dragTo = async (handle, target, shot = '') => {
  await handle.scrollIntoViewIfNeeded();
  const y = (await target.boundingBox()).y + 4;
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const from = box.y + box.height / 2;
  await page.mouse.move(x, from);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(x, from + ((y - from) * i) / 12, { steps: 2 });
  await wait(250);
  if (OUT && shot) await page.screenshot({ path: `${OUT}/reorder-${shot}.png` });
  await page.mouse.up();
  await wait(500);
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
await wait(800);
// three fixed lines, and a tool with two rules (the first with three steps), in the demo's own data
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('weave_demo_state'));
  const c = s.bots['acme-support'].config;
  c.messages = [
    { id: 'alpha_line', text: 'Alpha.' },
    { id: 'bravo_line', text: 'Bravo.' },
    { id: 'charlie_line', text: 'Charlie.' },
  ];
  c.connections = { ...(c.connections || {}), billing_api: { type: 'http', base_url: 'https://api.example.com' } };
  c.tools = [
    ...(c.tools || []),
    {
      id: 'get_bill',
      type: 'http',
      connection: 'billing_api',
      description: 'Gets the caller’s latest bill when they ask about it.',
      request: { method: 'GET', path: '/bill' },
      parameters: { type: 'object', properties: {} },
      effects: [
        { do: [{ type: 'say', text: 'First line.' }, { type: 'say', text: 'Second line.' }, { type: 'end_call' }] },
        { when: { state: 'verified', equals: true }, do: [{ type: 'say', text: 'Rule two.' }] },
      ],
    },
  ];
  c.agents.items[0].tools = [...(c.agents.items[0].tools || []), 'get_bill'];
  localStorage.setItem('weave_demo_state', JSON.stringify(s));
});
await page.reload();
await page.waitForSelector('.dashMain');

// ---- a list of cards: the fixed lines, in their side panel
await go('#/bots/acme-support/agent');
await page
  .getByRole('button', { name: /Fixed lines/ })
  .first()
  .click();
await page.waitForSelector('.nlDrawer .stFCards .dragHandle', { timeout: 20000 });
const drawer = page.locator('.nlDrawer');
const order = () => drawer.locator('.stFCards > .stFGroup > header strong').allInnerTexts();
const handle = (name) => drawer.getByRole('button', { name: `Drag ${name}` });
check('every card has a handle to drag it by', (await drawer.locator('.stFCards .dragHandle').count()) === 3);
const shut = drawer.locator('.stFCards > .stFGroup > header .stFGroupToggle[aria-expanded="true"]');
while (await shut.count()) await shut.first().click();
await wait(300);

await dragTo(handle('charlie_line'), drawer.locator('.stFCards > .stFGroup').first(), 'card');
check('a mouse drag moves a card', same(await order(), ['charlie_line', 'alpha_line', 'bravo_line']), JSON.stringify(await order()));

await handle('alpha_line').focus();
await page.keyboard.press('Space');
await wait(250);
const said = await page.evaluate(() => [...document.querySelectorAll('[id^="DndLiveRegion"]')].map((e) => e.textContent).join(' | '));
check('a screen reader is told what was picked up, by name and place', /Picked up alpha_line, at place 2 of 3/.test(said), said);
await page.keyboard.press('ArrowDown');
await wait(250);
await page.keyboard.press('Space');
await wait(500);
check('the keyboard moves it (Space, an arrow, Space)', same(await order(), ['charlie_line', 'bravo_line', 'alpha_line']), JSON.stringify(await order()));
check('and the keyboard stays on its handle', (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Drag alpha_line');

await page.keyboard.press('Space');
await wait(200);
await page.keyboard.press('ArrowUp');
await wait(200);
await page.keyboard.press('Escape');
await wait(500);
check('Escape during a keyboard move puts it back', same(await order(), ['charlie_line', 'bravo_line', 'alpha_line']), JSON.stringify(await order()));
check('and leaves the panel open', (await page.locator('.nlDrawer').count()) === 1);

const b = await handle('bravo_line').boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 30, { steps: 5 });
await wait(150);
await page.keyboard.press('Escape');
await wait(300);
await page.mouse.up();
await wait(400);
check('Escape during a mouse drag puts it back', same(await order(), ['charlie_line', 'bravo_line', 'alpha_line']), JSON.stringify(await order()));
check('and leaves the panel open too', (await page.locator('.nlDrawer').count()) === 1);
await handle('bravo_line').click();
await wait(300);
check('a click on the handle moves nothing', same(await order(), ['charlie_line', 'bravo_line', 'alpha_line']));
await drawer
  .getByRole('button', { name: /^(Done|Close)$/ })
  .last()
  .click();
await wait(800);
await page
  .locator('.nlBar')
  .getByRole('button', { name: /^Save$/ })
  .click();
await wait(1200);
check(
  'and what is saved',
  same(
    (await draft()).messages.map((m) => m.id),
    ['charlie_line', 'bravo_line', 'alpha_line'],
  ),
  JSON.stringify((await draft()).messages.map((m) => m.id)),
);

// ---- a tool's rules, and the steps of a rule
await go('#/bots/acme-support/tools');
await page
  .locator('.nlRow', { hasText: /Get bill/ })
  .first()
  .click();
await wait(2000);
const panel = page.locator('.nlDrawer');
await panel.locator('summary', { hasText: 'Technical details' }).click();
await wait(800);
const rules = () => panel.locator('section.stRule .stRuleSentence').allInnerTexts();
check(
  'rules and steps have handles',
  (await panel.getByRole('button', { name: 'Drag rule 2' }).count()) === 1 && (await panel.locator('.stAction .dragHandle').count()) >= 3,
);
const before = await rules();
const r2 = panel.getByRole('button', { name: 'Drag rule 2' });
await r2.scrollIntoViewIfNeeded();
await r2.focus();
await page.keyboard.press('Space');
await wait(250);
await page.keyboard.press('ArrowUp');
await wait(250);
await page.keyboard.press('Enter');
await wait(600);
check('the keyboard moves a rule (Enter drops it too)', same(await rules(), [before[1], before[0]]), JSON.stringify(await rules()));
check('with its panel still open', (await panel.count()) === 1);
const rule = panel.locator('section.stRule').nth(1);
const steps = () => rule.locator('.stActionSentence').allInnerTexts();
const sBefore = await steps();
await dragTo(rule.locator('.stAction').nth(2).locator('.dragHandle'), rule.locator('.stAction').first(), 'step');
check('a mouse drag moves a step within its rule', same(await steps(), [sBefore[2], sBefore[0], sBefore[1]]), JSON.stringify(await steps()));
check('and the step numbers follow', same(await rule.locator('.stActionNo').allInnerTexts(), ['1', '2', '3']));
await panel.getByRole('button', { name: /^Done$/ }).click();
await wait(800);
await page
  .locator('.nlBar')
  .getByRole('button', { name: /^Save$/ })
  .click();
await wait(1200);
const effects = (await draft()).tools.find((t) => t.id === 'get_bill').effects;
check(
  'what is saved has the rules and steps in their new order',
  effects[0].when?.state === 'verified' &&
    same(
      effects[1].do.map((a) => a.type),
      ['end_call', 'say', 'say'],
    ),
  JSON.stringify(effects),
);

check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
await browser.close();
process.exit(failed ? 1 : 0);
