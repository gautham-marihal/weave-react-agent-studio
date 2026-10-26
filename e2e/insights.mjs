// Alerts and "Questions it couldn't answer" in a real browser, on the demo (no backend). The demo has an incident on two agents: Acme Support's hand-over to
// a person keeps failing and Front Desk answers slowly. Alerts finds both on its own, the bell and the sidebar count them, "I'm on it" and Snooze take
// them off the count, a rule can be changed and put back, and "Open the tool" lands on the tool's panel. On Questions, the questions callers asked that
// the agent couldn't answer are grouped (Sunday delivery first, asked five times); answering one puts a rule and a test in the draft, Undo takes both
// out, Dismiss and "Bring it back" move it between the lists. Nothing is written anywhere but the demo.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/insights.mjs
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
  if (sessionStorage.getItem('insights')) return;
  sessionStorage.setItem('insights', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
  localStorage.removeItem('weave_insights_v1');
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
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/insights-${name}.png`, fullPage: true });
};
const bellCount = async () => {
  const b = page.locator('.inBell b');
  return (await b.count()) ? Number((await b.textContent()).replace('+', '')) : 0;
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

// ---- Alerts ------------------------------------------------------------------------------------------------------------------------------------------
await page.waitForSelector('.inBell b', { timeout: 15000 });
check('the check runs by itself and the bell counts the new alerts', (await bellCount()) === 2, String(await bellCount()));
check('the sidebar’s Alerts entry shows the same count', (await page.locator('.sideLink', { hasText: 'Alerts' }).locator('em').textContent()) === '2');

await page.locator('.inBell').click();
await page.waitForSelector('.inAlert');
const titles = await page.locator('.inAlert h3').allTextContents();
check(
  'the failing hand-over is first, as critical',
  /escalate_to_human/.test(titles[0]) && (await page.locator('.inAlert').first().getAttribute('class')).includes('critical'),
  titles.join(' | '),
);
check(
  'Front Desk answering slowly is the other alert',
  titles.some((t) => /slow/i.test(t)),
  titles.join(' | '),
);
check('each alert says what it rests on', /4 calls/.test(await page.locator('.inAlert').first().textContent()));
await shot('alerts');

const first = page.locator('.inAlert').first();
await first.getByRole('button', { name: /The 4 calls/ }).click();
check('“The 4 calls” lists them', (await first.locator('.inCalls li').count()) === 4);
await first.getByRole('button', { name: 'I’m on it' }).click();
await page.waitForFunction(() => document.querySelector('.inBell b')?.textContent === '1');
check('“I’m on it” takes it off the count, and says who', /On it: E2E/.test(await page.locator('.inAlert.seen .inStatus').textContent()));
const slow = page.locator('.inAlert.new').first();
await slow.getByRole('button', { name: 'Snooze' }).click();
// the choices are drawn above the page (a Radix menu), not inside the alert
await page.getByRole('menuitem', { name: 'For 4 hours' }).click();
await page.waitForFunction(() => !document.querySelector('.inBell b'));
check('a snoozed alert is off the count too', (await bellCount()) === 0);
check(
  'both stay on the page, under “Being looked at, or snoozed”',
  (await page.locator('.inSubhead').count()) === 1 && (await page.locator('.inAlert').count()) === 2,
);
await page.locator('.inAlert.snoozed').getByRole('button', { name: 'Mark as new' }).click();
await page.waitForFunction(() => document.querySelector('.inBell b')?.textContent === '1');
check('“Mark as new” puts it back on the count', (await bellCount()) === 1);

await page.getByRole('tab', { name: 'What to watch for' }).click();
const countBox = page.getByRole('spinbutton', { name: /A tool keeps failing: calls/ });
await countBox.fill('5');
check(
  'a rule’s number can be changed, and the way back is offered',
  (await page.getByRole('button', { name: 'Back to the recommended settings' }).count()) === 1,
);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('weave_insights_v1')).rules);
check('the change is kept', stored?.tool_failing?.params?.count === 5, JSON.stringify(stored));
await shot('rules');
await page.getByRole('button', { name: 'Back to the recommended settings' }).click();
check('“Back to the recommended settings” puts it back', (await countBox.inputValue()) === '3');

await page.getByRole('tab', { name: 'Where to send' }).click();
check('Where to send is honest about email and Slack', /need the Weave server/.test(await page.locator('.inServerNote').textContent()));
await page.getByRole('tab', { name: /Right now/ }).click();

await page
  .locator('.inAlert', { hasText: 'escalate_to_human' })
  .getByRole('button', { name: /Open “escalate_to_human”/ })
  .click();
await page.waitForSelector('.nlWorkspace');
await page.waitForSelector('.nlDrawer', { timeout: 8000 }).catch(() => {});
check(
  '“Open the tool” goes to the agent’s Tools, with that tool’s panel open',
  /\/tools\?tool=escalate_to_human/.test(page.url()) && (await page.locator('.nlDrawer').count()) === 1,
  page.url(),
);
await shot('tool');
await page.keyboard.press('Escape');

await page.evaluate(() => {
  location.hash = '#/bots/acme-support';
});
await page.waitForSelector('.inBanner');
check('the agent’s Home says what is wrong with it', /escalate_to_human/.test(await page.locator('.inBanner').textContent()));
await shot('home');

// ---- Questions ---------------------------------------------------------------------------------------------------------------------------------------
await page.locator('.nlNav button', { hasText: 'Questions' }).click();
await page.waitForSelector('.inQ');
const questions = await page.locator('.inQ h3').allTextContents();
const counts = (await page.locator('.inQ .inQCount').allTextContents()).map((t) => parseInt(t, 10));
check('the questions are grouped, the most asked first', /sunday/i.test(questions[0]) && counts[0] === 5, `${questions.join(' | ')} / ${counts.join(',')}`);
check(
  'PayPal, student discount and shipping to Malaysia are there too',
  ['paypal', 'student', 'malaysia'].every((w) => questions.some((q) => q.toLowerCase().includes(w))),
  questions.join(' | '),
);
check('one-off questions wait behind a line', /Asked once: \d+ more question/.test(await page.locator('.inQuestions .rxPartPanel > .inMore').textContent()));
await page.locator('.inQ').first().locator('.inMore').click();
check(
  'how it was asked, and why it went unanswered, are shown',
  (await page.locator('.inQ').first().locator('.inWordings li').count()) > 1 && /Passed to a person/.test(await page.locator('.inQ').first().textContent()),
);
await shot('questions');

const sunday = page.locator('.inQ').first();
await sunday.getByRole('button', { name: 'Answer it' }).click();
await sunday.locator('textarea').fill('We deliver Monday to Saturday. Sunday delivery isn’t available yet.');
check('the rule it will add is shown before it is added', /If a caller asks/.test(await sunday.locator('.inPreview').textContent()));
await shot('answer');
await sunday.getByRole('button', { name: 'Add to the draft' }).click();
await page.waitForSelector('.stNotice.good');
check('answering puts it in the draft, unsaved', /Unsaved changes/.test(await page.locator('.nlSaveState').textContent()));
check('it moves to Answered', /Answered \(1\)/.test(await page.getByRole('tab', { name: /Answered/ }).textContent()));
await page.getByRole('button', { name: 'See the test' }).click();
await page.waitForSelector('.nlPage');
await page.waitForTimeout(400);
check('the test that asks it is on the Scenarios', /answers_deliver_sunday/.test(await page.locator('.nlPage').textContent()));
await page.locator('.nlNav button', { hasText: 'Questions' }).click();
await page.getByRole('tab', { name: /Answered/ }).click();
await page.waitForSelector('.inQ .inDone');
check('an answered question says it hasn’t been asked unanswered since', /Not asked unanswered since/.test(await page.locator('.inQ').first().textContent()));
await page.locator('.inQ').first().getByRole('button', { name: 'Undo' }).click();
await page.getByRole('tab', { name: /To answer/ }).click();
check(
  'Undo takes it back out',
  /sunday/i.test(await page.locator('.inQ h3').first().textContent()) && !/Unsaved changes/.test(await page.locator('.nlSaveState').textContent()),
);

const paypal = page.locator('.inQ', { hasText: /paypal/i });
await paypal.getByRole('button', { name: 'Dismiss' }).click();
await page.getByRole('menuitem', { name: 'Already taken care of' }).click();
// the menu's choice is made once the menu has closed (ui/layer.ts afterMenu): waited for, not read at once
await page
  .getByRole('tab', { name: /Dismissed \(1\)/ })
  .waitFor({ timeout: 3000 })
  .catch(() => {});
check('Dismiss moves it to Dismissed', /Dismissed \(1\)/.test(await page.getByRole('tab', { name: /Dismissed/ }).textContent()));
await page.getByRole('tab', { name: /Dismissed/ }).click();
await page.getByRole('button', { name: 'Bring it back' }).click();
check('“Bring it back” puts it back', !/\(\d\)/.test(await page.getByRole('tab', { name: /Dismissed/ }).textContent()));

check('no errors in the page', problems.length === 0, problems.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
