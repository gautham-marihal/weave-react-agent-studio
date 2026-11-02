// Banking inside the agents: testing an agent wired to the banking gateway runs real banking conversations in its own
// Test stage. Live (first, before Sandbox is chosen; the harness sets no BANKING_GATEWAY_URL): a banking rehearsal on
// the mock bank comes first, labelled as test data wherever it shows, with the real agent one choice away; there is no
// Banking page. Sandbox: the conversation runs on the banking gateway in this browser (the
// gateway's own code on its mock bank): sign-in both ways (wrong secret, restart, lockout), account selection, every
// documented operation group, confirmations, the SMS phone, where each answer came from, the gateway timeline in the
// trace, the call kept on the Calls page, the test panel beside other pages, and voice through the browser's speech
// service (stubbed here: headless Chrome has no speech service) with the typed fallback when there is none.
//   E2E_LOOK=<dir>   also save light and dark screenshots
import path from 'node:path';
import { check, openBrowser, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('banking-agent');
page.setDefaultNavigationTimeout(90_000);
page.setDefaultTimeout(20_000);
const LOOK = process.env.E2E_LOOK;
const AGENT = 'acme-support';
const main = () => page.locator('main');
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ');

const JSON_FRAME = '[data-json-frame] [data-json-editor]';
async function stage(p, name) {
  await p.getByRole('navigation', { name: 'Agent stages' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
}
/** Wires the open agent's draft (in the editor) to the banking gateway, with web chat and web voice on. */
async function wireToGateway(p) {
  await stage(p, 'Build');
  await p.getByRole('navigation', { name: 'Build sections' }).getByRole('button', { name: 'JSON', exact: true }).click();
  await p.waitForFunction((frame) => (document.querySelector(frame)?.weaveJsonText?.() || '').length > 20, JSON_FRAME, { timeout: 60_000 });
  const config = JSON.parse(await p.evaluate((frame) => document.querySelector(frame).weaveJsonText(), JSON_FRAME));
  config.connections = { ...(config.connections || {}), banking_gateway: { type: 'http', base_url: 'https://banking-gateway.example.test' } };
  const channels = (config.channels || []).filter((c) => c.type !== 'web_chat' && c.type !== 'web_voice');
  config.channels = [...channels, { id: 'web-chat', type: 'web_chat', enabled: true }, { id: 'web-voice', type: 'web_voice', enabled: true }];
  const json = JSON.stringify(config, null, 2);
  await p.locator('[data-json-frame] .cm-content').focus();
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.insertText(json);
  await p.waitForFunction(([frame, wanted]) => document.querySelector(frame)?.weaveJsonText?.() === wanted, [JSON_FRAME, json], { timeout: 20_000 });
  await p.waitForTimeout(900);
}

// ---- the conversation (the transcript is "Conversation" in chat, "Live transcript" in voice)
const LIST = '[aria-label="Conversation"], [aria-label="Live transcript"]';
const convo = (p = page) => p.locator(LIST).first();
const device = (p = page) => p.locator('[data-customer-device]');
let seen = 0;
/** How many entries the transcript has: what comes after is new. */
const mark = async (p = page) => (seen = await p.evaluate((sel) => document.querySelector(sel)?.children.length ?? 0, LIST));
/** The text of the transcript's entries since the mark. */
const since = (p = page) => p.evaluate(([sel, from]) => [...(document.querySelector(sel)?.children ?? [])].slice(from).map((n) => n.textContent).join(' '), [LIST, seen]);
/** Sends a message and waits for a reply after it that matches `wanted`. */
async function say(words, wanted, p = page) {
  await mark(p);
  const box = p.getByLabel('Message', { exact: true });
  await box.fill(words);
  await box.press('Enter');
  if (wanted) await reply(wanted, p);
}
/** Waits until the transcript, since the mark, shows `wanted`. */
async function reply(wanted, p = page, timeout = 20_000) {
  await p.waitForFunction(
    ([sel, re, flags, from]) => new RegExp(re, flags).test([...(document.querySelector(sel)?.children ?? [])].slice(from).map((n) => n.textContent).join(' ')),
    [LIST, wanted.source, wanted.flags, seen],
    { timeout }
  );
}
/** Clicks a choice under the latest reply. */
async function pick(label, p = page) {
  const button = convo(p).getByRole('group', { name: 'Choose one' }).last().getByRole('button', { name: label }).first();
  await mark(p);
  await button.click();
}
async function keyIn(digits, p = page) {
  const field = device(p).getByLabel(/^Key in your/);
  const again = device(p).getByRole('button', { name: 'Open a new keypad' });
  await field.or(again).first().waitFor();
  if (!(await field.count())) await again.click();
  await field.waitFor();
  await field.fill(digits);
  await device(p).getByRole('button', { name: 'Submit', exact: true }).click();
}
async function shoot(name) {
  if (!LOOK) return;
  await page.screenshot({ path: path.join(LOOK, `${name}.png`), fullPage: false });
}

// ---- Live first: banking works on the mock bank, and says so

await step('Live: there is no Banking page or sidebar link; the address says no page', async () => {
  await page.goto(`${base}/`);
  await page.getByRole('navigation').first().waitFor();
  check(!(await page.getByRole('link', { name: 'Banking', exact: true }).count()), 'the sidebar still links to Banking');
  await page.goto(`${base}/banking`);
  await main().getByText(/not found/i).first().waitFor();
});

/** Answers the agent's follow-up questions (which account, how to deliver) until the latest replies show `goal`. */
async function until(goal, p = page) {
  for (let i = 0; i < 4; i += 1) {
    const latest = await since(p);
    if (goal.test(latest)) return;
    const group = convo(p).getByRole('group', { name: 'Choose one' }).last();
    if (/Which account would you like|Please choose one of these accounts/.test(latest)) await pick(/0101/, p);
    else if (/How would you like to receive it/.test(latest)) await pick(/Standard/, p);
    else if (await group.count()) await pick(/./, p);
    else break;
    await p.waitForFunction(([sel, from]) => (document.querySelector(sel)?.children.length ?? 0) >= from + 2, [LIST, seen]);
    await p.waitForTimeout(400);
  }
  await reply(goal, p);
}

const MOCK_SOURCE = 'Mock bank · banking gateway in this browser, test data only';

await step('Live: a banking draft’s Test stage opens on the real agent, and offers a banking rehearsal on the mock bank, labelled as test data', async () => {
  await page.goto(`${base}/agents/${AGENT}/build`);
  await wireToGateway(page);
  await stage(page, 'Test');
  await main().getByText('Talk to your draft').waitFor();
  const playedBy = main().getByLabel('Played by');
  await playedBy.waitFor();
  check((await playedBy.inputValue()) === 'agent', 'the agent itself comes first, never the rehearsal');
  check((await playedBy.locator('option').allInnerTexts()).join('|') === 'The real agent|Banking rehearsal (mock bank)', 'both choices are offered');
  await main().getByText('Real LiveKit').first().waitFor();
  await playedBy.selectOption('rehearsal');
  await main().getByText('Rehearsal · mock bank', { exact: true }).waitFor();
  const all = await text(main());
  check(all.includes(`on the mock bank: test data and test logins, never a real customer’s accounts (${MOCK_SOURCE})`), 'the start screen says it is the mock bank');
  await page.locator('[data-sandbox-note="banking"]').getByText(/A banking rehearsal on the mock bank/).waitFor();
  check(!/Sandbox/.test(all), `nothing on the page says Sandbox in Live: ${/.{0,60}Sandbox.{0,60}/.exec(all)?.[0]}`);
  await device().getByText('Customer’s device').first().waitFor();
  await device().locator('summary', { hasText: 'Test logins' }).click();
  await device().getByText('Phone Code user with three accounts').waitFor();
  await shoot('live-rehearsal-start-light');
});

await step('Live rehearsal: signs in on the secure keypad, reads a balance and confirms a request on the device, every answer from the mock bank', async () => {
  seen = 0;
  await main().getByRole('button', { name: /Start chat test/ }).click();
  await reply(/thank you for calling Acme Support. I'm your virtual banking assistant/);
  check(!/Weave Demo Bank/.test(await since()), 'the rehearsal greets as the agent, not a made-up bank');
  await device().getByText('Secure channel open').waitFor();
  check((await convo().getByText('Rehearsal', { exact: true }).count()) >= 1, 'the agent’s turns are tagged Rehearsal');
  await say('What is the USD exchange rate?', /Bank sells/);
  check((await since()).includes(`From: ${MOCK_SOURCE}`), 'the source line under the answer says mock bank');
  await say("What's my balance?", /verify your identity/);
  await pick(/Phone Code and PIN/);
  await reply(/7-digit Phone Code/);
  await say('1234567', /Phone PIN on the secure keypad/);
  await mark();
  await keyIn('135790');
  await reply(/you're verified/);
  await until(/Available/);
  await say('I need a new cheque book', /./);
  await until(/Shall I go ahead/);
  await device().locator('[data-confirmation]').getByRole('button', { name: 'Confirm' }).click();
  await reply(/Done\./, page, 30_000);
  const chip = page.getByRole('button', { name: /^Banking gateway\s*\d+/ });
  await chip.waitFor();
  check(Number(/\d+/.exec(await chip.innerText())?.[0]) > 5, 'the mock bank gateway’s timeline is in the trace');
  await shoot('live-rehearsal-signed-in-light');
});

await step('Live rehearsal: asking for a person is answered (a transfer says none really takes place; out of hours a call back is offered); ending it leaves the real agent one choice away', async () => {
  await say('Can I speak to a person?', /Service Manager|Commercial Service Centre/);
  const answer = await since();
  // the mock bank's service centre keeps office hours: in them the agent transfers, out of them it offers a call back
  if (/Would you like that\?/.test(answer)) await say('no thanks', /anything else/);
  else check(/no live transfer takes place/.test(answer), `a transfer says no live transfer takes place: ${answer}`);
  await main().getByRole('button', { name: 'End', exact: true }).click();
  await convo().getByText(/You ended the conversation/).waitFor();
  const playedBy = main().getByLabel('Played by');
  await playedBy.selectOption('agent');
  await main().getByText('Real LiveKit').first().waitFor();
  const notice = page.getByRole('note', { name: 'Banking' });
  await notice.getByText('The real agent can’t reach the mock bank here').waitFor();
  check(/choose “Banking rehearsal \(mock bank\)” under Played by/.test(await text(notice)), 'it says how to try the banking flow');
  await playedBy.selectOption('rehearsal');
  await main().getByText('Rehearsal · mock bank', { exact: true }).waitFor();
});

// ---- Sandbox from here on
await context.addInitScript(() => localStorage.setItem('weave_data_source', 'sandbox'));

await step('Sandbox: a draft not wired to the gateway keeps the simulated conversation', async () => {
  await page.goto(`${base}/agents/front-desk/test`);
  await main().getByText('Talk to your draft').waitFor();
  await main().getByText('Simulated · Sandbox').waitFor();
  check(!(await device().count()), 'a non-banking draft shows the customer’s device');
  await main().getByRole('button', { name: /Start chat test/ }).click();
  await convo().getByText('Simulated', { exact: true }).first().waitFor();
  await main().getByRole('button', { name: 'End', exact: true }).click();
});

await step('Sandbox: the banking draft’s Test stage offers a banking conversation, the customer’s device and the test logins', async () => {
  await page.goto(`${base}/agents/${AGENT}/build`);
  await wireToGateway(page);
  await stage(page, 'Test');
  await main().getByText('Sandbox · banking', { exact: true }).waitFor();
  check(/Starts a banking conversation in Sandbox.*banking gateway in this browser, mock bank systems/.test(await text(main())), 'the start screen says where answers come from');
  await page.locator('[data-sandbox-note="banking"]').waitFor();
  await device().getByText('Customer’s device').first().waitFor();
  await device().locator('summary', { hasText: 'Test logins' }).click();
  await device().getByText('Phone Code user with three accounts').waitFor();
  await shoot('sandbox-start-light');
});

await step('Sandbox chat: the agent greets first, on a gateway session, its turns labelled as simulated', async () => {
  seen = 0;
  await main().getByRole('button', { name: /Start chat test/ }).click();
  await reply(/thank you for calling Acme Support/);
  await device().getByText('Secure channel open').waitFor();
  check((await convo().getByText('Simulated', { exact: true }).count()) >= 1, 'agent turns are tagged Simulated');
});

await step('rates and branches before sign-in, each answer saying where it came from', async () => {
  await say('What is the USD exchange rate?', /Bank sells/);
  check(/From: Sandbox · banking gateway in this browser, mock bank systems/.test(await since()), 'the source line is under the answer');
  await say('prime rate please', /Prime lending rate/);
  await say('fixed deposit rates', /SGD fixed deposit rates/);
  await say('branches in the east', /Mock East Branch/);
});

await step('sign-in by Phone Code and PIN: method, Phone Code masked, wrong PIN, typed PIN refused, right PIN, then the pending balance after choosing an account', async () => {
  await say("What's my balance?", /verify your identity/);
  await pick(/Phone Code and PIN/);
  await reply(/7-digit Phone Code/);
  await say('1234567', /Phone PIN on the secure keypad/);
  check(/Phone Code •+4567/.test(await since()), 'the Phone Code is masked in the transcript');
  // a PIN typed into the conversation is refused and never shown
  await say('135790', /key in your Phone PIN on the secure keypad/);
  check(/Phone PIN typed: hidden/.test(await since()), 'the typed PIN shows as hidden');
  check(!(await text(convo())).includes('135790'), 'the PIN is in the transcript');
  await mark();
  await keyIn('000000');
  await reply(/attempt|not correct|incorrect|try again/i);
  await mark();
  await keyIn('135790');
  await reply(/you're verified/);
  await until(/Available/);
  await shoot('sandbox-signed-in-light');
});

await step('account selection on the customer’s device shows that account’s balance', async () => {
  await mark();
  await device().getByRole('radio').nth(2).check();
  await reply(/USD|EUR/);
});

await step('incoming funds and recent transactions', async () => {
  await say('any incoming funds on the first account?', /incoming|nothing/i);
  await say('show my recent transactions on the first account', /transaction|nothing/i);
});

await step('statement request: prepared, then confirmed on the customer’s device', async () => {
  await say('I need a statement for last month', /./);
  await until(/Shall I go ahead/);
  await device().locator('[data-confirmation]').getByRole('button', { name: 'Confirm' }).click();
  await reply(/Done\./, page, 30_000);
});

await step('cheques: deposited, issued status, a cheque book ordered with a typed yes, a stop cheque cancelled with a no', async () => {
  await say('Did my cheque clear? the first account', /cheque|nothing/i);
  await say('has cheque 100005 been presented on the first account', /cheque|100005/i);
  await say('I need a new cheque book', /./);
  await until(/Shall I go ahead/);
  await say('yes', /Done\./);
  await say('please stop cheque 100060 on the first account', /./);
  await until(/Shall I go ahead|cannot|not/);
  if (/Shall I go ahead/.test(await since())) await say('no', /cancelled that\. Nothing was sent/);
});

await step('appointments: book (service, branch, slot, how many, confirm), list, and cancel with a confirmation', async () => {
  await say('I would like to book an appointment', /What is the appointment for/);
  await pick('Foreign worker account opening');
  await reply(/Which branch would you like/);
  await pick(/Mock Central Branch/);
  await reply(/earliest available slots/);
  await pick(/./);
  await reply(/How many people/);
  await pick(/^2$/);
  await reply(/Shall I go ahead/);
  await say('yes', /Your appointment has been made/);
  await say('show my appointments', /one appointment: foreign worker account opening/);
  await say('cancel my appointment', /Which appointment would you like to cancel/);
  await pick(/./);
  await reply(/Shall I go ahead/);
  await say('yes', /Your appointment has been cancelled/);
});

await step('a call back, a transfer to a person, and a lost card', async () => {
  await say('please call me back', /call back|number/i);
  if (/Which number should/.test(await since())) await say('91234567', /call back/i);
  await say('Can I speak to a person?', /Service Manager|Commercial Service Centre/);
  if (/Would you like that\?/.test(await since())) await say('no thanks', /anything else/);
  await say('I lost my card', /priority request/);
});

await step('signing out, then sign-in by account number, NRIC and the SMS one-time password from the phone', async () => {
  await mark();
  await device().getByRole('button', { name: 'Sign out of banking' }).click();
  await reply(/signed out of banking/);
  await say('sign in please', /verify your identity/);
  await pick(/Account number, NRIC and OTP/);
  await reply(/12-digit business account number/);
  await say('500000000201', /NRIC/);
  check(/Account number •+0201/.test(await since()), 'the account number is masked');
  await mark();
  await keyIn('1234567');
  const phone = page.getByRole('region', { name: 'Mock phone' });
  await phone.locator('li').first().waitFor({ timeout: 15_000 });
  const otp = /\b(\d{6})\b/.exec(await phone.innerText())?.[1];
  check(otp, 'the phone shows the SMS one-time password');
  await keyIn(otp);
  await reply(/you're verified/);
  const all = await text(convo());
  check(!all.includes(otp), 'the OTP is in the transcript');
  check(!all.includes('1234567'), 'the NRIC digits are in the transcript');
  await shoot('sandbox-otp-light');
});

await step('the gateway’s timeline is in the trace', async () => {
  const chip = page.getByRole('button', { name: /^Banking gateway\s*\d+/ });
  await chip.waitFor();
  check(Number(/\d+/.exec(await chip.innerText())?.[0]) > 5, 'the trace has the gateway’s rows');
});

await step('ending keeps the conversation as a call with its tool calls', async () => {
  await main().getByRole('button', { name: 'End', exact: true }).click();
  await convo().getByText(/You ended the conversation/).waitFor();
  await page.goto(`${base}/calls`);
  const row = main().getByText('Test: banking chat (Sandbox)').first();
  await row.waitFor();
  await row.click();
  await main().getByRole('button', { name: /Open Transcript/ }).first().click();
  await main().getByText(/prepare_appointment_booking|get_balance/).first().waitFor();
});

await step('restart sign-in with another identifier keeps the failed attempts, and three wrong NRICs lock it', async () => {
  await page.goto(`${base}/agents/${AGENT}/build`);
  await wireToGateway(page);
  await stage(page, 'Test');
  seen = 0;
  await main().getByRole('button', { name: /Start chat test/ }).click();
  await reply(/thank you for calling/);
  await say('sign in', /verify your identity/);
  await pick(/Account number, NRIC and OTP/);
  await reply(/12-digit/);
  await say('500000000301', /NRIC/);
  await mark();
  await keyIn('0000000');
  await reply(/attempt|not|try again/i);
  await mark();
  await device().getByRole('button', { name: 'Use a different Phone Code or account' }).first().click();
  await say('500000000301', /NRIC/);
  await mark();
  await keyIn('0000001');
  await reply(/attempt|not|try again/i);
  await mark();
  await keyIn('0000002');
  await reply(/lock/i);
  await device().getByText(/lock/i).first().waitFor();
});

await step('the test panel beside another page holds the same banking conversation and shows the customer’s device', async () => {
  await stage(page, 'Build');
  await page.locator('button[aria-label^="Try it"]:not([disabled])').first().click();
  const panel = page.getByRole('complementary', { name: 'Test panel' });
  await panel.getByRole('button', { name: 'Customer’s device' }).click();
  await panel.locator('[data-customer-device]').waitFor();
  await panel.getByRole('button', { name: 'Conversation', exact: true }).click();
  await panel.locator(LIST).getByText(/lock/i).first().waitFor();
  if (LOOK) await page.screenshot({ path: path.join(LOOK, 'sandbox-dock-light.png') });
  await panel.getByRole('button', { name: 'Close the test panel' }).click();
});

const VOICE_STUB = () => {
  window.__spoken = [];
  window.__hear = null;
  class FakeRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.lang = 'en';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    }
    start() {
      window.__hear = (words) => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: words }], { isFinal: true, 0: { transcript: words } })] });
    }
    stop() {}
    abort() {}
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  const synth = {
    speak: (u) => {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend?.(), 30);
    },
    cancel: () => {},
    getVoices: () => [],
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  const media = navigator.mediaDevices || {};
  media.getUserMedia = async () => {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    return dest.stream;
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });
};

await step('Sandbox voice: the agent speaks its replies, hears the caller, labels spoken turns, and keeps the keypad on screen (speech service stubbed)', async () => {
  const { browser, context: vctx, page: vp } = await openBrowser();
  try {
    await vctx.addInitScript(() => localStorage.setItem('weave_data_source', 'sandbox'));
    await vctx.addInitScript(VOICE_STUB);
    vp.setDefaultTimeout(20_000);
    await vp.goto(`${base}/agents/${AGENT}/build`);
    await wireToGateway(vp);
    await stage(vp, 'Test');
    await vp.locator('main').getByRole('group', { name: 'Channel' }).getByRole('button', { name: 'Web voice' }).click();
    seen = 0;
    await vp.locator('main').getByRole('button', { name: /Start voice test/ }).click();
    await vp.getByText('Banking voice · your browser’s speech').waitFor();
    await vp.waitForFunction(() => window.__spoken.some((t) => /thank you for calling/.test(t)));
    await vp.waitForFunction(() => typeof window.__hear === 'function');
    const hear = async (words, wanted) => {
      await mark(vp);
      await vp.evaluate((w) => window.__hear(w), words);
      await reply(wanted, vp);
    };
    await hear('what is the euro exchange rate', /Bank sells/);
    await vp.waitForFunction(() => window.__spoken.some((t) => /EUR|euro|1 point/i.test(t)));
    check(/spoken/.test(await since(vp)), 'the caller’s turn is labelled spoken');
    await hear("what's my balance", /verify your identity/);
    await hear('phone code and pin', /Please enter your 7-digit Phone Code/);
    await hear('one two three four five six seven', /Phone PIN on the secure keypad/);
    await vp.locator('[data-customer-device]').getByLabel(/^Key in your/).waitFor();
    await vp.getByText('Authentication required').waitFor();
    // a spoken PIN is refused and shown as hidden
    await hear('one three five seven nine zero', /key in your Phone PIN on the secure keypad/);
    check(/hidden/.test(await since(vp)), 'the spoken PIN shows as hidden');
    check(!(await text(convo(vp))).includes('135790'), 'a spoken PIN is in the transcript');
    if (LOOK) await vp.screenshot({ path: path.join(LOOK, 'sandbox-voice-light.png') });
    await mark(vp);
    await keyIn('135790', vp);
    await reply(/you're verified/, vp);
  } finally {
    await browser.close();
  }
});

await step('Sandbox voice without speech support says so plainly, and the conversation is typed', async () => {
  const { browser, context: vctx, page: vp } = await openBrowser({ theme: LOOK ? 'dark' : 'light' });
  try {
    await vctx.addInitScript(() => localStorage.setItem('weave_data_source', 'sandbox'));
    await vctx.addInitScript(() => {
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    });
    vp.setDefaultTimeout(20_000);
    await vp.goto(`${base}/agents/${AGENT}/build`);
    await wireToGateway(vp);
    await stage(vp, 'Test');
    await vp.locator('main').getByRole('group', { name: 'Channel' }).getByRole('button', { name: 'Web voice' }).click();
    await vp.locator('main').getByText(/This browser has no speech recognition/).waitFor();
    seen = 0;
    await vp.locator('main').getByRole('button', { name: /Start chat test/ }).click();
    await reply(/no speech recognition, so you type/, vp);
    await reply(/thank you for calling/, vp);
    await say('prime rate', /Prime lending rate/, vp);
    if (LOOK) {
      // dark screenshots from this browser: the conversation with a keypad and a balance
      await say("What's my balance?", /verify your identity/, vp);
      await pick(/Phone Code and PIN/, vp);
      await say('1234567', /secure keypad/, vp);
      await vp.screenshot({ path: path.join(LOOK, 'sandbox-keypad-dark.png') });
      await mark(vp);
      await keyIn('135790', vp);
      await reply(/you're verified/, vp);
      await until(/Available/, vp);
      await vp.screenshot({ path: path.join(LOOK, 'sandbox-balance-dark.png') });
    }
  } finally {
    await browser.close();
  }
});

if (LOOK) {
  await step('screenshot of Live in dark', async () => {
    const { browser, page: vp } = await openBrowser({ theme: 'dark' });
    try {
      vp.setDefaultTimeout(20_000);
      await vp.goto(`${base}/agents/${AGENT}/build`);
      await wireToGateway(vp);
      await stage(vp, 'Test');
      await vp.getByLabel('Played by').selectOption('rehearsal');
      await vp.getByText('Rehearsal · mock bank', { exact: true }).waitFor();
      await vp.screenshot({ path: path.join(LOOK, 'live-rehearsal-start-dark.png') });
    } finally {
      await browser.close();
    }
  });
}

await finish();
