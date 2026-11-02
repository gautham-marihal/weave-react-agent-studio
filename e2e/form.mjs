// The schema-driven settings form ("All settings"), technical names, deep links and the Problems panel, against the
// stand-in API. Each step is one thing a person does and what they then see.
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('form');
// leaving a page with unsaved edits asks first; the steps answer "leave"
page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });

const AGENT = 'acme-support';
const all = async () => {
  await page.goto(`${base}/agents/${AGENT}/build?view=all`);
  await page.locator('[data-settings-form]').waitFor({ timeout: 20_000 });
};
const screen = async (group, view) => {
  await page.locator(`[data-group="${group}"]`).click();
  if (view) await page.locator(`[data-screen="${view}"]`).click();
  await page.locator(`[data-screen-id="${view ?? ''}"]`).first().waitFor({ timeout: 5_000 }).catch(() => {});
};
const field = (path) => page.locator(`[data-path="${path}"]`).first();
// a card opens when it is shut (a short list's cards are open already)
const openCard = async (card) => {
  await card.waitFor();
  const toggle = card.locator(':scope > header button[aria-expanded]');
  if (!(await toggle.count())) return; // drawn open, with no fold (the only setting of its screen)
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
};
const urlHas = (text) => page.waitForFunction((t) => window.location.href.includes(t), text, { timeout: 8_000 });

await step('All settings is drawn from the server’s schema, grouped by what each part is for', async () => {
  await all();
  const groups = await page.locator('[data-group]').allInnerTexts();
  check(groups.length === 8, `8 groups, got ${groups.length}: ${groups.join(' | ')}`);
  check(/About this agent/.test(groups[0]) && /Engine and operator settings/.test(groups[7]), `group order: ${groups.join(' | ')}`);
  await page.getByRole('heading', { name: 'Name and details' }).waitFor();
  await page.getByRole('textbox', { name: 'Description' }).waitFor();
});

await step('Settings read in plain words; what the server sets is shown but can’t be changed', async () => {
  await screen('about', 'persona');
  await page.getByText('Name it introduces itself by', { exact: true }).waitFor();
  await screen('about', 'meta');
  const id = page.locator('#field-meta\\.id-input');
  check(await id.isDisabled(), 'the agent id is read-only');
  await field('meta.id').getByText('Set by the server').waitFor();
});

await step('Technical names: a path chip per setting, Copy path, and In JSON opens the JSON view', async () => {
  await page.getByRole('switch', { name: 'Show technical names' }).click();
  const chip = field('meta.name').locator('[data-tech-name="meta.name"]');
  await chip.waitFor();
  await chip.getByRole('button', { name: 'Copy the path of name' }).click();
  await chip.getByRole('status').filter({ hasText: 'Copied' }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(copied === 'meta.name', `copied “${copied}”`);
  await chip.getByRole('button', { name: 'Open name in the JSON' }).click();
  await urlHas('view=json');
  await all();
  const toggle = page.getByRole('switch', { name: 'Show technical names' });
  if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
  check(!(await page.locator('[data-tech-name]').count()), 'technical names are off again');
});

await step('A change goes into the draft unsaved, and Undo takes it back', async () => {
  await all();
  const box = page.locator('#field-meta\\.description-input');
  const before = await box.inputValue();
  await box.fill('Answers questions about orders');
  await page.getByText('Unsaved changes').first().waitFor();
  await page.getByRole('heading', { name: 'Name and details' }).click();
  await page.keyboard.press('Control+z');
  await page.waitForFunction((v) => document.querySelector('#field-meta\\.description-input')?.value === v, before, { timeout: 5_000 });
});

await step('An unset setting shows its default; changing it sets it, and Reset brings the default back', async () => {
  await screen('talks', 'defaults.conversation');
  const row = field('defaults.conversation.inactivity.clock');
  await row.waitFor();
  await row.getByText('Default', { exact: true }).waitFor();
  const select = page.locator('#field-defaults\\.conversation\\.inactivity\\.clock-input');
  check(/\(default\)/.test(await select.locator('option:checked').innerText()), 'the default choice is marked');
  await select.selectOption('silence');
  await row.getByRole('button', { name: /Reset What counts as quiet to its default/ }).click();
  await row.getByText('Default', { exact: true }).waitFor();
});

await step('if/then: a built-in tool shows only the settings its action takes', async () => {
  await screen('does', 'tools');
  const handover = field('tools[1]');
  await openCard(handover);
  await openCard(field('tools[1].params'));
  await handover.getByText('Which transfer', { exact: true }).waitFor();
  const endCall = field('tools[0]');
  await openCard(endCall);
  await openCard(field('tools[0].params'));
  await endCall.getByText('What it says', { exact: true }).first().waitFor();
  check(!(await endCall.getByText('Which transfer', { exact: true }).count()), 'ending the call has no transfer to choose');
});

await step('A choice of kinds (oneOf): picking “Message” shows the fixed-line picker', async () => {
  await screen('where', 'channels');
  const channel = field('channels[0]');
  await openCard(channel);
  const say = channel.locator('[data-path="channels[0].greeting.say"]');
  await say.getByRole('button', { name: 'Message', exact: true }).click();
  await say.locator('select').first().waitFor();
});

await step('A field that points at something can make it there: a new fixed line, chosen at once', async () => {
  const say = field('channels[0].greeting.say');
  await say.getByRole('button', { name: 'New fixed line' }).click();
  await say.getByLabel('What it says').last().fill('Hello and welcome to Acme');
  await say.getByRole('button', { name: 'Make it and use it' }).click();
  await page.getByRole('status').filter({ hasText: 'Made fixed line “hello_and_welcome”' }).waitFor();
  const chosen = await say.locator('select').first().inputValue();
  check(chosen === 'hello_and_welcome', `the field points at the new line (${chosen})`);
});

await step('Renaming an id changes it everywhere that points at it', async () => {
  await screen('behaves', 'agents');
  const agent = field('agents.items[0]');
  await openCard(agent);
  await agent.getByRole('button', { name: 'Rename…' }).click();
  const dialog = page.getByRole('dialog', { name: /Rename agent “assistant”/ });
  await dialog.getByLabel('New name').fill('front_desk');
  await dialog.getByRole('button', { name: /Rename and update 1 place/ }).click();
  await page.getByRole('status').filter({ hasText: 'Renamed agent “assistant” to “front_desk” and updated 1 place.' }).waitFor();
  const entry = await page.locator('#field-agents\\.entry-input').inputValue();
  check(entry === 'front_desk', `who answers first follows the new name (${entry})`);
});

await step('A section the agent doesn’t have yet is drawn with its defaults; a named entry is added and renamed in place', async () => {
  await screen('behaves', 'state');
  const vars = field('state.variables');
  await openCard(vars);
  await vars.getByRole('button', { name: 'Add variable' }).click();
  const name = vars.getByLabel('Name of “variable_1”');
  await name.fill('order_number');
  await name.press('Enter');
  await page.getByRole('status').filter({ hasText: 'Renamed remembered value “variable_1” to “order_number”.' }).waitFor();
  await field('state.variables.order_number').waitFor();
});

await step('Deleting something others point at asks first, can take the references out too, and can be undone', async () => {
  await screen('does', 'tools');
  await field('tools[0]').getByRole('button', { name: 'Delete end_call' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete tool “end_call”?' });
  await dialog.getByText('Used in 1 place').waitFor();
  await dialog.getByRole('button', { name: 'Delete and remove those references' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Deleted tool “end_call” and the references to it.' });
  await toast.waitFor();
  check((await page.locator('[data-path^="tools["][data-path$="]"]').count()) === 1, 'one tool left');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await field('tools[1]').waitFor();
  check((await field('tools[0]').innerText()).includes('end_call'), 'end_call is back');
});

await step('Problems panel: a reference to nothing is said plainly, with the nearest names as one-click fixes and Undo', async () => {
  await field('tools[0]').getByRole('button', { name: 'Delete end_call' }).click();
  await page.getByRole('dialog', { name: 'Delete tool “end_call”?' }).getByRole('button', { name: 'Delete anyway' }).click();
  const panel = page.locator('#checks-panel');
  const problem = panel.locator('li').filter({ hasText: 'There is no tool called “end_call”. Choose one that exists.' });
  await problem.waitFor({ timeout: 10_000 });
  check(/Agents/.test(await problem.innerText()), 'the place is named by its labels');
  // Show me opens the setting the problem is about
  await problem.getByRole('button', { name: /Show me:/ }).click();
  await page.waitForFunction(() => (document.activeElement?.closest('[data-path]')?.getAttribute('data-path') || '').startsWith('agents.items[0].tools'), null, { timeout: 8_000 });
  await problem.getByRole('button', { name: 'Use “escalate_to_human”' }).click();
  const done = panel.getByRole('status').filter({ hasText: 'Done: Use “escalate_to_human”' });
  await done.waitFor();
  await problem.waitFor({ state: 'detached', timeout: 10_000 });
  await done.getByRole('button', { name: 'Undo' }).click();
  await panel.locator('li').filter({ hasText: 'There is no tool called “end_call”' }).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Control+z');
});

await step('Problems panel: a tool no agent is offered can be offered in one click', async () => {
  await screen('does', 'tools');
  await page.getByRole('combobox', { name: 'Add tool' }).selectOption({ label: 'Built-in' });
  const panel = page.locator('#checks-panel');
  const unused = panel.locator('li').filter({ hasText: /The tool “tool_1” isn’t offered to any agent/ });
  await unused.waitFor({ timeout: 10_000 });
  await unused.getByRole('button', { name: /Offer it to “/ }).click();
  await unused.waitFor({ state: 'detached', timeout: 10_000 });
});

// ---- deep links (a fresh page, so unsaved edits are dropped) --------------------------------------------------------

await step('?setting= opens the Build section, the screen and the exact field', async () => {
  await page.goto(`${base}/agents/${AGENT}/build/tools?setting=defaults.conversation.inactivity.timeout_s`);
  await page.waitForFunction(() => document.activeElement?.id === 'field-defaults.conversation.inactivity.timeout_s-input', null, { timeout: 15_000 });
  check(!page.url().includes('setting='), 'the request is taken off the address');
  check(/\/build$|\/build\/agent/.test(new URL(page.url()).pathname), `on the Agent section: ${page.url()}`);
});

await step('?tool= opens that tool on the Tools section', async () => {
  await page.goto(`${base}/agents/${AGENT}/build?tool=escalate_to_human`);
  // the Tools page lists every tool as a row; the link focuses that tool's row
  await page.waitForFunction(() => document.activeElement?.closest('[data-tool]')?.getAttribute('data-tool') === 'escalate_to_human', null, { timeout: 15_000 });
  check(page.url().includes('/build/tools'), page.url());
});

await step('?open=voice opens the voice block of the Agent section', async () => {
  await page.goto(`${base}/agents/${AGENT}/build/channels?open=voice`);
  await urlHas('/build/agent');
  await page.waitForFunction(() => {
    const el = document.activeElement;
    return !!el && (!!el.closest('[id^="field-defaults.models.tts.voice_id"]') || !!el.closest('#g-voice'));
  }, null, { timeout: 15_000 });
});

await step('?show=problems brings the checks into view; ?show=json opens the JSON view; ?view=detailed opens All settings', async () => {
  await page.goto(`${base}/agents/${AGENT}/build?show=problems`);
  await page.waitForFunction(() => document.getElementById('checks-panel')?.classList.contains('ring-2'), null, { timeout: 15_000 });
  await page.goto(`${base}/agents/${AGENT}/build?show=json`);
  await urlHas('view=json');
  await page.goto(`${base}/agents/${AGENT}/build?view=detailed`);
  await page.locator('[data-settings-form]').waitFor({ timeout: 15_000 });
  check(await page.getByRole('button', { name: 'All settings', pressed: true }).count(), 'All settings is the chosen view');
});

await step('The search in All settings finds any setting by its plain name and opens it', async () => {
  await all();
  await page.getByLabel('Search settings').fill('nudge');
  await page.getByRole('listbox', { name: 'Settings found' }).getByRole('button', { name: /Nudge a silent caller/ }).first().click();
  await page.waitForFunction(() => document.activeElement?.id === 'field-defaults.conversation.inactivity.enabled-input', null, { timeout: 10_000 });
});

await step('The Agent section shows its own part of the settings, below its plain controls', async () => {
  // Channels and Tools have their own pages (every channel and tool as a row), so they have no part of All settings
  await page.goto(`${base}/agents/${AGENT}/build/channels`);
  await page.getByRole('heading', { name: 'All channels' }).waitFor({ timeout: 15_000 });
  check(!(await page.getByRole('region', { name: 'All settings for Channels' }).count()), 'Channels asks nothing twice');
  await page.goto(`${base}/agents/${AGENT}/build/agent`);
  const part = page.getByRole('region', { name: 'All settings for Agent' });
  await part.locator('[data-settings-form]').waitFor({ timeout: 15_000 });
  const screens = await part.locator('[data-screen]').allInnerTexts();
  check(screens.length > 0, 'the Agent part has its screens');
  check(!(await part.locator('[data-group]').count()), 'no group menu inside a section');
});

await step('A viewer sees every setting but can change none', async () => {
  const viewer = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await viewer.addInitScript(() => {
    sessionStorage.setItem('weave_auth_user', JSON.stringify({ id: 'v', name: 'View Only', email: 'view.only@example.com', initials: 'VO', role: 'viewer' }));
  });
  const p = await viewer.newPage();
  await p.goto(`${base}/agents/${AGENT}/build?view=all`);
  await p.locator('[data-settings-form]').waitFor({ timeout: 20_000 });
  check(await p.locator('#field-meta\\.name-input').isDisabled(), 'the name is read-only for a viewer');
  check(!(await p.getByRole('button', { name: 'Reset to defaults' }).count()), 'no reset for a viewer');
  await viewer.close();
});

await finish();
