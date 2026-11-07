// Tetherfi Unbound use case 1, end to end on the REAL Agent Builder server (drafts; nothing published), through the
// studio's real Test panel. Works with ANY card: nothing about the card is assumed; each check follows what this card
// produced (accepted or refused, which name line, which hand-over reason) and checks that the steps agree.
//   1. unbound-onboarding: greeting → the inheritance deposit → offers → "let's see" → hand-over to onboarding → the
//      form → the card photo (a retake if asked) → the camera (Chrome plays a video of the card held up; a retake if
//      asked) → face check → what Aria says about the name → transfer to the human video banking desk (MX bridge).
//   2. the human agent's desktop (mock MX): picks the hand-over from the queue and completes it (plan, signed, the
//      name as confirmed on video).
//   3. unbound-case-desk: reads the hand-back, opens the TQD case, gives the next steps; TQD's outbox has the e-mail.
//
// Needs: the studio in real mode on E2E_BASE (CREDENTIALS_FILE=e2e/credentials.txt npx vite --port 5181 --strictPort),
// the two bots' drafts on the server, and the mock API deployed.
//
// Usage (from the project folder):
//   node demos/unbound/use-case-1/scripts/run-e2e.mjs [chat|voice]
// The card (pick one; default: the drawn SPECIMEN ID card from make-test-pictures.mjs):
//   UB_CARD=path/to/any-card.jpg   any card image: its photo and camera video are made for this run
//   UB_PICTURES=bank               the drawn fictional bank card (make-test-pictures.mjs bank)
// The customer (what is typed in the form; set the name to the card's to see "Everything matches"):
//   UB_FIRST_NAME, UB_LAST_NAME    default for the specimen card: Tan / Wei Ming (the planted "other way round" slip);
//                                  for any other card: Alex / Morgan
//   UB_ID_NUMBER, UB_DOB           the ID card number and date of birth typed (default S8512345D, 14/03/1985)
//   UB_FAILURE=deepfake | nomatch  the stand-in provider fails the face check (the identity-review path)
//   UB_CAMERA=path/to/video.mjpeg  another camera video (say, one where the card never shows: the take-a-picture path)
// On voice the panel shows only the latest caption: read what was said in the call record (Monitor › Calls).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const way = process.argv[2] || 'chat';
const env = process.env;
const FAILURE = /^(deepfake|nomatch)$/.test(env.UB_FAILURE || '') ? env.UB_FAILURE : '';
// the card: any image (made into a photo and a camera video now), the drawn bank card, or the specimen ID card
if (env.UB_CARD) execFileSync(process.execPath, [here('./make-test-pictures.mjs'), env.UB_CARD], { stdio: 'inherit' });
const PICTURES = env.UB_CARD ? 'custom' : env.UB_PICTURES === 'bank' ? 'bank' : '';
const assets = here(PICTURES ? `../test-pictures/${PICTURES}` : '../test-pictures');
const CARD_FILE = PICTURES ? fs.readdirSync(assets).find((f) => /^card\./.test(f)) : 'id-card.png';
if (!fs.existsSync(`${assets}/${CARD_FILE || 'none'}`) || !fs.existsSync(`${assets}/camera.mjpeg`)) {
  console.log(`No test pictures in ${assets}: run make-test-pictures.mjs first (or pass UB_CARD).`);
  process.exit(1);
}
// the customer
const FIRST = env.UB_FIRST_NAME || (PICTURES ? 'Alex' : 'Tan');
const LAST = env.UB_LAST_NAME || (PICTURES ? 'Morgan' : 'Wei Ming');
const ID_NUMBER = env.UB_ID_NUMBER || 'S8512345D';
const DOB = env.UB_DOB || '14/03/1985';
const MAIL_NAME = `${FIRST}.${LAST}`.toLowerCase().replace(/[^a-z.]+/g, '');
// UB_RUN: a tag of this run's own in the e-mail (name+r3@…), so the checks on the MX queue and the TQD outbox only see
// this run's customer, never one left there by an earlier run with the same name
const RUN_TAG = /^[a-z0-9]{1,12}$/i.test(env.UB_RUN || '') ? `+${env.UB_RUN.toLowerCase()}` : '';
const CUSTOMER_EMAIL = `${MAIL_NAME}${RUN_TAG}${FAILURE ? `+${FAILURE}` : ''}@example.com`;

const shots = here(`../shots/${way}`);
const BASE = env.E2E_BASE || 'http://localhost:5181';
fs.mkdirSync(shots, { recursive: true });
const MOCK = 'https://weave-mock-api.vercel.app';
const browser = await chromium.launch({
  channel: env.E2E_CHANNEL || 'chrome',
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${env.UB_CAMERA || `${assets}/camera.mjpeg`}`,
  ],
});
const context = await browser.newContext({ viewport: { width: 1536, height: 730 } });
context.setDefaultTimeout(20000);
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text().replace(/access_token=[^&\s']+/g, 'access_token=[hidden]'));
});
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
const until = async (check, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const t0 = Date.now();
const at = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s`;
// on voice, let the agent finish speaking first (typing while it speaks interrupts it, as a caller would)
const settle = async () => {
  if (way !== 'voice') return;
  let last = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500);
    const now = await textOf(panel);
    const speaking = await page.locator(`${panel} [data-state="speaking"], ${panel} .is-speaking`).count();
    if (now === last && !speaking) return;
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
// the panel's text is not append-only (cards update in place), so new lines are found by counting them
const countOf = (text, re) => (text.match(new RegExp(re.source, 'g')) || []).length;
const lastLine = (text, re) => {
  const at = [...text.matchAll(new RegExp(re.source, 'g'))].at(-1)?.index ?? -1;
  return at < 0
    ? ''
    : text
        .slice(at)
        .split(/(?<=\.)\s/)
        .slice(0, 2)
        .join(' ');
};
const PHOTO_RETAKE = /I can’t see a name|Part of the card|The card is too far away\. |The writing on the card|Glare is covering|The card is at too steep/;
const PHOTO_GIVE_UP = /still isn’t clear|still doesn’t show|No photo came through/;
const VIDEO_RETAKE =
  /I couldn’t see your whole face|I couldn’t see the card|The card was covering|The card was too far away to read|No picture came from the camera/;
const QUEUED = /next in the queue|colleagues are busy|Everything matches/;
// what Aria says after the checks, and the hand-over reason each one must go with (the first that matches wins)
const OUTCOMES = [
  { said: /needs to complete the identity check with you/, reason: 'identity_review', words: 'identity review (neutral line)' },
  { said: /still doesn’t show a name|still isn’t clear enough|No photo came through/, reason: 'check_incomplete', words: 'the card photo was not accepted' },
  { said: /colleague will finish the video check|camera didn’t come on/, reason: 'video_incomplete', words: 'the video was not accepted' },
  { said: /the other way round/, reason: 'name_order', words: 'names typed the other way round' },
  { said: /couldn’t see your name printed/, reason: 'name_unreadable', words: 'no readable name on the card' },
  { said: /the name in the form doesn’t match/, reason: 'name_mismatch', words: 'a different name' },
  { said: /in the form doesn’t match your ID card/, reason: 'details_mismatch', words: 'the ID number or date of birth differs' },
  { said: /Everything matches/, reason: 'ready_for_plan', words: 'everything matches' },
];
const cameraButton = async () => (await page.locator(panel).getByRole('button', { name: 'Turn on camera' }).count()) > 0;
const getJson = async (path) => (await fetch(`${MOCK}${path}`)).json();
const postJson = async (path, body) =>
  (await fetch(`${MOCK}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

const openTest = async (botId) => {
  await page.evaluate((id) => (location.hash = `#/bots/${id}/agent`), botId);
  await page.waitForSelector('.dtPart', { timeout: 30000 });
  await page.locator('.nlBar').getByRole('button', { name: /^Test/ }).click();
  await page.waitForSelector(panel);
  const real = page.locator(panel).getByRole('radio', { name: 'Real agent' });
  if (await real.count()) await real.first().click();
  const ways = page.locator(`${panel} .pvWay`);
  if (await ways.count()) {
    const pick = ways.filter({ hasText: way === 'voice' ? /call/i : /chat/i }).first();
    await pick.click();
  } else
    await page
      .locator(panel)
      .getByRole('button', { name: /Start a (conversation|call)|Start chatting/ })
      .first()
      .click();
};

console.log(
  `card: ${PICTURES ? `${assets}/${CARD_FILE}` : 'the specimen ID card'} | customer types: ${FIRST} / ${LAST}${FAILURE ? ` | face check fails: ${FAILURE}` : ''}`,
);
await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill(env.E2E_EMAIL || 'e2e@example.com');
await page.getByPlaceholder('Enter your password').fill(env.E2E_PASSWORD || 'any-password');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');
console.log(at(), 'signed in');

// ---------------------------------------------------------------- 1. AI agent 1: offers and onboarding
await openTest('unbound-onboarding');
console.log(at(), `started a real ${way} with unbound-onboarding (draft)`);
check('greeting', await until(async () => /Aria from Unbound Bank/.test(await textOf(panel)), 60000));
let mark = (await textOf(panel)).length;
await say(
  'Hi. I recently inherited about 500 million and I want to open an account to manage this sum separately. I am exploring the local banks to see who gives me good safety and value.',
);
let offered = await until(async () => /Private Wealth|Inheritance Holding|Laddered/i.test(await newText(mark)), 30000);
if (!offered && /currency|confirm|SGD/i.test(await newText(mark))) {
  console.log(at(), '   (the agent asked to confirm: answering, as a customer would)');
  await say('Yes, SGD 500 million.');
  offered = await until(async () => /Private Wealth|Inheritance Holding|Laddered/i.test(await newText(mark)), 45000);
}
await page.waitForTimeout(4000);
const offerText = await newText(mark);
check('offers from deposit_offers', offered, offerText.slice(0, 300));
check('asks to start onboarding (about 2 minutes)', /2 minutes|two minutes|open the account|start/i.test(offerText));
check('says deposit insurance only covers up to its limit', /insurance|limit/i.test(offerText));
check('mentions the proof of where the money comes from', /proof|probate|source/i.test(offerText));
await page.screenshot({ path: `${shots}/1-offers.png` });

mark = (await textOf(panel)).length;
await say('Oh really, only 2 minutes? OK, let’s see how this goes.');
const formShown = await until(async () => (await page.locator(`${panel} form.stTForm`).count()) > 0, 45000);
check('hand-over to onboarding, and the form opens', formShown, (await newText(mark)).slice(0, 160));
await page.screenshot({ path: `${shots}/2-form.png` });
let outcome = null;
let verified = false;
let selfCase = '';
if (formShown) {
  const form = page.locator(`${panel} form.stTForm`).first();
  const choose = async (label, value) => {
    const box = form.getByLabel(label);
    if ((await box.evaluate((e) => e.tagName)) === 'SELECT') await box.selectOption(value);
    else {
      await box.click();
      await page.getByRole('option', { name: value }).click();
    }
  };
  await form.getByLabel('First name').fill(FIRST);
  await form.getByLabel(/Last name/).fill(LAST);
  await form.getByLabel(/Date of birth/).fill(DOB);
  await choose('Nationality', 'Singaporean');
  await form.getByLabel('ID card number').fill(ID_NUMBER);
  await form.getByLabel('Email').fill(CUSTOMER_EMAIL);
  await form.getByLabel('Mobile number').fill('+65 9123 4567');
  await form.getByLabel('Residential address').fill('12 Example Garden Road, #08-12, Singapore 000123');
  await form.getByLabel('Occupation').fill('Architect');
  await choose(/Where does the money come from/, 'Inheritance');
  await choose('Country of tax residence', 'Singapore');
  await choose(/politically exposed person/, 'No');
  await form.getByLabel(/I agree/).check();
  await page.screenshot({ path: `${shots}/3-form-filled.png` });
  await form.getByRole('button', { name: 'Continue' }).click();
  console.log(at(), '   customer: sent the form');
  const photoCard = await until(async () => (await page.locator(`${panel} .pcCard input[type=file]`).count()) > 0, 45000);
  check('form accepted → card photo requested', photoCard, (await textOf(`${panel} .pcCard`)).slice(0, 120));
  let camCard = false;
  if (photoCard) {
    // up to two uploads: a refused photo is asked for again once, with the reason
    for (let attempt = 1; attempt <= 2; attempt++) {
      const start = await textOf(panel);
      // a retake is a new photo of the card (the panel refuses the same file twice, as a person would take another)
      const file = attempt === 1 ? `${assets}/${CARD_FILE}` : `${shots}/retake-${CARD_FILE}`;
      if (attempt > 1) fs.copyFileSync(`${assets}/${CARD_FILE}`, file);
      await page.locator(`${panel} .pcCard input[type=file]`).last().setInputFiles(file);
      console.log(at(), `   customer: uploaded ${CARD_FILE} (attempt ${attempt})`);
      await until(async () => {
        const now = await textOf(panel);
        return (
          (await cameraButton()) || countOf(now, PHOTO_RETAKE) > countOf(start, PHOTO_RETAKE) || countOf(now, PHOTO_GIVE_UP) > countOf(start, PHOTO_GIVE_UP)
        );
      }, 90000);
      await page.waitForTimeout(1500);
      const now = await textOf(panel);
      camCard = await cameraButton();
      const retake = countOf(now, PHOTO_RETAKE) > countOf(start, PHOTO_RETAKE) ? lastLine(now, PHOTO_RETAKE) : '';
      if (retake) console.log(at(), '   Aria asked for a retake:', retake);
      const again = !camCard && retake && (await until(async () => (await page.locator(`${panel} .pcCard input[type=file]`).count()) > 0, 20000));
      if (!again) break;
    }
    const afterPhoto = await textOf(panel);
    check(
      camCard ? 'card photo accepted → video check requested' : 'card photo refused, each time with its reason → a colleague takes over',
      camCard || countOf(afterPhoto, PHOTO_RETAKE) > 0,
      camCard ? afterPhoto.match(/Thank you, I have read your card[^.]*\./)?.[0] || '' : lastLine(afterPhoto, PHOTO_RETAKE),
    );
    await page.screenshot({ path: `${shots}/4-camera.png` });
    if (camCard) {
      // the camera: a get-ready countdown with a private preview, then shared (the agent takes its frames)
      const start = await textOf(panel);
      await page.locator(panel).getByRole('button', { name: 'Turn on camera' }).last().click();
      console.log(at(), '   customer: turned on the camera; a few seconds to get the face and the card in view');
      if (await until(async () => /Get ready/.test(await textOf('.pcStage')), 8000)) {
        check(
          'a get-ready countdown with a private preview comes first',
          await until(async () => (await page.locator('.pcStage .pcReady b').count()) === 1, 8000),
        );
        await page.screenshot({ path: `${shots}/4a-get-ready.png` });
      }
      if (await until(async () => /The agent is looking/.test(await textOf('.pcStage')), 15000)) await page.screenshot({ path: `${shots}/4b-camera-on.png` });
      await until(async () => {
        const now = await textOf(panel);
        return countOf(now, /take the picture instead/) > countOf(start, /take the picture instead/) || countOf(now, QUEUED) > countOf(start, QUEUED);
      }, 120000);
      await page.waitForTimeout(1500);
      // not recognised: the retake offers the video again or a picture, never a file; the customer takes a picture
      if (/take the picture instead/.test(await textOf(panel)) && !QUEUED.test(await textOf(panel))) {
        console.log(at(), '   Aria asked for a picture taken by the customer:', lastLine(await textOf(panel), VIDEO_RETAKE) || '(no frame)');
        const take = page.locator(`${panel} .pcCard`).getByRole('button', { name: 'Take a picture' });
        if (await until(async () => (await take.count()) > 0, 20000)) {
          const retakeCard = await textOf(`${panel} .pcCard`);
          check(
            'the retake offers the video again or a picture, never a file from the device',
            /Try again with video/.test(retakeCard) && !/Choose a photo|drop a photo/.test(retakeCard),
          );
          await take.last().click();
          const shutter = page.locator('.pcStage').getByRole('button', { name: 'Take picture' });
          await until(async () => (await shutter.count()) > 0 && (await shutter.isEnabled()), 15000);
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${shots}/4c-take-a-picture.png` });
          await shutter.click();
          console.log(at(), '   customer: took the picture');
          check('the customer’s own picture is sent', await until(async () => (await page.locator('.pcStage').count()) === 0, 20000));
        }
      }
    }
    await until(async () => QUEUED.test(await textOf(panel)), 120000);
    const all = await textOf(panel);
    outcome = OUTCOMES.find((o) => o.said.test(all)) || null;
    check('Aria says a clear outcome after the checks', !!outcome, outcome ? `${outcome.words}: ${lastLine(all, outcome.said)}` : '(no outcome line)');
    if (camCard && !FAILURE && outcome?.reason !== 'video_incomplete')
      check('video accepted and the face check passed (stand-in)', /face matches your ID photo/.test(all));
    if (FAILURE)
      check(
        `identity review (${FAILURE}): nothing about the face or the name is said`,
        outcome?.reason === 'identity_review' && !/face matches|other way round/.test(all),
      );
    if (outcome?.reason === 'ready_for_plan') {
      // verified: no hand-over; Aria offers the accounts the offers service gives for this amount (nothing typed into
      // the config), the customer chooses one in conversation, and signs it with the AI
      verified = true;
      const offerMark = all.lastIndexOf('Everything matches'); // what Aria says from the verdict on (the offer may already be in)
      const offersSaid = await until(async () => /Private Wealth|Inheritance Holding|Laddered/i.test(await newText(offerMark)), 60000);
      check(
        'verified: no transfer to a person; Aria offers the accounts for this amount',
        offersSaid && !/next in the queue/.test(all),
        (await newText(offerMark)).slice(0, 240),
      );
      await say('I would like the Private Wealth Account, please.');
      const planForm = page.locator(`${panel} form.stTForm`, { hasText: 'Sign to open your account' }).last();
      check('the chosen account’s signature form opens', await until(async () => (await planForm.count()) > 0, 60000));
      await page.screenshot({ path: `${shots}/5-choose-and-sign.png` });
      if (await planForm.count()) {
        await planForm.getByLabel(/I sign this application electronically/).check();
        await planForm.getByRole('button', { name: /Sign and open my account/ }).click();
        console.log(at(), '   customer: chose the Private Wealth Account and signed');
        await until(async () => /anything else/.test(await textOf(panel)), 60000);
        const doneText = await textOf(panel);
        selfCase = doneText.match(/case reference is (TQD-\d+)/)?.[1] || '';
        check(
          'the AI opens the account and the TQD case',
          /Your Private Wealth Account is open, account number ending \d{4}/.test(doneText) && !!selfCase,
          doneText.match(/Done\.[^.]*\.[^.]*\./)?.[0] || '',
        );
        check(
          'next steps: the relationship manager, the proof of the funds, login and card',
          /your relationship manager, will call you within one working day/.test(doneText) && /arrive by post/.test(doneText),
          doneText.match(/Next,[^.]*\./)?.[0] || '',
        );
        await page.screenshot({ path: `${shots}/6-account-open.png` });
      }
    } else {
      check(
        'transfer to the human video banking desk (MX)',
        /next in the queue/.test(all),
        all.match(/You’re next in the queue[^.]*\.|I’m sorry, all our[^.]*\./)?.[0] || '',
      );
      await page.screenshot({ path: `${shots}/5-handed-over.png` });
    }
  }
}

if (verified) {
  const queued = (await getJson('/mx/handovers?status=queued')).handovers || [];
  check('nothing was sent to the MX queue for this customer', !queued.some((h) => h.customer?.email === CUSTOMER_EMAIL));
  const mail = ((await getJson('/tqd/outbox')).emails || []).find((m) => m.case_id === selfCase);
  check('TQD outbox has the e-mail to the customer', !!mail && mail.to === CUSTOMER_EMAIL, mail ? `${mail.to} | ${mail.subject}` : '(not found)');
  if (mail) console.log('\n--- the e-mail ---\n' + mail.body + '\n------------------');
  mark = (await textOf(panel)).length;
  await say('No, that’s all. Thank you!');
  check('goodbye and end', await until(async () => /Goodbye|goodbye/.test(await newText(mark)), 40000));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; outcome: verified, finished by the AI (no hand-over)`);
  console.log('page errors:', problems.length ? problems.slice(0, 4).join(' | ') : 'none');
  await browser.close();
  process.exit(0);
}

// ---------------------------------------------------------------- 2. the human agent (mock MX desktop)
await page.waitForTimeout(2000);
const queue = await getJson('/mx/handovers?status=queued');
const ho = (queue.handovers || []).find((h) => h.customer?.email === CUSTOMER_EMAIL) || (queue.handovers || [])[0];
check(
  'MX queue has the hand-over, with the same reason Aria gave, and enhanced due diligence (the amount reached the bank)',
  !!ho && !!outcome && ho.reason === outcome.reason && ho.risk === 'enhanced_due_diligence',
  ho
    ? JSON.stringify({
        id: ho.handover_id,
        reason: ho.reason,
        expected: outcome?.reason,
        risk: ho.risk,
        customer: `${ho.customer.first_name} / ${ho.customer.last_name}`,
        checks: ho.checks,
      })
    : '(queue empty: maybe another Vercel instance)',
);
// the colleague confirms the name on video: the order corrected when it was typed the other way round
const confirmed = ho?.reason === 'name_order' ? { first_name: LAST, last_name: FIRST } : { first_name: FIRST, last_name: LAST };
if (ho) {
  const done = await postJson(`/mx/handovers/${ho.handover_id}/complete`, {
    plan_id: 'private_wealth',
    signed: true,
    ...confirmed,
    agent: 'Priya (video banking)',
    notes: `Finished on video after: ${ho.reason}.`,
  });
  check('human agent completes: identity confirmed, plan chosen and signed', done.status === 'returned_to_ai', JSON.stringify(done));
}

// ---------------------------------------------------------------- 3. AI agent 2: the case desk and TQD
await page
  .locator(panel)
  .getByRole('button', { name: /Close|End|Stop/ })
  .first()
  .click()
  .catch(() => {});
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(1500);
await openTest('unbound-case-desk');
console.log(at(), `started a real ${way} with unbound-case-desk (draft)`);
const welcomed = await until(async () => /Welcome back/.test(await textOf(panel)), 60000);
const caseLine = await until(async () => /case reference is TQD-|couldn’t create the case/.test(await textOf(panel)), 45000);
await until(async () => /anything else/.test(await textOf(panel)), 30000);
const deskText = await textOf(panel);
const back = await getJson('/mx/handbacks/latest');
check(
  'case desk welcomes the customer back by the confirmed name',
  welcomed && deskText.includes(`Welcome back, ${confirmed.first_name}.`),
  deskText.match(/Welcome back[^.]*\.[^.]*\./)?.[0] || '',
);
const caseId = deskText.match(/TQD-\d+/)?.[0];
check('TQD case created and e-mail sent', caseLine && !!caseId, deskText.match(/Done\.[^.]*\.[^.]*\./)?.[0] || '');
check(
  'next steps: the relationship manager, the proof of the funds, login and card',
  !!back.relationship_manager &&
    deskText.includes(`${back.relationship_manager}, your relationship manager`) &&
    (!back.proof_needed || deskText.includes(back.proof_needed)) &&
    /arrive by post/.test(deskText),
  deskText.match(/Next,[^:]*:[^.]*\./)?.[0] || '',
);
await page.screenshot({ path: `${shots}/6-case-desk.png` });
check(
  'hand-back came from MX (not the demo default)',
  back.source === 'mx' && back.handover_id === ho?.handover_id,
  `hand-back ${back.handover_id} (${back.source})`,
);
const outbox = await getJson('/tqd/outbox');
const mail = (outbox.emails || []).find((m) => m.case_id === caseId);
check(
  'TQD outbox has the e-mail to the customer',
  !!mail && mail.to === CUSTOMER_EMAIL,
  mail ? `${mail.to} | ${mail.subject}` : '(not in this instance’s outbox)',
);
if (mail) console.log('\n--- the e-mail ---\n' + mail.body + '\n------------------');
mark = (await textOf(panel)).length;
await say('No, that’s all. Thank you!');
const bye = await until(async () => /Goodbye|goodbye/.test(await newText(mark)), 40000);
check('goodbye and end', bye);

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; outcome: ${outcome?.words || '?'} (${ho?.reason || '?'})`);
console.log('page errors:', problems.length ? problems.slice(0, 4).join(' | ') : 'none');
await browser.close();
