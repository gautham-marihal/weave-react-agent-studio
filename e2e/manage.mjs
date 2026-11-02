// Managing agents, in a real browser against the stand-in API: the Agents list (status counts, "Furthest along", tag
// facets, remembered view, Move up / Move down), workspaces (switch, create, rename, delete, move an agent, a link opens
// the agent's workspace, other tabs follow), each agent's "⋯" menu (rename with the plain 409 wording, export, save as
// template, remove / restore / delete from the list / bring back), the Create dialog's own templates, and the agent
// header's "More" menu (the same actions, plus Discard edits and reload).
//   E2E_API_PORT=8429 E2E_WEB_PORT=5429 node e2e/manage.mjs
import { readFileSync } from 'node:fs';
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish, errors } = await suite('manage');
page.setDefaultTimeout(20_000);
page.setDefaultNavigationTimeout(90_000);

const api = (path, init) => page.evaluate(async ([p, i]) => (await fetch(`/api${p}`, i)).json(), [path, init ?? {}]);
const rowIds = () => page.locator('[id^="accordion-header-"]').evaluateAll((els) => els.map((e) => e.id.replace('accordion-header-', '')));
// the list animates rows in and out: wait (up to 5 s) until it shows these rows, then say what it shows
const rowsAre = async (expected) => {
  const until = Date.now() + 5000;
  let shown = JSON.stringify(await rowIds());
  while (shown !== expected && Date.now() < until) {
    await page.waitForTimeout(100);
    shown = JSON.stringify(await rowIds());
  }
  return shown;
};
const openList = async (query = '') => {
  await page.goto(`${base}/agents${query}`);
  await page.getByRole('heading', { name: 'Agents', level: 1 }).waitFor();
  await page.locator('[id^="accordion-header-"], table tbody tr').first().waitFor({ timeout: 20_000 });
};
const menuOf = async (name) => {
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).first().click();
  await page.getByRole('menu').waitFor();
};
const dialog = (name) => page.getByRole('dialog', { name });
const openRemoved = async () => {
  const toggle = page.getByRole('button', { name: /Removed from your list \(/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
};
// a toast can sit over the header's buttons: close them before using the header
const closeToasts = async () => {
  for (const b of await page.getByRole('button', { name: 'Dismiss notification' }).all()) await b.click().catch(() => undefined);
};
const statusButton = (label) => page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: new RegExp(`^${label}`) });

// Studio's toasts warn in development (ToastItem is not a forwardRef inside AnimatePresence, and it dismisses itself
// while rendering): known, in a shared component, not this suite's. Everything else on the console still fails the run.
const KNOWN = /ToastItem/;

// ---- the list (W19, W20) ----------------------------------------------------------------------------------------------
await step('the status filters show how many agents each would show', async () => {
  await openList();
  await page.waitForFunction(() => !/Checking…/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 20_000 });
  const label = async (name) => (await statusButton(name).innerText()).replace(/\s+/g, ' ').trim();
  check((await label('All')) === 'All 3', `All: ${await label('All')}`);
  check((await label('Draft only')) === 'Draft only 1', `Draft only: ${await label('Draft only')}`);
  check((await label('Published')) === 'Published 2', `Published: ${await label('Published')}`);
  check((await label('Live')) === 'Live 2', `Live: ${await label('Live')}`);
  await statusButton('Draft only').click();
  const shown1 = await rowsAre('["bookings"]');
  check(shown1 === '["bookings"]', `draft only shows ${shown1}`);
  await statusButton('All').click();
});

await step('the header names the open workspace (kept in this browser), never a made-up one', async () => {
  const text = await page.locator('main').innerText();
  check(!/Northwind workspace/.test(text), 'the old hard-coded “Northwind workspace” text is gone');
  check(/3 agents in\s*My workspace/.test(text), `header: ${text.slice(0, 120)}`);
});

await step('“Furthest along” puts the agent live furthest first and the draft-only one last', async () => {
  await page.getByLabel('Sort agents').selectOption('stage');
  await page.waitForTimeout(200);
  const shown2 = await rowsAre('["acme-support","front-desk","bookings"]');
  check(shown2 === '["acme-support","front-desk","bookings"]', `order: ${shown2}`);
});

await step('tags from each draft’s meta filter the list, with how many agents have each', async () => {
  const options = await page.getByLabel('Filter by tag').locator('option').allInnerTexts();
  check(options.includes('booking (1)') && options.includes('support (1)'), options.join(' | '));
  await page.getByLabel('Filter by tag').selectOption('booking');
  await page.waitForTimeout(200);
  const shown3 = await rowsAre('["bookings"]');
  check(shown3 === '["bookings"]', `tag booking: ${shown3}`);
  check(new URL(page.url()).searchParams.get('tag') === 'booking', 'the tag is in the address');
  await page.getByLabel('Filter by tag').selectOption('');
});

await step('an agent whose draft could not be read is counted as “not checked yet” by the tag filter', async () => {
  await page.route('**/api/bots/bookings/draft', (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"disk error"}' }) : route.continue()));
  await openList('?tag=support');
  const note = page.getByTestId('not-checked');
  await note.waitFor({ timeout: 10_000 });
  check(/1 agent not checked yet/.test(await note.innerText()), await note.innerText());
  await page.unroute('**/api/bots/bookings/draft');
});

await step('the view (cards or table) and the sort are remembered in this browser', async () => {
  await openList();
  await page.getByLabel('Sort agents').selectOption('name');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /Table/ }).click();
  await page.goto(`${base}/agents`);
  await page.locator('table tbody tr').first().waitFor({ timeout: 20_000 });
  check((await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /Table/ }).getAttribute('aria-pressed')) === 'true', 'table view kept');
  check((await page.getByLabel('Sort agents').inputValue()) === 'name', `sort kept: ${await page.getByLabel('Sort agents').inputValue()}`);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /Accordions/ }).click();
});

await step('Move down / Move up from the “⋯” menu reorder the list (keyboard-friendly), as “Your order”, kept after a reload', async () => {
  await openList('?sort=name');
  const shown4 = await rowsAre('["acme-support","bookings","front-desk"]');
  check(shown4 === '["acme-support","bookings","front-desk"]', `by name: ${shown4}`);
  await menuOf('Acme Support');
  await page.getByRole('menuitem', { name: /^Move down/ }).click();
  await page.waitForTimeout(300);
  const shown5 = await rowsAre('["bookings","acme-support","front-desk"]');
  check(shown5 === '["bookings","acme-support","front-desk"]', `after move down: ${shown5}`);
  check((await page.getByLabel('Sort agents').inputValue()) === 'own', 'the sort is now “Your order”');
  // from the keyboard: open the menu with Enter, move to "Move up" with the arrows, press Enter
  await page.getByRole('button', { name: 'More actions for Front Desk', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor();
  const focused = () => page.evaluate(() => document.activeElement?.textContent || '');
  check(/^Move up/.test(await focused()), 'the menu opens on its first item');
  await page.keyboard.press('ArrowDown');
  check(/^Rename/.test(await focused()), 'the arrows move between items, skipping the ones that are off (Move down)');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const shown6 = await rowsAre('["bookings","front-desk","acme-support"]');
  check(shown6 === '["bookings","front-desk","acme-support"]', `after move up: ${shown6}`);
  await page.reload();
  await page.locator('[id^="accordion-header-"]').first().waitFor();
  const shown7 = await rowsAre('["bookings","front-desk","acme-support"]');
  check(shown7 === '["bookings","front-desk","acme-support"]', `after reload: ${shown7}`);
});

// ---- workspaces (W3) --------------------------------------------------------------------------------------------------
await step('a workspace is created from the switcher, says it is kept in this browser, and opens', async () => {
  await page.getByRole('button', { name: /switch workspace/ }).click();
  check(/Kept in this browser/.test(await page.getByRole('group', { name: 'Workspaces' }).innerText()), 'the menu says where workspaces are kept');
  check(/3 agents/.test(await page.getByRole('group', { name: 'Workspaces' }).innerText()), 'each workspace shows its agent count');
  await page.getByRole('button', { name: 'New workspace' }).click();
  await dialog('New workspace').getByLabel('Workspace name').fill('Sales');
  await dialog('New workspace').getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForFunction(() => /0 agents in\s*Sales/.test(document.querySelector('main')?.innerText || ''));
  check(/No agents in Sales yet/.test(await page.locator('main').innerText()), 'the empty workspace says so');
});

await step('an agent moves to another workspace from its “⋯” menu, and each workspace lists its own', async () => {
  await page.getByRole('button', { name: /switch workspace/ }).click();
  await page.getByRole('group', { name: 'Workspaces' }).getByRole('button', { name: /^My workspace/ }).click();
  await page.locator('[id^="accordion-header-"]').first().waitFor();
  await menuOf('Bookings');
  await page.getByRole('menuitem', { name: /^Move to workspace/ }).click();
  await dialog(/Move Bookings/).getByLabel(/Sales/).check();
  await dialog(/Move Bookings/).getByRole('button', { name: 'Move agent' }).click();
  await dialog(/Bookings is now in Sales/).getByRole('button', { name: /Stay in My workspace/ }).click();
  await page.waitForTimeout(300);
  check(JSON.stringify((await rowIds()).sort()) === '["acme-support","front-desk"]', `my workspace now: ${await rowIds()}`);
  await page.getByRole('button', { name: /switch workspace/ }).click();
  const menuText = await page.getByRole('group', { name: 'Workspaces' }).innerText();
  check(/Sales\s*1 agent/.test(menuText) && /My workspace\s*2 agents/.test(menuText), menuText);
  await page.keyboard.press('Escape');
});

await step('a link to an agent opens the workspace it belongs to', async () => {
  await page.goto(`${base}/agents/bookings/build`);
  await page.getByRole('button', { name: 'More actions for Bookings', exact: true }).waitFor({ timeout: 20_000 });
  await openList().catch(() => undefined);
  await page.waitForFunction(() => /in\s*Sales/.test(document.querySelector('main')?.innerText || ''));
  const shown8 = await rowsAre('["bookings"]');
  check(shown8 === '["bookings"]', `Sales lists ${shown8}`);
});

await step('another tab follows a workspace rename made here', async () => {
  const other = await context.newPage();
  await other.goto(`${base}/agents`);
  await other.getByRole('button', { name: /switch workspace/ }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: /switch workspace/ }).click();
  await page.getByRole('button', { name: 'Rename Sales' }).click();
  await dialog('Rename Sales').getByLabel('Workspace name').fill('Growth');
  await dialog('Rename Sales').getByRole('button', { name: 'Rename' }).click();
  await other.getByRole('button', { name: /switch workspace/ }).click();
  await other.getByRole('group', { name: 'Workspaces' }).getByText('Growth').waitFor({ timeout: 5000 });
  await other.close();
});

await step('deleting a workspace asks first, and its agents move back', async () => {
  await page.getByRole('button', { name: /switch workspace/ }).click();
  await page.getByRole('button', { name: 'Delete Growth' }).click();
  const ask = dialog(/Delete the workspace “Growth”/);
  check(/1 agent moves to My workspace/.test(await ask.innerText()), await ask.innerText());
  await ask.getByRole('button', { name: 'Delete workspace' }).click();
  await page.waitForFunction(() => /3 agents in\s*My workspace/.test(document.querySelector('main')?.innerText || ''));
});

// ---- the "⋯" menu (W22) -----------------------------------------------------------------------------------------------
await step('rename saves the draft with its revision and changes only the name', async () => {
  await openList('?sort=name');
  const before = await api('/bots/bookings/draft');
  await menuOf('Bookings');
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  await dialog('Rename this agent').getByLabel('Name').fill('Bookings desk');
  await dialog('Rename this agent').getByRole('button', { name: 'Rename' }).click();
  await dialog('Rename this agent').waitFor({ state: 'detached' });
  const after = await api('/bots/bookings/draft');
  check(after.config.meta.name === 'Bookings desk', `name on the server: ${after.config.meta.name}`);
  check(after.revision === before.revision + 1, `revision ${before.revision} -> ${after.revision}`);
  check(JSON.stringify({ ...after.config, meta: {} }) === JSON.stringify({ ...before.config, meta: {} }), 'nothing else changed');
  await page.getByRole('button', { name: 'More actions for Bookings desk', exact: true }).first().waitFor();
});

await step('a rename that meets someone else’s save (409) says so plainly and overwrites nothing', async () => {
  await page.route('**/api/bots/bookings/draft', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"detail":"base_revision 3 is not the current revision 4"}' }) : route.continue());
  await menuOf('Bookings desk');
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  await dialog('Rename this agent').getByLabel('Name').fill('Bookings again');
  await dialog('Rename this agent').getByRole('button', { name: 'Rename' }).click();
  const alert = dialog('Rename this agent').getByRole('alert');
  await alert.waitFor();
  const text = await alert.innerText();
  check(/The draft changed while you were renaming/.test(text) && /Someone saved it a moment ago/.test(text), text);
  check(!/revision|409/.test(text), 'no technical words');
  await page.unroute('**/api/bots/bookings/draft');
  await dialog('Rename this agent').getByRole('button', { name: 'Cancel' }).click();
});

await step('export: the saved draft and any published version, as JSON files', async () => {
  await menuOf('Acme Support');
  await page.getByRole('menuitem', { name: /^Export configuration/ }).click();
  const box = dialog('Export Acme Support');
  // the published versions arrive after the dialog opens
  await box.getByRole('radio').nth(2).waitFor({ timeout: 10_000 }).catch(() => {});
  check((await box.getByRole('radio').count()) === 3, `draft and two versions to choose from, not: ${await box.innerText()}`);
  let [download] = await Promise.all([page.waitForEvent('download'), box.getByRole('button', { name: 'Download' }).click()]);
  check(download.suggestedFilename() === 'acme-support-draft.json', download.suggestedFilename());
  const draft = JSON.parse(readFileSync(await download.path(), 'utf8'));
  check(draft.meta.id === 'acme-support', 'the file is the draft');
  await box.getByLabel(/Version 0\.1\.0/).check();
  [download] = await Promise.all([page.waitForEvent('download'), box.getByRole('button', { name: 'Download' }).click()]);
  check(download.suggestedFilename() === 'acme-support-0.1.0.json', download.suggestedFilename());
  check(JSON.parse(readFileSync(await download.path(), 'utf8')).meta.version === '0.1.0', 'the file is that version');
  await box.getByRole('button', { name: 'Done' }).click();
});

await step('save as template, then create a new agent from it in the Create dialog', async () => {
  await menuOf('Acme Support');
  await page.getByRole('menuitem', { name: /^Save as template/ }).click();
  const box = dialog('Save Acme Support as a template');
  await box.getByLabel('Template name').fill('Care desk');
  await box.getByRole('button', { name: 'Save as template' }).click();
  await box.getByText('“Care desk” is saved').waitFor();
  await box.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Create agent' }).click();
  const create = dialog('Create an agent');
  await create.getByRole('radio', { name: /Care desk/ }).click();
  await create.getByLabel('Agent name').fill('Care two');
  await create.getByRole('button', { name: 'Create agent' }).click();
  await page.waitForURL(/\/agents\/care-two\/setup/, { timeout: 20_000 });
  const made = await api('/bots/care-two/draft');
  const acme = await api('/bots/acme-support/draft');
  check(made.config.meta.id === 'care-two' && made.config.meta.name === 'Care two', 'the new agent keeps its own id and name');
  check(JSON.stringify(made.config.tools) === JSON.stringify(acme.config.tools), 'it has the template’s tools');
});

await step('a template file is imported in the Create dialog, and a template is removed after asking', async () => {
  await openList();
  await page.getByRole('button', { name: 'Create agent' }).click();
  const create = dialog('Create an agent');
  const file = { name: 'shared.template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'weave-agent-template', version: 1, name: 'Shared desk', description: 'From a colleague', config: { agents: { entry: 'a', items: [{ id: 'a', name: 'A' }] }, channels: [] } })) };
  await create.getByLabel('Import a template file').setInputFiles(file);
  await create.getByText('Imported “Shared desk”.').waitFor();
  check((await create.getByRole('radio', { name: /Shared desk/ }).getAttribute('aria-checked')) === 'true', 'the imported template is chosen');
  await create.getByLabel('Import a template file').setInputFiles({ ...file, buffer: Buffer.from('{"hello":"world"}') });
  await create.getByText(/doesn’t look like an agent configuration/).waitFor();
  await create.getByRole('button', { name: 'Remove the template Shared desk' }).click();
  await create.getByRole('group', { name: /Remove the template Shared desk/ }).getByRole('button', { name: 'Remove' }).click();
  check((await create.getByRole('radio', { name: /Shared desk/ }).count()) === 0, 'removed');
  check(/Kept in this browser/.test(await create.innerText()), 'says where templates are kept');
  await create.getByRole('button', { name: 'Cancel' }).click();
});

await step('remove from my list → restore', async () => {
  await openList('?sort=name');
  await menuOf('Bookings desk');
  await page.getByRole('menuitem', { name: /^Remove from my list/ }).click();
  const box = dialog(/Remove Bookings desk from your list/);
  check(/can’t be deleted from the server/.test(await box.innerText()), 'says nothing is deleted on the server');
  await box.getByRole('button', { name: 'Remove from my list' }).click();
  await page.waitForTimeout(300);
  check(!(await rowIds()).includes('bookings'), 'gone from the list');
  await openRemoved();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.waitForTimeout(300);
  check((await rowIds()).includes('bookings'), 'back in the list');
});

await step('delete from the removed list → bring them back', async () => {
  await menuOf('Bookings desk');
  await page.getByRole('menuitem', { name: /^Remove from my list/ }).click();
  await dialog(/Remove Bookings desk/).getByRole('button', { name: 'Remove from my list' }).click();
  await openRemoved();
  await page.getByRole('button', { name: 'Delete Bookings desk from this list' }).click();
  await page.getByRole('group', { name: /Delete Bookings desk from this list\?/ }).getByRole('button', { name: 'Delete' }).click();
  await page.getByText('1 deleted from this list.').waitFor();
  check(/Removed from your list \(0\)/.test(await page.locator('main').innerText()), 'nothing waiting');
  await page.getByRole('button', { name: 'Bring it back' }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.waitForTimeout(300);
  check((await rowIds()).includes('bookings'), 'back in the list');
  check((await api('/bots')).some((b) => b.id === 'bookings'), 'it never left the server');
});

// ---- the agent header's "More" menu (A1) ------------------------------------------------------------------------------
await step('the agent header keeps its buttons and adds a “More” menu with every action', async () => {
  await page.goto(`${base}/agents/acme-support/build`);
  const more = page.getByRole('button', { name: 'More actions for Acme Support', exact: true });
  await more.waitFor({ timeout: 20_000 });
  for (const name of [/^Save$/, /Preview prompt/, /^Publish$/]) check((await page.getByRole('button', { name }).count()) > 0, `header still has ${name}`);
  await more.click();
  const items = (await page.getByRole('menuitem').allInnerTexts()).map((t) => t.split('\n')[0]);
  for (const want of ['Discard edits and reload', 'Rename…', 'Export configuration…', 'Save as template…', 'Move to workspace…', 'Remove from my list…'])
    check(items.includes(want), `menu has ${want}: ${items.join(' | ')}`);
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'More actions for Acme Support'), 'Escape gives the keyboard back to the button');
});

await step('with unsaved edits, Rename waits; Discard edits and reload asks, then drops them', async () => {
  // an edit: a change queued from another page lands in the draft, unsaved
  await page.evaluate(() =>
    sessionStorage.setItem('weave_pending_change', JSON.stringify({ agentId: 'acme-support', note: 'A test edit.', edits: [{ op: 'add_style_rules', rules: ['Be brisk.'] }] })));
  await page.reload();
  await page.getByRole('button', { name: /^Save$/ }).and(page.locator(':enabled')).waitFor({ timeout: 20_000 });
  await closeToasts();
  await page.getByRole('button', { name: 'More actions for Acme Support', exact: true }).click();
  const rename = page.getByRole('menuitem', { name: /^Rename/ });
  check((await rename.getAttribute('aria-disabled')) === 'true', 'rename is off while there are unsaved edits');
  check(/Save or discard your edits first/.test(await rename.innerText()), 'and says why');
  await page.getByRole('menuitem', { name: /^Discard edits and reload/ }).click();
  await closeToasts();
  await dialog('Discard your edits and reload?').getByRole('button', { name: 'Discard edits' }).click();
  await page.waitForFunction(() => !/Unsaved/i.test(document.querySelector('header')?.innerText || ''), null, { timeout: 10_000 });
  check(!(await api('/bots/acme-support/draft')).config.persona.style_rules?.includes('Be brisk.'), 'nothing was saved');
});

await step('remove from my list in the header goes back to the Agents list', async () => {
  await closeToasts();
  await page.getByRole('button', { name: 'Dismiss notification' }).first().waitFor({ state: 'detached' }).catch(() => undefined);
  // by keyboard this time: open the menu, End goes to its last item, Enter chooses it
  await page.getByRole('button', { name: 'More actions for Acme Support', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('End');
  check(/^Remove from my list/.test(await page.evaluate(() => document.activeElement?.textContent || '')), 'End reaches the last item');
  await page.keyboard.press('Enter');
  await dialog(/Remove Acme Support/).getByRole('button', { name: 'Remove from my list' }).click();
  await page.waitForURL(/\/agents$/);
  await openRemoved();
  await page.getByRole('button', { name: 'Restore' }).click();
});

errors.splice(0, errors.length, ...errors.filter((e) => !KNOWN.test(e)));
await finish();
