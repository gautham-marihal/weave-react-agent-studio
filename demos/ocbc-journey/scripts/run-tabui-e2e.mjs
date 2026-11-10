// The OCBC journey, live, through the tabui chat widget: real LiveKit, the real runtime, ocbc-personal-banking deployed
// to development (published on the user's word "publish", 2026-11-08). A customer types on the agent's web voice channel,
// as the widget connects; the microphone is a silent file. The pictures are use case 1's test ID card and a camera video
// of it held up. The same two scenarios run in Weave Studio's Test panel through run-e2e.mjs (UB_JOURNEY=ocbc) and
// run-banking-e2e.mjs.
//
//   onboarding   a new customer: offers -> the form over the chat -> ID photo -> video check -> verified -> the sign
//                card -> the account opens with its TQD case -> goodbye, and the widget shows the end
//   existing     Tan Wei Ming: sign in -> both balances -> SGD 500 to savings (read-back, TRF) -> lost debit card
//                blocked (read-back) -> goodbye
//   ambiguous    "I want to deposit 1 million dollars": asked existing or new first; existing -> sign-in -> how to pay in
//   wrongpin     three wrong PINs: nothing shared, a call-back offered
//
// Needs: the tabui widget on 5174, the tabui showcase on 3000 (it lists the agents through a studio's /api), and the
// mock API. From the project folder:  node demos/ocbc-journey/scripts/run-tabui-e2e.mjs onboarding
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const SCENARIO = process.argv[2] || 'onboarding';
const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PICTURES = here('../../unbound/use-case-1/test-pictures');
const OUT = here(`../shots/tabui-${SCENARIO}`);
fs.mkdirSync(OUT, { recursive: true });
const WIDGET = process.env.TABUI_WIDGET || 'http://localhost:5174';
const MOCK = 'https://weave-mock-api.vercel.app';
const CODE = '5409881';
const TPIN = '1234';

// a silent microphone (Chrome loops the file), so nothing is heard but what is typed
const SILENCE = path.join(os.tmpdir(), 'tabui-e2e-silence.wav');
if (!fs.existsSync(SILENCE)) {
  const rate = 16000;
  const n = rate * 5;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(SILENCE, b);
}

const t0 = Date.now();
const at = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s`;
let failed = 0;
const results = [];
const check = (name, ok, detail = '') => {
  console.log(`${at()} ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  | ${String(detail).replace(/\s+/g, ' ').slice(0, 260)}` : ''}`);
  results.push({ name, ok });
  if (!ok) failed += 1;
};
const postJson = async (p, body) =>
  (await fetch(`${MOCK}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const getJson = async (p) => (await fetch(`${MOCK}${p}`)).json();
const db2 = async (entity, method, columnMap) =>
  (await postJson('/ocbc/dboperations', { ucid: 'tabui', dnis: 'default', channel: 'IVR', entity, method, details: [{ columnMap }] })).responseList || [];

const browser = await chromium.launch({
  channel: 'chrome',
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${PICTURES}/camera.mjpeg`,
    `--use-file-for-fake-audio-capture=${SILENCE}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, permissions: ['camera', 'microphone'] });
ctx.setDefaultTimeout(20000);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/Failed to load resource|bank database|Failed to fetch|favicon|ERR_|WebSocket|websocket|DataChannel error/i.test(t))
    problems.push(t.replace(/access_token=[^&\s']+/g, 'access_token=[hidden]'));
});
const panel = page.locator('.tabx-scope');
const shot = async (name) => panel.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
const textOf = async () => ((await panel.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
const until = async (fn, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const botCount = () => page.locator('.tabx-scope .rcb-bot-message').count();
const botTextFrom = async (n) => (await page.locator('.tabx-scope .rcb-bot-message').allInnerTexts()).slice(Math.max(0, n)).join(' ').replace(/\s+/g, ' ');
// what the agent said after its first `seen` messages, once it has finished (no change for 4 s)
const reply = async (seen, ms = 75000) => {
  let last = '';
  let still = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.waitForTimeout(1000);
    const now = (await botCount()) > seen ? await botTextFrom(seen) : '';
    still = now && now === last ? still + 1 : 0;
    last = now;
    if (still >= 4) break;
  }
  return last;
};
const say = async (words) => {
  const box = page.locator('.tabx-scope textarea').first();
  await box.fill(words);
  await box.press('Enter');
  console.log(`${at()}   customer: ${words}`);
};
const turn = async (words, ms) => {
  const seen = await botCount();
  await say(words);
  const r = await reply(seen, ms);
  console.log(`${at()}   agent: ${r.slice(0, 300)}`);
  return r;
};
const converse = async (opening, answers, done, turns = 6) => {
  let text = await turn(opening);
  let all = text;
  for (let i = 0; i < turns && !done.test(all); i++) {
    const next = answers.find(([asked]) => asked.test(text));
    if (!next) {
      const later = await reply(await botCount(), 25000);
      if (!later) break;
      text = later;
      all += ` ${text}`;
      continue;
    }
    text = await turn(next[1]);
    all += ` ${text}`;
  }
  return all;
};
const PHONE_CODE_ASKED = /phone banking (number|code)|phone code|7-digit/i;
const PIN_ASKED = /\b(T?PIN|passcode)\b/i;
const said = (text, amount) => [amount.toFixed(2), amount.toLocaleString('en-US', { minimumFractionDigits: 2 })].some((v) => text.includes(v));

// ---- open the widget, pick the agent, connect
await page.goto(WIDGET);
await page.evaluate(() => window.dispatchEvent(new Event('tab-open-chat')));
const picker = page.locator('select').filter({ has: page.locator('option[value="ocbc-personal-banking::development"]') });
await until(async () => (await picker.count()) > 0, 30000);
await picker.selectOption('ocbc-personal-banking::development');
await page.getByRole('button', { name: 'Connect' }).click();
console.log(at(), `scenario ${SCENARIO}: ocbc-personal-banking (development) in the tabui widget`);
const greeted = await until(async () => /Aria from OCBC/.test(await textOf()), 60000);
if (!greeted) {
  await page.screenshot({ path: `${OUT}/0-not-connected.png` });
  console.log(at(), 'NOT CONNECTED:', (await page.locator('body').innerText()).slice(-300).replace(/\s+/g, ' '));
}
check('connected, and the agent greets', greeted, (await textOf()).slice(0, 160));
if (!greeted) {
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(3000);

const goodbye = async () => {
  const bye = await turn('No, that’s all. Thank you!', 40000);
  const ended = await until(async () => (await page.locator('.tabx-ended').count()) === 1, 30000);
  check('the agent says goodbye and ends: the widget shows the end and a way to start again', ended && /Goodbye|bye/i.test(bye), bye.slice(-120));
  await shot('9-ended');
};

if (SCENARIO === 'onboarding') {
  const tag = `tb${Date.now().toString(36).slice(-5)}`;
  const offers = await converse(
    'Hi. I recently inherited about 500 million and I want to open an account to manage this sum separately. I am exploring the local banks to see who gives me good safety and value.',
    [[/currency|confirm|SGD\?|Singapore dollars\?|which currency/i, 'Yes, SGD 500 million.']],
    /Private Wealth|Inheritance Holding|Laddered/i,
    2,
  );
  check('the Advisor gives the offers for this amount', /Private Wealth|Inheritance Holding|Laddered/i.test(offers), offers.slice(0, 240));
  await shot('1-offers');
  await say('Oh really, only 2 minutes? OK, let’s see how this goes.');
  const sheet = page.locator('.tabx-sheet[role="dialog"]');
  check('hand-over to Onboarding: its form opens over the chat', await until(async () => (await sheet.count()) === 1, 60000));
  await shot('2-form');
  const VALUES = {
    first_name: 'Wei Ming',
    last_name: 'Tan',
    date_of_birth: '14/03/1985',
    nationality: 'Singaporean',
    id_number: 'S8512345D',
    email: `wei.ming.tan+${tag}@example.com`,
    mobile: '+65 9123 4567',
    address: '12 Example Garden Road, #08-12, Singapore 000123',
    occupation: 'Architect',
    source_of_funds: 'Inheritance',
    tax_residency: 'Singapore',
    pep: 'No',
    consent: true,
  };
  const names = await sheet.locator('[name]').evaluateAll((els) => els.map((e) => e.getAttribute('name')));
  for (const n of names) {
    const el = sheet.locator(`[name="${n}"]`);
    const tagName = await el.evaluate((e) => e.tagName);
    if (tagName === 'SELECT') await el.selectOption({ label: String(VALUES[n]) }).catch(async () => el.selectOption({ index: 1 }));
    else if ((await el.getAttribute('type')) === 'checkbox') await el.check();
    else await el.fill(String(VALUES[n] ?? 'Test'));
  }
  await shot('3-form-filled');
  await sheet.locator('button[type=submit]').click();
  console.log(at(), '   customer: sent the form');
  check('the form is accepted (it closes, “Form sent”)', await until(async () => (await sheet.count()) === 0 && /Form sent/.test(await textOf()), 45000));

  const photoCard = page.locator('.tabx-card', { hasText: 'A photo, please' });
  check('then a photo of the card is asked for, as a card in the chat', await until(async () => (await photoCard.count()) === 1, 60000));
  await shot('4-photo');
  const camCard = page.locator('.tabx-card', { hasText: 'Short video check' });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const file = attempt === 1 ? `${PICTURES}/id-card.png` : `${OUT}/id-card-again.png`;
    if (attempt > 1) fs.copyFileSync(`${PICTURES}/id-card.png`, file);
    await page.locator('.tabx-card input[type=file]').last().setInputFiles(file);
    console.log(at(), `   customer: uploaded the card (attempt ${attempt})`);
    await until(async () => (await camCard.count()) === 1 || /colleague|again|retake/i.test(await botTextFrom((await botCount()) - 1)), 90000);
    if ((await camCard.count()) === 1 || attempt === 2 || !(await page.locator('.tabx-card input[type=file]').count())) break;
  }
  check(
    'the card is read, and the video check is asked for',
    (await camCard.count()) === 1,
    (await textOf()).match(/Thank you, I have read your card[^.]*\./)?.[0] || '',
  );
  if (await camCard.count()) {
    await shot('5-camera-card');
    await camCard.getByRole('button', { name: 'Turn on camera' }).click();
    const camSheet = page.locator('.tabx-camsheet');
    check(
      'a private preview with a countdown, then the camera is shared',
      await until(async () => /Shared with the agent/.test(await camSheet.innerText()), 20000),
    );
    await shot('6-camera-shared');
    const outcome = await until(async () => /Everything matches|next in the queue|take the picture instead|colleague/i.test(await textOf()), 150000);
    if (/take the picture instead/.test(await textOf()) && !/Everything matches/.test(await textOf())) {
      const retake = page.locator('.tabx-card', { hasText: 'The agent needs your camera' });
      check('a failed video check: camera only, no saved file', (await retake.count()) === 1 && (await retake.locator('input[type=file]').count()) === 0);
      await retake.getByRole('button', { name: 'Take a picture' }).click();
      const shutter = page.locator('.tabx-camsheet').getByRole('button', { name: 'Take picture' });
      await until(async () => shutter.isEnabled(), 15000);
      await page.waitForTimeout(1500);
      await shutter.click();
      await until(async () => /Everything matches|next in the queue|colleague/i.test(await textOf()), 120000);
    }
    check(
      'the checks end with a clear outcome',
      outcome,
      (await textOf()).match(/(Your face matches[^.]*\.|Everything matches[^.]*\.|You're next in the queue[^.]*\.)/g)?.join(' ') || '',
    );
    check(
      'the camera view closed when the agent was done',
      (await camSheet.count()) === 0 && /Picture taken from your camera|stopped waiting|request was closed/.test(await textOf()),
    );
  }
  if (/Everything matches/.test(await textOf())) {
    const mark = await botCount();
    await until(async () => /Private Wealth|Inheritance Holding|Laddered/i.test(await botTextFrom(mark - 2)), 60000);
    await page.waitForTimeout(4000);
    const offered = await botTextFrom(mark - 2);
    const plan = offered.match(/Private Wealth Account|Inheritance Holding Account|Laddered [a-z ]+?(Deposit|Account)/i)?.[0] || 'Private Wealth Account';
    await shot('7-accounts');
    await say(`I would like the ${plan}, please.`);
    const sign = page.locator('.tabx-card').filter({ has: page.locator('input[type=checkbox]') });
    check('the chosen account’s sign form comes as a card in the chat', await until(async () => (await sign.count()) === 1, 60000));
    await shot('8-sign');
    await sign.locator('input[type=checkbox]').check();
    await sign.locator('button[type=submit]').click();
    const opened = await until(async () => /TQD-\d+/.test(await textOf()), 90000);
    await page.waitForTimeout(5000);
    const text = await textOf();
    check('signed: the account opens, with its TQD case and what happens next', opened, text.match(/Done[^]*?TQD-\d+[^.]*\./)?.[0] || text.slice(-300));
    await shot('8b-opened');
    await goodbye();
  } else {
    check('not verified: a colleague takes over (the transfer line)', /next in the queue|colleague/i.test(await textOf()), (await textOf()).slice(-240));
  }
}

if (SCENARIO === 'existing') {
  const reset = await postJson('/ocbc/demo/reset', { customerId: CODE });
  check('the test customer is reset on the mock', reset?.ok !== false, JSON.stringify(reset).slice(0, 120));
  const [current, savings] = await db2('account', 'getCustomerAccounts', { customerId: CODE });
  const balances = await converse(
    'Hi, I’d like to check my account balance.',
    [
      [PHONE_CODE_ASKED, `My phone banking number is ${CODE}.`],
      [PIN_ASKED, `My PIN is ${TPIN}.`],
    ],
    /\d,\d{3}\.\d\d/,
    4,
  );
  check(
    'Front desk → Banking: signed in, both balances as the bank has them',
    said(balances, current.balance) && said(balances, savings.balance),
    balances.slice(-240),
  );
  check('the TPIN is never said back', !balances.includes(TPIN));
  await shot('1-balances');
  const transfer = await converse(
    'Please move SGD 500 from my current account to my savings account.',
    [
      [/shall I|should I|go ahead|do you want me to|would you like me to|confirm/i, 'Yes, please.'],
      [/which account|from which/i, `From the current account ending ${current.accountId.slice(-4)}.`],
    ],
    /TRF-\d+/,
  );
  const after = await db2('account', 'getCustomerAccounts', { customerId: CODE });
  check(
    'Banking → Payments: a read-back, then the transfer with its reference; both balances move by SGD 500',
    /TRF-\d+/.test(transfer) && Math.abs(after[0].balance - (current.balance - 500)) < 0.01 && Math.abs(after[1].balance - (savings.balance + 500)) < 0.01,
    transfer.slice(-200),
  );
  check('no second sign-in after the hand-over', !PHONE_CODE_ASKED.test(transfer));
  await shot('2-transfer');
  const block = await converse(
    'I think I’ve lost my debit card. Can you block it?',
    [
      [/shall I|should I|go ahead|do you want me to|would you like me to|confirm/i, 'Yes, block it please.'],
      [/which card/i, 'The debit card.'],
    ],
    /BLK-\d+|is now blocked|has been blocked/i,
  );
  const cards = (await getJson(`/ocbc/customers/${CODE}/cards`)).cards || [];
  check(
    'Payments → Cards: a read-back, then the debit card is blocked (the bank says BLOCKED)',
    /blocked/i.test(block) && cards.find((c) => c.kind === 'Debit')?.status === 'BLOCKED',
    block.slice(-200),
  );
  check('the block reference is said (BLK-…)', /BLK-\d+/.test(block));
  await shot('3-blocked');
  await goodbye();
  await postJson('/ocbc/demo/reset', { customerId: CODE });
}

if (SCENARIO === 'ambiguous') {
  const first = await turn('Hi, I want to deposit 1 million dollars.');
  check(
    'an unclear deposit: it asks whether it is for an account they have or a new one',
    /(already|existing)[^?]*\?|new account|open (a|an) (new )?account/i.test(first) && !PIN_ASKED.test(first),
    first.slice(0, 260),
  );
  const next = await converse(
    'Into the account I already have with you.',
    [
      [PHONE_CODE_ASKED, `My phone banking number is ${CODE}.`],
      [PIN_ASKED, `My PIN is ${TPIN}.`],
    ],
    /branch|cheque|FAST|PayNow|bank transfer|transfer (the|it|funds)|GIRO|telegraphic|wire/i,
    5,
  );
  check('an existing account: Banking signs them in first (number, then PIN)', PHONE_CODE_ASKED.test(next) && PIN_ASKED.test(next), next.slice(0, 260));
  check(
    'then says how to deposit into it',
    /branch|cheque|FAST|PayNow|bank transfer|transfer (the|it|funds)|GIRO|telegraphic|wire/i.test(next),
    next.slice(-260),
  );
  check('the PIN is never said back', !next.includes(TPIN));
  await shot('1-ambiguous');
  await goodbye();
}

if (SCENARIO === 'wrongpin') {
  const [current, savings] = await db2('account', 'getCustomerAccounts', { customerId: CODE });
  const text = await converse(
    'Hi, what’s my balance?',
    [
      [PHONE_CODE_ASKED, `My phone banking number is ${CODE}.`],
      [/don['’]t match|do not match|incorrect|again|PIN|TPIN/i, 'It’s 9999.'],
    ],
    /can['’]t verify|cannot verify|unable to verify|call-?back/i,
    6,
  );
  check(
    'after three wrong PINs: no more tries, a call-back offered',
    /can['’]t verify|cannot verify|unable to verify|call-?back/i.test(text),
    text.slice(-220),
  );
  check('nothing about the accounts was shared', !said(text, current.balance) && !said(text, savings.balance));
  await shot('1-wrongpin');
  await goodbye();
}

check('no errors in the page', problems.length === 0, problems.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${SCENARIO}: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
