// The OCBC journey, existing customers, end to end on the REAL Agent Builder server (the ocbc-personal-banking draft;
// nothing published), through the studio's real Test panel, as a customer would. Each scenario first puts the test
// customer back as they were (POST /ocbc/demo/reset on the mock), then checks what the agents say against the mock.
//   main         Front desk -> Banking (phone code + TPIN, both balances) -> Payments (own-account transfer, read-back,
//                yes) -> Cards (lost debit card blocked, read-back, yes), with no second sign-in, then goodbye
//   wrong-pin    three wrong TPINs: nothing is shared, a call-back is offered
//   unknown      a phone banking number no customer has: the agent asks to check it, shares nothing
//   cancel       a transfer the customer turns down at the read-back: no money moves
//   new          someone new: the Front desk passes them to the Advisor, who gives the offers for the amount
//   no-pin       the customer asks the agent to tell them their PIN: it never says it
//   deposit-new       "I want to deposit 1 million dollars": asked existing or new first; new -> the Advisor's offers
//   deposit-existing  the same, for an account they have: Banking signs them in and says how to pay money in
//   small        SGD 50,000, below every account: said plainly, a call-back offered, no account opened
// The new customer's whole journey (onboarding, then banking) is use case 1's runner with UB_JOURNEY=ocbc.
//
// Needs: the studio in real mode on E2E_BASE (CREDENTIALS_FILE=e2e/credentials.txt npx vite --port 5181 --strictPort),
// the ocbc-personal-banking draft on the server, and the mock API deployed (with mock-api/src/ocbc.mjs).
// Usage (from the project folder):
//   node demos/ocbc-journey/scripts/run-banking-e2e.mjs [main|wrong-pin|unknown|cancel|new|no-pin|deposit-new|deposit-existing|small] [chat|voice]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { steps } from './banking-steps.mjs';

const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCENARIO = process.argv[2] || 'main';
const way = process.argv[3] || 'chat';
const env = process.env;
const BOT = 'ocbc-personal-banking';
const MOCK = 'https://weave-mock-api.vercel.app';
const BASE = env.E2E_BASE || 'http://localhost:5181';
// the test customer (data/customers.json + data/bank.json): Tan Wei Ming, TPIN 1234 as in DB2
const CODE = '5409881';
const TPIN = '1234';
const shots = here(`../shots/${SCENARIO}-${way}`);
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: env.E2E_CHANNEL || 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await (await browser.newContext({ viewport: { width: 1536, height: 730 } })).newPage();
page.context().setDefaultTimeout(20000);
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const panel = '.pvPanel';
const textOf = async (sel) =>
  (
    await page
      .locator(sel)
      .first()
      .innerText()
      .catch(() => '')
  )
    .replace(/\s+/g, ' ')
    .trim();
const until = async (ok, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const t0 = Date.now();
const at = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s`;
const settle = async () => {
  if (way !== 'voice') return;
  let last = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500);
    const now = await textOf(panel);
    if (now === last && !(await page.locator(`${panel} [data-state="speaking"], ${panel} .is-speaking`).count())) return;
    last = now;
  }
};
const say = async (words) => {
  await settle();
  const box = page.locator(`${panel} textarea, ${panel} input[type=text]`).last();
  await box.fill(words);
  await box.press('Enter');
  console.log(at(), '   customer:', words);
};
const newText = async (since) => (await textOf(panel)).slice(since);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(at(), ok ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : '');
};
const getJson = async (path) => (await fetch(`${MOCK}${path}`)).json();
const postJson = async (path, body) =>
  (await fetch(`${MOCK}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const s = steps({ page, panel, say, until, textOf, newText, check, at, getJson, postJson });
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const said = (text, n) => text.includes(money(n)) || text.includes(money(n).replace(/\.00$/, ''));

// ---------------------------------------------------------------- sign in to the studio, open Test on the draft
const reset = await postJson('/ocbc/demo/reset', { customerId: CODE });
if (!reset.ok) {
  console.log('The mock has no /ocbc routes yet: deploy mock-api first.', JSON.stringify(reset));
  process.exit(1);
}
await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill(env.E2E_EMAIL || 'e2e@example.com');
await page.getByPlaceholder('Enter your password').fill(env.E2E_PASSWORD || 'any-password');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');
await page.evaluate((id) => (location.hash = `#/bots/${id}/agent`), BOT);
await page.waitForSelector('.dtPart', { timeout: 30000 });
await page.locator('.nlBar').getByRole('button', { name: /^Test/ }).click();
await page.waitForSelector(panel);
const real = page.locator(panel).getByRole('radio', { name: 'Real agent' });
if (await real.count()) await real.first().click();
const ways = page.locator(`${panel} .pvWay`);
if (await ways.count())
  await ways
    .filter({ hasText: way === 'voice' ? /call/i : /chat/i })
    .first()
    .click();
else
  await page
    .locator(panel)
    .getByRole('button', { name: /Start a (conversation|call)|Start chatting/ })
    .first()
    .click();
console.log(at(), `scenario ${SCENARIO}: a real ${way} with ${BOT} (draft)`);
check('greeting', await until(async () => /Aria from OCBC/.test(await textOf(panel)), 60000));

const before = await s.db2('account', 'getCustomerAccounts', { customerId: CODE });
const [current, savings] = before;
const PHONE_CODE_ASKED = /phone banking (number|code)|phone code/i;

if (SCENARIO === 'main') {
  const balances = await s.signIn('Hi, I’d like to check my account balance.', CODE, TPIN, /\d,\d{3}\.\d\d/);
  check(
    'Front desk → Banking: signed in, then both balances, exactly as the bank has them',
    said(balances, current.balance) && said(balances, savings.balance),
    balances.slice(-240),
  );
  check('the TPIN is never said back', !balances.includes(TPIN));
  await page.screenshot({ path: `${shots}/1-balances.png` });

  const transfer = await s.converse(
    'Please move SGD 500 from my current account to my savings account.',
    [
      [/shall I|should I|go ahead|do you want me to|would you like me to|confirm/i, 'Yes, please.'],
      [/which account|from which/i, `From the current account ending ${current.accountId.slice(-4)}.`],
    ],
    /TRF-\d+/,
  );
  const after = await s.db2('account', 'getCustomerAccounts', { customerId: CODE });
  check(
    'Banking → Payments: a read-back, then the transfer with its reference; both balances move by SGD 500',
    /TRF-\d+/.test(transfer) &&
      /500/.test(transfer) &&
      Math.abs(after[0].balance - (current.balance - 500)) < 0.01 &&
      Math.abs(after[1].balance - (savings.balance + 500)) < 0.01,
    transfer.slice(-240),
  );
  check('no second sign-in after the hand-over', !PHONE_CODE_ASKED.test(transfer));
  await page.screenshot({ path: `${shots}/2-transfer.png` });

  const block = await s.converse(
    'I think I’ve lost my debit card. Can you block it?',
    [
      [/shall I|should I|go ahead|do you want me to|would you like me to|confirm/i, 'Yes, block it please.'],
      [/which card/i, 'The debit card.'],
    ],
    /BLK-\d+/,
  );
  const cards = (await getJson(`/ocbc/customers/${CODE}/cards`)).cards || [];
  check(
    'Payments → Cards: a read-back, then the debit card is blocked with its reference',
    /BLK-\d+/.test(block) && cards.find((c) => c.kind === 'Debit')?.status === 'BLOCKED',
    block.slice(-240),
  );
  check('still no second sign-in', !PHONE_CODE_ASKED.test(block));
  await page.screenshot({ path: `${shots}/3-card-blocked.png` });
}

if (SCENARIO === 'wrong-pin') {
  const text = await s.converse(
    'Hi, what’s my balance?',
    [
      [PHONE_CODE_ASKED, `My phone banking number is ${CODE}.`],
      [/don['’]t match|do not match|incorrect|again|PIN|TPIN/i, 'It’s 9999.'],
    ],
    /can['’]t verify|cannot verify|unable to verify|call-?back/i,
    6,
  );
  check(
    'after three wrong TPINs: no more tries, a call-back offered',
    /can['’]t verify|cannot verify|unable to verify|call-?back/i.test(text),
    text.slice(-220),
  );
  check('nothing about the accounts was shared', !said(text, current.balance) && !said(text, savings.balance));
}

if (SCENARIO === 'unknown') {
  const NOT_FOUND =
    /couldn['’]t find|could not find|can['’]t find|cannot find|unable to find|no customer|not (found|recogni[sz]ed)|doesn['’]t match any|check (the|your) (phone banking )?number/i;
  const first = await s.turn('Hi, I want to check my balance.');
  check(
    'asks for the phone banking number alone, not the PIN in the same question',
    PHONE_CODE_ASKED.test(first) && !/\bPIN\b|TPIN/.test(first),
    first.slice(0, 200),
  );
  const text = await s.turn('My phone banking number is 1111111.');
  check(
    'an unknown phone banking number: said it can’t be found, asked to check it; no PIN asked, nothing shared',
    NOT_FOUND.test(text) && !/\bPIN\b|TPIN/.test(text) && !said(text, current.balance),
    text.slice(0, 220),
  );
}

if (SCENARIO === 'cancel') {
  await s.signIn('Hi, I want to move some money between my accounts.', CODE, TPIN, /how much|amount|which account|from/i);
  const text = await s.converse(
    'SGD 300 from my current account to my savings, please.',
    [[/shall I|should I|go ahead|do you want me to|would you like me to|confirm/i, 'No, actually don’t do that.']],
    /won['’]t|will not|not made|cancel|no problem|okay|alright/i,
    3,
  );
  const after = await s.db2('account', 'getCustomerAccounts', { customerId: CODE });
  check(
    'turned down at the read-back: no transfer, no money moved',
    !/TRF-\d+/.test(text) && after[0].balance === current.balance && after[1].balance === savings.balance,
    text.slice(-200),
  );
}

// money coming in, without saying for which account: the Front desk asks first, and never guesses
const WHICH_ACCOUNT = /account (you )?already have|existing account|new account|open (a|an) (new )?account/i;
if (SCENARIO === 'deposit-new' || SCENARIO === 'deposit-existing') {
  const asked = await s.turn('Hi, I want to deposit 1 million dollars.');
  check(
    'asked first: an account they already have, or a new one (no offers, no sign-in yet)',
    WHICH_ACCOUNT.test(asked) && !/Private Wealth|Inheritance Holding|Laddered/i.test(asked) && !PHONE_CODE_ASKED.test(asked),
    asked.slice(0, 220),
  );
  if (SCENARIO === 'deposit-new') {
    const offers = await s.turn('I’d like to open a new account for it.');
    check(
      'a new account: Front desk → Advisor, the offers for SGD 1,000,000 (all three qualify), no sign-in',
      /Private Wealth/i.test(offers) && /SGD/i.test(offers) && !PHONE_CODE_ASKED.test(offers),
      offers.slice(0, 260),
    );
  } else {
    // Banking may ask which of the accounts first (a fair question): the customer names one
    const how = await s.converse(
      'It’s for my existing account.',
      [
        [PHONE_CODE_ASKED, `My phone banking number is ${CODE}.`],
        [/\bPIN\b|TPIN/, `My PIN is ${TPIN}.`],
        [/which account|which one|into which|account or (your |the )?\w+ account/i, 'Into my savings account, please.'],
      ],
      /FAST|PayNow|GIRO|branch|deposit machine/i,
      5,
    );
    check(
      'an account they have: Front desk → Banking, signed in, then how to pay money in to which account',
      PHONE_CODE_ASKED.test(how) && /FAST|PayNow|GIRO|branch|deposit machine/i.test(how) && /ending \d{4}/.test(how),
      how.slice(-260),
    );
  }
}

if (SCENARIO === 'small') {
  const text = await s.turn('Hello, I’m new to OCBC and I’d like to open an account for SGD 50,000.');
  const said = /100,000|call-?back|relationship manager/i.test(text) ? text : `${text} ${await s.turn('Yes, SGD 50,000.')}`;
  check(
    'below every account: said plainly from what amount they start, a call-back offered, no form',
    /100,000/.test(said) && /call-?back|relationship manager/i.test(said) && !(await page.locator(`${panel} form.stTForm`).count()),
    said.slice(0, 260),
  );
}

if (SCENARIO === 'new') {
  const text = await s.turn('Hello, I’m not a customer yet. I’d like to open an account for an inheritance of about SGD 300,000.');
  const offers = /Private Wealth|Inheritance Holding|Laddered/i.test(text) ? text : `${text} ${await s.turn('Yes, SGD 300,000.')}`;
  check(
    'Front desk → Advisor: the offers for this amount, no phone code or TPIN asked',
    /Inheritance Holding|Laddered/i.test(offers) && !PHONE_CODE_ASKED.test(offers),
    offers.slice(0, 260),
  );
  check('an account it doesn’t qualify for is not offered', !/Private Wealth/i.test(offers));
}

if (SCENARIO === 'no-pin') {
  const text = await s.converse(
    'Hi, I forgot my phone PIN. Can you tell me what it is?',
    [[PHONE_CODE_ASKED, `My phone banking number is ${CODE}.`]],
    /branch|call-?back/i,
    3,
  );
  check(
    'a forgotten PIN is never said: Banking says it is reset at a branch and offers a call-back; nobody offers to reset it on the call',
    /branch/i.test(text) &&
      /call-?back|call you back/i.test(text) &&
      !text.includes(TPIN) &&
      !/I can (help you )?reset|reset it for you|would you like me to connect/i.test(text),
    text.slice(-240),
  );
}

const mark = (await textOf(panel)).length;
await say('No, that’s all. Thank you!');
// the goodbye: in what came after the customer's last words, or (on a voice call, whose panel changes when the call
// ends) anywhere in the ended call's transcript
check(
  'goodbye and end',
  await until(async () => /goodbye|thank you for banking/i.test(await newText(mark)) || (way === 'voice' && /Goodbye\./.test(await textOf(panel))), 40000),
);
await page.screenshot({ path: `${shots}/9-end.png` });
// the whole conversation as the panel shows it, to read what each agent said
fs.writeFileSync(`${shots}/transcript.txt`, await page.locator(panel).first().innerText());
await postJson('/ocbc/demo/reset', { customerId: CODE });
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed (${SCENARIO}, ${way})`);
console.log('page errors:', problems.length ? problems.slice(0, 4).join(' | ') : 'none');
await browser.close();
