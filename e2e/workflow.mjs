// The Workflow canvas in a real browser, on the demo (no backend): what the mouse does to it, which needs real layout and real pointer events (React Flow).
// A block dragged moves by exactly what the pointer moved (at the zoom), the blocks that go with an agent follow it, and only the dragged block's place is
// kept; a press that hardly moves selects; a block can't go past the top-left edge; a click on the empty space deselects and a drag on it moves the view;
// the wheel moves the view and Ctrl and the wheel zooms (and the zoom is kept); the overview shows only while some of the picture is out of sight; an
// arrow drawn from one agent to another lets it pass callers there, and a block that is not an agent can't be drawn from.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/workflow.mjs
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  if (sessionStorage.getItem('workflow')) return;
  sessionStorage.setItem('workflow', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_workflow_zoom', '1');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
});
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});
await page.route(
  (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
  (route) => route.abort(),
);
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/workflow-${name}.png` });
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
await page.evaluate(() => {
  location.hash = '#/bots/acme-support/workflow';
});
await page.waitForSelector('.wfScroll .wfNode[data-type="agent"]');
await page.waitForTimeout(800);

const BOT = 'acme-support';
const AGENT = 'assistant';
const saved = () => page.evaluate((bot) => JSON.parse(localStorage.getItem('weave_demo_state') || '{}').bots?.[bot]?.config, BOT);
const save = async () => {
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('.nlSaveState')?.textContent || ''), null, { timeout: 10000 });
};
const block = (id) => page.locator(`.wfScroll .wfNode[data-node="${id}"]`);
// where a block is on the picture (React Flow's own place for it)
const placeOf = (id) =>
  page.evaluate((nodeId) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el?.style.transform || '');
    return m ? [Number(m[1]), Number(m[2])] : null;
  }, id);
const selected = async (id) => (await block(id).getAttribute('aria-pressed')) === 'true';
// presses on a block, moves the pointer by (dx, dy) on the screen in steps, and lets go; `during` runs while the button is still down
const dragBy = async (id, dx, dy, during) => {
  const b = await block(id).boundingBox();
  // whole pixels, as a mouse moves
  const x = Math.round(b.x + 30);
  const y = Math.round(b.y + 20);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  if (during) await during();
  await page.mouse.up();
  await page.waitForTimeout(300);
};
const viewport = () => page.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform || '');
// a point of the picture with nothing on it (no block, arrow, word or overview): the empty space itself
const emptySpot = () =>
  page.evaluate(() => {
    const c = document.querySelector('.wfScroll').getBoundingClientRect();
    for (let y = c.top + 20; y < c.bottom - 20; y += 24)
      for (let x = c.right - 30; x > c.left + 30; x -= 24) if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
    return null;
  });

// ---- a step that goes with the agent: it follows the agent while it is dragged, and after
await block(AGENT).click();
await page.locator('.wfPlus').click();
await page.locator('.wfMenu [role=menuitem]', { hasText: /^Say/ }).first().click();
await page.waitForTimeout(500);
const stepId = await page.evaluate(
  (agent) => [...document.querySelectorAll('.wfScroll .wfNode')].map((n) => n.dataset.node).find((id) => id.startsWith(`${agent}::enter::`)),
  AGENT,
);
check('a step that goes with the agent is added', !!stepId);
await save();
const [ax, ay] = await placeOf(AGENT);
const [sx, sy] = await placeOf(stepId);
await page.mouse.click((await emptySpot()).x, (await emptySpot()).y);
await dragBy(AGENT, 40, 30, async () => {
  const [mx, my] = await placeOf(AGENT);
  const [tx, ty] = await placeOf(stepId);
  check('a dragged block follows the pointer exactly, while the button is down', mx === ax + 40 && my === ay + 30, `${mx - ax}, ${my - ay}`);
  check('and so does the step that goes with it', tx === sx + 40 && ty === sy + 30, `${tx - sx}, ${ty - sy}`);
  check('nothing is written until it is let go', !(await saved())?.builder?.ui?.graph_positions);
});
check('dragging is not selecting', !(await selected(AGENT)));
await save();
let places = (await saved())?.builder?.ui?.graph_positions || {};
check('only the dragged block gets a place of its own', JSON.stringify(Object.keys(places)) === JSON.stringify([AGENT]), Object.keys(places).join(', '));
check('its place is where it was dropped', places[AGENT]?.x === ax + 40 && places[AGENT]?.y === ay + 30, JSON.stringify(places[AGENT]));
const [s2x, s2y] = await placeOf(stepId);
check('the step stays beside it after the drop', s2x === sx + 40 && s2y === sy + 30, `${s2x - sx}, ${s2y - sy}`);
await shot('dragged');

// ---- at half size the same movement of the pointer is twice as far on the picture
for (let i = 0; i < 5; i += 1) await page.getByRole('button', { name: 'Zoom out' }).click();
await page.waitForTimeout(400);
check('the zoom buttons zoom (and say it)', (await page.locator('.wfZoom').textContent()) === '50%', await page.locator('.wfZoom').textContent());
const [hx, hy] = await placeOf(AGENT);
await dragBy(AGENT, 20, 20);
await save();
places = (await saved()).builder.ui.graph_positions;
check('at half size a drag goes twice as far', places[AGENT].x === hx + 40 && places[AGENT].y === hy + 40, JSON.stringify(places[AGENT]));
await page.getByRole('button', { name: /^Zoom 50%/ }).click();
await page.waitForTimeout(400);

// ---- a press that hardly moves selects, and moves nothing
const before = JSON.stringify((await saved()).builder.ui.graph_positions);
await dragBy(AGENT, 2, 1);
check('a shaky click still selects', await selected(AGENT));
await save().catch(() => {});
check('and moves nothing', JSON.stringify((await saved()).builder.ui.graph_positions) === before);

// ---- the top-left edge
await page.locator('.wfCanvasTools').getByRole('button', { name: 'Tidy up' }).click();
await page.waitForTimeout(300);
await dragBy(AGENT, -3000, -3000);
await save();
const edge = (await saved()).builder.ui.graph_positions[AGENT];
check('a block cannot be dragged out of the picture', edge.x >= 8 && edge.y >= 8, JSON.stringify(edge));
await page.locator('.wfCanvasTools').getByRole('button', { name: 'Tidy up' }).click();
await page.waitForTimeout(300);
await save();
check('Tidy up forgets the places', !(await saved())?.builder?.ui?.graph_positions);

// ---- the empty space: a click deselects; a drag moves the view (and selects nothing)
await block(AGENT).click();
const spot = await emptySpot();
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(300);
check('a click on the empty space deselects', !(await selected(AGENT)));
const v0 = await viewport();
await page.mouse.move(spot.x, spot.y);
await page.mouse.down();
await page.mouse.move(spot.x - 120, spot.y + 80, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
check('a drag on the empty space moves the view', (await viewport()) !== v0, `${v0} → ${await viewport()}`);

// ---- the wheel and Ctrl + the wheel
const v1 = await viewport();
await page.mouse.move(spot.x - 200, spot.y + 200);
await page.mouse.wheel(0, 150);
await page.waitForTimeout(400);
check('the wheel moves the view', (await viewport()) !== v1, `${v1} → ${await viewport()}`);
const z0 = await page.locator('.wfZoom').textContent();
await page.keyboard.down('Control');
await page.mouse.wheel(0, -250);
await page.keyboard.up('Control');
await page.waitForTimeout(600);
const z1 = await page.locator('.wfZoom').textContent();
check('Ctrl and the wheel zooms', z1 !== z0 && parseInt(z1, 10) > parseInt(z0, 10), `${z0} → ${z1}`);
check('and the zoom is kept for next time', (await page.evaluate(() => localStorage.getItem('weave_workflow_zoom'))) === String(parseInt(z1, 10) / 100));

// ---- the overview: only while some of the picture is out of sight
await page.getByRole('button', { name: /Fit to the window/ }).click();
await page.waitForTimeout(600);
check('with all of it in sight there is no overview to cover a block', (await page.locator('.wfMiniMap').count()) === 0);
for (let i = 0; i < 6; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
await page.waitForTimeout(600);
check('with some of it out of sight the overview shows where the view is', (await page.locator('.wfMiniMap').count()) === 1);
await shot('overview');
await page.getByRole('button', { name: /Fit to the window/ }).click();
await page.waitForTimeout(500);

// ---- an arrow drawn from one agent to another
await block(AGENT).click();
await page.locator('.wfPlus').click();
await page.locator('.wfMenu [role=menuitem]', { hasText: 'Subagent' }).first().click();
const [nameBox, whenBox] = await page.locator('.wfMenu form input').all();
await nameBox.fill('Billing');
await whenBox.fill('The caller asks about a bill');
await page.locator('.wfMenu form').getByRole('button', { name: 'Add the subagent' }).click();
await page.waitForTimeout(700);
await save();
const billing = (await saved()).agents.items.find((a) => a.name === 'Billing')?.id;
check(
  'a subagent is added (and the agent passes callers to it)',
  !!billing && (await saved()).agents.items.find((a) => a.id === AGENT).handoffs.some((h) => h.to === billing),
);
await page.getByRole('button', { name: /Fit to the window/ }).click();
await page.waitForTimeout(500);
await page.mouse.click((await emptySpot()).x, (await emptySpot()).y);
const handle = (id, kind) => page.locator(`.react-flow__node[data-id="${id}"] .react-flow__handle.${kind}`);
await block(billing).hover();
const from = await handle(billing, 'source').boundingBox();
const to = await handle(AGENT, 'target').boundingBox();
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2 + 40, { steps: 8 });
// the handles fade in
await page.waitForTimeout(250);
check('while an arrow is drawn, the agent it can go to shows where', (await handle(AGENT, 'target').evaluate((h) => getComputedStyle(h).opacity)) === '1');
await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(600);
check('the new arrow is selected, to say when it is taken', (await page.locator('.wfInspector').innerText()).includes('When should it pass the caller on?'));
await save();
check(
  'drawing an arrow from one agent to another lets it pass callers there',
  (await saved()).agents.items.find((a) => a.id === billing)?.handoffs?.some((h) => h.to === AGENT),
);
await shot('drawn');
const stepHandles = await page.evaluate(() =>
  [...document.querySelectorAll('.react-flow__node')]
    .filter((n) => !n.querySelector('.wfNode[data-type="agent"]'))
    .flatMap((n) => [...n.querySelectorAll('.react-flow__handle')].map((h) => h.classList.contains('connectable'))),
);
check('a block that is not an agent has nothing to draw an arrow from', stepHandles.length > 0 && stepHandles.every((c) => !c));

// ---- the toolbar floats over the picture: fitted, no block is under it
await page.getByRole('button', { name: /Fit to the window/ }).click();
await page.waitForTimeout(600);
const underToolbar = await page.evaluate(() => {
  const bar = document.querySelector('.wfCanvasTools').getBoundingClientRect();
  return [...document.querySelectorAll('.wfScroll .wfNode')]
    .filter((n) => {
      const r = n.getBoundingClientRect();
      return r.left < bar.right && r.right > bar.left && r.top < bar.bottom && r.bottom > bar.top;
    })
    .map((n) => n.dataset.node);
});
check('fitted, no block is under the toolbar', underToolbar.length === 0, underToolbar.join(', '));
const underFoot = await page.evaluate(() => {
  const bars = ['.wfZoomBar', '.wfTestButton'].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
  return [...document.querySelectorAll('.wfScroll .wfNode')]
    .filter((n) => {
      const r = n.getBoundingClientRect();
      return bars.some((bar) => r.left < bar.right && r.right > bar.left && r.top < bar.bottom && r.bottom > bar.top);
    })
    .map((n) => n.dataset.node);
});
check('fitted, no block is under the zoom or the Test button', underFoot.length === 0, underFoot.join(', '));

// ---- an agent's parts, as tabs
await block(billing).click();
await page.getByRole('tab', { name: 'Edges' }).click();
await page.waitForTimeout(200);
check('a subagent’s Edges part lists who passes callers to it', (await page.locator('.wfInspector').innerText()).includes('Callers come from'));
await page.getByRole('tab', { name: 'General' }).click();
check(
  'an agent’s own settings say they use the default',
  (await page.locator('.wfOwnHead small').allTextContents()).every((t) => t === 'Using default'),
);

// ---- Templates: the menu opens in sight
await page.getByRole('button', { name: 'Templates' }).click();
await page.waitForTimeout(300);
const menuBox = await page.locator('.wfTemplateMenu').boundingBox();
const view = page.viewportSize();
check(
  'the Templates menu opens in sight',
  !!menuBox && menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= view.width && menuBox.y + menuBox.height <= view.height,
);
await page.keyboard.press('Escape');

// ---- the panel hidden: the picture gets the width, and what was in the middle stays there
const middle = async () =>
  page.evaluate(() => {
    const box = document.querySelector('.wfScroll').getBoundingClientRect();
    const n = document.querySelector(`.wfScroll .wfNode[data-type="agent"]`).getBoundingClientRect();
    return { off: Math.round(n.left + n.width / 2 - (box.left + box.width / 2)), w: Math.round(box.width) };
  });
const beforeHide = await middle();
await page.getByRole('button', { name: 'Hide the panel' }).first().click();
await page.waitForTimeout(500);
const afterHide = await middle();
check(
  'hiding the panel gives the picture the width',
  afterHide.w > beforeHide.w + 300 && (await page.locator('.wfInspector').count()) === 0,
  `${beforeHide.w} → ${afterHide.w}`,
);
check('what was in the middle of the view stays in the middle', Math.abs(afterHide.off - beforeHide.off) <= 2, `${beforeHide.off} → ${afterHide.off}`);
await page.getByRole('button', { name: 'Show the panel' }).click();
await page.waitForTimeout(400);
check('the panel comes back', (await page.locator('.wfInspector').count()) === 1);

// ---- a block near the picture's right and bottom edges: its delete question and its ＋ menu open in sight, by moving the picture, never by scrolling
// the picture's box (it has no scroll bars to scroll it back)
const canvas = await page.locator('.wfScroll').boundingBox();
const near = await block(billing).boundingBox();
const grab = { x: canvas.x + 30, y: canvas.y + canvas.height - 30 };
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
await page.mouse.move(grab.x + (canvas.x + canvas.width - near.width - 30 - near.x), grab.y + (canvas.y + canvas.height - near.height - 40 - near.y), {
  steps: 10,
});
await page.mouse.up();
await page.waitForTimeout(400);
await block(billing).click();
const inSight = (sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    const c = document.querySelector('.wfScroll').getBoundingClientRect();
    const b = document.querySelector('.wfCanvasBox');
    return !!r && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom && !b.scrollTop && !b.scrollLeft;
  }, sel);
await page.getByRole('button', { name: 'Delete Billing' }).click();
await page.waitForTimeout(400);
check('near the edge, the delete question opens in sight and the box is not scrolled', await inSight('.wfConfirmPop'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check(
  'Escape puts the question away and gives the keyboard back to its trash button',
  (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Delete Billing',
);
await page.locator('.wfPlus').click();
await page.waitForTimeout(400);
check(
  'the ⊕ at the end of a subagent opens Add a step in the side panel, and the box is not scrolled',
  (await page.locator('.wfAddPanel').count()) === 1 && (await page.evaluate(() => !document.querySelector('.wfCanvasBox').scrollTop)),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ---- the keyboard: Tab on the selected block goes to its own controls
await block(billing).focus();
await page.keyboard.press('Tab');
check('Tab on the selected block goes to its controls', (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Copy Billing');

// ---- changing a block where it is: a click shows its panel (opened again if it was hidden), a double click puts the cursor in its first field
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Hide the panel' }).first().click();
await page.waitForTimeout(300);
await block(billing).click();
await page.waitForTimeout(400);
check(
  'a click on a block shows its panel, even when the panel was hidden',
  ((await page.locator('.wfInspector header strong').first().textContent()) || '').trim() === 'Billing',
);
const endBlock = page.locator('.wfScroll .wfNode[data-type="end"]').first();
await endBlock.dblclick();
await page.waitForTimeout(500);
check(
  'a double click on a block puts the cursor in its panel, ready to change what it says',
  await page.evaluate(() => !!document.activeElement?.closest('.wfInspector') && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)),
);
// the actions of a selected block (copy, delete) never cover another block
const covered = [];
for (const el of await page.locator('.wfScroll .wfNode:not([data-type="agent"]):not([data-type="trigger"]):not([data-type="model"])').all()) {
  // chosen from the keyboard: a block out of sight is chosen too
  await el.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const hit = await page.evaluate(() => {
    const t = document.querySelector('.wfNodeTools')?.getBoundingClientRect();
    if (!t) return '';
    return [...document.querySelectorAll('.wfScroll .wfNode')]
      .filter((b) => {
        const q = b.getBoundingClientRect();
        return t.left < q.right - 1 && t.right > q.left + 1 && t.top < q.bottom - 1 && t.bottom > q.top + 1;
      })
      .map((b) => b.dataset.node)
      .join(', ');
  });
  if (hit) covered.push(`${await el.getAttribute('data-node')} covers ${hit}`);
}
check('the actions of a selected block cover no other block', covered.length === 0, covered.slice(0, 3).join(' | '));

// ---- the canvas at a window as small as 1536×730: all of it in sight, its foot too; then filling the window, and Esc back
await page.setViewportSize({ width: 1536, height: 730 });
await page.waitForTimeout(600);
const foot = await page.evaluate(() =>
  Math.max(...['.wfCanvasBox', '.wfZoomBar', '.wfTestButton'].map((s) => document.querySelector(s)?.getBoundingClientRect().bottom || 0)),
);
check('at 1536×730 the whole canvas is in the window, the zoom and Test the agent too', foot <= 730, `foot at ${Math.round(foot)}`);
await page.getByRole('button', { name: 'Expand the canvas' }).click();
await page.waitForTimeout(500);
const big = await page.locator('.wfCanvasBox').boundingBox();
check(
  'Expand the canvas fills the window, and the page under it is out of reach of the keyboard',
  big.height > 680 && big.y < 20 && (await page.evaluate(() => !!document.querySelector('.dashSidebar, nav')?.closest('[inert]'))),
  JSON.stringify(big),
);
// nothing chosen and nothing focused (the page itself has the keyboard): Esc is the canvas's
await page.keyboard.press('Escape');
await page.evaluate(() => document.activeElement?.blur());
await page.waitForTimeout(200);
const chosenBefore = await page.evaluate(() => [...document.querySelectorAll('.wfScroll .wfNode[aria-pressed="true"]')].map((n) => n.dataset.node).join(','));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const afterEsc = await page.evaluate(() => ({
  full: !!document.querySelector('.wfTab.full'),
  inert: [...document.querySelectorAll('[inert]')].map((e) => e.className).slice(0, 3),
}));
check(
  'Esc goes back to the page and gives it back to the keyboard',
  !afterEsc.full && !afterEsc.inert.length,
  `chosen before: ${chosenBefore || 'none'}; ${JSON.stringify(afterEsc)}`,
);
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(300);

check('no errors in the page', problems.length === 0, problems.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `FAIL  ${failed} check${failed === 1 ? '' : 's'} failed` : 'PASS  all checks passed');
process.exitCode = failed ? 1 : 0;
