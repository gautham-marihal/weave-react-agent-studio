// The Tools page of an agent: every tool as a row, adding one from a card, its panel (when it is used, parameters,
// the request with its name hints, rules as numbered steps with a condition), "Try it" answered by the server,
// deleting with Undo, and the "Not used" flag. Against the stand-in API, on acme-support.
//   E2E_SHOTS=<dir> also saves light and dark pictures of the page and an open panel there.
import path from 'node:path';
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('build-tools');
const shots = process.env.E2E_SHOTS;
const panel = () => page.getByRole('dialog');
const rows = () => page.getByRole('list', { name: 'All its tools' });
const ruleSentences = () => panel().locator('[data-rule-sentence]').allInnerTexts();
const stepSentences = (rule) => panel().getByRole('region', { name: `Rule ${rule}` }).locator('[data-sentence]').allInnerTexts();

await step('the Tools page lists every tool, with what it does in words', async () => {
  await page.goto(`${base}/agents/acme-support/build/tools`);
  await page.getByRole('heading', { name: 'All its tools' }).waitFor();
  const list = rows();
  await list.locator('[data-tool="end_call"]').waitFor();
  check((await list.locator('[data-tool="end_call"]').innerText()).includes('Ends the call'), 'end_call says what it does');
  check((await list.locator('[data-tool="escalate_to_human"]').innerText()).includes('Hands over to a person'), 'the hand-over says what it does');
  check(await page.getByRole('switch', { name: /can use end_call/ }).isVisible(), 'each row has the agent’s switch');
});

await step('a card for a tool it already has opens that one instead of adding a second', async () => {
  await page.getByRole('button', { name: 'Add a tool' }).click();
  const card = panel().locator('[data-card="end_call"]');
  check((await card.innerText()).includes('Already added'), 'the card says it is there');
  await card.click();
  await panel().getByRole('heading', { name: 'Tool “end_call”' }).waitFor();
  check((await panel().getByLabel('When it uses it').inputValue()).startsWith('Ends the conversation'), 'its own description is shown');
  await panel().getByRole('button', { name: 'Done' }).click();
  await panel().waitFor({ state: 'detached' });
  check((await rows().locator('[data-tool]').count()) === 2, 'no second tool was added');
});

await step('adding a tool from a job card opens its panel, offered to the agent', async () => {
  await page.getByRole('button', { name: 'Add a tool' }).click();
  await panel().locator('[data-card="lookup"]').click();
  await panel().getByRole('heading', { name: 'New tool' }).waitFor();
  check(await panel().getByRole('checkbox', { name: 'Acme Support' }).isChecked(), 'the answering agent can use it');
  check(await panel().getByRole('region', { name: 'The request' }).isVisible(), 'a lookup asks for its request');
});

await step('typing when it uses it keeps every letter, and the advice follows', async () => {
  const box = panel().getByLabel('When it uses it');
  await box.click();
  const text = 'Use when the caller asks where their order is.';
  const started = Date.now();
  await box.pressSequentially(text, { delay: 5 });
  const perKey = (Date.now() - started) / text.length;
  check((await box.inputValue()) === text, `the box holds what was typed: ${await box.inputValue()}`);
  check(perKey < 120, `typing stays quick (${Math.round(perKey)} ms a key)`);
  check(!(await panel().getByText('Add a description').count()), 'the warning about no description has gone');
});

await step('a parameter is a row, and the model’s view follows it', async () => {
  await panel().getByRole('button', { name: 'Add a parameter' }).click();
  await panel().getByLabel('Parameter 1 name').fill('order_id');
  await panel().getByLabel('Parameter 1 description').fill('The order number, like NB-1003');
  await panel().getByRole('checkbox', { name: 'Required' }).check();
  const view = panel().getByLabel('What the model sees');
  await view.getByText('lookup(order_id)').waitFor();
  check((await view.innerText()).includes('order_id (text, required): The order number'), 'the parameter is described as the model reads it');
});

await step('the request path offers the names to insert, and shows the address it calls', async () => {
  const pathBox = panel().getByRole('textbox', { name: 'Path', exact: true });
  await pathBox.click();
  await pathBox.fill('/orders/');
  await panel().getByRole('button', { name: 'args.order_id' }).click();
  check((await pathBox.inputValue()) === '/orders/{{args.order_id}}', `the name went in at the caret: ${await pathBox.inputValue()}`);
  await pathBox.fill('/orders/{{args.order_number}}');
  await panel().getByText(/“order_number” isn’t an argument of this tool/).waitFor();
  await pathBox.fill('/orders/{{args.order_id}}');
  check((await panel().getByLabel('The address that will be called').innerText()).includes('GET /orders/{{args.order_id}}'), 'the address is shown');
});

await step('rules are numbered steps that move with the buttons and the keyboard', async () => {
  await panel().getByRole('button', { name: 'Add a rule' }).click();
  await panel().getByLabel('Step 1 of rule 1: what it says').fill('One moment.');
  await panel().getByLabel('Add a step to rule 1').selectOption('end_call');
  check((await stepSentences(1)).join(' | ') === 'Say “One moment.” | End the call', `two steps in order: ${(await stepSentences(1)).join(' | ')}`);
  await panel().getByRole('button', { name: 'Move step 2 of rule 1 up' }).click();
  check((await stepSentences(1)).join(' | ') === 'End the call | Say “One moment.”', 'the button moved it up');
  // Alt+↓ from inside the first step moves it down again
  await panel().getByLabel('Step 1 of rule 1: what to do').focus();
  await page.keyboard.press('Alt+ArrowDown');
  check((await stepSentences(1)).join(' | ') === 'Say “One moment.” | End the call', `the keyboard moved it back: ${(await stepSentences(1)).join(' | ')}`);
  check((await ruleSentences())[0] === 'Always: say “One moment.”, then end the call.', `the rule reads as a sentence: ${(await ruleSentences())[0]}`);
});

await step('a condition is built as one row and read back in words', async () => {
  await panel().getByRole('button', { name: 'Only when…' }).click();
  await panel().getByLabel('Rule 1 condition: what to test').selectOption('arg');
  await panel().getByLabel('Rule 1 condition: which argument').selectOption('order_id');
  await panel().getByLabel('Rule 1 condition: value').fill('NB-1003');
  const sentence = (await ruleSentences())[0];
  check(sentence === 'When the argument order_id is “NB-1003”: say “One moment.”, then end the call.', `the rule reads: ${sentence}`);
  await panel().getByLabel('Rule 1 condition: comparison').selectOption('in');
  await panel().getByLabel('Rule 1 condition: values, separated by commas').fill('NB-1, NB-2');
  check((await ruleSentences())[0].startsWith('When the argument order_id is one of “NB-1”, “NB-2”'), `one of a list: ${(await ruleSentences())[0]}`);
});

await step('“Try it” shows what the server says the tool would send and what the model would read', async () => {
  const tryIt = panel().getByRole('region', { name: 'Try it' });
  await tryIt.getByLabel('Sample arguments').fill('{ "order_id": "NB-1003" }');
  await tryIt.getByLabel('A sample answer').fill('{ "found": true, "status": "shipped" }');
  await tryIt.getByRole('button', { name: 'Try it' }).click();
  const result = tryIt.locator('[data-try-result]');
  await result.waitFor();
  const text = await result.innerText();
  check(text.includes('The request that would be sent') && text.includes('/orders/NB-1003'), `the request with the argument filled in: ${text.slice(0, 200)}`);
  check(text.includes('What the model would read of that answer') && text.includes('shipped'), 'what the model would read');
  check(text.includes('only when its condition holds'), 'the rule is listed among what runs');
});

if (shots) {
  await step('pictures of the tool panel, light and dark', async () => {
    await panel().getByRole('region', { name: 'After it succeeds' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'tools-panel-light.png') });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(shots, 'tools-panel-dark.png') });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  });
}

await step('deleting a tool offers Undo, which brings it back', async () => {
  await panel().getByRole('button', { name: 'Delete this tool' }).click();
  await panel().waitFor({ state: 'detached' });
  const notice = page.getByRole('status').filter({ hasText: 'Tool “lookup” deleted.' });
  await notice.waitFor();
  check(!(await rows().locator('[data-tool="lookup"]').count()), 'the row has gone');
  await notice.getByRole('button', { name: 'Undo' }).click();
  await rows().locator('[data-tool="lookup"]').waitFor();
  check(!(await notice.count()), 'the notice has gone');
});

await step('a tool no agent offers is flagged “Not used”', async () => {
  const row = rows().locator('[data-tool="lookup"]');
  check(!(await row.getByText('Not used').count()), 'it is used to begin with');
  await page.getByRole('switch', { name: 'Acme Support can use lookup' }).click();
  await row.getByText('Not used').waitFor();
});

await step('opening a row edits that tool, and the edit is unsaved until Save', async () => {
  await rows().getByRole('button', { name: 'Open the tool lookup' }).click();
  await panel().getByRole('heading', { name: 'Tool “lookup”' }).waitFor();
  check((await panel().getByLabel('Parameter 1 name').inputValue()) === 'order_id', 'the parameter is still there');
  await panel().getByRole('button', { name: 'Done' }).click();
  await page.getByText(/Unsaved|unsaved/).first().waitFor({ timeout: 5000 });
});

if (shots) {
  await step('pictures of the Tools page, light and dark', async () => {
    await page.getByRole('heading', { name: 'All its tools' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'tools-page-light.png') });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(shots, 'tools-page-dark.png') });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  });
}

await finish();
