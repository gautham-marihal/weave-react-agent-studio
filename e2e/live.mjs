// The Live board in a real browser, on the demo (no backend): the demo's calls start, go on and end by the clock. The board finds them by itself, their
// durations count up and their words arrive as they are said, what needs a look is marked and can be shown alone, callers' words can be hidden, an agent
// can be picked, Pause stops it all and Resume picks up, Watch follows one call in a side panel, and "Open in Calls" opens it in its agent.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/live.mjs
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder to save pictures.
import { chromium } from 'playwright-core';
import { pick } from './pick.mjs';

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
  if (sessionStorage.getItem('live')) return;
  sessionStorage.setItem('live', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
  localStorage.removeItem('weave_live_private');
});
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});
await page.route(
  (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
  (route) => route.abort(),
);
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-${name}.png`, fullPage: true });
};
const texts = (sel) => page.locator(sel).allTextContents();
const secondsOf = (t) => {
  const m = String(t).match(/(\d+):(\d+)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number(String(t).replace(/\D/g, ''));
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

await page.locator('.sideLink', { hasText: 'Live' }).click();
await page.waitForSelector('.lvCard', { timeout: 20000 });
await page.waitForTimeout(600);
const cards = await page.locator('.lvCard').count();
check('the calls going on are found by themselves', cards >= 2, String(cards));
check('the count at the top is the number of cards', Number(await page.locator('.lvStat strong').first().textContent()) === cards);
check('the status says what is watched', /Watching 3 agents/.test(await page.locator('.lvStatus').textContent()));
check('a phone number never shows whole', !/\+\d{6,}/.test(await page.locator('.lvGrid').textContent()));

// time moves, and words arrive
const label = await page.locator('.lvCard').first().getAttribute('aria-label');
const name = label.split(':')[0];
const timeBefore = secondsOf(await page.locator('.lvCard').first().locator('.lvTime').textContent());
const linesBefore = (await texts('.lvLine .lvText')).join('|');
await page.waitForTimeout(3200);
const timesAfter = (await page.locator('.lvCard', { hasText: name }).locator('.lvTime').allTextContents()).map(secondsOf);
check(
  'a call’s time counts up',
  timesAfter.some((t) => t >= timeBefore + 2),
  `${timeBefore} → ${timesAfter.join(',')}`,
);
let moved = false;
for (let i = 0; i < 40 && !moved; i += 1) {
  await page.waitForTimeout(1000);
  moved = (await texts('.lvLine .lvText')).join('|') !== linesBefore;
}
check('what is said arrives as it is said', moved);
await shot('board');

// what needs a look
await page.waitForFunction(() => document.querySelectorAll('.lvCard.bad, .lvCard.warn').length > 0, null, { timeout: 90000 }).catch(() => {});
check('a call that needs a look is marked, with why', (await page.locator('.lvCard.bad .lvFlags li, .lvCard.warn .lvFlags li').count()) > 0);
await page.getByLabel('Only what needs a look').check();
await page.waitForTimeout(200);
const onlyFlagged = await page
  .locator('.lvCard')
  .evaluateAll((all) => all.length > 0 && all.every((c) => c.classList.contains('bad') || c.classList.contains('warn')));
check('“Only what needs a look” shows only those', onlyFlagged);
await page.getByLabel('Only what needs a look').uncheck();

// privacy
await page.getByLabel('Hide what callers say').check();
await page.waitForTimeout(200);
const callerLines = await texts('.lvLine.caller .lvText');
check(
  '“Hide what callers say” hides every caller line',
  callerLines.length > 0 && callerLines.every((t) => /^Caller spoke \(\d+ words?\)$/.test(t)),
  callerLines.slice(0, 3).join(' | '),
);
check('and it is remembered', (await page.evaluate(() => localStorage.getItem('weave_live_private'))) === '1');
await page.getByLabel('Hide what callers say').uncheck();

// one agent
await pick(page, page.locator('[aria-label="Agent"]'), 'front-desk');
await page.waitForTimeout(300);
const agents = await texts('.lvCard .lvAgent');
check(
  'picking an agent shows only its calls',
  agents.every((a) => a === 'Front Desk'),
  agents.join(', '),
);
await pick(page, page.locator('[aria-label="Agent"]'), '');

// pause
await page.getByRole('button', { name: 'Pause' }).click();
check('Pause says so', /Paused/.test(await page.locator('.lvStatus').textContent()));
const frozen = await page.locator('.lvCard .lvTime').allTextContents();
await page.waitForTimeout(2500);
check('and stops the clock', (await page.locator('.lvCard .lvTime').allTextContents()).join() === frozen.join());
await page.getByRole('button', { name: 'Resume' }).click();
await page.waitForFunction(() => /Watching/.test(document.querySelector('.lvStatus')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
check('Resume starts it again', /Watching/.test(await page.locator('.lvStatus').textContent()));

// watch one
await page.locator('.lvCard').first().getByRole('button', { name: 'Watch' }).click();
await page.waitForSelector('.nlDrawer .clDetail', { timeout: 10000 });
check('Watch opens the call beside the board', (await page.locator('.nlDrawer').count()) === 1);
await page.waitForTimeout(1200);
await shot('watch');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes it', (await page.locator('.nlDrawer').count()) === 0);

// ended
check('calls that ended in the last minutes are listed', (await page.locator('.lvEnded li').count()) > 0);
if ((await page.locator('.lvMore').count()) > 0) {
  const before = await page.locator('.lvEnded li').count();
  await page.locator('.lvMore').click();
  check('“Show all” shows the rest', (await page.locator('.lvEnded li').count()) > before);
}

// open in calls
await page.locator('.lvCard').first().getByRole('button', { name: 'Open in Calls' }).click();
await page.waitForFunction(() => /#\/bots\/[^/]+\/calls\?call=/.test(location.hash), null, { timeout: 10000 }).catch(() => {});
check('“Open in Calls” opens the call in its agent', /#\/bots\/[^/]+\/calls\?call=/.test(page.url()), page.url());

check('no errors in the page', problems.length === 0, problems.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
