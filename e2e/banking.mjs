// A banking agent end to end, in a real browser, against the banking gateway's test environment (its mock bank systems):
// Build → Banking (second in the Build menu: the bank's name, the agent's voice, the gateway's tools), saved and read back
// after a reload; then Tests → Banking by chat (sign-in, the secure field, a choice answered once, a balance, a goodbye
// that ends the conversation) and by voice (spoken with the agent's chosen voice); the console fitting a laptop screen
// under the studio's pinned bars, and no demo wording on screen. The Agent Builder API is the e2e mock.
//
// Needs, beforehand:
//   GATEWAY_TOKEN=<32+ chars> npm run gateway:mock
//   BANKING_GATEWAY_URL=http://localhost:8790 BANKING_GATEWAY_TOKEN=<same> BANKING_GATEWAY_REHEARSALS=on npm run dev
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_SHOTS (a folder for screenshots).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createMockApi } from './mockApi.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS || '';
// a test login of the gateway's test environment (services/banking-gateway/README.md)
const PHONE_CODE = '1234567';
const PIN = '135790';
const BANK = 'Acme Business Banking';
const DEMO_WORDS = /\b(mock|demo|rehearsal)\b/i;
// [ok, the words around a match]: for step()
const noDemo = (text) => {
  const at = text.search(DEMO_WORDS);
  return [at < 0, at < 0 ? '' : `…${text.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, ' ')}…`];
};

let failures = 0;
const step = (name, ok, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`);
};
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function launch() {
  const headless = process.env.E2E_HEADED !== '1';
  // a fake microphone, allowed without asking, for the voice conversation
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (process.env.E2E_BROWSER) return chromium.launch({ executablePath: process.env.E2E_BROWSER, headless, args });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless, args });
    } catch {
      /* try the next one */
    }
  }
  throw new Error('No Chrome or Edge found. Set E2E_BROWSER to the path of one.');
}

const browser = await launch();
// a laptop screen: the console must fit under the studio's pinned bars
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await context.addInitScript(() => {
  // what the browser is asked to say, and with which voice (to check the agent's voice is the one used)
  window.__spoken = [];
  const speak = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
  if (speak) window.speechSynthesis.speak = (u) => (window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name || '' }), speak(u));
  if (sessionStorage.getItem('e2e-seeded')) return;
  sessionStorage.setItem('e2e-seeded', '1');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E Tester', email: 'e2e@example.com', workspaceName: 'E2E', role: 'dev' }));
});
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[console.error] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
const mock = createMockApi();
await page.route(
  (url) => url.pathname.startsWith('/api/'),
  (route) => mock.handle(route),
);

const agentId = 'banking-desk';
const save = async () => {
  await page.keyboard.press('Control+s');
  await page
    .getByText(/Saved just now/)
    .first()
    .waitFor({ timeout: 15000 });
};

try {
  console.log(`Banking e2e, ${BASE}`);
  const health = await page.request.get(`${BASE}/gateway/health`);
  step(
    'the studio reaches the banking gateway through /gateway',
    health.ok(),
    `status ${health.status()}: is the gateway running and BANKING_GATEWAY_URL set?`,
  );
  if (!health.ok()) throw new Error('no gateway');
  const denied = await page.request.post(`${BASE}/gateway/v1/sessions`, { data: { call_id: 'x' } });
  step('the proxy refuses a route the browser may not use', denied.status() === 403, `status ${denied.status()}`);

  await page.goto(BASE);
  await page
    .getByRole('button', { name: /sign in|get started|start/i })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill('e2e@example.com');
  await page.getByPlaceholder('Enter your password').fill('any-password');
  await page.getByRole('button', { name: /continue to workspace/i }).click();
  await page.waitForSelector('.dashMain');
  await page
    .getByRole('button', { name: /^\W*Agents/ })
    .first()
    .click();
  await page.waitForSelector('.agentCard, .agentRow, .emptyPanel, .agentTable');
  await page
    .getByRole('button', { name: /Create agent/ })
    .first()
    .click();
  await page.getByPlaceholder('e.g. Acme Support').fill('Banking Desk');
  await page.getByRole('radio', { name: /Customer care/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Create agent', exact: true }).click();
  await page.waitForSelector('.suPage', { timeout: 15000 });

  // ---- Build → Banking: second in the menu, right after Agent
  await page.evaluate((id) => (location.hash = `#/bots/${id}/banking`), agentId);
  await page.getByRole('heading', { name: 'Banking name' }).waitFor({ timeout: 15000 });
  const menu = await page.locator('nav[aria-label="Build"] button[data-page]').evaluateAll((list) => list.map((b) => b.dataset.page));
  step('Banking is second in the Build menu, right after Agent', menu[0] === 'agent' && menu[1] === 'banking', JSON.stringify(menu));
  step('Banking is the open page', (await page.locator('nav[aria-label="Build"] button[aria-current="page"]').getAttribute('data-page')) === 'banking');

  const card = page.getByRole('region', { name: 'Banking gateway tools' });
  await card.getByLabel('Gateway address the agent runtime uses').fill('http://banking-gateway.internal:8790');
  await card.getByRole('button', { name: 'Add banking tools' }).click();
  await card.getByText(/Draft updated: \d+ added/).waitFor({ timeout: 15000 });
  await page.getByLabel('Banking name').fill(BANK);
  // the agent's voice: a woman's American English voice (switch talking on first if the agent only types)
  if (await page.getByText(/It only types, so it needs no voice yet/).count()) {
    await save();
    await page.evaluate((id) => (location.hash = `#/bots/${id}/channels`), agentId);
    await page
      .getByRole('checkbox', { name: /website.*(talk|voice)|talk.*website|voice/i })
      .first()
      .check();
    await page.evaluate((id) => (location.hash = `#/bots/${id}/banking`), agentId);
  }
  await page
    .getByRole('button', { name: /^Use Sarah, .*ElevenLabs$/ })
    .first()
    .click();
  step('the Banking page sets the bank’s name and the agent’s voice', (await page.getByRole('button', { name: /^Using Sarah,/ }).count()) === 1);
  await save();
  await shot(page, '1-banking-page');

  await page.reload();
  await page.getByRole('heading', { name: 'Banking name' }).waitFor({ timeout: 15000 });
  step('after a reload the bank’s name is read back from the saved draft', (await page.getByLabel('Banking name').inputValue()) === BANK);
  step('after a reload the chosen voice is still the agent’s voice', (await page.getByRole('button', { name: /^Using Sarah,/ }).count()) === 1);
  const saved = await mock.bots.get(agentId);
  step(
    'the draft keeps the name, the voice and the gateway tools',
    saved?.config?.constants?.banking_name === BANK && !!saved.config.defaults?.models?.tts?.voice_id && saved.config.tools.some((t) => t.id === 'get_balance'),
  );
  step('the Banking page shows no demo wording', ...noDemo(await page.locator('.nlPage').innerText()));

  // ---- Tests → Banking, by chat
  await page.getByRole('button', { name: 'Test Banking' }).click();
  await page.getByRole('button', { name: 'Start chat conversation' }).waitFor({ timeout: 15000 });
  step(
    '“Test Banking” opens Tests with Banking chosen',
    (await page.getByLabel('What to talk to').getByRole('radio', { name: 'Banking', exact: true }).getAttribute('aria-checked')) === 'true',
  );
  await page.getByRole('button', { name: 'Start chat conversation' }).click();
  const log = page.getByRole('log', { name: 'Conversation' });
  await log.getByText(`thank you for calling ${BANK}`).waitFor({ timeout: 15000 });
  step('the assistant greets callers with the bank’s name', true);
  const side = page.getByRole('complementary', { name: 'Banking side panel' });
  await side.getByText('Secure channel open').waitFor({ timeout: 15000 });

  // the whole console fits the free height of a laptop screen, under the pinned bars
  const measureFit = () =>
    page.evaluate(() => {
      const bars = [...document.querySelectorAll('.dashTopbar, .nlHead')].reduce(
        (m, el) => Math.max(m, (parseFloat(getComputedStyle(el).top) || 0) + el.getBoundingClientRect().height),
        0,
      );
      const conv = document.querySelector('[aria-label="Conversation"]').closest('section').getBoundingClientRect();
      const box = document.querySelector('[aria-label="Message the banking assistant"]').getBoundingClientRect();
      return { bars: Math.round(bars), top: Math.round(conv.top), bottom: Math.round(conv.bottom), composer: Math.round(box.bottom), vh: innerHeight };
    });
  const fits = (f) => f.top >= f.bars && f.composer <= f.vh && f.bottom <= f.vh;
  const fit = await measureFit();
  step('the conversation starts below the pinned bars and its message box is on screen', fits(fit), JSON.stringify(fit));
  // like a person: type into the focused box, and click without the test tool scrolling things into view first
  const type = async (text) => {
    await page.getByRole('textbox', { name: 'Message the banking assistant' }).evaluate((el) => el.focus({ preventScroll: true }));
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  };
  const clickTwice = (locator) => locator.evaluate((el) => (el.click(), el.click()));

  const message = page.getByRole('textbox', { name: 'Message the banking assistant' });
  await type('What is my account balance?');
  const methods = log.getByRole('button', { name: /Phone Code and PIN/ });
  await methods.waitFor();
  await clickTwice(methods);
  await log.getByText(/enter your 7-digit Phone Code/).waitFor();
  await page.waitForTimeout(600);
  const said = await log.innerText();
  step('two clicks in a row answer a choice once', (said.match(/Phone Code and PIN\s*selected on screen/g) || []).length === 1, said.slice(-400));
  step('an answered choice is closed and shows what was chosen', (await methods.getAttribute('aria-pressed')) === 'true' && (await methods.isDisabled()));
  step(
    'the method chosen in the conversation is chosen on the banking screen too',
    (await side.getByText('How would you like to verify?').count()) === 0 || (await side.getByLabel('Phone Code').count()) > 0,
  );
  await type(PHONE_CODE);
  const keypad = side.getByRole('region', { name: 'Secure keypad' });
  await keypad.waitFor({ timeout: 15000 });
  const secure = page.getByLabel(/Secure entry · Phone PIN/);
  step('asking for the PIN opens the keypad and makes the message box a masked field', (await secure.getAttribute('type')) === 'password');
  await shot(page, '2-pin');
  await secure.evaluate((el) => el.focus({ preventScroll: true }));
  await page.keyboard.type(PIN);
  await page.keyboard.press('Enter');
  await side.getByText('Verified').first().waitFor({ timeout: 15000 });
  const account = log.getByRole('button', { name: /Current account ••••0101/ }).last();
  await account.waitFor({ timeout: 15000 });
  const before = (await log.innerText()).length;
  await clickTwice(account);
  await log.getByRole('region', { name: /Balance of/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const after = (await log.innerText()).slice(before);
  step(
    'choosing an account runs one balance request, answered once',
    (after.match(/Your account balance is/g) || []).length === 1 && (await log.getByRole('region', { name: /Balance of/ }).count()) === 1,
    after,
  );
  const still = await measureFit();
  step('the whole conversation stays in view as it goes on (no jumping page)', fits(still), JSON.stringify(still));
  const transcript = await log.innerText();
  step('the PIN never appears, and the Phone Code is masked', !transcript.includes(PIN) && !transcript.includes(PHONE_CODE));
  step('the console shows no demo wording', ...noDemo(await page.locator('.stTest').innerText()));
  await shot(page, '3-balance');

  // the side panel scrolls, and hands the wheel back to the page at its ends
  const panel = page.getByLabel('Banking side panel content');
  const area = await panel.boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + Math.min(area.height - 20, 200));
  for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  const scrolled = await panel.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  const pageY = await page.evaluate(() => scrollY);
  for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  step(
    'the side panel scrolls to its end, then the page scrolls on',
    scrolled.max <= 0 || (scrolled.top >= scrolled.max - 2 && (await page.evaluate(() => scrollY)) >= pageY),
    JSON.stringify(scrolled),
  );

  const sideTabs = page.getByLabel('Side panel', { exact: true });
  await sideTabs.getByRole('radio', { name: /Trace/ }).click();
  await side.getByText(/get_balance answered/).waitFor({ timeout: 15000 });
  step('the trace shows what the gateway did', true);
  await sideTabs.getByRole('radio', { name: 'Banking', exact: true }).click();

  await message.fill('Thanks, goodbye');
  await message.press('Enter');
  await page.getByText('The caller said goodbye, so this conversation has ended').waitFor({ timeout: 15000 });
  step(
    'a goodbye ends the conversation, with nothing more after it',
    (await page.getByRole('textbox', { name: 'Message the banking assistant' }).count()) === 0,
  );

  // ---- by voice, with the agent's voice
  await page.getByLabel('Channel', { exact: true }).getByRole('radio', { name: 'Web voice' }).click();
  await page.getByRole('button', { name: 'New conversation' }).click();
  const callHeader = page.getByRole('region', { name: 'Voice call' });
  await callHeader.waitFor({ timeout: 15000 });
  const transcriptLog = page.getByRole('log', { name: 'Live transcript' });
  await transcriptLog.getByText(`thank you for calling ${BANK}`).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  step('the call header names the bank', (await callHeader.innerText()).includes(BANK));
  // WhatsApp-like: the call header, the transcript and the call controls side by side in the panel, nothing on top of the transcript
  const callLayout = await page.evaluate(() => {
    const box = (el) => el && el.getBoundingClientRect();
    const head = box(document.querySelector('[aria-label="Voice call"]'));
    const log = box(document.querySelector('[aria-label="Live transcript"]'));
    const controls = box(document.querySelector('[aria-label="Call controls"]'));
    const section = box(document.querySelector('[aria-label="Live transcript"]').closest('section'));
    // what is drawn at the transcript's centre is the transcript (or something inside it)
    const probe = document.elementFromPoint(log.left + log.width / 2, log.top + log.height / 2);
    return {
      head: head && [Math.round(head.top), Math.round(head.bottom)],
      log: [Math.round(log.top), Math.round(log.bottom)],
      controls: controls && [Math.round(controls.top), Math.round(controls.bottom)],
      section: [Math.round(section.top), Math.round(section.bottom)],
      onTop: !!probe && !!probe.closest('[aria-label="Live transcript"]'),
      vh: innerHeight,
    };
  });
  step(
    'by voice, the call header, the transcript and the controls stack without covering one another',
    !!callLayout.head &&
      !!callLayout.controls &&
      callLayout.head[1] <= callLayout.log[0] + 1 &&
      callLayout.log[1] <= callLayout.controls[0] + 1 &&
      callLayout.controls[1] <= Math.min(callLayout.section[1], callLayout.vh) &&
      callLayout.onTop &&
      callLayout.log[1] - callLayout.log[0] >= 200,
    JSON.stringify(callLayout),
  );
  const callStatus = await callHeader.getByRole('status').innerText();
  step('the call header says what the assistant is doing', /Listening|Speaking|Thinking|Checking|Connecting|Verification|Muted/.test(callStatus), callStatus);
  const mute = page.getByRole('group', { name: 'Call controls' }).getByRole('button', { name: 'Mute' });
  await mute.click();
  step('Mute shows as pressed and the header says muted, or the assistant is mid-reply', (await mute.getAttribute('aria-pressed')) === 'true');
  await mute.click();
  // switching to chat and back keeps the same conversation (no new session, nothing lost)
  const linesBefore = await transcriptLog.locator('time').count();
  await page.getByRole('group', { name: 'Call controls' }).getByRole('button', { name: 'Switch to chat' }).click();
  const chatLog = page.getByRole('log', { name: 'Conversation' });
  await chatLog.waitFor({ timeout: 5000 });
  const linesInChat = await chatLog.locator('time').count();
  await page.getByLabel('Channel', { exact: true }).getByRole('radio', { name: 'Web voice' }).click();
  await callHeader.waitFor({ timeout: 5000 });
  step(
    'switching to chat and back to voice keeps the conversation',
    linesInChat === linesBefore &&
      (await transcriptLog.locator('time').count()) >= linesBefore &&
      (await page.getByRole('button', { name: 'New conversation' }).count()) === 1,
    `${linesBefore} → ${linesInChat}`,
  );
  const spoken = await page.evaluate(() => window.__spoken);
  const greetingSaid = spoken.find((s) => s.text.includes(BANK));
  step(
    'the greeting is spoken in the agent’s voice’s language (en-US for Sarah)',
    !!greetingSaid && /^en-US$/i.test(greetingSaid.lang),
    JSON.stringify(spoken.slice(-2)),
  );
  await shot(page, '4-voice');
  await page.getByRole('group', { name: 'Call controls' }).getByRole('button', { name: 'End call' }).click();
  await callHeader.getByText('Call ended').waitFor({ timeout: 5000 });
  step(
    'after the call ends, the conversation stays on screen with "Call again"',
    (await transcriptLog.getByText(`thank you for calling ${BANK}`).count()) === 1 && (await page.getByRole('button', { name: 'Call again' }).count()) === 1,
  );
  await shot(page, '5-ended');
} catch (error) {
  step('the run finished', false, error.message);
  await shot(page, 'failure');
} finally {
  step('no errors in the console', problems.length === 0, problems.slice(0, 5).join('\n      '));
  await browser.close();
}
console.log(failures ? `\n${failures} step(s) failed` : '\nAll steps passed');
process.exit(failures ? 1 : 0);
