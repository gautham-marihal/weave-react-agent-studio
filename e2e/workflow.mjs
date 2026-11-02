// Build › Workflow: the extras on Studio's React Flow canvas: templates, what an agent does as it takes over, its own
// settings, transfers to a number or to another agent, sticky notes, another agent's workflow, the Advanced panel,
// "used by" buttons, Test from the canvas, and the canvas's own moves (a dragged block keeps its place; Tidy up).
//   E2E_API_PORT=8426 E2E_WEB_PORT=5426 node e2e/workflow.mjs
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish, errors } = await suite('workflow');
const CANVAS = `${base}/agents/acme-support/build?view=canvas`;
const node = (id) => page.locator(`.react-flow__node[data-id="${id}"]`);
const draft = async (id = 'acme-support') => (await (await page.request.get(`${base}/api/bots/${id}/draft`)).json()).config;
const save = async () => {
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => /Saved/.test(document.body.innerText) && ![...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Save' && !b.disabled), null, { timeout: 15000 });
};
const selectBlock = async (id) => {
  // every block in sight first (a new block can be outside the view)
  await page.getByRole('button', { name: 'Fit to screen (Shift+1)' }).click();
  await page.waitForTimeout(400);
  await node(id).click();
  await page.getByRole('button', { name: 'Close the settings panel' }).waitFor({ timeout: 5000 });
};

await step('the Workflow opens on the canvas with the agent’s blocks', async () => {
  await page.goto(CANVAS, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await node('assistant').waitFor({ timeout: 60000 });
  check(await node('channel::web-chat').count() === 1, 'the channel is a block');
  check(await node('tool::end_call').count() === 1, 'a tool is a block');
});

await step('a dragged block keeps its place in the draft, and Tidy up forgets the places', async () => {
  await page.waitForTimeout(1500); // the first fit of the view has settled
  const box = await node('tool::end_call').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 35, box.y + 25);
  await page.mouse.move(box.x + 90, box.y + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => /Unsaved/i.test(document.body.innerText), null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Tidy up: lay every block out again' }).click();
  await page.waitForTimeout(300);
  check(await page.getByRole('button', { name: 'Tidy up: lay every block out again' }).isDisabled(), 'with no places saved there is nothing to tidy');
});

await step('Templates › Front desk with specialists adds Sales and Support, handed to by the first agent', async () => {
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.getByRole('menuitem', { name: /Front desk with specialists/ }).click();
  await node('sales').waitFor({ timeout: 5000 });
  await node('support').waitFor({ timeout: 5000 });
  await page.getByText('Added Sales and Support.', { exact: false }).first().waitFor({ timeout: 5000 });
  check(await page.locator('.react-flow__edge').count() >= 4, 'the hand-offs are arrows');
});

await step('Templates › Back to the first agent, then it says there is nothing more to add', async () => {
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.getByRole('menuitem', { name: /Back to the first agent/ }).click();
  await page.getByText(/Every agent can now pass callers back/).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.getByRole('menuitem', { name: /Back to the first agent/ }).getByText('Every agent can already pass callers back.').waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
});

await step('Templates › Every agent can end the conversation, and Undo takes it back', async () => {
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.getByRole('menuitem', { name: /Every agent can end the conversation/ }).click();
  await page.getByText(/Every agent can now end the conversation/).first().waitFor({ timeout: 5000 });
  const ends = await page.locator('.react-flow__edge').count();
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.react-flow__edge').length < n, ends, { timeout: 5000 });
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.getByRole('menuitem', { name: /Every agent can end the conversation/ }).click();
});

await step('on taking over: say a line and remember a value, in an order that can be changed', async () => {
  await selectBlock('sales');
  const enter = page.getByRole('region', { name: 'When it takes over' });
  await enter.getByRole('button', { name: 'Say a line' }).click();
  await enter.getByLabel('What it says in step 1').fill('Welcome to sales.');
  await enter.getByRole('button', { name: 'Remember a value' }).click();
  await enter.getByText(/There is nothing to remember yet/).waitFor({ timeout: 3000 });
  await enter.getByRole('button', { name: 'Move step 2 up' }).click();
  const first = await enter.locator('[data-enter-step="0"] p').first().innerText();
  check(/Remembers/.test(first), `the value is first now: ${first}`);
  await enter.getByRole('button', { name: 'Remove step 1' }).click();
  check((await enter.locator('[data-enter-step="0"] p').first().innerText()).includes('Welcome to sales.'), 'the line is left');
});

await step('its own settings: an AI model of its own, and whether callers can interrupt it', async () => {
  const own = page.getByRole('region', { name: 'Its own settings' });
  const model = own.getByLabel('AI model');
  const choice = await model.locator('option').nth(1).getAttribute('value');
  await model.selectOption(choice);
  await own.getByLabel('Callers can interrupt it').selectOption('false');
  check(await model.inputValue() === choice, 'the model is kept');
  await own.getByLabel('Callers can interrupt it').selectOption('');
});

await step('a transfer to a phone number is a tool the agent can use', async () => {
  const pass = page.getByRole('region', { name: 'Pass the call on' });
  await pass.getByLabel('To a phone number').fill('12345');
  check(await pass.getByRole('button', { name: 'Add' }).first().isDisabled(), 'a number without its country code is not taken');
  await pass.getByLabel('To a phone number').fill('+44 20 7946 0000');
  await pass.getByRole('button', { name: 'Add' }).first().click();
  await node('tool::transfer_to_442079460000').waitFor({ timeout: 5000 });
  await page.getByText(/can now transfer callers to \+44 20 7946 0000/).first().waitFor({ timeout: 5000 });
});

await step('a transfer to another agent of the workspace goes to that agent’s number', async () => {
  const made = await page.request.post(`${base}/api/bots/front-desk/numbers`, { data: { number: '+15550100', environment: 'development' } });
  check(made.ok(), `the stand-in took the number (${made.status()})`);
  await save();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await node('support').waitFor({ timeout: 30000 });
  await selectBlock('support');
  const pass = page.getByRole('region', { name: 'Pass the call on' });
  const other = pass.getByLabel('To another agent in this workspace');
  await page.waitForFunction(() => [...document.querySelectorAll('select option')].some((o) => /\+15550100/.test(o.textContent || '')), null, { timeout: 10000 });
  await other.selectOption('front-desk');
  await pass.getByRole('button', { name: 'Add' }).nth(1).click();
  await node('tool::transfer_to_front_desk').waitFor({ timeout: 5000 });
  await page.getByText(/can now put callers through to Front Desk \(\+15550100\)/).first().waitFor({ timeout: 5000 });
});

await step('“Named in” on a tool lists the agents that use it, and a press shows that agent', async () => {
  await selectBlock('tool::end_call');
  const named = page.locator('[data-used-by]').first();
  await named.waitFor({ timeout: 3000 });
  await named.getByRole('button', { name: /agent “Sales”/ }).click();
  await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="sales"]')?.classList.contains('selected'), null, { timeout: 5000 });
});

await step('a sticky note is added, kept in this browser across a reload, and deleted', async () => {
  await page.getByRole('button', { name: 'Add a sticky note (kept in this browser)' }).click();
  await page.getByText(/kept in this browser only/).first().waitFor({ timeout: 3000 });
  const note = page.locator('[data-sticky-note]').first();
  await note.getByLabel('Note', { exact: true }).fill('Ask legal about the refund rule.');
  await page.waitForTimeout(600);
  await note.getByRole('radio', { name: 'blue' }).click();
  await save().catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-sticky-note]').first().waitFor({ timeout: 30000 });
  check(await page.locator('[data-sticky-note] textarea').first().inputValue() === 'Ask legal about the refund rule.', 'the note came back');
  const stored = await page.evaluate(() => localStorage.getItem('weave_workflow_notes:acme-support'));
  check(stored?.includes('refund rule') && stored.includes('blue'), 'kept in this browser');
  check(!JSON.stringify(await draft()).includes('refund rule'), 'never in the configuration');
  await page.locator('[data-sticky-note]').first().getByRole('button', { name: 'Delete the note' }).click();
  check(await page.locator('[data-sticky-note]').count() === 0, 'the note is gone');
});

await step('Advanced › Agents: which agent answers first, every agent’s name and role', async () => {
  await page.getByRole('button', { name: /^Advanced/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Advanced' });
  await dialog.waitFor({ timeout: 3000 });
  check(await dialog.getByLabel('Answers first').inputValue() === 'assistant', 'the first agent is chosen');
  check(await dialog.getByLabel('Name of sales').inputValue() === 'Sales', 'each agent is listed');
  await dialog.getByLabel('Name of sales').fill('Sales team');
  await dialog.locator('tr', { has: page.getByText('support', { exact: true }) }).getByRole('button', { name: 'Show' }).click();
  await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="support"]')?.classList.contains('selected'), null, { timeout: 5000 });
  check((await node('sales').innerText()).includes('Sales team'), 'the new name is on the block');
});

await step('Advanced › Things it remembers: a value is added, said to be unused, and set on taking over', async () => {
  await page.getByRole('button', { name: /^Advanced/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Advanced' });
  await dialog.getByRole('button', { name: 'Things it remembers' }).click();
  await dialog.getByLabel('Name of the new value').fill('Bad Name');
  await dialog.getByText(/Use lowercase letters/).waitFor({ timeout: 3000 });
  await dialog.getByLabel('Name of the new value').fill('plan');
  await dialog.getByRole('button', { name: 'Add a value' }).click();
  const row = dialog.locator('[data-state-variable="plan"]');
  await row.waitFor({ timeout: 3000 });
  await row.getByText('Nothing uses this yet.').waitFor({ timeout: 3000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await selectBlock('sales');
  const enter = page.getByRole('region', { name: 'When it takes over' });
  await enter.getByRole('button', { name: 'Remember a value' }).click();
  await enter.getByLabel('Value of plan').fill('gold');
  await page.getByRole('button', { name: /^Advanced/ }).click();
  await dialog.getByRole('button', { name: 'Things it remembers' }).click();
  await row.getByRole('button', { name: /agent “Sales team”/ }).waitFor({ timeout: 3000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
});

await step('Advanced › Events: an event hook is added and its steps are listed', async () => {
  await page.getByRole('button', { name: /^Advanced/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Advanced' });
  await dialog.getByRole('button', { name: 'Events' }).click();
  await dialog.getByLabel('When', { exact: true }).selectOption('call_ended');
  await dialog.getByRole('button', { name: 'Add an event' }).click();
  const ev = dialog.locator('[data-event="0"]');
  await ev.getByText('No steps yet: add them below.').waitFor({ timeout: 3000 });
  await ev.getByText('Edit the steps (JSON)').click();
  await ev.getByLabel('Steps as JSON').fill('[{"type": "set_state", "values": {"plan": "done"}}]');
  await ev.getByRole('button', { name: 'Apply' }).click();
  await ev.getByText('Remembers plan').waitFor({ timeout: 3000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
});

await step('everything above is in the draft, as the server’s own settings', async () => {
  await save();
  const config = await draft();
  const sales = config.agents.items.find((a) => a.id === 'sales');
  check(sales.name === 'Sales team', 'renamed');
  check(JSON.stringify(sales.on_enter).includes('Welcome to sales.') && JSON.stringify(sales.on_enter).includes('"plan":"gold"'), `on taking over: ${JSON.stringify(sales.on_enter)}`);
  check(!!sales.overrides?.models?.llm?.model, 'its own model');
  check(config.state?.variables?.plan?.type === 'string', 'the remembered value');
  check(config.events?.[0]?.on === 'call_ended', 'the event');
  check(config.telephony.transfers.some((t) => t.target === '+15550100'), 'the transfer to the other agent');
});

await step('another agent’s workflow opens from the canvas', async () => {
  await page.getByLabel('Open another agent’s workflow').selectOption('front-desk');
  await page.waitForURL(/\/agents\/front-desk\/build\?view=canvas/, { timeout: 10000 });
  await node('assistant').waitFor({ timeout: 30000 });
  await page.getByLabel('Open another agent’s workflow').selectOption('acme-support');
  await page.waitForURL(/\/agents\/acme-support\/build\?view=canvas/, { timeout: 10000 });
});

await step('Test from the canvas opens the test of this agent', async () => {
  await node('assistant').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.waitForURL(/\/agents\/acme-support\/test/, { timeout: 10000 });
});

// Known warnings of the studio's toasts (ToastItem: a ref inside framer-motion's popLayout, a state update while rendering),
// not of these screens.
for (let i = errors.length - 1; i >= 0; i -= 1) if (errors[i].includes('ToastItem')) errors.splice(i, 1);

await finish();
