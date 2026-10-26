// Phone numbers in a real browser, on the demo (no backend: the demo imitates the numbers API and nothing real is created). The Telephony page lists the numbers,
// checks a number as it is typed, sets one up, changes it and releases it, each after the person confirms it (FRONTEND_GUIDE 4, section 10.5). An agent's
// phone line asks for no number, trunk or routing rule (the platform sets them up), and its Deploy page lists its numbers with "Add a number".
//
//   npm run dev:demo      (in one terminal)
//   node e2e/numbers.mjs
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
  if (sessionStorage.getItem('numbers')) return;
  sessionStorage.setItem('numbers', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
});
const page = await context.newPage();
const problems = [];
const requests = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});
await page.route(
  (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
  (route) => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  },
);
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/numbers-${name}.png` });
};
// the studio asks in its own dialog; a browser dialog here would be a regression
const nativeDialogs = [];
page.on('dialog', (dialog) => {
  nativeDialogs.push(dialog.message());
  dialog.dismiss();
});

await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill('e2e@example.test');
await page.getByPlaceholder('Enter your password').fill('x12345678');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');
await page
  .getByRole('button', { name: /^\s*\S?\s*Telephony/ })
  .first()
  .click();
// its parts are tabs under the page's title; each has an address (#/telephony/numbers)
await page.getByRole('tab', { name: /Phone numbers/ }).click();
await page.waitForSelector('.telephonyPageHeader h2');
check('the part has its own address', (await page.evaluate(() => location.hash)) === '#/telephony/numbers');

check('the page says it is connected, not a preview', (await page.locator('.telephonyPreview.connected').count()) === 1);
check(
  'the numbers set up by hand are listed, read-only',
  (await page.locator('tbody tr', { hasText: '+6563001000' }).locator('.telephonyReadOnly').count()) === 1,
);
check('a number set up outside the builder says so', /Set up outside the builder/.test(await page.locator('tbody tr', { hasText: '+6563001000' }).innerText()));

// ---- add
await page
  .getByRole('button', { name: /Add a number/ })
  .first()
  .click();
const dialog = page.locator('[role=dialog]');
check('the dialog does not say it is saved in the browser only', !/Saved in this browser only/.test(await dialog.innerText()));
await dialog.getByLabel('Number', { exact: true }).fill('+6563001000');
await page.waitForSelector('[data-check="taken_external"]');
check(
  'a number used on the phone system says by what',
  /used by “singtel poc”, which this builder does not manage/.test(await dialog.locator('.telephonyCheck').innerText()),
);
check('the button still lets you try, but the form will not send it', (await dialog.locator('.telephonyCheck.bad').count()) === 1);
await dialog.getByRole('button', { name: 'Set up this number' }).click();
await page.waitForSelector('[role=dialog] [role=alert]');
check(
  'pressing the button on a number that cannot be used says why, and sends nothing',
  /used by “singtel poc”/.test(await dialog.locator('[role=alert]').innerText()),
);
await dialog.getByLabel('Number', { exact: true }).fill('+6599990000');
await page.waitForSelector('[data-check="free"]');
check('a free number says so', /This number is free/.test(await dialog.locator('.telephonyCheck').innerText()));
await page.waitForTimeout(600);
const environments = await dialog.getByLabel('Environment').locator('option').allInnerTexts();
check(
  'each environment says which version runs there now',
  environments.every((o) => /· (runs v|nothing deployed)/.test(o)),
  environments.join(' | '),
);
await pick(page, dialog.getByLabel('Environment'), 'development');
await dialog.locator('summary', { hasText: 'Advanced' }).click();
check(
  'recording is on by default and says it is a recording of callers',
  /recording of callers/.test(await dialog.innerText()) && (await dialog.getByLabel('Record the call audio').isChecked()),
);
await dialog.getByLabel('Longest call (minutes)').fill('30');
await shot('add');
await dialog.getByRole('button', { name: 'Set up this number' }).click();
const setUp = page.getByRole('alertdialog');
await setUp.waitFor();
check(
  'setting a number up asks first, says for whom and where, and that it is an administrator’s job',
  /Set up \+6599990000\?/.test(await setUp.innerText()) && /in Development/.test(await setUp.innerText()) && /administrator/.test(await setUp.innerText()),
);
await setUp.getByRole('button', { name: 'Set up the number' }).click();
await page.waitForSelector('.telephonyNotice.good');
check('it says what was set up and where', /\+6599990000 was set up for .* in Development/.test(await page.locator('.telephonyNotice.good').innerText()));
const row = page.locator('tbody tr', { hasText: '+6599990000' });
check('the new number is in the list', (await row.count()) === 1);
check('its status says it needs attention, with the reason', /Needs attention/.test(await row.innerText()) && /no phone channel/.test(await row.innerText()));
check(
  'until a call is logged it says the phone system must route the number',
  /No call to \+6599990000 has been logged yet/.test(await row.innerText()) && /must route \+6599990000 to the LiveKit SIP service/.test(await row.innerText()),
);
check('the trunk and rule are folded away, for support', (await row.locator('details.numberDetails:not([open])').count()) === 1);
check('its settings are in words', /calls are recorded · calls end after 30 minutes/.test(await row.innerText()));
await shot('list');

// ---- change
await row.getByRole('button', { name: 'Edit' }).click();
const edit = page.locator('[role=dialog]');
check('the number itself cannot be edited, only its settings', (await edit.getByLabel('Number', { exact: true }).count()) === 0);
await pick(page, edit.getByLabel('Environment'), 'staging');
await edit.locator('summary', { hasText: 'Advanced' }).click();
await edit.getByLabel('Filter background noise').check();
await edit.getByRole('button', { name: 'Save changes' }).click();
const change = page.getByRole('alertdialog');
await change.waitFor();
const changeText = await change.innerText();
check(
  'a change asks first and says it in sentences',
  /Move it to Staging/.test(changeText) && /Start filtering background noise\./.test(changeText),
  changeText,
);
await change.getByRole('button', { name: 'Save changes' }).click();
await page.waitForSelector('.telephonyNotice.good:has-text("was updated")');
const changed = page.locator('tbody tr', { hasText: '+6599990000' });
check('the change shows in the list', /Staging/.test(await changed.innerText()) && /noise filtering on/.test(await changed.innerText()));

// ---- release
await changed.getByRole('button', { name: 'Release' }).click();
const ask = page.getByRole('alertdialog');
await ask.waitFor();
const asked = await ask.innerText();
await ask.getByRole('button', { name: 'Release' }).click();
await page.waitForSelector('.telephonyNotice.good:has-text("was released")');
check('a release asks first, and says what it removes', /removes the trunk and dispatch rule/.test(asked), asked);
check('it asks in the studio’s dialog, not the browser’s', nativeDialogs.length === 0, nativeDialogs.join(' | '));
check('the number is gone from the list', (await page.locator('tbody tr', { hasText: '+6599990000' }).count()) === 0);
check('the numbers set up by hand are still there', (await page.locator('tbody tr', { hasText: '+6563001000' }).count()) === 1);

// ---- an agent: its phone line asks for no route, and its Deploy page lists its numbers
await page.evaluate(() => (location.hash = '#/bots/front-desk/channels'));
await page.waitForTimeout(1500);
await page.locator('.nlRow', { hasText: /phone/i }).first().click();
// how callers reach it is under the panel's technical details
await page.locator('.nlDrawer .stChannelTech > summary').click();
await page.waitForSelector('[data-route="platform"]');
check(
  'a phone line asks for no number, trunk or routing rule',
  (await page.locator('[data-route="platform"] input').count()) === 0 &&
    /Add one for this agent under Releases › Deploy/.test(await page.locator('[data-route="platform"]').innerText()),
);
await page.keyboard.press('Escape');
await page.evaluate(() => (location.hash = '#/bots/front-desk/deploy'));
await page.waitForSelector('.agentNumbers');
check(
  'its Deploy page lists its numbers, with a way to add one',
  (await page.locator('.agentNumbers').getByRole('button', { name: 'Add a number' }).count()) === 1,
);

check('nothing was sent to a server (the demo answers in the browser)', requests.length === 0, requests.join(', '));
check('no errors in the console', problems.length === 0, problems.slice(0, 2).join(' | '));
await browser.close();
console.log(failed ? `FAIL  ${failed} check${failed === 1 ? '' : 's'} failed` : 'PASS  all checks passed');
process.exitCode = failed ? 1 : 0;
