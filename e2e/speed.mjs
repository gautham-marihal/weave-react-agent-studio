// Speed in a real browser, on the demo (no backend). The workspace page says in a sentence how quickly callers are answered, times every agent's answers
// and compares the agents; the target changes the share within it; the day-by-day line shows a day's numbers when pointed at, and turns into a table;
// the wait is split into its parts for voice calls and chats; a suggestion opens the setting it is about, in the right agent; "Open" goes to an agent's
// own Speed page; a slowest answer opens its call; an old #/cost link still opens the page; Home shows the week's answer time; and nothing anywhere
// says what a call costs. Nothing is written anywhere but the demo.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/speed.mjs
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
  if (sessionStorage.getItem('speed')) return;
  sessionStorage.setItem('speed', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
  localStorage.removeItem('weave_speed_target');
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
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/speed-${name}.png`, fullPage: true });
};
const statText = (i) => page.locator('.csStat').nth(i).locator('strong').textContent();
const meterText = () => page.locator('.csVerdict .csMeter strong').textContent();
// money anywhere on the page: a dollar amount, or the words of the old page
const moneyOnPage = async () => {
  const text = await page.locator('.dashMain').innerText();
  return /\$\s?\d|per call|a month\b|\bprice|\bcost\b|Cost and speed/i.test(text)
    ? text.match(/\$\s?\d[^\n]*|per call|a month\b|\bprice\w*|\bcost\b|Cost and speed/i)[0]
    : '';
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

// ---- Home ---------------------------------------------------------------------------------------------------------------------------------------------
const answerCard = page.locator('.wsPulse .ovStat', { hasText: 'Answer time' });
await answerCard.waitFor();
await page.waitForFunction(() => /\d(\.\d)? s|\d+ ms/.test(document.querySelector('.wsPulse')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
check('Home shows the week’s answer time', /Answer time · last 7 days\s*\d/.test(await answerCard.innerText()), await answerCard.innerText());
check('Home says nothing of cost', !/Cost ·|\$\d/.test(await page.locator('.wsPulse').innerText()), await page.locator('.wsPulse').innerText());
const homeWait = (await answerCard.innerText()).match(/(\d[\d.]* m?s)\s*Half the answers; 1 in 10 over (\d[\d.]* m?s)/);
await answerCard.click();
await page.waitForSelector('.csVerdict h2', { timeout: 60000 });
check('the card opens Speed at #/speed', /#\/speed$/.test(page.url()), page.url());

// the same calls give the same numbers everywhere: Home's week is Speed's week, and Monitoring's period is Speed's
const settled = () => page.waitForSelector('.csBody:not(.reading)', { timeout: 60000 }).then(() => page.waitForTimeout(300));
await settled();
const speedFortnight = [await statText(0), await statText(1)];
await pick(page, page.getByLabel('Period'), '7');
await settled();
const speedWeek = [await statText(0), await statText(1)];
check(
  'Home and Speed give the same answer time for the same week',
  !!homeWait && homeWait[1] === speedWeek[0] && homeWait[2] === speedWeek[1],
  `${homeWait?.slice(1).join(' / ')} vs ${speedWeek.join(' / ')}`,
);
await page.evaluate(() => (location.hash = '#/monitoring'));
const waitKpi = page.locator('.mnKpi', { hasText: 'Time to answer' });
await waitKpi.waitFor({ timeout: 60000 });
await page
  .waitForFunction(() => [...document.querySelectorAll('.mnKpi')].some((k) => /slowest tenth/.test(k.innerText)), null, { timeout: 60000 })
  .catch(() => {});
const monitoring = (await waitKpi.innerText()).match(/(\d[\d.]* m?s)\s*slowest tenth: (\d[\d.]* m?s)/);
check(
  'Monitoring and Speed give the same answer time for the same period',
  !!monitoring && monitoring[1] === speedFortnight[0] && monitoring[2] === speedFortnight[1],
  `${monitoring?.slice(1).join(' / ')} vs ${speedFortnight.join(' / ')}`,
);
await page.evaluate(() => (location.hash = '#/speed'));
await page.waitForSelector('.csVerdict h2', { timeout: 60000 });
await settled();

// ---- the workspace ------------------------------------------------------------------------------------------------------------------------------------
check('the sidebar says Speed', (await page.locator('.sideLink', { hasText: /^Speed$/ }).count()) === 1);
check('how fast answers come', /\d(\.\d)? s$|\d+ ms$/.test(await statText(0)), await statText(0));
check('every agent is compared', (await page.locator('section[aria-labelledby="csAgents"] tbody tr').count()) === 3);
check('no money on the page', !(await moneyOnPage()), await moneyOnPage());
check(
  'a sentence says how quickly callers are answered',
  /answered|wait|judge/i.test(await page.locator('.csVerdict h2').textContent()),
  await page.locator('.csVerdict h2').textContent(),
);
await shot('workspace');

// the wait, part by part, for voice calls and for chats
const kinds = await page.locator('.csStageRow .csStageHead strong').allInnerTexts();
check('the wait is split into its parts, for voice calls and chats', kinds.includes('Voice calls') && kinds.includes('Chats'), kinds.join(' | '));
check('each part is named in the table under the bars', (await page.locator('.csStageTable tbody tr').count()) >= 3);

// the day-by-day line: pointing at a day shows its numbers, and it can be read as a table
const plot = page.locator('.csPlot');
await plot.scrollIntoViewIfNeeded();
const pbox = await plot.boundingBox();
await page.mouse.move(pbox.x + pbox.width - 60, pbox.y + pbox.height / 2);
await page.waitForTimeout(250);
check(
  'pointing at a day shows its numbers',
  /typical wait/.test(
    await page
      .locator('.csTip')
      .innerText()
      .catch(() => ''),
  ),
);
await page.getByRole('button', { name: 'Show as a table' }).click();
check('the line can be read as a table, a row a day', (await page.locator('.csDayTable tbody tr').count()) === 14);
await page.getByRole('button', { name: 'Show as a chart' }).click();

// the target
const within = async () => Number((await meterText()).replace('%', ''));
const at2 = await within();
await pick(page, page.getByLabel('Target answer time, in seconds'), '4');
await page.waitForTimeout(200);
check('a longer target, more answers within it', (await within()) > at2, `${at2} → ${await within()}`);
await pick(page, page.getByLabel('Target answer time, in seconds'), '2');
await page.waitForTimeout(200);

// a suggestion opens the setting it is about, in that agent
const fasterModel = page.getByRole('button', { name: /^Choose a faster model for / }).first();
if (await fasterModel.count()) {
  const label = await fasterModel.getAttribute('aria-label');
  await fasterModel.click();
  await page.waitForSelector('.nlDrawer', { timeout: 20000 }).catch(() => {});
  check(
    '“Choose a faster model” opens that agent’s AI models',
    /#\/bots\/[^/]+\/agent/.test(page.url()) &&
      /AI models/.test(
        await page
          .locator('.nlDrawer')
          .innerText()
          .catch(() => ''),
      ),
    `${label} → ${page.url()}`,
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = '#/speed'));
  await page.waitForSelector('section[aria-labelledby="csAgents"] tbody tr', { timeout: 60000 });
} else check('a suggestion to choose a faster model is offered on the demo', false);

// ---- an agent's own page ----------------------------------------------------------------------------------------------------------------------------
await page.locator('section[aria-labelledby="csAgents"] tr', { hasText: 'Front Desk' }).getByRole('button', { name: 'Open' }).click();
await page.waitForSelector('.nlWorkspace .csVerdict h2', { timeout: 60000 });
check('“Open” goes to the agent’s own Speed page', /#\/bots\/front-desk\/speed/.test(page.url()), page.url());
check('the agent’s menu says Speed', (await page.locator('.nlNav button', { hasText: /^Speed$/ }).count()) === 1);
check('no money on the agent’s page either', !(await moneyOnPage()), await moneyOnPage());
await shot('agent');

// the agent's Home gives its week's answer time as its Speed page does for the week
await page.waitForSelector('.nlWorkspace .csBody:not(.reading)', { timeout: 60000 });
await pick(page, page.getByLabel('Period'), '7');
await page.waitForSelector('.nlWorkspace .csBody:not(.reading)', { timeout: 60000 });
await page.waitForTimeout(300);
const agentWeek = [await statText(0), await statText(1)];
await page.evaluate(() => (location.hash = '#/bots/front-desk/home'));
const agentCard = page.locator('.ovStat', { hasText: 'Typical answer time' });
await agentCard.waitFor({ timeout: 60000 });
await page.waitForFunction(() => /1 in 10 over/.test(document.querySelector('.ovStats')?.innerText || ''), null, { timeout: 60000 }).catch(() => {});
const agentHome = (await agentCard.innerText()).match(/(\d[\d.]* m?s)\s*1 in 10 over (\d[\d.]* m?s)/);
check(
  'an agent’s Home and its Speed page give the same answer time for the week',
  !!agentHome && agentHome[1] === agentWeek[0] && agentHome[2] === agentWeek[1],
  `${agentHome?.slice(1).join(' / ')} vs ${agentWeek.join(' / ')}`,
);
await page.evaluate(() => (location.hash = '#/bots/front-desk/speed'));
await page.waitForSelector('.nlWorkspace .csVerdict h2', { timeout: 60000 });
await page.waitForSelector('.nlWorkspace .csBody:not(.reading)', { timeout: 60000 });

await page.locator('.csSlow').first().getByRole('button', { name: 'Open the call' }).first().click();
await page.waitForFunction(() => /\/calls\?call=/.test(location.hash), null, { timeout: 10000 }).catch(() => {});
check('a slow answer opens its call', /#\/bots\/front-desk\/calls\?call=/.test(page.url()), page.url());

// ---- old links ----------------------------------------------------------------------------------------------------------------------------------------
await page.evaluate(() => (location.hash = '#/cost'));
await page.waitForSelector('.csStats', { timeout: 60000 });
check('an old #/cost bookmark opens Speed', (await page.locator('.csPage h1').textContent()) === 'Speed');
await page.evaluate(() => (location.hash = '#/bots/bookings/cost'));
await page.waitForSelector('.nlWorkspace .csStats', { timeout: 60000 });
check('so does an old link to an agent’s page', (await page.locator('.nlWorkspace .csPage h1').textContent()) === 'Speed');

check('no errors in the page', problems.length === 0, problems.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
