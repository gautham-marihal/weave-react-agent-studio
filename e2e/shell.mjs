// The shell around every page: the grouped sidebar (fold, remembered, folds inside an agent, counts), the phone
// drawer, the tab titles, "Page not found" and "Agent not found", skip to content, help, a broken page that leaves the
// menu working, the offline and "can't reach the server" strips, the profile menu and Settings.
//   E2E_API_PORT=8430 E2E_WEB_PORT=5430 node e2e/shell.mjs
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish, errors } = await suite('shell');

const sidebar = () => page.locator('#studio-sidebar');
const sidebarWidth = () => sidebar().evaluate((el) => Math.round(el.getBoundingClientRect().width));
const titleIs = async (want) => {
  await page.waitForFunction((t) => document.title === t, want, { timeout: 10_000 }).catch(() => {});
  const got = await page.title();
  check(got === want, `the tab is called “${got}”, not “${want}”`);
};
// a move inside the app (no page load): wait for the address
const urlIs = (re) => page.waitForFunction((src) => new RegExp(src).test(location.pathname + location.search), re.source, { timeout: 15_000 });
// the module the app itself loaded (the dev server names files by their full path), to set a count from the test
const setBadge = (to, count) =>
  page.evaluate(async ([t, c]) => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /navBadges.ts/.test(n));
    (await import(url)).setNavBadge(t, c, 'danger');
  }, [to, count]);

const ready = async (path, text) => {
  await page.goto(`${base}${path}`);
  await page.locator('main').waitFor();
  if (text) await page.getByText(text).first().waitFor({ timeout: 15_000 });
};

// the dev server prepares its files on the first visit: give it time once
await page.goto(base + '/', { timeout: 120_000 }).catch(() => {});
await page.locator('main').waitFor({ timeout: 120_000 }).catch(() => {});

await step('the sidebar groups the pages: Workspace, Library, then Team and Settings', async () => {
  await ready('/', /Good (morning|afternoon|evening)/);
  const groups = await sidebar().locator('nav[aria-label="Main"] > [role="group"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check(JSON.stringify(groups) === JSON.stringify(['Workspace', 'Library', 'Team and settings']), `groups: ${groups}`);
  const workspace = await sidebar().getByRole('group', { name: 'Workspace' }).getByRole('link').allInnerTexts();
  check(['Home', 'Agents', 'Calls'].every((n) => workspace.some((w) => w.includes(n))), `workspace links: ${workspace}`);
  check(await sidebar().getByRole('link', { name: 'Team' }).isVisible(), 'Team is in the sidebar');
});

await step('the top bar keeps only the data source, search, notifications, theme and the account; the sidebar only the pages', async () => {
  await ready('/calls', 'Calls');
  const bar = page.getByRole('banner');
  for (const gone of [/Help and shortcuts/, /API status/, /Development/]) check(!(await bar.getByRole('button', { name: gone }).count()), `the top bar still has ${gone}`);
  check(await bar.getByRole('group', { name: 'Data source' }).isVisible(), 'the data source is in the top bar');
  for (const name of ['Search anything', 'Theme']) check(await bar.getByRole('button', { name }).first().isVisible(), `no ${name} in the top bar`);
  check(await bar.getByRole('button', { name: /Your account: Test Person/ }).isVisible(), 'the account is at the top right');
  for (const gone of [/Search anything/, /Help & shortcuts/, /Your account/]) check(!(await sidebar().getByRole('button', { name: gone }).count()), `the sidebar still has ${gone}`);
  // groups are named for screen readers only (and Library is a link, not a heading over it)
  check(!(await sidebar().getByText('Workspace', { exact: true }).count()), 'the sidebar still shows section headings');
  check((await sidebar().getByText('Library', { exact: true }).count()) === 1, 'Library is named twice in the sidebar');
  check(!(await sidebar().getByText('Collapse', { exact: true }).count()), 'the sidebar still says “Collapse”');
  const fold = sidebar().getByRole('button', { name: 'Collapse the sidebar' });
  const top = await fold.evaluate((el) => el.getBoundingClientRect().top);
  check(top < 60, `the fold button is not at the top (${top}px)`);
  check(!(await page.getByRole('navigation', { name: /breadcrumb/i }).count()), 'a page the menu opens has no breadcrumb trail');
});

await step('Settings › Working environment: Production puts a warning on every page, and “Change” comes back here', async () => {
  await ready('/settings', 'Settings');
  const section = page.locator('#working-environment');
  await section.getByRole('button', { name: 'Production' }).click();
  const bar = page.getByRole('alert').filter({ hasText: 'You are working in Production.' });
  await bar.waitFor();
  await page.getByRole('link', { name: 'Agents', exact: true }).click();
  await bar.waitFor();
  await bar.getByRole('link', { name: 'Change' }).click();
  await page.waitForURL(/\/settings/);
  await section.getByRole('button', { name: 'Development' }).click();
  await bar.waitFor({ state: 'detached' });
});

await step('the browser tab names the page, then the agent', async () => {
  await ready('/', /Good/);
  await titleIs('Home · Weave Studio');
  await ready('/calls', 'Calls');
  await titleIs('Calls · Weave Studio');
  await ready('/agents/acme-support/build/tools', 'Acme Support');
  await titleIs('Tools · Acme Support · Weave Studio');
  await ready('/agents/acme-support/release', 'Acme Support');
  await titleIs('Release · Acme Support · Weave Studio');
});

await step('an address that leads nowhere says “Page not found” and stays put', async () => {
  await ready('/nothing-here/at-all', 'Page not found');
  check(new URL(page.url()).pathname === '/nothing-here/at-all', `moved to ${page.url()}`);
  await titleIs('Page not found · Weave Studio');
  check(await sidebar().isVisible(), 'the menu is still there');
  await page.getByRole('link', { name: 'Go to Home' }).click();
  await page.getByRole('heading', { level: 1, name: /Good/ }).waitFor();
});

await step('a missing agent says “Agent not found”', async () => {
  await ready('/agents/no-such-agent/build', 'Agent not found');
  await titleIs('Agent not found · Weave Studio');
});

await step('the sidebar folds to icons and remembers it', async () => {
  await ready('/calls', 'Calls');
  check((await sidebarWidth()) > 200, 'it starts open');
  await page.getByRole('button', { name: 'Collapse the sidebar' }).click();
  await page.waitForFunction(() => document.querySelector('#studio-sidebar').getBoundingClientRect().width < 80);
  check(await sidebar().getByRole('link', { name: 'Calls' }).isVisible(), 'the links are still there, as icons with their names');
  await page.reload();
  await page.locator('main').waitFor();
  await page.waitForTimeout(300);
  check((await sidebarWidth()) < 80, 'still folded after a reload');
  await page.getByRole('button', { name: 'Expand the sidebar' }).click();
  await page.waitForFunction(() => document.querySelector('#studio-sidebar').getBoundingClientRect().width > 200);
});

await step('inside an agent it folds by itself, and opens again outside', async () => {
  await ready('/agents/acme-support', 'Acme Support');
  await page.waitForFunction(() => document.querySelector('#studio-sidebar').getBoundingClientRect().width < 80);
  await page.getByRole('button', { name: 'Expand the sidebar' }).click();
  await page.waitForFunction(() => document.querySelector('#studio-sidebar').getBoundingClientRect().width > 200);
  await sidebar().getByRole('link', { name: 'Calls' }).click();
  await urlIs(/\/calls$/);
  await page.waitForTimeout(300);
  check((await sidebarWidth()) > 200, 'open again outside the agent');
  await ready('/agents/front-desk/build', 'Front Desk');
  await page.waitForFunction(() => document.querySelector('#studio-sidebar').getBoundingClientRect().width < 80);
});

await step('a sidebar link can show a count (the slot Alerts uses)', async () => {
  await ready('/', /Good/);
  await setBadge('/calls', 4);
  const badge = sidebar().locator('[data-nav-badge="/calls"]');
  await badge.waitFor();
  check((await badge.innerText()).trim() === '4', 'the count shows');
  const name = await sidebar().getByRole('link', { name: /Calls/ }).textContent();
  check(/4 need attention/.test(name), `a screen reader hears it: ${name}`);
  await setBadge('/calls', 0);
  await badge.waitFor({ state: 'detached' });
});

await step('the first Tab offers “Skip to content”, which jumps past the menu', async () => {
  await ready('/calls', 'Calls');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check(first === 'Skip to content', `the first Tab lands on “${first}”`);
  check(await page.getByText('Skip to content').isVisible(), 'it shows when focused');
  await page.keyboard.press('Enter');
  const where = await page.evaluate(() => ({ tag: document.activeElement?.tagName, inMain: !!document.activeElement?.closest('#main-content') }));
  check(where.inMain, `focus moved to ${where.tag}, not into the page`);
});

await step('“?” opens Help with “Where things live”, Esc closes it, and typing a “?” does not', async () => {
  await ready('/team', 'Team');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Help & shortcuts' });
  await dialog.waitFor();
  check(await dialog.getByText('Where things live').isVisible(), 'the guide is in it');
  const keys = await dialog.locator('kbd').allInnerTexts();
  check(keys.includes('Ctrl K') && keys.includes('Ctrl S'), `keys on Windows: ${keys}`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('searchbox', { name: 'Search people' }).fill('who?');
  await page.waitForTimeout(300);
  check((await page.getByRole('dialog', { name: 'Help & shortcuts' }).count()) === 0, 'typing “?” in a field does not open it');
  // also from the account menu at the top right
  await page.getByRole('banner').getByRole('button', { name: /Your account/ }).click();
  await page.getByRole('menuitem', { name: /Help & shortcuts/ }).click();
  await dialog.waitFor();
  await page.keyboard.press('Escape');
});

await step('on a Mac the keys read ⌘', async () => {
  const mac = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await mac.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS' }) });
    sessionStorage.setItem('weave_auth_user', JSON.stringify({ id: 'e2e', name: 'Test Person', email: 'test.person@example.com', initials: 'TP', role: 'admin' }));
  });
  const p = await mac.newPage();
  try {
    await p.goto(`${base}/`);
    await p.locator('main').waitFor();
    await p.keyboard.press('?');
    const keys = await p.getByRole('dialog', { name: 'Help & shortcuts' }).locator('kbd').allInnerTexts();
    check(keys.includes('⌘ K') && keys.includes('⌘ S') && keys.includes('⌘ ⇧ Z'), `keys on a Mac: ${keys}`);
    await p.keyboard.press('Escape');
    const barKbd = await p.getByRole('banner').getByRole('button', { name: 'Search anything' }).first().locator('kbd').innerText();
    check(barKbd.trim() === '⌘ K', `the top bar's search says ${barKbd}`);
  } finally {
    await mac.close();
  }
});

await step('a page that breaks says so; the menu still works, and another page starts afresh', async () => {
  await page.route('**/api/bots/*/calls?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ calls: [{ id: 'bad', room: 'r', channel: 'web_chat', caller: 'x', started_at: 'not a date', status: 'ended', duration_s: 3, version: 'draft', ref: 'production' }], next: null }),
    })
  );
  try {
    await ready('/calls');
    await page.getByText('This page couldn’t be shown').waitFor({ timeout: 15_000 });
    check(await page.getByRole('button', { name: 'Go to Home' }).isVisible(), 'it offers the way Home');
    check(await sidebar().getByRole('link', { name: 'Agents' }).isVisible(), 'the menu is still there');
    check(!(await page.getByText('An application error occurred').count()), 'not the whole-app error screen');
  } finally {
    await page.unroute('**/api/bots/*/calls?*');
    // the page broke on purpose: what it logged is expected, not a failure
    errors.splice(0, errors.length, ...errors.filter((e) => !/Invalid time value|above error occurred|ErrorBoundary caught/.test(e)));
  }
  await sidebar().getByRole('link', { name: 'Agents' }).click();
  await urlIs(/\/agents$/);
  await page.getByRole('heading', { level: 1, name: 'Agents' }).waitFor();
  check(!(await page.getByText('This page couldn’t be shown').count()), 'the next page is drawn afresh');
});

await step('when the server can’t be reached a strip says so, and Try again brings it back', async () => {
  await page.route('**/api/health', (route) => route.abort());
  try {
    await ready('/calls');
    await page.getByText('Can’t reach the server.').waitFor({ timeout: 20_000 });
    check(!(await page.getByRole('banner').getByRole('button', { name: /API status/ }).count()), 'the top bar keeps no API pill: the strip says it');
  } finally {
    await page.unroute('**/api/health');
  }
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByText('Can’t reach the server.').waitFor({ state: 'detached', timeout: 15_000 });
});

await step('while the server is down it asks again by itself every 15 seconds', async () => {
  await page.route('**/api/health', (route) => route.abort());
  await ready('/');
  await page.getByText('Can’t reach the server.').waitFor({ timeout: 20_000 });
  await page.unroute('**/api/health');
  const started = Date.now();
  await page.getByText('Can’t reach the server.').waitFor({ state: 'detached', timeout: 22_000 });
  const took = Math.round((Date.now() - started) / 1000);
  check(took <= 20, `took ${took} s`);
});

await step('Settings shows what is running where, checks the API again, and links to Team', async () => {
  await ready('/settings', 'What is running where');
  const rows = page.getByTestId('running-where');
  await rows.waitFor();
  const text = await rows.innerText();
  check(/Development[\s\S]*Acme Support[\s\S]*0\.1\.1/.test(text), `development: ${text}`);
  check(/Staging[\s\S]*Acme Support[\s\S]*0\.1\.0/.test(text), `staging: ${text}`);
  check(/Production[\s\S]*Nothing deployed/.test(text), `production: ${text}`);
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByTestId('api-state').filter({ hasText: /Connected/ }).waitFor();
  check(!(await page.getByText('arrive in version 2').count()), 'the old “version 2” line is gone');
  await page.getByRole('link', { name: 'Team page' }).click();
  await urlIs(/\/team$/);
});

await step('the profile menu opens the Account dialog and signs out', async () => {
  await ready('/', /Good/);
  await page.getByRole('banner').getByRole('button', { name: /Your account: Test Person/ }).click();
  const menu = page.getByRole('menu');
  await menu.waitFor();
  check((await menu.getByRole('menuitem').allInnerTexts()).some((t) => /Account/.test(t)), 'Account is in it');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await page.getByRole('banner').getByRole('button', { name: /Your account/ }).click();
  await page.getByRole('menuitem', { name: /Account/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Your account' });
  await dialog.waitFor();
  const text = await dialog.innerText();
  check(/Test Person/.test(text) && /test\.person@example\.com/.test(text) && /Admin/.test(text) && /Workspace/.test(text), text);
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  // signed out at the bare address: the landing page (any other address asks to sign in)
  await urlIs(/^\/welcome$/);
  await page.getByRole('link', { name: 'Start', exact: true }).waitFor();
});

await step('on a phone the menu is a drawer: it opens over a scrim and closes on Esc, a pick, or the scrim', async () => {
  const phone = await context.browser().newContext({ viewport: { width: 390, height: 844 } });
  await phone.addInitScript(() =>
    sessionStorage.setItem('weave_auth_user', JSON.stringify({ id: 'e2e', name: 'Test Person', email: 'test.person@example.com', initials: 'TP', role: 'admin' }))
  );
  const p = await phone.newPage();
  try {
    await p.goto(`${base}/`);
    await p.locator('main').waitFor();
    const drawer = p.locator('#studio-sidebar');
    check(!(await drawer.isVisible()), 'the menu is hidden on a phone');
    const open = p.getByRole('button', { name: 'Open the menu' });
    await open.click();
    await drawer.waitFor({ state: 'visible' });
    check(await p.getByTestId('nav-scrim').isVisible(), 'a scrim covers the page');
    await p.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    await open.click();
    await drawer.getByRole('link', { name: 'Calls' }).click();
    await p.waitForURL(/\/calls$/);
    await drawer.waitFor({ state: 'hidden' });
    await open.click();
    await p.getByTestId('nav-scrim').click({ position: { x: 370, y: 400 } });
    await drawer.waitFor({ state: 'hidden' });
  } finally {
    await phone.close();
  }
});

await step('without a network a strip says “You’re offline”', async () => {
  const off = await context.browser().newContext({ viewport: { width: 1280, height: 800 } });
  await off.addInitScript(() =>
    sessionStorage.setItem('weave_auth_user', JSON.stringify({ id: 'e2e', name: 'Test Person', email: 'test.person@example.com', initials: 'TP', role: 'admin' }))
  );
  const p = await off.newPage();
  try {
    await p.goto(`${base}/settings`);
    await p.locator('main').waitFor();
    await off.setOffline(true);
    await p.getByText('You’re offline.').waitFor({ timeout: 5_000 });
    await off.setOffline(false);
    await p.getByText('You’re offline.').waitFor({ state: 'detached', timeout: 5_000 });
  } finally {
    await off.close();
  }
});

await finish();
