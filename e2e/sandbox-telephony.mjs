// Telephony (Weave React's Telephony page, GAPS W33). Live: the real phone numbers, and the parts the Agent Builder API
// does not offer (test calls, dispatch rules, SIP trunks) say so with nothing made up. Sandbox: every part on sample data
// kept in this browser: simulated calls through the rules, dispatch rules, test numbers and trunks, each action.
//   E2E_SHOTS=<dir>   also saves light and dark screenshots, desktop and a 390 px phone, of every part
import path from 'node:path';
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('sandbox-telephony');

// The data source and theme are chosen per page load from this tab's session (set before a reload), so one browser can
// show Live, then Sandbox, in light and dark. Runs after the harness's own script, so it wins.
await context.addInitScript(() => {
  const source = sessionStorage.getItem('e2e_source');
  if (source === 'sandbox') localStorage.setItem('weave_data_source', 'sandbox');
  else localStorage.removeItem('weave_data_source');
  const theme = sessionStorage.getItem('e2e_theme');
  if (theme) localStorage.setItem('weave_theme', theme);
});
const use = async ({ source, theme }) => {
  await page.evaluate(
    ({ s, t }) => {
      if (s) sessionStorage.setItem('e2e_source', s);
      if (t) sessionStorage.setItem('e2e_theme', t);
    },
    { s: source, t: theme },
  );
};

const SHOTS = process.env.E2E_SHOTS;
const shot = async (name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(350); // dialogs and toasts settle
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };
// at a phone's width the page itself never scrolls sideways (wide tables scroll inside their box)
const fitsWidth = async (what) => {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  check(scroll <= width, `${what}: the page is ${scroll} px wide at ${width} px`);
};

const main = () => page.locator('main');
const tab = (name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const panel = () => page.locator('[role="tabpanel"]');
const dialog = (name) => page.getByRole('dialog', { name });
const table = (name) => page.getByRole('region', { name });
const rowsOf = (name) => table(name).locator('tbody tr[data-row]');
const open = async (route) => {
  await page.goto(`${base}${route}`);
  await main().waitFor();
};
const waitText = (text) => page.waitForFunction((source) => new RegExp(source).test(document.querySelector('main')?.innerText || ''), text.source, { timeout: 15_000 });
const search = () => page.getByRole('dialog', { name: 'Search Weave Studio' });

// ---- Live ----------------------------------------------------------------------------------------------------------

await step('Live: the sidebar links Telephony, which opens on the real phone numbers', async () => {
  await open('/');
  await page.locator('#studio-sidebar').getByRole('link', { name: 'Telephony' }).click();
  await page.locator('[data-number="+6563001000"]').waitFor({ timeout: 30_000 });
  check(new URL(page.url()).pathname === '/telephony', page.url());
  check((await tab('Phone numbers').getAttribute('aria-selected')) === 'true', 'the phone numbers part is open');
  const text = await main().innerText();
  check(!/Sandbox,|simulat|Main support line/i.test(text), 'nothing from Sandbox is shown');
  check(/aren’t offered by the Agent Builder API yet/.test(text), 'the page says what Live lacks');
});

await step('Live: test calls, dispatch rules and SIP trunks say the API does not offer them yet, with nothing made up', async () => {
  for (const [name, part, words] of [
    ['Test calls', 'calls', /Test calls through your routing aren’t offered yet/],
    ['Dispatch rules', 'dispatch', /Dispatch rules aren’t offered yet/],
    ['SIP trunks', 'trunks', /SIP trunks aren’t offered yet/],
  ]) {
    await tab(name).click();
    await page.getByTestId('telephony-not-offered').filter({ hasText: words }).waitFor();
    check(new URL(page.url()).pathname === `/telephony/${part}`, `${name} has its own address: ${page.url()}`);
    const text = await page.getByTestId('telephony-not-offered').innerText();
    check(words.test(text) && /try this in Sandbox/.test(text), text);
    check((await page.locator('table').count()) === 0 && (await page.getByTestId('sandbox-note').count()) === 0, `${name}: no rows, no sample`);
    check((await tab(name).innerText()).includes('Not yet'), `${name}: the tab is marked`);
  }
  await page.getByRole('button', { name: 'See the phone numbers' }).click();
  await page.locator('[data-number="+6563001000"]').waitFor();
});

await step('Live: the search finds Telephony, and no Sandbox records', async () => {
  await open('/');
  await page.keyboard.press('Control+k');
  await search().getByRole('combobox').fill('dispatch rules');
  await page.waitForTimeout(300);
  const first = await search().locator('[role="option"][aria-selected="true"] p').first().innerText();
  check(first === 'Telephony', `first result: ${first}`);
  await search().getByRole('combobox').fill('main support line');
  await page.waitForTimeout(500);
  check((await search().locator('[role="group"]').filter({ hasText: /^telephony/i }).count()) === 0, 'no Telephony records in Live');
  await search().getByRole('combobox').fill('telephony');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/telephony$/);
});

await step('Live: light and dark, desktop and a 390 px phone, with no sideways page scroll (screenshots with E2E_SHOTS)', async () => {
  for (const theme of ['light', 'dark']) {
    await use({ theme });
    for (const [size, viewport] of [['desktop', desktop], ['phone', phone]]) {
      await page.setViewportSize(viewport);
      await open('/telephony/numbers');
      await page.locator('[data-number="+6563001000"]').waitFor({ timeout: 30_000 });
      await shot(`live-numbers-${theme}-${size}`);
      await fitsWidth(`live numbers, ${size}`);
      await open('/telephony/dispatch');
      await page.getByTestId('telephony-not-offered').waitFor();
      await shot(`live-dispatch-${theme}-${size}`);
      await fitsWidth(`live dispatch, ${size}`);
    }
  }
  await page.setViewportSize(desktop);
  await use({ theme: 'light' });
});

// ---- Sandbox -------------------------------------------------------------------------------------------------------

await step('Sandbox: Telephony opens on Simulated calls, marked Sandbox, with the sample setup ready', async () => {
  await use({ source: 'sandbox' });
  await open('/telephony');
  await panel().waitFor();
  await waitText(/No simulated calls yet/);
  check((await tab('Simulated calls').getAttribute('aria-selected')) === 'true', 'Simulated calls is open');
  check(await page.locator('h1 + span', { hasText: 'Sandbox' }).isVisible(), 'the page is marked Sandbox');
  const note = await page.getByTestId('sandbox-note').innerText();
  check(/simulated in your browser/.test(note) && /No real call is placed/.test(note), note);
  check(/Your routing is set up/.test(await panel().innerText()), 'the sample rules make it ready');
  check((await tab('Simulated calls').innerText()).includes('Simulated'), 'the tab says simulated');
});

await step('Sandbox: a simulated call is refused with a bad caller number, then run through the rules stage by stage', async () => {
  await page.getByRole('button', { name: 'Simulate a call' }).first().click();
  const box = dialog('Simulate an inbound call');
  await box.waitFor();
  check(/would match “Main support line” and go to Acme Support/.test(await page.getByTestId('call-preview').innerText()), await page.getByTestId('call-preview').innerText());
  await box.getByLabel('Caller’s number').fill('abc');
  await box.getByRole('button', { name: 'Simulate call' }).click();
  check(/Enter a phone number/.test(await box.innerText()), 'the caller number is checked');
  await box.getByLabel('Caller’s number').fill('+1 415 555 0123');
  await box.getByRole('button', { name: 'Simulate call' }).click();
  const detail = page.getByTestId('call-detail');
  await detail.waitFor();
  const text = await detail.innerText();
  check(/Incoming call/.test(text) && /Matched “Main support line”/.test(text) && /Call ended/.test(text), text);
  check(/isn’t live in Production/.test(text), 'the sample agent is not in Production, and the call says so');
  check(/^Simulated call #/.test(await page.getByRole('dialog').locator('h2').first().innerText()), 'titled as simulated');
  await shot('sandbox-call-detail-light-desktop');
  await page.getByRole('button', { name: 'Done' }).click();
  await rowsOf('Calls').first().waitFor();
  check((await rowsOf('Calls').count()) === 1, 'one call listed');
  const stat = await page.locator('[data-stat="Simulated calls"]').innerText();
  check(/\b1\b/.test(stat), stat);
});

await step('Sandbox: the call form previews the rule a time would use (UK line on a Saturday goes to the after-hours rule)', async () => {
  await page.getByRole('button', { name: 'Simulate a call' }).first().click();
  const box = dialog('Simulate an inbound call');
  await box.getByLabel('Number called').selectOption({ label: '+44 20 7946 0321 (Bookings, UK)' });
  await box.getByLabel('When').selectOption('custom');
  await box.getByLabel('Date and time').fill('2026-11-07T11:00');
  check(/“After-hours desk” and go to Front Desk/.test(await page.getByTestId('call-preview').innerText()), await page.getByTestId('call-preview').innerText());
  await box.getByLabel('Date and time').fill('2026-11-04T11:00');
  check(/“After-hours desk”/.test(await page.getByTestId('call-preview').innerText()) === false, 'on a Wednesday at 11 the UK rule takes it');
  check(/“UK bookings” and go to Bookings/.test(await page.getByTestId('call-preview').innerText()), await page.getByTestId('call-preview').innerText());
  await box.getByRole('switch', { name: 'The caller asks for a person' }).click();
  await box.getByLabel('How busy is the agent?').selectOption('overloaded');
  await box.getByRole('button', { name: 'Simulate call' }).click();
  await page.getByTestId('call-detail').waitFor();
  check(/On hold/.test(await page.getByTestId('call-detail').innerText()), 'an overloaded agent keeps the caller on hold');
  await page.getByRole('button', { name: 'Done' }).click();
  // a call on 4 November is outside the past 24 hours (unless today is that day): widen the range to see it
  await page.getByLabel('Time range').selectOption('Past 90 days');
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Calls"] tbody tr[data-row]').length === 2);
});

await step('Sandbox: the calls table searches, chooses columns, and opens a call', async () => {
  await table('Calls').getByRole('button', { name: 'Search calls' }).click();
  await table('Calls').getByLabel('Search calls').fill('zzqx');
  await table('Calls').getByText('No matches for “zzqx”').waitFor();
  await table('Calls').getByRole('button', { name: 'Clear search' }).click();
  check((await rowsOf('Calls').count()) === 2, 'both calls back');
  await table('Calls').getByRole('button', { name: 'Choose columns' }).click();
  await table('Calls').getByRole('group', { name: 'Visible columns' }).getByLabel('To', { exact: true }).check();
  await table('Calls').locator('th', { hasText: /^To$/ }).waitFor();
  await page.keyboard.press('Escape');
  await rowsOf('Calls').first().click();
  await page.getByTestId('call-detail').waitFor();
  await page.keyboard.press('Escape');
  await page.getByTestId('call-detail').waitFor({ state: 'detached' });
});

await step('Sandbox: dispatch rules list the sample rules, their calls, and warn about agents not live', async () => {
  await tab('Dispatch rules').click();
  await rowsOf('Dispatch rules').first().waitFor();
  check(new URL(page.url()).pathname === '/telephony/dispatch', page.url());
  check((await rowsOf('Dispatch rules').count()) === 3, 'three sample rules');
  const main = rowsOf('Dispatch rules').filter({ hasText: 'Main support line' });
  check(/Acme Support/.test(await main.innerText()) && /\+1 415 555 0142/.test(await main.innerText()), await main.innerText());
  check(/rules send callers to an agent that isn’t live in Production/.test(await panel().innerText()), 'the warning');
  check(/Rules here are kept in this browser and route no real call/.test(await page.getByTestId('sandbox-note').innerText()), 'the Sandbox note');
});

await step('Sandbox: a dispatch rule is created, its form checked field by field', async () => {
  await page.getByRole('button', { name: 'Create dispatch rule' }).first().click();
  const box = dialog('Create a dispatch rule');
  await box.waitFor();
  await box.getByLabel('Maximum hold time (seconds)').fill('3');
  await box.getByRole('button', { name: 'Create rule' }).click();
  const text = await box.innerText();
  check(/Give the rule a name\./.test(text) && /Use 5 to 600 seconds\./.test(text), text);
  await box.getByLabel('Rule name').fill('main SUPPORT line');
  await box.getByRole('button', { name: 'Create rule' }).click();
  check(/A rule with this name already exists/.test(await box.innerText()), 'names are unique');
  await box.getByLabel('Rule name').fill('Weekend line');
  await box.getByLabel('Maximum hold time (seconds)').fill('60');
  await box.getByRole('button', { name: 'Business hours' }).click();
  await box.getByRole('button', { name: 'Mon', exact: true }).click();
  await box.getByLabel('Agent').selectOption('bookings');
  await box.getByLabel('If no one answers in time').selectOption('agent');
  await box.getByLabel('Send to').selectOption('');
  await box.getByRole('button', { name: 'Create rule' }).click();
  check(/Choose a different agent/.test(await box.innerText()), 'an overflow agent is needed');
  await box.getByLabel('Send to').selectOption('front-desk');
  await box.getByRole('button', { name: 'Create rule' }).click();
  await box.waitFor({ state: 'detached' });
  const row = rowsOf('Dispatch rules').filter({ hasText: 'Weekend line' });
  await row.waitFor();
  const words = await row.innerText();
  check(/Tue, Wed, Thu, Fri/.test(words) && /Send to Front Desk/.test(words) && /60 s/.test(words), words);
  check((await rowsOf('Dispatch rules').count()) === 4, 'four rules');
});

await step('Sandbox: a dispatch rule is edited, and deleted after asking', async () => {
  await page.getByRole('button', { name: 'Edit Weekend line' }).click();
  const box = dialog('Edit “Weekend line”');
  await box.getByLabel('Rule name').fill('Weekday line');
  await box.getByRole('button', { name: 'Save changes' }).click();
  await rowsOf('Dispatch rules').filter({ hasText: 'Weekday line' }).waitFor();
  await page.getByRole('button', { name: 'Delete Weekday line' }).click();
  const ask = dialog('Delete this dispatch rule?');
  check(/“Weekday line” is removed from this browser/.test(await ask.innerText()), 'says what it removes');
  await ask.getByRole('button', { name: 'Delete' }).click();
  await rowsOf('Dispatch rules').filter({ hasText: 'Weekday line' }).waitFor({ state: 'detached' });
  check((await rowsOf('Dispatch rules').count()) === 3, 'back to three');
});

await step('Sandbox: test numbers: one is got (area code checked), one released, and its rule left unassigned', async () => {
  await tab('Phone numbers').click();
  await rowsOf('Test numbers').first().waitFor();
  check((await rowsOf('Test numbers').count()) === 2, 'two sample numbers');
  await page.getByRole('button', { name: 'Get a number' }).click();
  const box = dialog('Get a test number');
  await box.getByLabel('Area code (optional)').fill('123');
  await box.getByRole('button', { name: 'Get number' }).click();
  check(/Use a 3-digit US area code/.test(await box.innerText()), 'the area code is checked');
  await box.getByLabel('Area code (optional)').fill('212');
  await box.getByLabel('Label (optional)').fill('Night line');
  await box.getByRole('button', { name: 'Get number' }).click();
  const added = rowsOf('Test numbers').filter({ hasText: 'Night line' });
  await added.waitFor();
  check(/\+1 212 555 01\d\d/.test(await added.innerText()) && /Not routed|After-hours desk/.test(await added.innerText()), await added.innerText());
  await page.getByRole('button', { name: 'Release +44 20 7946 0321' }).click();
  await dialog('Release this test number?').getByRole('button', { name: 'Release' }).click();
  await rowsOf('Test numbers').filter({ hasText: '+44 20 7946 0321' }).waitFor({ state: 'detached' });
  await tab('Dispatch rules').click();
  check(/Unassigned/.test(await rowsOf('Dispatch rules').filter({ hasText: 'UK bookings' }).innerText()), 'its rule is unassigned');
  await tab('Phone numbers').click();
});

await step('Sandbox: the numbers set up for an agent are the API part, answered by the Sandbox imitation', async () => {
  const section = page.locator('section[aria-labelledby="sandbox-api-numbers"]');
  await section.waitFor();
  check(/answered by an imitation kept in this browser/.test(await section.innerText()), 'says it is the imitation');
  await section.getByRole('button', { name: 'Add a number' }).waitFor();
});

await step('Sandbox: SIP trunks: listed by direction, created with the form checked, and deleted', async () => {
  await tab('SIP trunks').click();
  await rowsOf('Inbound trunks').first().waitFor();
  check((await rowsOf('Inbound trunks').count()) === 1 && (await rowsOf('Outbound trunks').count()) === 1, 'one of each');
  check(/Not connected/.test(await page.locator('[data-stat="SIP URI"]').innerText()), 'no SIP endpoint');
  await page.getByRole('button', { name: 'Create SIP trunk' }).click();
  const box = dialog('Create a SIP trunk');
  await box.getByRole('button', { name: 'Outbound' }).click();
  await box.getByLabel('Trunk name').fill('Night carrier');
  await box.getByRole('button', { name: 'Create trunk' }).click();
  const text = await box.innerText();
  check(/Add at least one number to call from/.test(text) && /Enter your carrier’s SIP address/.test(text), text);
  await box.getByLabel('Numbers to call from').fill('+1 212 555 0100, nope');
  await box.getByRole('button', { name: 'Create trunk' }).click();
  check(/“nope” isn’t a valid phone number/.test(await box.innerText()), 'each number is checked');
  await box.getByLabel('Numbers to call from').fill('+1 212 555 0100');
  await box.getByLabel('Carrier SIP address').fill('sip.night.example');
  await box.getByRole('button', { name: 'Create trunk' }).click();
  await rowsOf('Outbound trunks').filter({ hasText: 'Night carrier' }).waitFor();
  await page.getByRole('button', { name: 'Delete Sample carrier, inbound' }).click();
  await dialog('Delete this trunk?').getByRole('button', { name: 'Delete' }).click();
  await table('Inbound trunks').getByText('No inbound trunks').waitFor();
  await table('Inbound trunks').getByRole('button', { name: 'Create inbound trunk' }).waitFor();
});

await step('Sandbox: what was made is kept in this browser across a reload', async () => {
  await page.reload();
  await rowsOf('Outbound trunks').filter({ hasText: 'Night carrier' }).waitFor();
  await tab('Simulated calls').click();
  await page.getByLabel('Time range').selectOption('Past 90 days');
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Calls"] tbody tr[data-row]').length === 2);
});

await step('Sandbox: the search finds a dispatch rule and a test number, each opening its part', async () => {
  await open('/');
  await page.keyboard.press('Control+k');
  await search().getByRole('combobox').fill('main support line');
  const group = search().locator('[role="group"]').filter({ hasText: /^telephony/i });
  await group.waitFor({ timeout: 10_000 });
  await group.getByRole('option', { name: /Main support line/ }).click();
  await page.waitForURL(/\/telephony\/dispatch$/);
  await rowsOf('Dispatch rules').first().waitFor();
  await page.keyboard.press('Control+k');
  await search().getByRole('combobox').fill('night line');
  await search().getByRole('option', { name: /Sandbox test number, Night line/ }).click();
  await page.waitForURL(/\/telephony\/numbers$/);
});

await step('Sandbox: every part in light and dark, desktop and a 390 px phone, with no sideways page scroll (screenshots with E2E_SHOTS)', async () => {
  for (const theme of ['light', 'dark']) {
    await use({ theme });
    for (const [size, viewport] of [['desktop', desktop], ['phone', phone]]) {
      await page.setViewportSize(viewport);
      for (const part of ['calls', 'dispatch', 'numbers', 'trunks']) {
        await open(`/telephony/${part}`);
        await panel().locator('section, table').first().waitFor();
        if (part === 'calls') await page.getByLabel('Time range').selectOption('Past 90 days');
        await shot(`sandbox-${part}-${theme}-${size}`);
        await fitsWidth(`sandbox ${part}, ${size}`);
        if (part === 'calls') {
          await rowsOf('Calls').first().click();
          await page.getByTestId('call-detail').waitFor();
          await shot(`sandbox-call-detail-${theme}-${size}`);
          await page.keyboard.press('Escape');
          await page.getByTestId('call-detail').waitFor({ state: 'detached' });
        }
      }
      await open('/telephony/dispatch');
      await page.getByRole('button', { name: 'Create dispatch rule' }).first().click();
      await dialog('Create a dispatch rule').waitFor();
      await shot(`sandbox-rule-dialog-${theme}-${size}`);
      await fitsWidth(`the rule dialog, ${size}`);
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize(desktop);
  await use({ theme: 'light' });
});

await step('Sandbox: Start again puts the sample setup back and clears the simulated calls', async () => {
  await open('/telephony/trunks');
  await rowsOf('Outbound trunks').first().waitFor();
  await page.getByRole('button', { name: 'Start again' }).click();
  await dialog('Start Sandbox telephony again?').getByRole('button', { name: 'Start again' }).click();
  await rowsOf('Inbound trunks').first().waitFor();
  check((await rowsOf('Outbound trunks').filter({ hasText: 'Night carrier' }).count()) === 0, 'the made trunk is gone');
  await tab('Simulated calls').click();
  await waitText(/No simulated calls yet/);
});

await step('Live again: none of the Sandbox telephony shows', async () => {
  await use({ source: 'live' });
  await open('/telephony/dispatch');
  await page.getByTestId('telephony-not-offered').waitFor();
  const text = await main().innerText();
  check(!/Main support line|Sample carrier|simulat/i.test(text), 'no sample records or simulated wording in Live');
});

await finish();
