// The Agent page (Build › Agent) and its panels, the prompt preview, and Build on one page, against the stand-in API.
//   E2E_API_PORT=8425 E2E_WEB_PORT=5425 node e2e/agentpage.mjs
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('agentpage');
// leaving a page with unsaved edits asks first (beforeunload); these steps move on on purpose
page.on('dialog', (dialog) => void dialog.accept());

// The voice samples are somebody else's server: answer with a tiny silent sound so no network is needed, and note which
// address was asked for (only a catalogue recording may be played).
const samples = [];
let samplesFail = false;
await page.route(
  (url) => /storage\.googleapis\.com|elevenlabs\.io|creativeclaw\.co/.test(url.hostname),
  (route) => {
    samples.push(route.request().url());
    if (samplesFail) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=', 'base64') });
  },
);

const main = () => page.locator('main');
const openAgent = async (id = 'acme-support', query = '') => {
  await page.goto(`${base}/agents/${id}/build/agent${query}`, { timeout: 120_000 });
  await main().getByRole('heading', { name: 'What it should do' }).waitFor({ timeout: 20_000 });
};
const row = (title) => main().getByRole('button', { name: new RegExp(`^${title}:`) });
const panel = (title) => page.getByRole('dialog', { name: title });
const done = async (title) => {
  await panel(title).getByRole('button', { name: 'Done' }).click();
  await panel(title).waitFor({ state: 'detached' });
};
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();
const until = async (fn, message, timeout = 8_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) throw new Error(message);
    await page.waitForTimeout(100);
  }
};

// ---- the page --------------------------------------------------------------------------------------------------------
await step('Build › Agent shows its name, its role with a word count, where conversations are processed, and the rows', async () => {
  await openAgent();
  check((await main().getByLabel('Agent name').inputValue()) === 'Acme Support', 'the name is in its box');
  const role = main().getByLabel('What the agent should do (its role)');
  check((await role.inputValue()).length > 20, 'the role is in its box');
  check(/^\d+ words$/.test(await text(main().locator('[data-count]'))), 'a word count is shown');
  check(/^Conversations are processed by OpenAI\.$/.test(await text(main().locator('[data-flow]'))), `data-flow sentence: ${await text(main().locator('[data-flow]'))}`);
  for (const title of ['Voice', 'Language', 'Tone and style', 'AI models', 'Personality and rules']) check(await row(title).isVisible(), `the ${title} row is there`);
  check(/Not needed while it only chats/.test(await text(row('Voice'))), 'an agent that only chats is not told it lacks a voice');
});

await step('the word count follows the role, and a name the agent lacks is hinted, not refused', async () => {
  const role = main().getByLabel('What the agent should do (its role)');
  await role.fill('You help Acme customers with bills. Ask for {{state.account}} first.');
  await until(async () => (await text(main().locator('[data-count]'))) === '10 words', 'the count did not follow');
  check(/“account” isn’t something it keeps during the call/.test(await text(main())), 'the unknown name is hinted');
  check((await main().locator('[aria-invalid="true"]').count()) === 0, 'nothing is marked as an error');
});

await step('“Insert a detail” puts what it keeps during a call at the cursor', async () => {
  // give the agent something it keeps, through the JSON view (as a person would), then come back to the Agent page
  await main().getByRole('button', { name: 'JSON' }).click();
  // the code editor draws only the lines in sight: read it through its own hook, write it as a paste does
  const frame = '[data-json-frame] [data-json-editor]';
  await page.waitForFunction((f) => (document.querySelector(f)?.weaveJsonText?.() || '').length > 20, frame, { timeout: 60_000 });
  const config = JSON.parse(await page.evaluate((f) => document.querySelector(f).weaveJsonText(), frame));
  config.state = { variables: { account_number: { type: 'string' } } };
  const edited = JSON.stringify(config, null, 2);
  await page.locator('[data-json-frame] .cm-content').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(edited);
  await page.waitForFunction(([f, wanted]) => document.querySelector(f)?.weaveJsonText?.() === wanted, [frame, edited], { timeout: 20_000 });
  await page.waitForTimeout(700);
  await main().getByRole('button', { name: 'Back to Agent' }).click();
  await main().getByRole('heading', { name: 'What it should do' }).waitFor();
  const role = main().getByLabel('What the agent should do (its role)');
  await role.fill('Ask for the number.');
  await role.click();
  await role.press('End');
  await main().getByText('Insert a detail').click();
  await main().getByRole('button', { name: 'Account number' }).click();
  await until(async () => (await role.inputValue()) === 'Ask for the number.{{state.account_number}}', `inserted: ${await role.inputValue()}`);
  check(!/isn’t something it keeps/.test(await text(main())), 'a name it keeps is not hinted');
});

await step('renaming offers to change the places that still say the old name, and changes them when asked', async () => {
  const name = main().getByLabel('Agent name');
  const greeting = main().getByLabel('Greeting');
  await greeting.fill('Hi, this is Acme Support. How can I help?');
  await name.click();
  await name.fill('Acme Help');
  await main().getByLabel('Greeting').click();
  const offer = main().getByRole('status').filter({ hasText: 'still' });
  await offer.waitFor();
  check(/What it says first still says “Acme Support”\./.test(await text(offer)), `offer: ${await text(offer)}`);
  await offer.getByRole('button', { name: 'Change it to “Acme Help”' }).click();
  check((await greeting.inputValue()) === 'Hi, this is Acme Help. How can I help?', 'the greeting now says the new name');
  check((await offer.count()) === 0, 'the offer goes once it is answered');
});

// ---- the prompt preview ------------------------------------------------------------------------------------------------
await step('the prompt preview opens inline with what-ifs (channel, time, caller’s number, state) and the server’s exact text', async () => {
  await main().getByRole('button', { name: /^Preview the prompt/ }).click();
  const preview = main().locator('[data-prompt-preview]');
  await preview.locator('[data-total]').waitFor({ timeout: 10_000 });
  check(/\d+ words/.test(await text(preview.locator('[data-total]'))), 'the size is shown');
  for (const label of ['Preview on channel', 'Pretend it is this time', 'Pretend the caller’s number is', 'What if account_number were']) check(await preview.getByLabel(label).isVisible(), `${label} is offered`);
  await preview.getByLabel('Pretend the caller’s number is').fill('+6561234567');
  await preview.getByLabel('What if account_number were').fill('A-17');
  await page.waitForTimeout(600);
  await preview.locator('[data-extra="models"] summary').click();
  check(/Thinking\s*openai/.test(await text(preview.locator('[data-extra="models"]'))), 'the models it would use are listed');
  check(/Only the names of secrets are shown/.test(await text(preview.locator('[data-extra="models"]'))), 'secrets are named, never shown');
  await preview.locator('[data-extra="state"] summary').click();
  check(/account_number A-17/.test(await text(preview.locator('[data-extra="state"]'))), 'the state what-if reaches the server');
  await preview.getByText('The exact text the model receives').click();
  check((await preview.getByLabel('The exact instructions').innerText()).includes('{{state.account_number}}') || (await preview.getByLabel('The exact instructions').innerText()).length > 10, 'the exact text is shown');
});

await step('when the server can’t build the preview, the error is shown and nothing is put together in its place', async () => {
  await page.route('**/api/preview/prompt', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'The preview is not available' }) }));
  const preview = main().locator('[data-prompt-preview]');
  await preview.getByLabel('Pretend the caller’s number is').fill('+6500000000');
  await preview.getByRole('alert').waitFor({ timeout: 10_000 });
  check(/The server could not build the preview/.test(await text(preview.getByRole('alert'))), 'the error is said');
  check((await preview.locator('[data-total]').count()) === 0 && (await preview.locator('[data-section]').count()) === 0, 'no prompt is shown in its place');
  await page.unroute('**/api/preview/prompt');
  await preview.getByRole('button', { name: 'Try again' }).click();
  await preview.locator('[data-total]').waitFor({ timeout: 10_000 });
});

await step('the header’s Preview prompt dialog has the same what-ifs and extras', async () => {
  await page.getByRole('button', { name: 'Preview prompt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Prompt preview' });
  await dialog.locator('[data-total]').waitFor({ timeout: 10_000 });
  check(await dialog.getByLabel('Pretend the caller’s number is').isVisible(), 'the caller’s number what-if is there');
  check((await dialog.locator('[data-extra]').count()) > 0, 'the extras are there');
  await dialog.getByRole('button', { name: 'Done' }).click();
});

// ---- one greeting for every channel -------------------------------------------------------------------------------------
await step('one greeting is shared across channels: another channel’s own line is shown and shared only when asked', async () => {
  await openAgent('front-desk');
  const greeting = main().getByLabel('Greeting');
  const hint = main().locator('[data-greeting-hint]');
  await greeting.fill('Hello from the front desk!');
  check(/Phone says “Welcome to the front desk\. How can I help you\?”/.test(await text(hint)), `hint: ${await text(hint)}`);
  await hint.getByRole('button', { name: 'Say this on Phone too' }).click();
  check((await text(hint)) === 'Used on 2 channels.', `after sharing: ${await text(hint)}`);
});

// ---- the voice picker --------------------------------------------------------------------------------------------------
await step('voice: search, pick (the engine switch is said), and Done puts it in; the row shows it', async () => {
  await openAgent();
  await row('Voice').click();
  const p = panel('Voice');
  await p.getByLabel('Search voices').fill('sarah');
  const voices = p.getByRole('list', { name: 'Voices' }).locator('li');
  check((await voices.count()) === 1, `one voice matches (${await voices.count()})`);
  await p.getByRole('button', { name: /^Use Sarah,/ }).click();
  check(/voice engine is now ElevenLabs/.test(await text(p.getByRole('status'))), 'the engine switch is noted');
  check((await p.getByRole('button', { name: /^Using Sarah,/ }).count()) === 1, 'the voice in use is marked');
  await done('Voice');
  check(/Sarah · ElevenLabs/.test(await text(row('Voice'))), `row: ${await text(row('Voice'))}`);
});

await step('voice: the filters combine, nothing matching says so, and Cancel leaves the draft as it was', async () => {
  await row('Voice').click();
  const p = panel('Voice');
  await p.getByLabel('Language of the voice').selectOption('');
  await p.getByLabel('Engine').selectOption('cartesia');
  await p.getByLabel('Gender').selectOption('Male');
  const engines = await p.locator('[data-engine]').allInnerTexts();
  check(engines.length > 0 && engines.every((e) => /Cartesia/.test(e)), 'only Cartesia voices');
  check(!/· Female ·/.test(await text(p.getByRole('list', { name: 'Voices' }))), 'only male voices');
  await p.getByRole('button', { name: /^Use Ramon,/ }).click();
  await p.getByLabel('Search voices').fill('zzzz');
  check(/No voice matches/.test(await text(p.getByRole('list', { name: 'Voices' }))), 'nothing matching is said');
  await p.getByRole('button', { name: 'Cancel' }).click();
  check(/Sarah · ElevenLabs/.test(await text(row('Voice'))), 'the draft still has Sarah');
});

await step('voice: listening plays the catalogue’s own recording, and a recording that can’t load is said, with no other voice instead', async () => {
  await row('Voice').click();
  const p = panel('Voice');
  await p.getByLabel('Search voices').fill('sarah');
  const before = samples.length;
  await p.getByRole('button', { name: 'Listen to Sarah' }).first().click();
  await until(async () => samples.length > before, 'no recording was asked for');
  check(samples.slice(before).every((u) => u.includes('EXAVITQu4vr4xnSDxMaL')), `asked for: ${samples.slice(before).join(' | ')}`);
  samplesFail = true;
  await p.getByLabel('Search voices').fill('laura');
  await p.getByRole('button', { name: 'Listen to Laura' }).click();
  await p.getByText('The recording of Laura couldn’t be played').waitFor({ timeout: 8_000 });
  samplesFail = false;
  check(!/browser/i.test(await text(p)), 'no browser voice is offered instead');
  await p.getByRole('button', { name: 'Cancel' }).click();
});

await step('voice: a voice id from your own account can be typed', async () => {
  await row('Voice').click();
  const p = panel('Voice');
  await p.getByText('A voice from your own account').last().click();
  await p.getByLabel('Voice id').fill('my-own-voice-123');
  await done('Voice');
  check(/A voice from your own account · ElevenLabs/.test(await text(row('Voice'))), `row: ${await text(row('Voice'))}`);
});

// ---- the language picker -----------------------------------------------------------------------------------------------
await step('language: the main language is searched and picked, other languages are added and taken away, detection switched on', async () => {
  await row('Language').click();
  const p = panel('Language');
  await p.getByRole('button', { name: /^Main language:/ }).click();
  await p.getByLabel('Main language: search').fill('span');
  const options = await p.getByRole('option').allInnerTexts();
  check(options.length === 2 && /Spanish \(Spain\)/.test(options[0]) && /Spanish \(Mexico\)/.test(options[1]), `options: ${options.join(' | ')}`);
  await p.getByRole('option', { name: /Spanish \(Mexico\)/ }).click();
  check((await p.getByRole('option').count()) === 0, 'the list closes after one choice');
  await p.getByRole('button', { name: /^Add a language:/ }).click();
  await p.getByRole('option', { name: /French/ }).click();
  check((await p.getByRole('option').count()) > 0, 'the list stays open to add more');
  await p.getByRole('option', { name: /German/ }).click();
  check((await p.getByRole('option', { name: /French/ }).count()) === 0, 'a language that is added is not offered again');
  await p.getByLabel('Add a language: search').press('Escape');
  check((await p.getByRole('list', { name: 'Languages it speaks' }).innerText()).includes('Spanish'), 'the main language is a chip');
  check((await p.getByRole('button', { name: 'Remove Spanish' }).count()) === 0, 'the main language can’t be removed');
  await p.getByRole('button', { name: 'Remove German' }).click();
  await p.getByRole('switch', { name: 'Detect the caller’s language automatically' }).click();
  await done('Language');
  const value = await text(row('Language'));
  check(/Spanish \(Mexico\) · also .*French.* · detects the caller’s/.test(value) && !/German/.test(value), `row: ${value}`);
});

await step('language: the keyboard works the list (arrows, Enter, Escape) and languages it only recognises are kept', async () => {
  await row('Language').click();
  const p = panel('Language');
  await p.getByRole('button', { name: /^Main language:/ }).click();
  const search = p.getByLabel('Main language: search');
  await search.press('ArrowDown');
  await search.press('Enter');
  check(/English \(United Kingdom\)/.test(await text(p.getByRole('button', { name: /^Main language:/ }))), 'the second one was picked');
  await p.getByRole('button', { name: /^Main language:/ }).click();
  await p.getByLabel('Main language: search').press('Escape');
  check((await p.getByRole('option').count()) === 0, 'Escape closes the list');
  check(await panel('Language').isVisible(), 'and leaves the panel open');
  await p.getByRole('button', { name: /^Add a language to recognise:/ }).click();
  await p.getByRole('option', { name: /Japanese/ }).click();
  await p.getByLabel('Add a language to recognise: search').press('Escape');
  check((await p.getByRole('button', { name: 'Stop recognising Japanese' }).count()) === 1, 'Japanese is recognised');
  await done('Language');
  check(/English \(United Kingdom\)/.test(await text(row('Language'))), 'the row follows');
});

// ---- the AI models picker ----------------------------------------------------------------------------------------------
await step('AI models: the three parts say what is chosen; a model of another provider switches it, and a missing key is said', async () => {
  await row('AI models').click();
  const p = panel('AI models');
  const llm = p.locator('[data-stage="llm"]');
  check(/GPT-4\.1 mini/.test(await text(llm.locator('[data-chosen]'))), 'the language model in use is shown');
  check((await p.locator('section[data-stage]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stage')))).join() === 'llm,stt,tts', 'in the order people think of them');
  await llm.getByRole('button', { name: /Change Language model models/ }).click();
  await llm.getByRole('group', { name: 'Provider' }).getByRole('button', { name: 'Anthropic' }).click();
  const engines = await llm.locator('[data-engine]').allInnerTexts();
  check(engines.length > 0 && engines.every((e) => /Anthropic/.test(e)), 'only Anthropic models');
  check(engines.every((e) => /no key/.test(e)), 'the missing key is marked on each');
  await llm.getByRole('button', { name: /^Use Claude Sonnet 5\.5 from Anthropic/ }).click();
  check(/doesn’t have ANTHROPIC_API_KEY set/.test(await text(llm.locator('[data-problem]'))), 'the card says what would stop a call');
  await done('AI models');
  check(/Language model: Anthropic Claude Sonnet 5\.5/.test(await text(row('AI models'))), `row: ${await text(row('AI models'))}`);
  check(/Key missing/.test(await text(row('AI models'))), 'the row says the key is missing');
});

await step('AI models: any other model id can be typed and is kept with the provider in use; the catalogue says it isn’t listed', async () => {
  await row('AI models').click();
  const p = panel('AI models');
  const llm = p.locator('[data-stage="llm"]');
  await llm.getByRole('button', { name: /Change Language model models/ }).click();
  await p.locator('#pk-other-llm').fill('claude-9-custom');
  await llm.getByRole('button', { name: 'Use it' }).click();
  check(/isn’t in the catalogue/.test(await text(llm.locator('[data-status]'))), 'the typed id is said to be saved as typed');
  check(/Anthropic/.test(await text(llm.locator('[data-chosen]'))), 'the provider stays');
  await done('AI models');
});

await step('AI models: a provider the server can’t run is said, and nothing is guessed when the server’s list can’t be read', async () => {
  await page.route('**/api/providers', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'Providers are not available' }) }));
  await openAgent();
  await row('AI models').click();
  const p = panel('AI models');
  await p.getByRole('note').filter({ hasText: 'could not be checked' }).waitFor({ timeout: 10_000 });
  const llm = p.locator('[data-stage="llm"]');
  await llm.getByRole('button', { name: /Change Language model models/ }).click();
  check((await llm.getByRole('list').count()) === 0, 'no list of models is offered on a guess');
  check(await p.locator('#pk-other-llm').isEnabled(), 'a model id can still be typed for the provider in use');
  await p.getByRole('button', { name: 'Cancel' }).click();
  await page.unroute('**/api/providers');
  await openAgent();
});

// ---- tone, personality ---------------------------------------------------------------------------------------------------
await step('tone and style, and personality and rules, are written from their panels on Done', async () => {
  await row('Tone and style').click();
  let p = panel('Tone and style');
  await p.getByLabel('Tone', { exact: true }).fill('calm and brief');
  await p.getByRole('button', { name: 'Add a rule' }).click();
  await p.getByLabel('Style rules 3', { exact: true }).fill('Never use jargon.');
  await done('Tone and style');
  check(/calm and brief · 3 style rules/.test(await text(row('Tone and style'))), `row: ${await text(row('Tone and style'))}`);
  await row('Personality and rules').click();
  p = panel('Personality and rules');
  await p.getByLabel('The company it speaks for').fill('Acme Ltd');
  await p.getByRole('button', { name: 'Add a rule' }).click();
  await p.getByLabel('Rules for every agent 1', { exact: true }).fill('Never guess a balance.');
  await done('Personality and rules');
  check(/from Acme Ltd · 1 rule for every agent/.test(await text(row('Personality and rules'))), `row: ${await text(row('Personality and rules'))}`);
});

await step('the changes are ordinary draft edits: Save keeps them, and they are there after a reload', async () => {
  await page.keyboard.press('Control+s');
  await page.getByText(/^Saved/).first().waitFor({ timeout: 10_000 });
  await openAgent();
  check(/from Acme Ltd/.test(await text(row('Personality and rules'))), 'kept after a reload');
});

// ---- Build on one page -----------------------------------------------------------------------------------------------
await step('Build on one page shows every part in build order, where each stands, with its plain controls or a way to its page', async () => {
  await main().getByRole('button', { name: 'One page' }).click();
  const one = main().locator('[data-guided-build]');
  await one.waitFor();
  const titles = await one.locator('section h2').allInnerTexts();
  check(titles.join(' | ') === 'Who it is and how it sounds | What it knows | What it can do | How a conversation moves | Where people reach it | Its boundaries | After the call', `parts: ${titles.join(' | ')}`);
  check((await one.locator('[data-part-status]').count()) === 7, 'each part says where it stands');
  check(/One agent answers every conversation\./.test(await text(one)), 'the workflow part says who answers');
  check(await one.getByText('What it should do').first().isVisible(), 'the agent part has its plain controls');
  await one.getByRole('button', { name: 'Open the Workflow' }).click();
  await page.waitForURL(/view=canvas/);
  // Back to the one-page view (the view buttons replace the address rather than add to the history)
  await page.goto(`${base}/agents/acme-support/build/agent?view=guided`);
  await main().locator('[data-guided-build]').waitFor();
  await main().locator('[data-guided-build]').getByRole('button', { name: 'Set its boundaries' }).click();
  await page.waitForURL(/\/build\/guardrails/);
});

await step('the panels fit a phone-sized window', async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openAgent();
  const before = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await row('Voice').click();
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const box = await panel('Voice').boundingBox();
  check(overflow <= Math.max(0, before), `the panel makes the page scroll sideways by ${overflow - before}px`);
  check(box && box.x >= -1 && box.x + box.width <= 391, `the panel fits the window (${JSON.stringify(box)})`);
  await panel('Voice').getByRole('button', { name: 'Cancel' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
});

await finish();
