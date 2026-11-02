// Sandbox, the test workstream: in Sandbox the Test page and the test panel talk to the imitation agent (with the
// editor's unsaved edits), each made-up reply is tagged, tools and hand-offs show in the trace, and a finished
// conversation is kept as one of the agent's calls ("Test: simulated chat") with a line in the bell. Replays, scripted
// callers and scenarios run on the imitation and say so; the checks, Calls and Analytics pages say what is made up.
// Live shows none of it (the first step).
//   E2E_LOOK=<dir>   also save light and dark screenshots of each Sandbox screen there
import path from 'node:path';
import { check, openBrowser, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('sandbox-test');
page.setDefaultNavigationTimeout(90_000);
const AGENT = 'acme-support';
const testPage = (focus) => `${base}/agents/${AGENT}/test${focus ? `?focus=${focus}` : ''}`;
const main = () => page.locator('main');
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ');
const sandboxNotes = () => page.locator('[data-sandbox-note]');

async function stage(name) {
  await page
    .getByRole('navigation', { name: 'Agent stages' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
}
const JSON_FRAME = '[data-json-frame] [data-json-editor]';
async function jsonEditor() {
  await stage('Build');
  await page.getByRole('navigation', { name: 'Build sections' }).getByRole('button', { name: 'JSON', exact: true }).click();
  await page.waitForFunction((frame) => (document.querySelector(frame)?.weaveJsonText?.() || '').length > 20, JSON_FRAME, { timeout: 60_000 });
}
async function writeJson(text) {
  await jsonEditor();
  await page.locator('[data-json-frame] .cm-content').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await page.waitForFunction(([frame, wanted]) => document.querySelector(frame)?.weaveJsonText?.() === wanted, [JSON_FRAME, text], { timeout: 20_000 });
  await page.waitForTimeout(900);
}
const openTab = (name) => page.getByRole('group', { name: 'Test Mode' }).getByRole('button', { name }).click();

// ---- Live first (before Sandbox is chosen): nothing made up is shown or reachable

await step('Live: the Test page, callers, scenarios, Calls and a replay are the real ones, with nothing simulated', async () => {
  await page.goto(testPage());
  await main().getByText('Talk to your draft').waitFor();
  check(/Real LiveKit/.test(await text(main())), 'the chip says Real LiveKit');
  check(!/simulat|Sandbox imitation/i.test(await text(main())), 'Live mentions a simulation');
  check((await page.getByLabel('Talk to', { exact: true }).locator('option').first().innerText()) === 'The saved draft', 'Live talks to the saved draft');
  await openTab('Scripted callers');
  await page.getByLabel('These use the live model and cost money').waitFor();
  await openTab('Scenarios');
  await main().getByText('Paid and real-request options').waitFor();
  check(!(await main().getByText('Sandbox imitation').count()), 'the runner chip shows in Live');
  await page.goto(`${base}/calls`);
  await main().getByText('Live and recorded conversations from the Agent Builder API.').waitFor();
  const calls = await (await fetch(`${base}/api/bots/${AGENT}/calls?limit=100`)).json();
  const withWords = calls.calls.find((c) => c.status === 'ended' && c.caller_turns > 0);
  await page.goto(`${base}/calls/${encodeURIComponent(withWords.id)}?agent=${AGENT}`);
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Replay on the runtime' }).waitFor();
  check(!(await dialog.getByRole('button', { name: 'Replay in the browser' }).count()), 'Live offers a replay in the browser');
  check(await dialog.getByRole('checkbox').isVisible(), 'Live does not ask about cost');
  check(!(await sandboxNotes().count()), 'a Sandbox note shows in Live');
});

// ---- Sandbox from here on
await context.addInitScript(() => localStorage.setItem('weave_data_source', 'sandbox'));

await step('the Test page talks to the simulated agent, says so, and uses what is in the editor', async () => {
  await page.goto(testPage());
  await main().getByText('Talk to your draft').waitFor();
  await main().getByText('Simulated · Sandbox').waitFor();
  check(!/Real LiveKit/.test(await text(main())), 'still says Real LiveKit');
  await page.locator('[data-sandbox-note="test"]').waitFor();
  check(/made up in your browser by simple rules/.test(await text(main())), 'the note says replies are made up');
  check(/Starts a simulated conversation in your browser/.test(await text(main())), 'the start screen says it is simulated');
  check(/Conversations use what is in the editor/.test(await text(main())), 'the header says what it plays');
  check((await page.getByLabel('Talk to', { exact: true }).locator('option').first().innerText()) === 'The draft, as edited', 'the draft option');
});

await step('a conversation starts on the unsaved edits without saving, and each reply is tagged Simulated', async () => {
  await jsonEditor();
  const before = await page.evaluate((frame) => document.querySelector(frame).weaveJsonText(), JSON_FRAME);
  check(before.includes('How can I help you today?'), 'the sample greeting is not where expected');
  await writeJson(before.replace('How can I help you today?', 'What can I do for you, unsaved edition?'));
  await stage('Test');
  await main().getByRole('button', { name: /Start chat test/ }).click();
  const greeting = main().getByLabel('Conversation', { exact: true }).getByText('What can I do for you, unsaved edition?', { exact: false });
  await greeting.waitFor({ timeout: 10_000 });
  check(!(await page.getByRole('dialog').count()), 'it asked to save first');
  const saved = await page.evaluate(() => localStorage.getItem('weave_sandbox_state') || '');
  check(!saved.includes('unsaved edition'), 'the edit was saved');
  check((await main().getByTitle('Made up by a simulation in your browser, not by the real agent').count()) >= 1, 'the reply is not tagged');
  check(/simulated/i.test(await text(main().getByLabel('Conversation', { exact: true }))), 'no Simulated tag');
});

await step('tools and hand-offs show in the trace, marked as made by the simulation', async () => {
  await main().getByRole('textbox', { name: 'Message' }).fill('Can I speak to a person?');
  await main().getByRole('button', { name: 'Send' }).click();
  await main().getByLabel('Conversation', { exact: true }).getByText('I can’t put you through to a person from here right now', { exact: false }).waitFor({ timeout: 10_000 });
  await main().getByText('escalate_to_human').first().waitFor();
  await page.locator('[data-sandbox-note="trace"]').waitFor();
  check(/No runtime wrote them/.test(await text(page.locator('[data-sandbox-note="trace"]'))), 'the trace note');
  check((await main().getByRole('list', { name: 'Records' }).getByText('Can I speak to a person?').count()) >= 1, 'the trace reads the records like a call');
});

await step('when it ends it is kept as one of the agent’s calls, and the bell says so', async () => {
  await main().getByRole('button', { name: 'Thanks, goodbye' }).click();
  await main().getByText('The simulated agent ended the conversation.').waitFor({ timeout: 10_000 });
  await page.getByTestId('bell').click();
  await page.getByText('Acme Support had a test conversation').waitFor({ timeout: 5_000 });
  check(/Simulated in Sandbox, and kept with its calls/.test(await text(page.locator('body'))), 'the bell line');
  await page.keyboard.press('Escape');
  const state = JSON.parse(await page.evaluate(() => localStorage.getItem('weave_sandbox_state')));
  const kept = state.bots[AGENT].calls[0].summary;
  check(kept.channel.label === 'Test: simulated chat', `the newest call is ${JSON.stringify(kept.channel)}`);
  check(kept.caller_turns === 2, `${kept.caller_turns} caller turns kept`);
});

await step('the kept conversation is on the Calls page as “Test: simulated chat”, with its trace', async () => {
  await page.goto(`${base}/calls?agent=${AGENT}`);
  await main().getByText('Sample calls kept in this browser, and the test conversations you had in Sandbox.').waitFor();
  await page.locator('[data-sandbox-note="calls"]').waitFor();
  await main().getByText('Test: simulated chat').first().waitFor({ timeout: 15_000 });
  const state = JSON.parse(await page.evaluate(() => localStorage.getItem('weave_sandbox_state')));
  const id = state.bots[AGENT].calls[0].summary.id;
  await page.goto(`${base}/calls/${encodeURIComponent(id)}?agent=${AGENT}`);
  await main().getByText('escalate_to_human').first().waitFor({ timeout: 15_000 });
  check(/Test: simulated chat/.test(await text(main())), 'the call page names the channel');
});

await step('the test panel beside other pages is the simulated conversation too', async () => {
  await page.goto(`${base}/agents/${AGENT}/build`);
  await page.getByRole('button', { name: /Try it: talk to the agent/ }).click();
  const dock = page.getByRole('complementary', { name: 'Test panel' });
  await dock.getByText('Simulated · Sandbox').waitFor();
  await dock.getByRole('button', { name: /Start chat test/ }).click();
  await dock.getByLabel('Conversation', { exact: true }).getByText('How can I help you today?', { exact: false }).waitFor({ timeout: 10_000 });
  check((await dock.getByTitle('Made up by a simulation in your browser, not by the real agent').count()) >= 1, 'the panel’s reply is not tagged');
  await dock.getByRole('button', { name: 'End', exact: true }).click();
  await dock.getByText('You ended the simulated conversation.').first().waitFor();
  await dock.getByRole('button', { name: 'Close the test panel' }).click();
});

await step('the checks panel says it is checked by simple rules in this browser', async () => {
  await page.goto(`${base}/agents/${AGENT}/build`);
  const note = page.locator('[data-sandbox-note="checks"]');
  await note.waitFor({ timeout: 15_000 });
  check(/checked by simple rules in this browser, not by the server/.test(await text(note)), await text(note));
  await main().getByText('Checked in this browser').waitFor();
});

await step('Replay plays the call on the imitation in the browser, labelled a simulation, with no cost to accept', async () => {
  const state = JSON.parse(await page.evaluate(() => localStorage.getItem('weave_sandbox_state')));
  const call = state.bots[AGENT].calls.map((c) => c.summary).find((s) => s.status === 'ended' && s.caller_turns > 0 && !s.channel?.label);
  check(!!call, 'no sample call with caller turns');
  await page.goto(`${base}/calls/${encodeURIComponent(call.id)}?agent=${AGENT}`);
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Replay in the browser' }).waitFor();
  check(!(await dialog.getByRole('checkbox').count()), 'it asks about cost');
  check(!(await dialog.getByRole('button', { name: 'Replay on the runtime' }).count()), 'it offers the real runtime');
  await dialog.locator('[data-sandbox-note="replay"]').waitFor();
  await dialog.getByRole('button', { name: 'Replay in the browser' }).click();
  await dialog.getByRole('status', { name: 'What changed' }).waitFor({ timeout: 10_000 });
  check(/This replay is a simulation\./.test(await text(dialog)), 'not labelled a simulation');
  check((await dialog.locator('[data-turn]').count()) === call.caller_turns, 'not one row per caller turn');
  await dialog.getByRole('button', { name: 'Replay on the Sandbox runner' }).click();
  await dialog.getByText(/Replay: The saved draft on the Sandbox imitation/).waitFor({ timeout: 20_000 });
});

await step('scripted callers run on the imitation without a cost to accept, and say so', async () => {
  await page.goto(testPage('callers'));
  await main().getByRole('region', { name: 'Callers' }).waitFor();
  const note = page.locator('[data-sandbox-note="callers"]');
  await note.waitFor();
  check(/played by Sandbox’s imitation/.test(await text(note)), await text(note));
  check(!(await page.getByLabel('These use the live model and cost money').count()), 'the cost box shows');
  await main().getByRole('button', { name: 'Clear' }).click();
  for (const key of ['caller_direct', 'check_greets']) await main().locator(`[data-key="${key}"]`).getByRole('checkbox').check();
  const tryIt = main().getByRole('button', { name: /Try 2 on the draft/ });
  check(await tryIt.isEnabled(), 'Try waits for a cost');
  await tryIt.click();
  await main().getByText(/need a look|that ran passed/).first().waitFor({ timeout: 20_000 });
});

await step('scenarios say the Sandbox imitation runs them, and the paid and real-request options are not offered', async () => {
  await openTab('Scenarios');
  await main().getByText('Sandbox imitation', { exact: true }).waitFor();
  await page.locator('[data-sandbox-note="scenarios"]').waitFor();
  await main().getByText('Run options').click();
  await page.getByLabel('Include live scenarios').waitFor();
  check(!(await page.getByLabel('Grade reviewer checks').count()), 'reviewer grading is offered');
  check(!(await page.getByLabel('Let requests reach real systems').count()), 'real requests are offered');
  check(!(await main().getByText('Paid and real-request options').count()), 'the paid options show');
  check(!/never calls a real API/.test(await text(main())), 'the real-runtime banner shows');
});

await step('Analytics says the numbers come from sample calls', async () => {
  await page.goto(`${base}/analytics`);
  const note = page.locator('[data-sandbox-note="monitoring"]');
  await note.waitFor({ timeout: 20_000 });
  check(/not how a real agent performs/.test(await text(note)), await text(note));
});

// ---- screenshots, light and dark
if (process.env.E2E_LOOK) {
  const dir = process.env.E2E_LOOK;
  for (const theme of ['light', 'dark']) {
    await step(`screenshots (${theme})`, async () => {
      const look = await openBrowser({ theme });
      try {
        await look.context.addInitScript(() => localStorage.setItem('weave_data_source', 'sandbox'));
        const p = look.page;
        p.setDefaultNavigationTimeout(90_000);
        const shot = (name) => p.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
        await p.goto(testPage());
        await p.locator('main').getByRole('button', { name: /Start chat test/ }).click();
        await p.locator('main').getByLabel('Conversation', { exact: true }).getByText('How can I help you today?', { exact: false }).waitFor({ timeout: 10_000 });
        await p.locator('main').getByRole('button', { name: 'Can I speak to a person?' }).click();
        await p.locator('main').getByText('escalate_to_human').first().waitFor({ timeout: 10_000 });
        await p.waitForTimeout(800);
        await shot('test-conversation');
        await p.goto(`${base}/agents/${AGENT}/build`);
        await p.getByRole('button', { name: /Try it: talk to the agent/ }).click();
        const dock = p.getByRole('complementary', { name: 'Test panel' });
        await dock.getByRole('button', { name: /Start chat test/ }).click();
        await dock.getByLabel('Conversation', { exact: true }).getByText('How can I help you today?', { exact: false }).waitFor({ timeout: 10_000 });
        await p.locator('[data-sandbox-note="checks"]').scrollIntoViewIfNeeded();
        await shot('build-checks-and-panel');
        await dock.getByRole('button', { name: 'Close the test panel' }).click();
        const state = JSON.parse(await p.evaluate(() => localStorage.getItem('weave_sandbox_state')));
        const call = state.bots[AGENT].calls.map((c) => c.summary).find((s) => s.status === 'ended' && s.caller_turns > 0);
        await p.goto(`${base}/calls/${encodeURIComponent(call.id)}?agent=${AGENT}`);
        await p.getByRole('button', { name: 'Replay', exact: true }).click();
        await p.getByRole('dialog').getByRole('button', { name: 'Replay in the browser' }).click();
        await p.getByRole('dialog').getByRole('status', { name: 'What changed' }).waitFor({ timeout: 10_000 });
        await shot('replay');
        await p.goto(testPage('callers'));
        await p.locator('[data-sandbox-note="callers"]').scrollIntoViewIfNeeded();
        await shot('callers');
        await p.goto(testPage('scenarios'));
        await p.locator('[data-sandbox-note="scenarios"]').waitFor();
        await shot('scenarios');
        await p.goto(`${base}/calls`);
        await p.locator('[data-sandbox-note="calls"]').waitFor();
        await p.waitForTimeout(1500);
        await shot('calls');
        await p.goto(`${base}/analytics`);
        await p.locator('[data-sandbox-note="monitoring"]').waitFor({ timeout: 20_000 });
        await p.locator('[data-sandbox-note="monitoring"]').scrollIntoViewIfNeeded();
        await shot('analytics');
        check(!look.errors.length, look.errors.join('\n'));
      } finally {
        await look.browser.close();
      }
    });
  }
}

await finish();
