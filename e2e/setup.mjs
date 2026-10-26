// The guided setup of the New layout in a real browser, on the demo (no backend): an agent is created and set up step by step (what it does, where people
// reach it, its language and voice, what it knows, what it can do), tried, and put live, and the draft is checked to hold what each step chose. Then: leaving
// half way and coming back opens the step where it was left; an agent that is already published is not offered the setup, and its "Getting it ready" steps
// open its own pages; a new agent has no calls until it is live. Nothing is written anywhere but the demo.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/setup.mjs
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
await context.addInitScript(() => {
  if (sessionStorage.getItem('setup')) return;
  sessionStorage.setItem('setup', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'Sam', email: 'sam@example.test', workspaceName: 'Clinic', role: 'Operations' }));
  localStorage.removeItem('weave_demo_state');
  Object.keys(localStorage)
    .filter((k) => k.startsWith('weave_setup_'))
    .forEach((k) => localStorage.removeItem(k));
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
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/setup-${name}.png`, fullPage: true });
};
const heading = () => page.locator('.suHead h1').innerText();
const next = async () => {
  await page.locator('.suFoot .primaryCta').click();
  await page.waitForTimeout(600);
};
const go = async (hash) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForTimeout(1500);
};

await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill('sam@example.test');
await page.getByPlaceholder('Enter your password').fill('a-demo-password');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');

// ---- an agent that is already published is not offered the setup
await go('#/bots/acme-support/home');
check('a published agent’s Overview does not offer the setup', (await page.locator('.suBanner').count()) === 0);
const next1 = page.locator('.nlSetup');
if (await next1.count()) {
  await next1.click();
  await page.waitForTimeout(1200);
  check(
    'its “Getting it ready” card opens the agent’s own page, not the setup',
    !/\/setup/.test(page.url()) && (await page.locator('.suPage').count()) === 0,
    page.url(),
  );
}

// ---- create: straight into the setup
await go('#/bots?new=1');
await page.locator('[role=dialog] input').first().fill('Smile Dental');
await page.locator('[role=dialog]').getByRole('button', { name: 'Create agent', exact: true }).click();
await page.waitForSelector('.suPage', { timeout: 15000 });
check(
  'creating an agent opens its setup at “What should it do?”',
  /#\/bots\/smile-dental\/setup/.test(page.url()) && /What should it do\?/.test(await heading()),
  page.url(),
);
check('the setup’s steps take the menu’s place', (await page.locator('.suSteps li').count()) === 8 && (await page.locator('.nlNav').count()) === 0);
check('the agent’s own top bar is out of the way', (await page.locator('.nlBar').count()) === 0);
await shot('1-purpose');

// what it does
await page
  .locator('.suField textarea')
  .fill(
    'You answer the phone and the website chat for Smile Dental. Help people book, move or cancel a check-up, answer questions about opening hours and prices, and pass anything urgent to the team straight away. Never give medical advice.',
  );
await page.locator('.suField', { hasText: 'The first thing it says' }).locator('input').fill('Hello, this is Smile Dental. How can I help you today?');
await next();

// leave half way, and come back
await page.getByRole('button', { name: 'Save and finish later' }).click();
await page.waitForTimeout(1500);
check('“Save and finish later” goes to the Overview', /#\/bots\/smile-dental\/home/.test(page.url()), page.url());
check(
  'the Overview offers to finish, naming the step',
  /You stopped at “Where people reach it”/.test(
    await page
      .locator('.suBanner')
      .innerText()
      .catch(() => ''),
  ),
);
check('a new agent has had no calls', /No calls in the last 7 days/.test(await page.locator('.ovSide').innerText()));
// a new agent already has a main language (the browser's): the next thing to do is publishing, which the setup does at its last step
const nextStep = await page.locator('.nlSetupNext').innerText();
await page.locator('.nlSetup').click();
await page.waitForSelector('.suPage');
const opened = await heading();
check(
  'the menu’s “Getting it ready” card opens the setup at the next thing to do',
  /\/setup/.test(page.url()) && /Publish/.test(nextStep) && /Put it live/.test(opened),
  `${nextStep} → ${page.url()} ${opened}`,
);
await go('#/bots/smile-dental/home');
await page
  .locator('.suBanner')
  .getByRole('button', { name: /Continue setup/ })
  .click();
await page.waitForSelector('.suPage');
check('“Continue setup” opens the step where it was left', (await heading()) === opened, await heading());
await page
  .locator('.suSteps')
  .getByRole('button', { name: /^Where people reach it/ })
  .click();
await page.waitForTimeout(600);

// where people reach it
check('website chat is on to start with', (await page.locator('.suChoice', { hasText: 'Chat on your website' }).getAttribute('aria-checked')) === 'true');
await page.locator('.suChoice', { hasText: 'Phone calls' }).click();
await page.waitForTimeout(300);
check(
  'phone calls switch on, with the recording notice offered',
  (await page.locator('.suChoice', { hasText: 'Phone calls' }).getAttribute('aria-checked')) === 'true' &&
    (await page.locator('.suField', { hasText: 'What callers hear first' }).count()) === 1,
);
await page.locator('.suChoice', { hasText: 'Chat on your website' }).click();
await page.locator('.suChoice', { hasText: 'Phone calls' }).click();
await page.waitForTimeout(300);
check('the last way of reaching it can’t be switched off', /at least one way/.test(await page.locator('.suBody').innerText()));
await page.locator('.suChoice', { hasText: 'Chat on your website' }).click();
await shot('2-reach');
await next();

// language and voice
check(
  'the language step comes with a voice, because it takes calls',
  /Which language, and which voice/.test(await heading()) && (await page.locator('#suVoice').count()) === 1,
);
await page.waitForTimeout(600);
const mainLanguage = await page
  .locator('.pkValueText strong')
  .first()
  .innerText()
  .catch(() => '');
check('the main language starts as the person’s own (the browser’s)', mainLanguage === 'English (United Kingdom)', mainLanguage);
const voiceLanguages = [...new Set(await page.locator('.pkVoices .pkVoiceText small:last-child').allInnerTexts())];
check(
  'the voices listed are the ones that speak it',
  voiceLanguages.length === 1 &&
    voiceLanguages[0] === 'English (United Kingdom)' &&
    (await page.getByLabel('Language of the voice').inputValue()) === 'English (United Kingdom)',
  voiceLanguages.join(' | '),
);
await page.locator('.suBlock', { hasText: 'Voice' }).getByRole('button', { name: /^Use / }).first().click();
await page.waitForTimeout(400);
await shot('3-voice');
await next();
check('the language step is done', (await page.locator('.suStep', { hasText: 'Language and voice' }).getAttribute('class')).includes('done'));

// what it knows
check('what it knows is optional', /What should it know/.test(await heading()) && /optional/.test(await page.locator('.suEyebrow').innerText()));
await page.locator('.suDrop input[type=file]').setInputFiles({
  name: 'clinic-faq.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from('# Smile Dental\n\nWe are open 8am to 6pm, Monday to Saturday. A check-up costs $60.'),
});
await page.waitForTimeout(800);
await page.locator('.suInline input').fill('www.smiledental.example/prices');
await page.getByRole('button', { name: 'Add the page' }).click();
await page.waitForTimeout(300);
const known = await page.locator('.suList').innerText();
check('a document and a web page are listed', /clinic-faq\.md/.test(known) && /smiledental\.example\/prices/.test(known));
await next();

// what it can do
check('what it can do', /What can it do for people/.test(await heading()));
const action = (label) => page.locator('.suAction', { hasText: label });
const switchOn = async (label) => {
  const sw = action(label).getByRole('switch');
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  await page.waitForTimeout(200);
};
check(
  'the starter’s own actions are already on',
  (await action('End the conversation').getByRole('switch').getAttribute('aria-checked')) === 'true' &&
    (await action('Pass people to a person').getByRole('switch').getAttribute('aria-checked')) === 'true',
);
await switchOn('Pass people to a person');
await action('Pass people to a person').locator('input').fill('+6561234567');
await switchOn('Take people’s contact details');
await action('Take people’s contact details').getByLabel('Email').click();
await switchOn('Look something up');
const lookup = action('Look something up');
await lookup
  .locator('.suField', { hasText: 'The web address it asks' })
  .locator('input')
  .fill('https://booking.smiledental.example/appointments/{booking reference}');
await lookup.locator('.suField', { hasText: 'What it finds' }).locator('input').fill('a booking');
await lookup.locator('.suField', { hasText: 'What it needs' }).locator('input').fill('booking reference');
await lookup.getByRole('button', { name: /Switch it on|Save/ }).click();
await page.waitForTimeout(300);
check('all four actions are on', (await page.locator('.suAction.on').count()) === 4, String(await page.locator('.suAction.on').count()));
await shot('4-actions');
await next();

// try it
check('try it', /Try it out/.test(await heading()));
await page
  .locator('.suTryPanel')
  .getByRole('button', { name: /Start a simulated chat/ })
  .first()
  .click();
await page.waitForTimeout(1500);
const box = page.locator('.suTryPanel').getByLabel('Message to the agent');
await box.fill('What are your opening hours?');
await box.press('Enter');
await page.waitForTimeout(2500);
check('trying it marks the step done', (await page.locator('.suStep', { hasText: 'Try it' }).getAttribute('class')).includes('done'));
await next();

// go live
check('put it live', /Put it live/.test(await heading()));
check(
  'nothing to fix before it goes live',
  (await page.locator('.suProblems').count()) === 0,
  await page
    .locator('.suProblems')
    .innerText()
    .catch(() => ''),
);
check(
  'every step that counts is done',
  (await page.locator('.suNote.warn').count()) === 0,
  await page
    .locator('.suNote.warn')
    .innerText()
    .catch(() => ''),
);
await page.getByRole('button', { name: /Put it live in Development/ }).click();
const live = await page
  .locator('.suDone')
  .waitFor({ timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check('it says it is live in Development', live && /Smile Dental is live in Development/.test(await page.locator('.suDone').innerText()));
check('with phone calls on, a number can be added right there', (await page.locator('.agentNumbers, .suNote').count()) > 0);
await shot('5-live');

// what the agent holds now
const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('weave_demo_state') || '{}').bots?.['smile-dental']?.config || null);
const entry = draft?.agents?.items?.find((a) => a.id === draft.agents.entry);
check('its main language is the one the setup started it with', draft?.defaults?.language?.primary === 'en-GB', draft?.defaults?.language?.primary);
check(
  'the agent that answers has every action switched on',
  ['end_call', 'escalate_to_human', 'collect_details', 'look_up'].every((t) => entry?.tools?.includes(t)),
  entry?.tools?.join(','),
);
check('the hand-over has the number', draft?.telephony?.transfers?.find((t) => t.id === 'human_support')?.target === '+6561234567');
check('the form asks for name, phone and email', draft?.forms?.[0]?.fields?.map((f) => f.name).join(',') === 'name,phone,email');
const lookUp = draft?.tools?.find((t) => t.id === 'look_up');
check(
  'the lookup calls the system with the booking reference',
  draft?.connections?.your_system?.base_url === 'https://booking.smiledental.example' && lookUp?.request?.path === '/appointments/{{args.booking_reference}}',
  JSON.stringify(lookUp?.request),
);
check('the knowledge is read by the agent that answers', entry?.knowledge?.includes('knowledge') && draft?.knowledge?.[0]?.sources?.length === 2);
check(
  'chat and phone, with speech models for the phone',
  draft?.channels?.some((c) => c.type === 'sip_voice' && c.enabled) && !!draft?.defaults?.models?.stt && !!draft?.defaults?.models?.tts,
);

// afterwards
await page.getByRole('button', { name: 'Go to the agent' }).click();
await page.waitForTimeout(1500);
check(
  '“Go to the agent” opens its Overview, with the setup no longer offered',
  /#\/bots\/smile-dental\/home/.test(page.url()) && (await page.locator('.suBanner').count()) === 0,
  page.url(),
);
check('no page errors', !problems.length, problems.slice(0, 3).join(' | '));

console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
await browser.close();
process.exit(failed ? 1 : 0);
