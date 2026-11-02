// Guardrails and After the call: checks and rules added, changed and deleted (with Undo), a line tried against the
// checks, and the more after-call settings (the summary's model, files, closing messages, records). Saved drafts are read
// back from the stand-in API, so what the page wrote is checked, not only what it shows.
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('build-guardrails');
const AGENT = 'acme-support';
const draft = () => page.evaluate(async (id) => (await (await fetch(`/api/bots/${id}/draft`)).json()).config, AGENT);
const save = async () => {
  await page.locator('main h2').first().click();
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => !/Unsaved|Saving/i.test(document.querySelector('header')?.innerText || ''), null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
};
const card = (title) => page.locator(`section[aria-label="${title}"]`);

await step('the Guardrails page opens with its lists', async () => {
  await page.goto(`${base}/agents/${AGENT}/build/guardrails`);
  await card('Checks on what is said').waitFor({ timeout: 20_000 });
  check(await page.getByText('On what the caller says', { exact: true }).isVisible(), 'the caller list is shown');
  check(await page.getByText('On what the agent says', { exact: true }).isVisible(), 'the agent list is shown');
  check(await page.getByText('All its hand-over and ending rules').isVisible(), 'the rules list is shown');
});

await step('a check on the caller is added from a card that names its job', async () => {
  const checks = card('Checks on what is said');
  await checks.getByRole('button', { name: 'Add a check on the caller' }).click();
  await checks.getByRole('button', { name: /Block certain words or patterns/ }).first().click();
  const patterns = checks.getByLabel('Patterns to look for');
  await patterns.waitFor();
  await patterns.fill('\\brefund\\b');
  await checks.getByLabel('How it is applied').last().selectOption('both');
  await save();
  const c = await draft();
  const rule = c.guardrails.input.find((r) => r.type === 'regex_block');
  check(rule && JSON.stringify(rule.patterns) === '["\\\\brefund\\\\b"]', `patterns written: ${JSON.stringify(rule)}`);
  check(rule.enforcement === 'both' && rule.on_trigger?.action === 'block', `enforcement and action: ${JSON.stringify(rule)}`);
  check(rule.id === 'blocked_words', `named by its job: ${rule.id}`);
});

await step('a check on the agent is added, and its id is clear of the caller’s', async () => {
  const checks = card('Checks on what is said');
  await checks.getByRole('button', { name: 'Add a check on the agent' }).click();
  await checks.getByRole('button', { name: /Block certain words or patterns/ }).last().click();
  await checks.getByLabel('Patterns to look for').last().fill('guaranteed');
  await save();
  const c = await draft();
  const ids = [...(c.guardrails.input ?? []), ...(c.guardrails.output ?? [])].map((r) => r.id);
  check(new Set(ids).size === ids.length, `ids are one set: ${ids.join(', ')}`);
  check(c.guardrails.output.some((r) => r.id === 'blocked_words_2'), `the second is numbered: ${ids.join(', ')}`);
});

await step('a check is deleted and Undo brings it back', async () => {
  const checks = card('Checks on what is said');
  const before = (await draft()).guardrails.output.length;
  await checks.getByRole('button', { name: /^Delete Words or patterns/ }).last().click();
  const status = checks.getByRole('status').filter({ hasText: 'deleted' });
  await status.waitFor();
  check(/Check “Words or patterns” deleted/.test(await status.innerText()), 'the notice names it');
  await status.getByRole('button', { name: 'Undo' }).click();
  await save();
  check((await draft()).guardrails.output.length === before, 'the check is back');
});

await step('a rule of one’s own says what is missing, then reads in words once finished', async () => {
  const moments = card('When it hands over or ends the call');
  await moments.getByRole('button', { name: 'Add a rule of your own' }).click();
  check(await moments.getByText('Not finished yet: say when it applies.').first().isVisible(), 'unfinished rule says what is missing');
  await moments.getByLabel('Words that start this rule').fill('lawyer');
  await moments.getByRole('radio', { name: 'Ends the call' }).or(moments.getByRole('button', { name: 'Ends the call' })).first().click();
  await moments.getByRole('textbox', { name: 'What the rule says first', exact: true }).fill('I’m going to end the call now. Goodbye.');
  await page.waitForTimeout(200);
  check(await moments.getByText('When they say “lawyer”: end the call').isVisible(), 'the rule reads in words');
  await save();
  const rule = (await draft()).guardrails.escalation.find((r) => r.when?.keywords?.includes('lawyer'));
  check(rule && rule.action === 'end_call' && /Goodbye/.test(rule.say), `rule written: ${JSON.stringify(rule)}`);
});

await step('a line is tried against the checks (POST /preview/guardrails)', async () => {
  const tryCard = card('Try a line');
  await tryCard.getByRole('textbox').fill('Can I get a refund?');
  await tryCard.getByRole('button', { name: 'Try it' }).click();
  await tryCard.locator('[aria-live="polite"]').waitFor({ timeout: 15_000 });
  const text = await tryCard.locator('[aria-live="polite"]').innerText();
  check(text.length > 10, `the server's answer is shown: ${text}`);
});

await step('After the call: the summary’s model is asked once summaries are on', async () => {
  await page.goto(`${base}/agents/${AGENT}/build/aftercall`);
  const modelCard = card('The model that writes the summaries');
  await modelCard.waitFor({ timeout: 20_000 });
  const summary = card('A summary of each call');
  await summary.getByRole('radio', { name: 'On' }).or(summary.getByRole('button', { name: 'On', exact: true })).first().click();
  await modelCard.getByLabel('Model').waitFor();
  await modelCard.getByLabel('Model').fill('gpt-4.1');
  await save();
  const c = await draft();
  check(c.post_call.summary.enabled === true && c.post_call.summary.llm?.model === 'gpt-4.1', JSON.stringify(c.post_call.summary));
});

await step('After the call: a file after each call, a closing message, and call records', async () => {
  const files = card('Files after each call');
  await files.getByRole('button', { name: 'The transcript' }).click();
  await files.locator('[data-artifact="0"]').waitFor();
  const closing = card('Closing messages');
  await closing.getByRole('button', { name: 'Add a closing message' }).click();
  await closing.locator('[data-wrapup="wrapup"] input').nth(1).fill('Thanks for calling. Goodbye!');
  const records = card('Call records and logs');
  await records.getByLabel('How much the call log holds').selectOption('full');
  await records.getByLabel('Folder for call logs').fill('/var/log');
  check(await records.getByRole('alert').isVisible(), 'a full path is refused in words');
  await records.getByLabel('Folder for call logs').fill('calls');
  await save();
  const c = await draft();
  check(c.post_call.artifacts?.[0]?.kind === 'transcript' && c.post_call.artifacts[0].sink.type === 'file', JSON.stringify(c.post_call.artifacts));
  check(c.wrapups?.[0]?.on_silence?.[0]?.say === 'Thanks for calling. Goodbye!', JSON.stringify(c.wrapups));
  check(c.observability.session_log.detail === 'full' && c.observability.session_log.directory === 'calls', JSON.stringify(c.observability));
});

await step('After the call: a file is deleted and Undo brings it back', async () => {
  const files = card('Files after each call');
  await files.getByRole('button', { name: 'Delete this file' }).click();
  await files.getByRole('button', { name: 'Undo' }).click();
  check((await files.locator('[data-artifact]').count()) === 1, 'the file is back');
});

await step('redaction: a line is tried (POST /preview/redaction)', async () => {
  const hiding = card('Hiding sensitive details in what is kept');
  await hiding.getByPlaceholder(/Try a line/).fill('My card is 4111 1111 1111 1111');
  await hiding.getByRole('button', { name: 'Try it' }).click();
  await hiding.getByText('Kept as:').waitFor({ timeout: 15_000 });
});

await finish();
