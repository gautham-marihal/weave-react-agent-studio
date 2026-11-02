// Speed against the stand-in API: the workspace page says in a sentence how quickly callers are answered, times every
// agent's answers and compares them; the target changes the share within it; the day-by-day line shows a day's numbers
// when pointed at and turns into a table; the wait is split into its parts for voice calls and chats; a suggestion opens
// the setting it is about, in the right agent; "Open" goes to an agent's own Speed view; a slowest answer opens its call;
// Home, an agent's Overview and Monitoring give the same answer time as Speed for the same calls; nothing says what a
// call costs.
//   E2E_API_PORT=8522 E2E_WEB_PORT=5522 node e2e/speed.mjs
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('speed');

const figure = (i) => page.getByTestId('speed-figure').nth(i).locator('strong').textContent();
const settled = async () => {
  await page.waitForSelector('[data-testid="speed-body"][data-reading="no"]', { timeout: 60_000 });
  await page.waitForTimeout(200);
};
const within = async () => Number((await page.getByTestId('speed-within').textContent()).replace('%', ''));
const moneyOnPage = async () => {
  const text = await page.locator('main').innerText();
  const m = text.match(/\$\s?\d[^\n]*|per call|a month\b|\bprice\w*|\bcost\b/i);
  return m ? m[0] : '';
};
let homeWait = null;

await step('Home shows the week’s answer time, and the tile opens Speed', async () => {
  await page.goto(`${base}/`, { timeout: 120_000 });
  const tile = page.getByTestId('workspace-pulse').locator('a', { hasText: 'Answer time' });
  await tile.waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => /Half the answers; 1 in 10 over/.test(document.querySelector('[data-testid="workspace-pulse"]')?.innerText || ''), null, { timeout: 60_000 });
  const text = await tile.innerText();
  homeWait = text.match(/(\d[\d.]* m?s)\s*Half the answers; 1 in 10 over (\d[\d.]* m?s)/);
  check(!!homeWait, text);
  await tile.click();
  await page.waitForURL(/\/analytics\/speed$/);
  await page.getByTestId('speed-verdict').waitFor({ timeout: 60_000 });
});

let fortnight = [];
await step('Home and Speed give the same answer time for the same week', async () => {
  await settled();
  fortnight = [await figure(0), await figure(1)];
  await page.getByLabel('Period').selectOption('7');
  await settled();
  const week = [await figure(0), await figure(1)];
  check(homeWait && homeWait[1] === week[0] && homeWait[2] === week[1], `${homeWait?.slice(1).join(' / ')} vs ${week.join(' / ')}`);
  await page.getByLabel('Period').selectOption('14');
  await settled();
});

await step('Monitoring and Speed give the same answer time for the same period', async () => {
  await page.getByRole('navigation', { name: 'Analytics' }).getByRole('link', { name: /^Monitoring/ }).click();
  await page.getByRole('region', { name: 'The numbers' }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => /slowest tenth/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 60_000 });
  const text = await page.getByRole('region', { name: 'The numbers' }).innerText();
  const m = text.match(/Time to answer\s*(\d[\d.]* m?s)\s*slowest tenth: (\d[\d.]* m?s)/);
  check(!!m && m[1] === fortnight[0] && m[2] === fortnight[1], `${m?.slice(1).join(' / ')} vs ${fortnight.join(' / ')}`);
  await page.getByRole('navigation', { name: 'Analytics' }).getByRole('link', { name: /^Speed/ }).click();
  await page.getByTestId('speed-verdict').waitFor({ timeout: 60_000 });
  await settled();
});

await step('a sentence says how quickly callers are answered, with the typical wait, and every agent is compared', async () => {
  check(/answered|wait|judge/i.test(await page.getByTestId('speed-verdict').locator('h2').textContent()), await page.getByTestId('speed-verdict').innerText());
  check(/\d(\.\d)? s$|\d+ ms$/.test(await figure(0)), await figure(0));
  check((await page.getByRole('region', { name: 'By agent' }).locator('tbody tr').count()) === 3, 'not every agent is compared');
  check(!(await moneyOnPage()), await moneyOnPage());
});

await step('the wait is split into its parts, for voice calls and chats, each part named in a table', async () => {
  const kinds = await page.getByTestId('speed-stage-row').locator('strong').allInnerTexts();
  check(kinds.includes('Voice calls') && kinds.includes('Chats'), kinds.join(' | '));
  check((await page.getByTestId('speed-stage-table').locator('tbody tr').count()) >= 3, 'too few parts');
});

await step('pointing at a day shows its numbers, and the line can be read as a table, a row a day', async () => {
  const plot = page.getByTestId('speed-day-chart');
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2);
  await page.getByTestId('speed-day-tip').waitFor({ timeout: 3000 });
  check(/typical wait|No answers timed/.test(await page.getByTestId('speed-day-tip').innerText()), await page.getByTestId('speed-day-tip').innerText());
  await page.getByRole('button', { name: 'Show as a table' }).click();
  check((await page.getByTestId('speed-day-table').locator('tbody tr').count()) === 14, 'not a row a day');
  await page.getByRole('button', { name: 'Show as a chart' }).click();
});

await step('a longer target puts more answers within it, and the target is kept in this browser', async () => {
  const before = await within();
  await page.getByLabel('Target answer time, in seconds').selectOption('4');
  await page.waitForTimeout(200);
  const after = await within();
  check(after > before, `${before} → ${after}`);
  check((await page.evaluate(() => localStorage.getItem('weave_speed_target'))) === '4', 'not kept');
  await page.getByLabel('Target answer time, in seconds').selectOption('2');
});

await step('“Choose a faster model” opens that agent’s AI model setting', async () => {
  const link = page.getByRole('link', { name: /^Choose a faster model for / }).first();
  check((await link.count()) === 1, 'no suggestion to choose a faster model');
  const href = await link.getAttribute('href');
  check(/^\/agents\/[^/]+\/build\/agent\?focus=model$/.test(href), href);
  await link.click();
  await page.waitForURL(/\/build\/agent\?focus=model$/);
});

await step('“Open” in By agent goes to the agent’s own Speed view', async () => {
  await page.goto(`${base}/analytics/speed`);
  const row = page.getByRole('region', { name: 'By agent' }).locator('tr', { hasText: 'Front Desk' });
  await row.waitFor({ timeout: 60_000 });
  await row.getByRole('link', { name: /Open/ }).click();
  await page.waitForURL(/\/agents\/front-desk\/monitor\/speed$/);
  await page.getByTestId('speed-verdict').waitFor({ timeout: 60_000 });
  check((await page.getByRole('navigation', { name: 'Monitor' }).locator('a[aria-current="page"]').textContent()) === 'Speed', 'Speed is not the current view');
  check(!(await page.getByRole('region', { name: 'By agent' }).count()), 'one agent’s view compares agents');
  check(!(await moneyOnPage()), await moneyOnPage());
});

await step('an agent’s Overview gives its week’s answer time as its Speed view does', async () => {
  await settled();
  await page.getByLabel('Period').selectOption('7');
  await settled();
  const week = [await figure(0), await figure(1)];
  await page.goto(`${base}/agents/front-desk`);
  await page.waitForFunction(() => /1 in 10 over/.test(document.querySelector('[data-testid="overview-stats"]')?.innerText || ''), null, { timeout: 60_000 });
  const text = await page.getByTestId('overview-stats').locator('a', { hasText: 'Typical answer time' }).innerText();
  const m = text.match(/(\d[\d.]* m?s)\s*1 in 10 over (\d[\d.]* m?s)/);
  check(!!m && m[1] === week[0] && m[2] === week[1], `${m?.slice(1).join(' / ')} vs ${week.join(' / ')}`);
});

await step('a slowest answer opens its call', async () => {
  await page.goto(`${base}/agents/front-desk/monitor/speed`);
  const slowest = page.getByTestId('speed-slowest');
  await slowest.waitFor({ timeout: 60_000 });
  await slowest.getByRole('link', { name: 'Open the call' }).first().click();
  await page.waitForURL(/\/calls\/[^?]+\?agent=front-desk$/);
});

await finish();
