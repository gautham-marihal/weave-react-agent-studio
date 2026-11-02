// The Test workstream: the conversation (it can't start against the stand-in, which has no LiveKit, so the "can't
// start" state and everything around it), the test panel beside other pages, scenarios (write, check, run, paid and
// real-request options, results, "Add a mock", paste, edit as JSON, earlier runs), scripted callers and readiness checks.
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('test');
// The first page load compiles the app on demand, which can take a while.
page.setDefaultNavigationTimeout(90_000);
const AGENT = 'acme-support';
const testPage = (focus) => `${base}/agents/${AGENT}/test${focus ? `?focus=${focus}` : ''}`;
const main = () => page.locator('main');
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ');

/** Moves to a page of the agent without reloading (unsaved edits stay in the editor). */
async function stage(name) {
  await page
    .getByRole('navigation', { name: 'Agent stages' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
}

/** Build › JSON, opened in the app: the code editor (CodeMirror), which draws only the lines in sight. */
const JSON_FRAME = '[data-json-frame] [data-json-editor]';
async function jsonEditor() {
  await stage('Build');
  await page.getByRole('navigation', { name: 'Build sections' }).getByRole('button', { name: 'JSON', exact: true }).click();
  await page.waitForFunction((frame) => (document.querySelector(frame)?.weaveJsonText?.() || '').length > 20, JSON_FRAME, { timeout: 60_000 });
}

/** The editor's config, read from Build › JSON (what Save would send), through the editor's own hook. */
async function readConfig() {
  await jsonEditor();
  return JSON.parse(await page.evaluate((frame) => document.querySelector(frame).weaveJsonText(), JSON_FRAME));
}

/** Replaces the editor's config through Build › JSON, as a paste does (it applies after a short pause). */
async function writeConfig(config) {
  await jsonEditor();
  const text = JSON.stringify(config, null, 2);
  await page.locator('[data-json-frame] .cm-content').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await page.waitForFunction(([frame, wanted]) => document.querySelector(frame)?.weaveJsonText?.() === wanted, [JSON_FRAME, text], { timeout: 20_000 });
  await page.waitForTimeout(900);
}

async function openTab(name) {
  await page.getByRole('group', { name: 'Test Mode' }).getByRole('button', { name }).click();
}

// ---- the conversation

await step('the Test page opens with its five tabs, the conversation first', async () => {
  await page.goto(testPage());
  await main().getByText('Talk to your draft').waitFor();
  const tabs = await page.getByRole('group', { name: 'Test Mode' }).getByRole('button').allInnerTexts();
  check(
    JSON.stringify(tabs) === JSON.stringify(['Live conversation', 'Voice readiness', 'Scenarios', 'Scripted callers', 'Readiness checks']),
    `tabs: ${tabs.join(', ')}`,
  );
});

await step('“Talk to” offers the saved draft, the latest version and each environment something is live in', async () => {
  const options = await page.getByLabel('Talk to', { exact: true }).locator('option').allInnerTexts();
  check(options[0] === 'The saved draft', options.join(' | '));
  check(
    options.some((o) => /^Latest published \(v0\.1\.1\)$/.test(o)),
    options.join(' | '),
  );
  check(options.some((o) => /^Development \(v0\.1\.1\)$/.test(o)) && options.some((o) => /^Staging \(v0\.1\.0\)$/.test(o)), options.join(' | '));
});

await step('a conversation can’t start without LiveKit, and says so plainly with a way to try again', async () => {
  await main()
    .getByRole('button', { name: /Start chat test/ })
    .click();
  const alert = main()
    .getByRole('alert')
    .filter({ hasText: /not set up for test conversations/ });
  await alert.waitFor({ timeout: 15_000 });
  check(!/LIVEKIT_/.test(await text(alert)), 'server setting names are kept out of the message');
  check(await main().getByRole('button', { name: 'Try again' }).isVisible(), 'Try again is offered');
});

await step('talking to an environment says which version it runs, and asks for nothing to be saved', async () => {
  await page.goto(testPage());
  await page.getByLabel('Talk to', { exact: true }).selectOption('staging');
  await main().getByText('This talks to version 0.1.0').waitFor();
  check(/v0\.1\.0 · Staging/.test(await text(main())), 'the chip names the version and the environment');
  check(/Talk to the agent/.test(await text(main())), 'the title no longer says draft');
  await main()
    .getByRole('button', { name: /Start chat test/ })
    .click();
  await main()
    .getByRole('alert')
    .filter({ hasText: /not set up for test conversations/ })
    .waitFor({ timeout: 15_000 });
});

await step('unsaved model changes and parts the runtime does not run are said before starting', async () => {
  const config = await readConfig();
  config.defaults = {
    ...config.defaults,
    models: { ...(config.defaults?.models ?? {}), llm: { ...(config.defaults?.models?.llm ?? {}), provider: 'openai', model: 'gpt-4.1-mini-e2e' } },
  };
  await writeConfig(config);
  await stage('Test');
  await main().getByText('The AI models you chose aren’t saved yet').waitFor();
  check(/You’ll be asked to save before it starts/.test(await text(main())), 'it says the save comes first');
});

// ---- the test panel beside other pages

await step('a “Try it” button on other pages opens the test panel beside the page', async () => {
  await stage('Build');
  const toggle = page.getByRole('button', { name: /Try it: talk to the agent/ });
  await toggle.waitFor();
  await toggle.click();
  const dock = page.getByRole('complementary', { name: 'Test panel' });
  await dock.waitFor();
  check(/Talk to your draft/.test(await text(dock)), 'the panel holds the conversation');
  check(await dock.getByLabel('Talk to', { exact: true }).isVisible(), 'the panel can talk to a version too');
});

await step('the panel stays open across pages and its conversation is the Test page’s', async () => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByText(/^Saved/)
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => undefined);
  const dock = page.getByRole('complementary', { name: 'Test panel' });
  // The panel shows the conversation the Test page started (it is the same one); a new one starts from here too.
  check(/not set up for test conversations/.test(await text(dock)), 'the Test page’s conversation is in the panel');
  await dock.getByRole('button', { name: 'New conversation' }).click();
  await dock.getByText(/not set up for test conversations/).waitFor({ timeout: 15_000 });
  await stage('Release');
  await page.waitForURL(/\/release/);
  check(await dock.isVisible(), 'still open on Release');
  check(/not set up for test conversations/.test(await text(dock)), 'the same conversation (its error) is still shown');
  await stage('Test');
  await page.waitForURL(/\/test/);
  // On the Test page the page itself is the conversation.
  await dock.waitFor({ state: 'hidden', timeout: 5_000 });
  check(/not set up for test conversations/.test(await text(main())), 'and it shows the same conversation');
  await stage('Overview');
  await dock.waitFor();
  await dock.getByRole('button', { name: 'Close the test panel' }).click();
  check(!(await dock.isVisible()), 'closed');
  check(await page.getByRole('button', { name: /Try it: talk to the agent/ }).isVisible(), 'the button is back');
});

// ---- scenarios

await step('Scenarios start with an invitation, and Run all waits for one', async () => {
  await page.goto(testPage('scenarios'));
  await main().getByText('No scenarios yet').waitFor();
  check(
    await main()
      .getByRole('button', { name: /Run all \(0\)/ })
      .isDisabled(),
    'Run all is disabled',
  );
  check(/never calls a real API/.test(await text(main())), 'it says mocks answer, not real systems');
});

await step('a scenario with mistakes isn’t added, and says what to fix', async () => {
  await main().getByRole('button', { name: 'New scenario' }).click();
  const form = main().getByRole('form', { name: 'New scenario' });
  await form.getByLabel('Id', { exact: true }).fill('Bad Id');
  await form.getByLabel('Turn 1: what the caller says').fill('');
  await form.getByRole('button', { name: 'Add the scenario' }).click();
  const words = await text(form);
  check(/Start with a lowercase letter/.test(words), 'the id problem is shown');
  check(/Every turn needs some words/.test(words), 'the turn problem is shown');
  check(/Not added to the draft yet/.test(words), 'it says it was not added');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await main().getByText('No scenarios yet').waitFor();
});

await step('write a scenario: it goes into the draft as a live one, unsaved', async () => {
  await main().getByRole('button', { name: 'New scenario' }).click();
  const form = main().getByRole('form', { name: 'New scenario' });
  await form.getByLabel('Id', { exact: true }).fill('asks_for_a_person');
  await form.getByLabel('Turn 1: what the caller says').fill('Can I speak to a human?');
  await form.getByLabel('Expectation 1: what to check').selectOption('tool_called');
  await form.getByLabel('Expectation 1: tool').selectOption('escalate_to_human');
  await form.getByRole('button', { name: 'Add an expectation' }).click();
  await form.getByLabel('Expectation 2: what to check').selectOption('said_matches');
  await form.getByLabel('Expectation 2: pattern').fill('refund');
  await form.getByRole('button', { name: 'Add the scenario' }).click();
  const row = main().locator('[data-scenario="asks_for_a_person"]');
  await row.waitFor();
  check(/Live/.test(await text(row)), 'no model script: it is live');
  check(/2 checks/.test(await text(row)), 'two checks');
  await main().getByText('Runs use your edits, saved or not').waitFor();
});

await step('every one of the thirteen kinds of check can be chosen in the form', async () => {
  await main().getByRole('button', { name: 'Edit asks_for_a_person' }).click();
  const form = main().getByRole('form', { name: 'Edit asks_for_a_person' });
  const kinds = await form.getByLabel('Expectation 1: what to check').locator('option').count();
  check(kinds === 13, `${kinds} kinds`);
  await form.getByRole('button', { name: 'Cancel' }).click();
});

await step('a live scenario is skipped unless included, and the run tests the unsaved edits', async () => {
  await main()
    .getByRole('button', { name: /Run all \(1\)/ })
    .click();
  const row = main().locator('[data-scenario="asks_for_a_person"]');
  await row.getByText('Skipped').first().waitFor({ timeout: 15_000 });
  const run = main().getByRole('status', { name: 'Current run' });
  check(/your unsaved edits/.test(await text(run)), 'the run is marked as the unsaved edits');
  check(/no model script/.test(await text(row)), 'it says why it was skipped');
});

await step('including live scenarios asks first because it costs money, and the Run button says so', async () => {
  await main().getByText('Paid and real-request options').click();
  await page.getByLabel('Include live scenarios').click();
  const dialog = page.getByRole('dialog', { name: 'Run live scenarios?' });
  await dialog.waitFor();
  check(/billed by the model’s provider/.test(await text(dialog)), 'the cost is explained');
  await dialog.getByRole('button', { name: 'Include live scenarios' }).click();
  await main()
    .getByRole('button', { name: /Run all \(1\) · uses a paid model/ })
    .waitFor();
  check(/\(on\)/.test(await text(main().getByText(/Paid and real-request options/))), 'the options say they are on');
});

await step('a failed live scenario says which check failed and why, with the trace', async () => {
  await main()
    .getByRole('button', { name: /Run all \(1\)/ })
    .click();
  const row = main().locator('[data-scenario="asks_for_a_person"]');
  await row.getByText('Failed').first().waitFor({ timeout: 15_000 });
  const words = await text(row);
  check(/the tool “escalate_to_human” is used/.test(words), 'the passing check is listed');
  check(/the agent says something matching \/refund\//.test(words), 'the failing check is listed');
  check((await row.locator('[data-passed="false"]').count()) >= 1, 'a check is marked failed');
  check(/The trace \(\d+ records\)/.test(words), 'the trace is there');
  check(/0 passed · 1 failed/.test(await text(main().getByRole('status', { name: 'Current run' }))), 'the run counts it');
});

await step('letting requests reach real systems is off, asks first, and says so on Run all', async () => {
  const box = page.getByLabel('Let requests reach real systems');
  check(!(await box.isChecked()), 'off by default');
  await box.click();
  const dialog = page.getByRole('dialog', { name: 'Let runs send requests to real systems?' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Not now' }).click();
  check(!(await box.isChecked()), 'declining leaves it off');
  check(!/real requests/.test(await text(main().getByRole('button', { name: /Run all/ }))), 'the button says nothing about it');
  await box.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Allow real requests' }).click();
  await main()
    .getByRole('button', { name: /real requests/ })
    .waitFor();
  await box.click();
  check(!/real requests/.test(await text(main().getByRole('button', { name: /Run all/ }))), 'switching it off takes the words away');
});

await step('editing a scenario puts the change into the draft', async () => {
  await main().getByRole('button', { name: 'Edit asks_for_a_person' }).click();
  const form = main().getByRole('form', { name: 'Edit asks_for_a_person' });
  await form.getByLabel('Turn 1: what the caller says').fill('Can I talk to a real person please?');
  await form.getByRole('button', { name: 'Save the scenario' }).click();
  const row = main().locator('[data-scenario="asks_for_a_person"]');
  await row.getByText('Can I talk to a real person please?').waitFor();
});

await step('pasted scenarios are added and bad ones reported', async () => {
  await main().getByRole('button', { name: 'Paste scenarios…' }).click();
  await page.getByLabel('Scenarios as JSON').fill(
    JSON.stringify([
      { id: 'good', channel: 'web-chat', turns: [{ say: 'hi' }], expect: [{ said_matches: 'x' }] },
      { id: 'bad', channel: 'nope', turns: [], expect: [] },
    ]),
  );
  await main().getByRole('button', { name: 'Add them' }).click();
  const status = main().getByRole('region', { name: 'Paste scenarios' }).getByRole('status');
  await status.waitFor();
  check(/Added 1 scenario/.test(await text(status)), await text(status));
  check(/bad: .*no channel “nope”/.test(await text(status)), await text(status));
  await main().locator('[data-scenario="good"]').waitFor();
});

await step('a scenario with the newer fields opens whole in the form, and saving keeps all of it', async () => {
  const rich = {
    id: 'a_hazard_reaches_the_line',
    description: 'A hazard goes straight to a person.',
    channel: 'web-chat',
    now: '2026-10-14T03:00:00+08:00',
    state: { verified: true },
    http_mocks: [{ method: 'GET', path: '/orders/*', json: { found: true } }],
    model_script: [{ tool: 'end_call' }, 'Goodbye.'],
    turns: [{ say: 'There is a gas leak' }],
    expect: [
      { tool_called_with: { tool: 'end_call', args: {} } },
      { agent_is: 'assistant' },
      { http_called: { method: 'GET', path: '/orders/*', times: 1 } },
      { sentiment_is: 'calm' },
    ],
  };
  await page.getByLabel('Scenarios as JSON').fill(JSON.stringify([rich]));
  await main().getByRole('button', { name: 'Add them' }).click();
  await main().getByRole('button', { name: 'Close', exact: true }).click();
  await main()
    .getByRole('button', { name: `Edit ${rich.id}` })
    .click();
  const form = main().getByRole('form', { name: `Edit ${rich.id}` });
  check(/Scripted/.test(await text(form)), 'a script makes it scripted');
  check((await form.locator('[data-kind="unknown"]').count()) === 1, 'the kind it does not know is kept');
  check(/kept exactly as it is/.test(await text(form)), 'and says so');
  check((await form.getByLabel('Pretend it is').inputValue()) === rich.now, 'the clock');
  check((await form.getByLabel('Expectation 3: how many times').inputValue()) === '1', 'times');
  check((await form.getByLabel('Mock 1: path').inputValue()) === '/orders/*', 'the mock');
  check((await form.getByLabel('Model reply 1: tool').inputValue()) === 'end_call', 'the model script');
  await form.getByLabel('Turn 1: what the caller says').fill('There is a gas leak!');
  await form.getByRole('button', { name: 'Save the scenario' }).click();
  await main()
    .getByRole('button', { name: `Edit ${rich.id}` })
    .click();
  const again = main().getByRole('form', { name: `Edit ${rich.id}` });
  await again.getByRole('button', { name: 'Edit as JSON' }).click();
  const saved = JSON.parse(await again.getByLabel('The scenario as JSON').inputValue());
  check(JSON.stringify(saved) === JSON.stringify({ ...rich, turns: [{ say: 'There is a gas leak!' }] }), JSON.stringify(saved));
  await again.getByRole('button', { name: 'Cancel' }).click();
});

await step('deleting a scenario asks first, then takes it out of the draft', async () => {
  await main().getByRole('button', { name: 'Delete good' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete the scenario “good”?' });
  await dialog.getByRole('button', { name: 'Delete scenario' }).click();
  await main().locator('[data-scenario="good"]').waitFor({ state: 'detached' });
});

await step('a request no mock answered offers “Add a mock”, and the mock goes into the scenario', async () => {
  const config = await readConfig();
  config.connections = { ...(config.connections ?? {}), api: { type: 'http', base_url: 'https://api.example.com' } };
  config.tools = [
    ...(config.tools ?? []),
    {
      id: 'find_order',
      type: 'http',
      description: 'Looks up an order',
      connection: 'api',
      request: { method: 'GET', path: '/orders/{{args.order_id}}' },
      parameters: { type: 'object', properties: { order_id: { type: 'string' } } },
    },
  ];
  config.agents.items[0].tools = [...(config.agents.items[0].tools ?? []), 'find_order'];
  config.tests = [
    ...(config.tests ?? []),
    {
      id: 'lookup',
      channel: 'web-chat',
      model_script: [{ tool: 'find_order', args: { order_id: 'NB-1' } }, 'It shipped.'],
      turns: [{ say: 'Where is NB-1?' }],
      expect: [{ http_called: { method: 'GET', path: '/orders/*' } }],
    },
  ];
  await writeConfig(config);
  await stage('Test');
  await openTab('Scenarios');
  await main().getByRole('button', { name: 'Run lookup' }).click();
  const row = main().locator('[data-scenario="lookup"]');
  // The request was made, so the check passes and the result stays folded: it is opened to see the request.
  await row.locator('summary').first().waitFor({ timeout: 15_000 });
  await row.locator('summary').first().click();
  await row.getByText(/no mock answered/).waitFor();
  check(/GET \/orders\/NB-1/.test(await text(row)), 'the request is named');
  await row.getByRole('button', { name: 'Add a mock' }).click();
  await row.getByRole('button', { name: 'Mock added: run it again' }).waitFor();
  const after = await readConfig();
  const mocks = after.tests.find((t) => t.id === 'lookup').http_mocks;
  check(JSON.stringify(mocks) === JSON.stringify([{ path: '/orders/NB-1', status: 200, json: {}, method: 'GET', connection: 'api' }]), JSON.stringify(mocks));
});

await step('saved, a run tests the saved draft, and earlier runs can be opened', async () => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(800);
  await stage('Test');
  await openTab('Scenarios');
  await main().getByRole('button', { name: 'Run lookup' }).click();
  const run = main().getByRole('status', { name: 'Current run' });
  await run.getByText('Latest run').waitFor({ timeout: 15_000 });
  check(/draft/.test(await text(run)) && !/unsaved/.test(await text(run)), await text(run));
  const earlier = main().getByRole('region', { name: 'Earlier runs' });
  await earlier.waitFor();
  const buttons = earlier.getByRole('button');
  check((await buttons.count()) >= 2, 'more than one earlier run');
  const label = await buttons.nth(1).innerText();
  await buttons.nth(1).click();
  await earlier.locator('button[aria-pressed="true"]').filter({ hasText: label }).waitFor();
});

// ---- scripted callers

await step('scripted callers: callers and checks to pick from, with a count, Clear and Select all', async () => {
  await openTab('Scripted callers');
  const callers = main().getByRole('region', { name: 'Callers' });
  await callers.waitFor();
  const all = await main().locator('[data-key]').count();
  check(all >= 12, `${all} to choose from`);
  const count = main().getByTestId('caller-count');
  check(/^\d+ of \d+ chosen$/.test(await count.innerText()), await count.innerText());
  await main().getByRole('button', { name: 'Clear' }).click();
  check(/^0 of/.test(await count.innerText()), 'cleared');
  check(
    await main()
      .getByRole('button', { name: /Try 0 on the draft/ })
      .isDisabled(),
    'nothing to try',
  );
  await main().getByRole('button', { name: 'Select all' }).click();
  check(new RegExp(`^${all} of ${all} chosen$`).test(await count.innerText()), await count.innerText());
  check(!/simulat/i.test(await text(main())), 'the word for imitation is never used');
});

await step('a caller shows what it says, and can be kept as a test without running', async () => {
  const row = main().locator('[data-key="caller_frustrated"]');
  await row.getByRole('button', { name: /What it says/ }).click();
  check(/a reviewer agrees that/.test(await text(row)), 'the reviewer check is listed');
  await row.getByRole('button', { name: /Keep as a test.*Frustrated/ }).click();
  await row.getByText('A test').waitFor();
  check(!(await row.getByRole('button', { name: /Keep as a test/ }).count()), 'not offered again');
  await main()
    .getByText(/Added a test to the draft, not saved yet/)
    .waitFor();
});

await step('callers run on what is in the editor once the cost is accepted, and the good ones can be kept', async () => {
  await main().getByRole('button', { name: 'Clear' }).click();
  for (const key of ['caller_direct', 'caller_wants_person', 'check_greets', 'check_hangs_up'])
    await main().locator(`[data-key="${key}"]`).getByRole('checkbox').check();
  const tryIt = main().getByRole('button', { name: /Try 4 on the draft/ });
  check(await tryIt.isDisabled(), 'waits for the cost to be accepted');
  await page.getByLabel('These use the live model and cost money').check();
  await tryIt.click();
  await main()
    .getByText(/need a look|that ran passed/)
    .first()
    .waitFor({ timeout: 20_000 });
  check((await main().locator('[data-result]').count()) >= 4, 'each one has a result');
  const direct = main().locator('[data-key="caller_direct"]');
  await direct.getByRole('button', { name: /Details/ }).click();
  check(/The caller says/.test(await text(direct)) && /What should hold afterwards/.test(await text(direct)), 'the details show what it said and the checks');
  const keep = main().getByRole('button', { name: 'Keep the ones that passed as tests' });
  if (await keep.count()) {
    await keep.click();
    await main()
      .getByText(/to the draft, not saved yet/)
      .first()
      .waitFor();
  }
  const config = await readConfig();
  check(
    config.tests.some((t) => t.id === 'caller_frustrated' && /^Scripted caller: /.test(t.description)),
    'the kept caller is a test in the draft',
  );
});

// ---- readiness checks

await step('readiness checks read the draft or a version, and keep each run in this browser', async () => {
  await page.goto(testPage('checks'));
  await main().getByText('No checks run yet').waitFor();
  await main()
    .getByRole('button', { name: /Run 12 checks/ })
    .click();
  const runs = main().getByRole('region', { name: 'Earlier checks' });
  await runs.waitFor();
  check(/Kept in this browser/.test(await text(runs)), 'it says where runs are kept');
  check(/Passed \d+ of 12/.test(await text(runs)), await text(runs));
  check(/The saved draft/.test(await text(runs)), 'it names what was checked');
  check((await runs.locator('[data-passed]').count()) === 12, 'each check is listed');
  await page.getByLabel('Which version to check').selectOption('0.1.0');
  await main()
    .getByRole('button', { name: /Run 12 checks/ })
    .click();
  await runs.getByText('Version 0.1.0').waitFor();
  const ids = await runs.locator('[data-check-run]').evaluateAll((els) => els.map((e) => e.getAttribute('data-check-run')));
  check(ids.length === 2 && ids.every((id) => /^check_/.test(id)), ids.join(', '));
  await page.reload();
  await main().getByRole('region', { name: 'Earlier checks' }).waitFor();
  check((await main().locator('[data-check-run]').count()) === 2, 'the history is still there after a reload');
});

await finish();
