// Monitoring, alerts and the numbers on Home, the agents list and an agent's Overview, against the stand-in API. The
// stand-in's calls have an incident on two agents: Acme Support's hand-over to a person keeps failing and Front Desk
// answers slowly. The background check finds both on its own; the bell counts them; "I'm on it" and Snooze take them off
// the count; a rule can be changed and put back (kept in this browser); "Open the tool" lands on the agent's Tools.
//   E2E_API_PORT=8422 E2E_WEB_PORT=5422 node e2e/insights.mjs
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('insights');

const bellCount = async () => {
  const badge = page.getByTestId('bell-count');
  return (await badge.count()) ? Number((await badge.textContent()).replace('+', '')) : 0;
};
const waitForBell = (n) =>
  page.waitForFunction((want) => (Number(document.querySelector('[data-testid="bell-count"]')?.textContent || 0) || 0) === want, n, { timeout: 30_000 });
const alertCards = () => page.locator('article[data-severity]');

await step('Home shows the workspace’s numbers: calls today, calls now, alerts and answer time', async () => {
  // the first page a fresh dev server serves can take a while (it prepares the dependencies)
  await page.goto(`${base}/`, { timeout: 120_000 });
  const pulse = page.getByTestId('workspace-pulse');
  await pulse.waitFor({ timeout: 20_000 });
  const tiles = pulse.locator('a');
  check((await tiles.count()) === 4, `expected 4 tiles, saw ${await tiles.count()}`);
  await page.waitForFunction(() => /Calls today\s*\d+/.test(document.querySelector('[data-testid="workspace-pulse"]')?.innerText || ''), null, { timeout: 30_000 });
  const hrefs = await tiles.evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  check(JSON.stringify(hrefs) === JSON.stringify(['/calls', '/live', '/analytics/alerts', '/analytics/speed']), `tiles open ${hrefs.join(', ')}`);
  check(/in the last 7 days/.test(await tiles.nth(0).innerText()), await tiles.nth(0).innerText());
});

await step('the background check runs by itself, and the bell counts the two new alerts', async () => {
  await waitForBell(2);
  check((await bellCount()) === 2, `bell says ${await bellCount()}`);
  await page.waitForFunction(() => /Alerts\s*2/.test(document.querySelector('[data-testid="workspace-pulse"]')?.innerText || ''), null, { timeout: 10_000 });
});

await step('the bell lists the alerts beside the deployments, and leads to the Alerts page', async () => {
  await page.getByTestId('bell').click();
  const list = page.getByTestId('bell-alerts');
  await list.waitFor();
  const text = await list.innerText();
  check(/escalate_to_human/.test(text) && /slow/i.test(text), text);
  check(await page.getByText('Deployments and jobs').isVisible(), 'the deployments section is still there');
  await list.getByRole('link', { name: 'All alerts' }).click();
  await page.waitForURL(/\/analytics\/alerts$/);
});

await step('the failing hand-over is first, as critical, and says what it rests on', async () => {
  await alertCards().first().waitFor({ timeout: 20_000 });
  const titles = await alertCards().locator('h3').allTextContents();
  check(/escalate_to_human/.test(titles[0]), titles.join(' | '));
  check((await alertCards().first().getAttribute('data-severity')) === 'critical', 'not critical');
  check(titles.some((t) => /slow/i.test(t)), titles.join(' | '));
  check(/4 calls/.test(await alertCards().first().innerText()), await alertCards().first().innerText());
  check(/kept in this browser/i.test(await page.locator('main').innerText()), 'the page does not say where the rules are kept');
});

await step('“The 4 calls” lists them, each opening its call', async () => {
  const first = alertCards().first();
  await first.getByRole('button', { name: /The 4 calls/ }).click();
  const links = first.getByRole('list', { name: 'The calls behind it' }).getByRole('link');
  check((await links.count()) === 4, `${await links.count()} calls`);
  check(/^\/calls\/[^?]+\?agent=acme-support$/.test(await links.first().getAttribute('href')), await links.first().getAttribute('href'));
});

await step('“I’m on it” takes it off the count, and says who', async () => {
  await alertCards().first().getByRole('button', { name: 'I’m on it' }).click();
  await waitForBell(1);
  check(/On it: Test Person/.test(await page.locator('article[data-status="seen"]').innerText()), await page.locator('article[data-status="seen"]').innerText());
});

await step('a snoozed alert is off the count too, and both stay under “Being looked at, or snoozed”', async () => {
  const slow = page.locator('article[data-status="new"]').first();
  await slow.getByRole('button', { name: 'Snooze' }).click();
  await page.getByRole('menuitem', { name: 'For 4 hours' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="bell-count"]'), null, { timeout: 5000 });
  check((await bellCount()) === 0, `bell says ${await bellCount()}`);
  check((await page.getByText('Being looked at, or snoozed').count()) === 1, 'no heading for handled alerts');
  check((await alertCards().count()) === 2, `${await alertCards().count()} cards`);
});

await step('“Mark as new” puts it back on the count', async () => {
  await page.locator('article[data-status="snoozed"]').getByRole('button', { name: 'Mark as new' }).click();
  await waitForBell(1);
});

await step('a rule’s number can be changed and is kept in this browser; the way back is offered', async () => {
  await page.getByRole('tab', { name: 'What to watch for' }).click();
  const box = page.getByRole('spinbutton', { name: /A tool keeps failing: calls/ });
  await box.fill('5');
  await page.getByRole('button', { name: 'Back to the recommended settings' }).waitFor();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('weave_alerts_v1') || '{}').rules);
  check(stored?.tool_failing?.params?.count === 5, JSON.stringify(stored));
  await page.getByRole('button', { name: 'Back to the recommended settings' }).click();
  // the box follows the rule once React has re-rendered, which can be just after the click returns
  await box.evaluate((el) => new Promise((done) => { const t0 = Date.now(); const tick = () => (el.value === '3' || Date.now() - t0 > 3000 ? done() : setTimeout(tick, 50)); tick(); }));
  check((await box.inputValue()) === '3', `the box says ${await box.inputValue()}`);
});

await step('a rule can be switched off', async () => {
  const toggle = page.getByRole('switch', { name: 'No calls coming in' });
  await toggle.click();
  check((await toggle.getAttribute('aria-checked')) === 'false', 'still on');
  await toggle.click();
  check((await toggle.getAttribute('aria-checked')) === 'true', 'not back on');
});

await step('Where to send: browser notifications are off until turned on, and it is honest about email and Slack', async () => {
  await page.getByRole('tab', { name: 'Where to send' }).click();
  check((await page.getByRole('switch', { name: 'Browser notifications' }).getAttribute('aria-checked')) === 'false', 'notifications on without asking');
  check(/need the Weave server/.test(await page.getByTestId('server-note').innerText()), 'no server note');
  await page.getByRole('tab', { name: /Right now/ }).click();
});

await step('“Open escalate_to_human” goes to the agent’s Tools', async () => {
  await page.locator('article', { hasText: 'escalate_to_human' }).getByRole('link', { name: /Open “escalate_to_human”/ }).click();
  await page.waitForURL(/\/agents\/acme-support\/build\/tools$/);
});

await step('the agent’s Overview: what is wrong with it, its week in numbers, its build parts, where it runs and its latest calls', async () => {
  await page.goto(`${base}/agents/acme-support`);
  await page.getByTestId('agent-alerts').waitFor({ timeout: 20_000 });
  check(/escalate_to_human/.test(await page.getByTestId('agent-alerts').innerText()), await page.getByTestId('agent-alerts').innerText());
  const stats = page.getByTestId('overview-stats');
  await page.waitForFunction(() => /Calls · last 7 days\s*\d+/.test(document.querySelector('[data-testid="overview-stats"]')?.innerText || ''), null, { timeout: 30_000 });
  const text = await stats.innerText();
  check(/Handled without a person/.test(text) && /Typical answer time/.test(text) && /Cut off/.test(text), text);
  const parts = page.getByTestId('overview-build-parts').locator('li');
  check((await parts.count()) === 6, `${await parts.count()} build parts`);
  check(/Getting it ready/.test(await page.locator('main').innerText()), 'the readiness checklist is gone');
  check(/Production/.test(await page.getByTestId('overview-where').innerText()), 'no environments');
  await page.getByTestId('overview-calls').locator('a').first().waitFor({ timeout: 20_000 });
  const calls = page.getByTestId('overview-calls').locator('a');
  check((await calls.count()) === 5, `${await calls.count()} latest calls`);
  await calls.first().click();
  await page.waitForURL(/\/calls\/[^?]+\?agent=acme-support/);
});

await step('a build part opens its Build page', async () => {
  await page.goto(`${base}/agents/acme-support`);
  await page.getByTestId('overview-build-parts').locator('li[data-part="channels"] a').click();
  await page.waitForURL(/\/agents\/acme-support\/build\/channels$/);
});

await step('the agent’s Monitor has Calls, Health, Speed and Alerts, and its alerts are there', async () => {
  await page.goto(`${base}/agents/acme-support/monitor`);
  const nav = page.getByRole('navigation', { name: 'Monitor' });
  await nav.waitFor();
  check((await nav.getByRole('link').allTextContents()).join('|').replace(/\d/g, '') === 'Calls|Health|Speed|Alerts', await nav.innerText());
  check(/Recent calls for|No calls for/.test(await page.locator('main').innerText()), 'the calls view is gone');
  await nav.getByRole('link', { name: /Alerts/ }).click();
  await page.waitForURL(/\/monitor\/alerts$/);
  await alertCards().first().waitFor();
  check((await alertCards().count()) === 1, `${await alertCards().count()} alerts for this agent`);
  check(/escalate_to_human/.test(await alertCards().first().innerText()), 'not its alert');
});

await step('the agent’s Health: its numbers, calls per day and what needs attention', async () => {
  await page.getByRole('navigation', { name: 'Monitor' }).getByRole('link', { name: 'Health' }).click();
  await page.waitForURL(/\/monitor\/health$/);
  await page.getByRole('region', { name: 'The numbers' }).waitFor({ timeout: 20_000 });
  const text = await page.locator('main').innerText();
  check(/Calls per day/.test(text) && /Needs attention/.test(text), text.slice(0, 400));
  check(!(await page.getByRole('heading', { name: 'Agents' }).count()), 'one agent’s page lists agents');
});

await step('Analytics opens on Monitoring: the numbers, calls per day, what goes wrong and every agent', async () => {
  await page.goto(`${base}/analytics`);
  await page.getByRole('region', { name: 'The numbers' }).waitFor({ timeout: 30_000 });
  check(!/not available yet/.test(await page.locator('main').innerText()), 'the placeholder is still there');
  await page.waitForFunction(() => /Tools that failed\s*\d+%/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 30_000 });
  const agents = page.getByRole('region', { name: 'Agents' }).locator('tbody tr');
  check((await agents.count()) === 3, `${await agents.count()} agents`);
  const wrong = await page.getByRole('region', { name: 'What goes wrong most' }).innerText();
  check(/A tool failed/.test(wrong), wrong);
  check(/escalate_to_human/.test(await page.getByTestId('agent-alerts').innerText()), 'Monitoring does not say what is wrong now');
});

await step('the period can be changed, and the Analytics tabs lead to Speed and Alerts with the count', async () => {
  await page.getByLabel('Period').selectOption('7');
  await page.getByRole('region', { name: 'The numbers' }).waitFor();
  check(/in 7 days|the period before/i.test(await page.getByRole('region', { name: 'The numbers' }).innerText()), 'period not applied');
  const nav = page.getByRole('navigation', { name: 'Analytics' });
  await page.waitForFunction(() => /Alerts\s*1/.test(document.querySelector('nav[aria-label="Analytics"]')?.textContent || ''), null, { timeout: 20_000 });
  await nav.getByRole('link', { name: /^Speed/ }).click();
  await page.waitForURL(/\/analytics\/speed$/);
});

await step('the agents list shows each agent’s week of calls and its alerts, in the list and in the table', async () => {
  await page.goto(`${base}/agents`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="agent-activity"] .sr-only').length >= 3, null, { timeout: 30_000 });
  // the alert check runs again after the page loads
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="agent-activity"]')].some((el) => /1 alert/.test(el.textContent || '')), null, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const row = page.locator('tr', { hasText: 'Acme Support' });
  await row.getByTestId('agent-activity').waitFor();
  await page.waitForFunction(() => /1 alert/.test([...document.querySelectorAll('tr')].find((tr) => /Acme Support/.test(tr.textContent || ''))?.textContent || ''), null, { timeout: 20_000 });
  const activity = await row.getByTestId('agent-activity').innerText();
  check(/\d/.test(activity) && /1 alert/.test(activity), activity);
  check((await page.getByRole('columnheader', { name: 'Calls, last 7 days' }).count()) === 1, 'no column for the calls');
  await row.getByRole('link', { name: /1 alert/ }).click();
  await page.waitForURL(/\/agents\/acme-support\/monitor\/alerts$/);
});

await finish();
