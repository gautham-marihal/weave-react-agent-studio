// Tools › Transfers, connections, forms, messages and tasks: each row says what is set, each kind is edited in its own
// panel, a task reads step by step and is tried on the server (POST /preview/task), and a deletion comes back with Undo.
import path from 'node:path';
import process from 'node:process';
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('build-extras');
const shots = process.env.E2E_SHOTS;
const shot = async (p, name) => {
  if (shots) await p.screenshot({ path: path.join(shots, `extras-${name}.png`), fullPage: false });
};
const section = () => page.locator('section[aria-label="Transfers, connections, forms, messages and tasks"]');
const dialog = () => page.getByRole('dialog');
const openRow = async (title) => {
  await section().getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await dialog().waitFor();
};
const done = async () => {
  await dialog().getByRole('button', { name: 'Done' }).click();
  await dialog().waitFor({ state: 'detached' });
};

await step('the rows say what is set', async () => {
  await page.goto(`${base}/agents/acme-support/build/tools`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await section().waitFor({ timeout: 60_000 });
  const text = await section().innerText();
  check(/Phone transfers/.test(text) && /1 transfer with no number yet: callers are offered a callback/.test(text), `transfers row: ${text}`);
  check(/Connections\s+None yet/.test(text), 'connections say none yet');
  check(/Multi-step tasks\s+None yet/.test(text), 'tasks say none yet');
  await shot(page, 'section-light');
});

await step('a transfer gets a number, and its row says where calls go', async () => {
  await openRow('Phone transfers');
  await dialog().getByLabel('Phone number or SIP address').fill('+44 20 7946 0000');
  await done();
  check(/Passes calls to \+44 20 7946 0000/.test(await section().innerText()), 'the row names the number');
  check((await page.getByText('Unsaved changes').count()) > 0, 'the edit is an unsaved change of the draft');
});

await step('connections: a web service with a token named as a secret, and a text sender', async () => {
  await openRow('Connections');
  await dialog().getByRole('button', { name: 'A web service' }).click();
  await dialog().getByLabel('Address', { exact: true }).fill('https://api.acme.example');
  await dialog().getByLabel('How web_service signs in').selectOption('bearer');
  await dialog().getByLabel('Secret with the token').fill('billing token');
  check((await dialog().getByLabel('Secret with the token').inputValue()) === 'BILLING_TOKEN', 'a secret is named, in capitals');
  check((await dialog().locator('input[type="password"]').count()) === 0, 'no box asks for a secret value');
  check(/Never the value itself/.test(await dialog().innerText()), 'it says only the name is kept');
  await dialog().getByRole('button', { name: 'A text or email sender' }).click();
  await dialog().getByLabel('Service', { exact: true }).fill('twilio');
  await done();
  check(/2 connections: api\.acme\.example, Sender/.test(await section().innerText()), 'the row names both');
});

await step('a form with a field to choose from', async () => {
  await openRow('Forms');
  await dialog().getByRole('button', { name: 'Add a form' }).click();
  await dialog().getByRole('button', { name: 'Add a field' }).click();
  await dialog().getByLabel('Field 2 label').fill('Topic');
  await dialog().getByLabel('Field 2 kind').selectOption('select');
  await dialog().getByLabel('Field 2 choices').fill('Billing, Technical');
  check((await dialog().getByLabel('Field 2 choices').inputValue()) === 'Billing, Technical', 'the choices are kept as typed');
  await dialog().getByRole('button', { name: 'Move field Topic up' }).click();
  check((await dialog().getByLabel('Field 1 label').inputValue()) === 'Topic', 'the field moved up');
  await done();
  check(/1 form: Your details/.test(await section().innerText()), 'the row names the form');
});

await step('a message sent by text', async () => {
  await openRow('Messages it sends');
  await dialog().getByRole('button', { name: 'Add a message' }).click();
  check((await dialog().getByLabel('Sent by').inputValue()) === 'sender', 'the sender is chosen');
  await dialog().getByLabel('Text', { exact: true }).fill('Your ticket {{with.ticket_id}} is open.');
  await done();
  check(/1 message it can text or email/.test(await section().innerText()), 'the row counts it');
});

await step('a task reads step by step; a step is added and moved', async () => {
  await openRow('Multi-step tasks');
  await dialog().getByRole('button', { name: 'Add a task that checks who the caller is' }).click();
  const reading = dialog().locator('section[aria-label="The task step by step"]');
  check(/Checks who the caller is in 1 step\./.test(await reading.innerText()), 'the reading names the task');
  await dialog().getByRole('button', { name: 'Ask the caller' }).click();
  await dialog().getByLabel('Step 2: what it asks').fill('Ask for the PIN.');
  await dialog().getByLabel('Step 2: the caller answers').selectOption('dtmf');
  await dialog().getByRole('button', { name: 'Move step ask up' }).click();
  const text = await reading.innerText();
  check(/in 2 steps/.test(text), 'two steps');
  check(text.indexOf('Ask for the PIN.') < text.indexOf('Ask for the account number.'), `the moved step reads first: ${text}`);
  check(/answered on the keypad/.test(text), 'the keypad answer is said');
  await shot(page, 'task-light');
});

await step('Try this task shows the server’s answer', async () => {
  const panel = dialog().locator('section[aria-label="Try this task"]');
  await panel.getByRole('button', { name: 'Show the steps' }).click();
  await panel.locator('[data-step="ask"]').waitFor();
  check((await panel.locator('[data-step]').count()) === 2, 'both steps are shown');
  check(/never sees the digits/.test(await panel.locator('[data-step="ask"]').innerText()), 'the keypad step says the AI never sees the digits');
  check(/How it can end/.test(await panel.innerText()), 'the endings are told');
  await panel.getByLabel('What if these were already remembered (optional)').fill('{nope');
  check(/not valid JSON/.test(await panel.innerText()), 'bad JSON is said in words');
  check(await panel.getByRole('button', { name: 'Show the steps' }).isDisabled(), 'and nothing is sent');
});

await step('a deleted task comes back with Undo', async () => {
  await dialog().getByRole('button', { name: 'Delete the task verify_caller' }).click();
  check(/Task “verify_caller” deleted\./.test(await dialog().innerText()), 'the deletion is said');
  check(/No tasks yet/.test(await dialog().innerText()), 'the task is gone');
  await dialog().getByRole('button', { name: 'Undo' }).click();
  check((await dialog().getByText('verify_caller').count()) > 0, 'the task is back');
  await done();
  check(/1 task: Verify caller/.test(await section().innerText()), 'the row counts it again');
});

await step('saved, it opens the same in the dark theme', async () => {
  await page.keyboard.press('Control+s');
  await page.getByText(/^Saved \d/).first().waitFor({ timeout: 10_000 });
  const dark = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await dark.addInitScript(() => {
    sessionStorage.setItem('weave_auth_user', JSON.stringify({ id: 'e2e', name: 'Test Person', email: 'test.person@example.com', initials: 'TP', role: 'admin' }));
    localStorage.setItem('weave_theme', 'dark');
  });
  const p = await dark.newPage();
  await p.goto(`${base}/agents/acme-support/build/tools`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const s = p.locator('section[aria-label="Transfers, connections, forms, messages and tasks"]');
  await s.waitFor({ timeout: 20_000 });
  check(/1 task: Verify caller/.test(await s.innerText()), 'the saved task is there');
  await s.scrollIntoViewIfNeeded();
  await shot(p, 'section-dark');
  await s.getByRole('button', { name: /^Multi-step tasks/ }).click();
  await p.getByRole('dialog').waitFor();
  await shot(p, 'task-dark');
  await dark.close();
});

await finish();
