// The search (Ctrl/⌘ K): grouped results, the best match first, recent picks, an agent's own pages, tasks and
// settings, each agent's Publish/Test/Deploy/Calls, phone numbers and calls, against the stand-in API.
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('search');
page.on('dialog', (dialog) => dialog.accept().catch(() => {}));

const dialog = () => page.getByRole('dialog', { name: 'Search Weave Studio' });
const box = () => dialog().getByRole('combobox');
const open = async () => {
  await page.keyboard.press('Control+k');
  await box().waitFor();
};
const typeIn = async (text) => {
  await box().fill(text);
  await page.waitForTimeout(250);
};
const chosen = () => dialog().locator('[role="option"][aria-selected="true"] p').first().innerText();
const groups = () => dialog().locator('[role="group"] > p').allInnerTexts();
const titlesIn = (group) => dialog().locator('[role="group"]').filter({ has: page.locator('p', { hasText: new RegExp(`^${group}$`, 'i') }) }).locator('[role="option"] p:first-child').allInnerTexts();

await step('Ctrl K opens a named search with a list box; the first result is ready for Enter and a screen reader hears it', async () => {
  await page.goto(`${base}/`);
  await page.locator('main').waitFor();
  await open();
  const listId = await box().getAttribute('aria-controls');
  check((await page.locator(`[id="${listId}"]`).getAttribute('role')) === 'listbox', 'the box controls a list box');
  const gs = (await groups()).map((g) => g.toLowerCase());
  check(gs.includes('navigate') && gs.includes('actions') && gs.includes('agents'), `groups: ${gs.join(', ')}`);
  check((await chosen()) === 'Home', 'Home is ready for Enter');
  const active = await box().getAttribute('aria-activedescendant');
  check(!!active && (await page.locator(`[id="${active}"]`).innerText()).startsWith('Home'), 'the box names the chosen result');
});

await step('Results are found however they are typed, the closest first', async () => {
  await typeIn('knowlege');
  check((await chosen()) === 'Knowledge', `a slip finds Knowledge (${await chosen()})`);
  await typeIn('acme');
  check((await titlesIn('Agents')).includes('Acme Support'), 'the agent by its name');
  await typeIn('zzqx');
  await dialog().getByText('No matches for “zzqx”').waitFor();
});

await step('The arrows move through the results across the groups and round; Enter opens one; Escape closes', async () => {
  await typeIn('');
  await page.keyboard.press('ArrowDown');
  const second = await chosen();
  check(second !== 'Home', 'the arrow moved on');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const last = await chosen();
  check(last !== 'Home' && last !== second, `round to the last (${last})`);
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'detached' });
  await open();
  await typeIn('calls');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/calls$/);
  check(!(await dialog().count()), 'choosing closes it');
});

await step('The recent picks come first while nothing is typed, and are kept in this browser', async () => {
  await open();
  const gs = await groups();
  check(gs[0].toLowerCase() === 'recent', `the recent picks first (${gs.join(', ')})`);
  check((await titlesIn('Recent'))[0] === 'Calls', 'the last pick first');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('weave_search_recent') || '[]'));
  check(kept[0] === 'page:calls', `kept: ${kept}`);
  await dialog().getByText('Recent picks are kept in this browser').waitFor();
  await page.keyboard.press('Escape');
});

await step('Each agent’s Publish, Test, Deploy and Calls are offered by its name', async () => {
  await open();
  await typeIn('deploy front desk');
  const actions = await titlesIn('Actions on an agent');
  check(actions[0] === 'Put a version live', `actions: ${actions.join(', ')}`);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/agents\/front-desk\/release/);
  await page.getByRole('dialog', { name: 'Deploy a version' }).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await open();
  await typeIn('calls bookings');
  const option = dialog().locator('[role="option"]').filter({ hasText: 'Bookings · Every conversation' }).first();
  await option.click();
  await page.waitForURL(/\/calls\?agent=bookings/);
});

await step('Publish from the search opens the publish step of that agent', async () => {
  await open();
  await typeIn('publish acme');
  check((await titlesIn('Actions on an agent'))[0] === 'Publish a version', 'Publish is first');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/agents\/acme-support\/release/);
  await page.getByRole('dialog').filter({ hasText: /Publish/ }).first().waitFor({ timeout: 10_000 });
  check(!page.url().includes('publish=1'), 'the request is taken off the address');
  await page.keyboard.press('Escape');
});

await step('Phone numbers and recent calls are found by what is typed', async () => {
  await page.goto(`${base}/`);
  await page.locator('main').waitFor();
  await open();
  await typeIn('6563001000');
  await dialog().locator('[role="group"]').filter({ hasText: /^phone numbers/i }).first().waitFor({ timeout: 10_000 });
  check((await titlesIn('Phone numbers')).includes('+6563001000'), 'the number');
  await typeIn('acme support call');
  await dialog().locator('[role="group"]').filter({ hasText: /^calls/i }).first().waitFor({ timeout: 10_000 });
  check((await titlesIn('Calls')).some((t) => t === 'Acme Support call'), 'a call of that agent');
  await page.keyboard.press('Escape');
});

await step('On an agent, its own pages come first, and a setting opens on that agent (not the first in the list)', async () => {
  await page.goto(`${base}/agents/front-desk/overview`);
  await page.locator('main').waitFor();
  await open();
  const gs = (await groups()).map((g) => g.toLowerCase());
  check(gs.indexOf('this agent') >= 0 && gs.indexOf('this agent') < gs.indexOf('navigate'), `This agent before the rest (after the recent picks): ${gs.join(', ')}`);
  await typeIn('nudge silent');
  await dialog().locator('[role="group"]').filter({ hasText: /settings of this agent/i }).waitFor({ timeout: 10_000 });
  const option = dialog().locator('[role="option"]').filter({ hasText: 'Nudge a silent caller' }).filter({ hasText: 'Agent ›' }).first();
  await option.click();
  await page.waitForURL(/\/agents\/front-desk\/build/);
  await page.waitForFunction(() => document.activeElement?.id === 'field-defaults.conversation.inactivity.enabled-input', null, { timeout: 15_000 });
});

await step('On an agent, its pages and tasks are found by the words people use', async () => {
  await open();
  await typeIn('problems');
  check((await chosen()) === 'Problems the server found', `first: ${await chosen()}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('checks-panel')?.classList.contains('ring-2'), null, { timeout: 10_000 });
  await open();
  await typeIn('all settings');
  await page.keyboard.press('Enter');
  await page.locator('[data-settings-form]').waitFor({ timeout: 10_000 });
});

await step('Key labels follow the keyboard: ⌘ K on a Mac', async () => {
  const mac = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await mac.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS' }) });
    sessionStorage.setItem('weave_auth_user', JSON.stringify({ id: 'm', name: 'Mac Person', email: 'mac.person@example.com', initials: 'MP', role: 'admin' }));
  });
  const p = await mac.newPage();
  await p.goto(`${base}/`);
  await p.locator('main').waitFor();
  await p.getByText('⌘ K').first().waitFor();
  await mac.close();
  check((await page.getByText('Ctrl K').count()) > 0, 'Ctrl K elsewhere');
});

await finish();
