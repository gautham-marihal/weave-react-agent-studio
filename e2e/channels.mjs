// Channels in a real browser, on the demo (no backend): what a channel offers follows its kind (a phone line has a keypad and no form, a web chat the other way round),
// a kind nothing connects yet says so, a web chat that carries audio is called out, and the Test tab offers every web channel of the agent side by side.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/channels.mjs
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addInitScript(() => {
  if (sessionStorage.getItem('channels')) return;
  sessionStorage.setItem('channels', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
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
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/channels-${name}.png` });
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

// set-up: a phone line, a web chat, a web voice channel, a WhatsApp channel, and a "web chat" that also carries audio
await page.evaluate(() => {
  location.hash = '#/bots/acme-support/settings';
});
await page.waitForSelector('.nlWorkspace');
await page.locator('.nlPageActions button', { hasText: 'Edit as JSON' }).click();
const box = page.locator('.nlPage textarea').first();
await page.waitForFunction(() => (document.querySelector('.nlPage textarea')?.value || '').length > 20);
const config = JSON.parse(await box.inputValue());
const both = { input: ['audio'], output: ['audio'] };
config.channels = [
  { id: 'phone', type: 'sip_voice', enabled: true, entry: { dnis: '+15550100' }, modalities: both, capabilities: { dtmf: true } },
  { id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'w' }, modalities: { input: ['text'], output: ['text'] } },
  { id: 'web-voice', type: 'web_voice', enabled: true, entry: { widget_id: 'w2' }, modalities: both },
  { id: 'wa', type: 'whatsapp', enabled: true, modalities: { input: ['text'], output: ['text'] } },
  { id: 'odd-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'w3' }, modalities: { input: ['text', 'audio'], output: ['text'] } },
  {
    id: 'text-with-voice',
    type: 'sms',
    enabled: true,
    modalities: { input: ['text'], output: ['text'] },
    overrides: { conversation: { ivr_detection: true, noise_cancellation: true } },
  },
  { id: 'own', type: 'custom', enabled: true, modalities: { input: ['text'], output: ['text'] } },
];
await box.fill(JSON.stringify(config, null, 2));
await page.waitForTimeout(600);
await page
  .locator('.nlBar')
  .getByRole('button', { name: /^Save$/ })
  .click();
await page.waitForTimeout(900);

// ---- the channel screens: each channel opens in a panel of its own on the Channels page
await page.evaluate(() => {
  location.hash = '#/bots/acme-support/channels';
});
await page.waitForSelector('.nlSection');
const rows = page.locator('.nlSection', { hasText: 'All channels' }).locator('.nlRow');
check('every channel is a row', (await rows.count()) === 7, String(await rows.count()));
// the panel of the nth channel, open, with its technical details unfolded (its kind, route and what it carries are there); `done` puts its changes in
// (Done), else it is closed as it is
const open = async (n) => {
  await rows.nth(n).click();
  await page.waitForSelector('.nlDrawer .stChannel');
  const fold = page.locator('.nlDrawer .stChannelTech');
  if ((await fold.getAttribute('open')) === null) await fold.locator('> summary').click();
  return page.locator('.nlDrawer .stChannel');
};
const close = async ({ done = false } = {}) => {
  const footer = page.locator('.nlDrawer .nlDrawerFoot');
  // Cancel leaves the draft as it was; Done (or Close, while nothing changed) puts the panel's changes in
  await footer
    .getByRole('button', { name: done ? /^(Done|Close)$/ : 'Cancel', exact: !done })
    .last()
    .click();
  await page.waitForTimeout(300);
};
const caps = async (n) => {
  const channel = await open(n);
  const found = await channel.locator('[data-capability]').evaluateAll((els) => els.map((e) => e.getAttribute('data-capability')));
  await close();
  return found;
};
check('a phone line offers the keypad and a hand-over, and no form switch', JSON.stringify(await caps(0)) === JSON.stringify(['dtmf', 'human_transfer']));
check('a web chat offers a form and a hand-over, and no keypad', JSON.stringify(await caps(1)) === JSON.stringify(['human_transfer', 'forms']));
// what a channel carries is a section of its panel: read the choices
const carries = async (n) => {
  await open(n);
  const checks = page.locator('.nlDrawer .stFGroup[data-path$="modalities"] .stFChecks');
  const shown = [await checks.nth(0).locator('label').allInnerTexts(), await checks.nth(1).locator('label').allInnerTexts()];
  await close();
  return shown;
};
const phone = await carries(0);
check('a phone line can only carry audio in and out', phone[0].length === 1 && phone[1].length === 1, JSON.stringify(phone));
check('a web chat can carry audio, text, images and video in', (await carries(1))[0].length === 4);
let channel = await open(0);
check('the kind says what it is, in the server’s words', /A phone call carries audio only/.test(await channel.innerText()));
await close();
channel = await open(3);
check('WhatsApp says nothing connects it yet', /Nothing connects WhatsApp to the runtime yet/.test(await channel.innerText()));
check('WhatsApp is labelled in the kind list', /WhatsApp \(not available yet\)/.test(await channel.locator('select').first().innerText()));
await close();
let mislabelled = 0;
for (let n = 0; n < 7; n += 1) {
  channel = await open(n);
  const here = await channel.locator('[data-note=mislabelled]').count();
  if (n === 4) check('a web chat that carries audio is called out', here === 1);
  if (n === 1) check('a web chat with only text has no voice-only note', (await channel.locator('[data-note=voice-only]').count()) === 0);
  mislabelled += here;
  await close();
}
check('and the others are not', mislabelled === 1, String(mislabelled));
// a custom channel may have any entry field: all the known ones are offered
channel = await open(6);
const customText = await channel.innerText();
check(
  'a custom channel offers every entry field',
  ['Phone number', 'Widget id', 'Allowed websites', 'WhatsApp phone number id'].every((t) => customText.includes(t)),
  customText.slice(0, 200),
);
await close();
// a text channel that already holds voice-only settings says so, and one click removes them (and the Undo bar can bring them back)
channel = await open(5);
check(
  'a text channel holding voice-only settings names them',
  /do nothing here: .*noise reduction/.test(await channel.locator('[data-note=voice-only]').innerText()),
);
await channel.getByRole('button', { name: 'Remove them' }).click();
await page.waitForTimeout(400);
check('one click removes them', (await channel.locator('[data-note=voice-only]').count()) === 0);
await page.locator('.nlDrawer').getByRole('button', { name: /^Undo/ }).first().click();
await page.waitForTimeout(400);
check('Undo brings them back', (await channel.locator('[data-note=voice-only]').count()) === 1);
await channel.getByRole('button', { name: 'Remove them' }).click();
await page.waitForTimeout(300);
await shot('screens');
await close({ done: true });
channel = await open(4);
await channel.getByRole('button', { name: 'Make it a web voice channel' }).click();
await page.waitForTimeout(500);
check(
  'one click makes it a web voice channel',
  (await channel.locator('[data-note=mislabelled]').count()) === 0 && (await channel.locator('select').first().inputValue()) === 'web_voice',
);
await close({ done: true });

// ---- the Test tab offers every web channel, side by side
await page.evaluate(() => {
  location.hash = '#/bots/acme-support/test';
});
await page.waitForSelector('.stTest');
const group = page.locator('.stTChannels');
check(
  'the Test tab offers the web channels of the agent side by side',
  (await group.count()) === 1 && (await group.locator('button').count()) >= 2,
  await group.innerText().catch(() => ''),
);
check('a phone line and a channel that does not run are not offered', !/phone|WhatsApp/i.test(await group.innerText()));
await group.locator('button').nth(1).click();
check(
  'the choice is marked',
  (await group.locator('button.on').count()) === 1 && (await group.locator('button').nth(1).getAttribute('aria-pressed')) === 'true',
);
await shot('test');
check('no errors in the console', problems.length === 0, problems.slice(0, 2).join(' | '));
await browser.close();
console.log(failed ? `FAIL  ${failed} check${failed === 1 ? '' : 's'} failed` : 'PASS  all checks passed');
process.exitCode = failed ? 1 : 0;
