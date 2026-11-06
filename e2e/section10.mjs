// FRONTEND_GUIDE section 10, the canvas build, in a real browser on the demo (no backend; nothing leaves the browser):
//   Build › Knowledge: upload a file, "Save and build", the build followed to the end, the file's card, a search on the
//     score scale with the what-if line, and × asking whether to delete the file too (the saved draft's 409 explained);
//   Build › Tools: "Try it" on a tool, nothing called;
//   Monitor › Calls: "Choose dates…" and a two-day range from the calendar, by mouse and by keys;
//   Preview prompt: one chip per agent, each showing that agent's prompt.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/section10.mjs
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch,
// E2E_SHOTS=folder to save pictures, E2E_THEME=dark for the dark theme.
import { chromium } from 'playwright-core';
import { pick } from './pick.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS || '';
const THEME = process.env.E2E_THEME === 'dark' ? 'dark' : 'light';
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
// the user's window
const context = await browser.newContext({ viewport: { width: 1536, height: 730 } });
await context.addInitScript((theme) => {
  if (sessionStorage.getItem('section10')) return;
  sessionStorage.setItem('section10', '1');
  localStorage.setItem('weave_theme', theme);
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
}, THEME);
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
const wait = (ms = 600) => page.waitForTimeout(ms);
const shot = async (name, locator = null) => {
  if (!SHOTS) return;
  const path = `${SHOTS}/s10-${THEME}-${name}.png`;
  if (locator) await locator.screenshot({ path });
  else await page.screenshot({ path });
};
const go = async (h) => {
  await page.evaluate((x) => (location.hash = x), h);
  await wait(1500);
};
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('weave_demo_state') || '{}').bots?.['acme-support']?.config);
// nothing in a box is cut off: its own width holds what it shows (a scroll box scrolls inside)
const cutOff = (locator) =>
  locator.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter(
        (el) => el.offsetParent !== null && !el.closest('.srOnly') && getComputedStyle(el).overflowX !== 'auto' && getComputedStyle(el).overflowY !== 'auto',
      )
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible')
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`),
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
await wait(800);

// a tool with arguments and a condition, and a second agent, in the demo's own data
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('weave_demo_state'));
  const c = s.bots['acme-support'].config;
  c.connections = { ...(c.connections || {}), billing_api: { type: 'http', base_url: 'https://api.example.com' } };
  c.tools = [
    ...(c.tools || []).filter((t) => t.id !== 'get_bill'),
    {
      id: 'get_bill',
      type: 'http',
      connection: 'billing_api',
      description: 'Gets the caller’s latest bill when they ask about it.',
      request: { method: 'GET', path: '/bill', query: { month: '{{args.month}}' } },
      parameters: { type: 'object', properties: { month: { type: 'string', description: 'Which month, e.g. 2026-10' } }, required: ['month'] },
    },
  ];
  const first = c.agents.items[0];
  first.tools = [...new Set([...(first.tools || []), 'get_bill'])];
  if (!c.agents.items.some((a) => a.id === 'billing'))
    c.agents.items.push({ id: 'billing', name: 'Billing', instructions: { role: 'You answer questions about bills.' }, tools: ['get_bill'] });
  localStorage.setItem('weave_demo_state', JSON.stringify(s));
});
await page.reload();
await page.waitForSelector('.dashMain');

// ---------------------------------------------------------------- Knowledge: upload, save and build, the file's card
await go('#/bots/acme-support/knowledge');
// these checks read the part's cards: Knowledge opens on what it knows, so its All settings view is chosen
await page.getByRole('button', { name: 'All settings', exact: true }).click();
await page.waitForSelector('[data-field="knowledge.upload"]');
const text =
  'Returns. You can return a router within 30 days of delivery, unused and in its box.\n\nWarranty. Routers come with a 2-year warranty covering faults.\n\nOpening hours. We open Monday to Saturday, 9am to 6pm.';
await page
  .locator('[data-field="knowledge.upload"] input[type=file]')
  .setInputFiles({ name: 'returns.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
await page.waitForSelector('[data-source="file:returns.md"]', { timeout: 10000 });
const index = page.locator('[data-field="knowledge.index"] .kxIndex');
check('a new file makes the index "Not saved yet"', (await index.getAttribute('data-state')) === 'unsaved', await index.getAttribute('data-state'));
await shot('index-unsaved', page.locator('[data-card="knowledge.docs"]'));
await page.locator('[data-field="knowledge.index"]').getByRole('button', { name: 'Save and build' }).click();
await page.waitForSelector('[data-field="knowledge.index"] .kxIndex[data-state="reading"]', { timeout: 10000 }).catch(() => {});
const sawSteps = (await page.locator('[data-field="knowledge.index"] .kxSteps li').count()) === 4;
check('the build is followed, step by step', sawSteps);
await shot('index-building', page.locator('[data-field="knowledge.index"]'));
await page.waitForSelector('[data-field="knowledge.index"] .kxIndex[data-state="ready"]', { timeout: 20000 }).catch(() => {});
check('…to the end: up to date, with its passages', /Up to date/.test(await index.innerText()), await index.innerText());
const saved = await draft();
check('the file is in the saved draft', JSON.stringify(saved.knowledge || []).includes('returns.md'));
const card = page.locator('[data-source="file:returns.md"]');
check('the file’s card says it is in the index', /In the index/.test(await card.innerText()), await card.innerText());
check(
  'nothing is cut off in the documents card',
  (await cutOff(page.locator('[data-card="knowledge.docs"]'))).length === 0,
  String(await cutOff(page.locator('[data-card="knowledge.docs"]'))),
);
await shot('index-ready', page.locator('[data-card="knowledge.docs"]'));

// ---------------------------------------------------------------- Knowledge: a search on the scale
const search = page.locator('[data-card="knowledge.try"]');
await search.scrollIntoViewIfNeeded();
await search.locator('#kx-query').fill('how long can I return a router');
await search.getByRole('button', { name: 'Search' }).click();
await page.waitForSelector('[data-card="knowledge.try"] .kxHit', { timeout: 10000 }).catch(() => {});
const hits = await search.locator('.kxHit').count();
check('a search lists the passages it found', hits > 0, String(hits));
check('…each on the score scale', (await search.locator('.kxDot').count()) === hits);
check('…with what the agent is given', (await search.locator('.kxSees').count()) === 1);
await search.locator('#kx-line').fill('0.99');
await wait(200);
check('moving the line to 0.99 greys out every passage under it', (await search.locator('.kxHit.drop').count()) === hits);
const after = await draft();
check('the try-out line saves nothing', JSON.stringify(after.knowledge) === JSON.stringify(saved.knowledge));
await search.locator('#kx-line').fill('0.2');
await shot('search', search);
check('nothing is cut off in the search card', (await cutOff(search)).length === 0, String(await cutOff(search)));
await search.getByRole('button', { name: 'change it under How it searches' }).click();
await wait(400);
check('the link goes to the saved setting', await page.evaluate(() => !!document.activeElement?.closest('[data-field="knowledge.score"]')));

// ---------------------------------------------------------------- Knowledge: × asks, and a 409 is explained
await page.getByRole('button', { name: 'Remove returns.md' }).click();
const dialog = page.getByRole('dialog');
await dialog.waitFor();
await wait(500);
check(
  '× asks which is meant',
  /Only take it out of this agent/.test(await dialog.innerText()) && /Take it out and delete the file/.test(await dialog.innerText()),
);
await shot('remove', dialog);
await dialog.getByText('Take it out and delete the file').click();
await dialog.getByRole('button', { name: 'Remove and delete' }).click();
const sure = page.getByRole('alertdialog').filter({ hasText: 'The saved draft still reads this file' });
await sure.waitFor({ timeout: 10000 }).catch(() => {});
check('the saved draft’s 409 is explained before forcing', (await sure.count()) === 1);
check('…in plain words (no force=true)', !/force\s*=/i.test(await sure.innerText()));
await wait(500);
await shot('remove-409', sure);
await sure.getByRole('button', { name: 'Delete it anyway' }).click();
await page.waitForSelector('text=returns.md is taken out and deleted from the server', { timeout: 10000 }).catch(() => {});
check('…and deleted on the second yes', (await page.getByText('returns.md is taken out and deleted from the server').count()) === 1);
check('the file is out of the draft (until saved)', (await page.locator('[data-source="file:returns.md"]').count()) === 0);

// ---------------------------------------------------------------- Tools: Try it
// a tool's address opens its own page on "What it can do"; the Try it card is in All settings (remembered from here on)
await go('#/bots/acme-support/tools');
await page.locator('.apSeg').getByRole('button', { name: 'All settings', exact: true }).click();
await go('#/bots/acme-support/tools?item=tools:get_bill');
const tryCard = page.locator('[data-card="tools.try"]');
await tryCard.waitFor({ timeout: 10000 });
check('the tool has a Try it card', /Try it: /.test(await tryCard.innerText()));
await tryCard.locator('input[id$="-month"]').fill('2026-10');
await tryCard.locator('textarea[id$="-answer"]').fill('{ "amount": 42.5, "due": "2026-11-20" }');
await page.waitForSelector('[data-card="tools.try"] [data-block="request"]', { timeout: 10000 }).catch(() => {});
check(
  'it shows the request it would send',
  /\/bill/.test(
    await tryCard
      .locator('[data-block="request"]')
      .innerText()
      .catch(() => ''),
  ),
);
check('…whether it may run', (await tryCard.locator('[data-block="gate"]').count()) === 1);
await page.waitForSelector('[data-card="tools.try"] [data-block="answer"]', { timeout: 10000 }).catch(() => {});
check('…and how the answer splits three ways', (await tryCard.locator('.ttLane').count()) === 3);
check('nothing is cut off in Try it', (await cutOff(tryCard)).length === 0, String(await cutOff(tryCard)));
await tryCard.scrollIntoViewIfNeeded();
await shot('tool-try', tryCard);

// ---------------------------------------------------------------- Calls: chosen days
await go('#/bots/acme-support/calls');
await pick(page, page.locator('.clFilters label', { hasText: 'When' }).locator('button, select'), 'dates');
const range = page.locator('.clRange');
await range.waitFor({ timeout: 10000 });
check('"Choose dates…" opens a calendar', (await range.locator('.clCalBtn').count()) >= 28);
const days = range.locator('.clCalBtn:not(.out):not([disabled])');
await days.nth(0).click();
await days.nth(2).click();
check('two presses make a three-day range', /3 days/.test(await range.locator('.clRangeLine').innerText()), await range.locator('.clRangeLine').innerText());
check('the days between are shaded', (await range.locator('.clCalBtn.in').count()) === 3);
await days.nth(2).focus();
await page.keyboard.press('ArrowLeft');
check('arrow keys move between days', await page.evaluate(() => document.activeElement?.classList.contains('clCalBtn')));
await page.keyboard.press('PageUp');
check('Page Up shows the month before', /\d{4}/.test(await range.locator('.clRangeHead strong').innerText()));
await shot('calls-dates', range);

// ---------------------------------------------------------------- Preview prompt: a chip per agent
await go('#/bots/acme-support/agent');
await page.getByRole('button', { name: 'Preview prompt' }).click();
const chips = page.locator('.stAgentChip');
await chips
  .first()
  .waitFor({ timeout: 10000 })
  .catch(() => {});
check('one chip per agent', (await chips.count()) === 2, String(await chips.count()));
await page.getByRole('radio', { name: /Billing/ }).click();
await wait(800);
check('a chip shows that agent’s prompt', /answer questions about bills/i.test(await page.locator('.nlDrawer, [role="dialog"]').last().innerText()));
await shot('prompt-agents', page.locator('.nlDrawer, [role="dialog"]').last());

check('no errors on the page', problems.length === 0, problems.slice(0, 3).join(' | '));
check('nothing left the browser', requests.length === 0, requests.slice(0, 3).join(', '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
