// A call, played again: replay it on the runtime against the draft or a version, keep it as a test, and fix what went
// wrong. Fixing and keeping change the agent's draft in its own page, unsaved, until Save.
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish, errors } = await suite('replay');

async function call(method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const dialog = () => page.getByRole('dialog');
// Whether Build › JSON shows a text: the code editor through its own hook (it draws only the lines in sight), or the
// plain box that stands in while the editor loads.
const jsonShows = (text) =>
  page.evaluate((wanted) => {
    const code = document.querySelector('[data-json-frame] [data-json-editor]')?.weaveJsonText?.();
    if (typeof code === 'string') return code.includes(wanted);
    return Array.from(document.querySelectorAll('textarea')).some((el) => el.value.includes(wanted));
  }, text);
const untilJson = async (text, shown, timeout) => {
  const until = Date.now() + timeout;
  while ((await jsonShows(text)) !== shown) {
    if (Date.now() > until) throw new Error(`Build › JSON ${shown ? 'never showed' : 'still shows'} ${text}`);
    await page.waitForTimeout(100);
  }
};

// The seeded call whose order lookup failed (HTTP 503).
const calls = (await call('GET', '/bots/acme-support/calls?limit=100')).calls;
const failing = calls.find((c) => /b7e4/.test(c.id));
const openCall = async (c) => {
  await page.goto(`${base}/calls/${encodeURIComponent(c.id)}?agent=acme-support`, { timeout: 90_000 });
  await page.getByRole('button', { name: 'Replay', exact: true }).waitFor({ timeout: 20_000 });
};

await step('a finished call offers Replay, Fix this call and Keep as a test', async () => {
  check(!!failing, 'the seeded call with a failing tool is missing');
  await openCall(failing);
  for (const name of ['Replay', 'Fix this call', 'Keep as a test']) check(await page.getByRole('button', { name, exact: true }).isEnabled(), `${name} is not offered`);
});

await step('Replay plays the caller’s words to the saved draft on the runtime and compares them turn by turn', async () => {
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await dialog().getByText('What if it ran again?').waitFor();
  const go = dialog().getByRole('button', { name: 'Replay on the runtime' });
  check(await go.isDisabled(), 'a paid replay starts without saying it costs money');
  await dialog().getByRole('checkbox').check();
  await go.click();
  await dialog().getByRole('status', { name: 'What changed' }).waitFor({ timeout: 30_000 });
  check((await dialog().locator('[data-turn]').count()) === failing.caller_turns, 'not one row per caller turn');
  check(/Replay: The saved draft/.test(await dialog().getByRole('table').innerText()), 'the replay column does not say what it was played to');
  const draft = await call('GET', '/bots/acme-support/draft');
  check(!(draft.config.tests || []).some((t) => /^replay/.test(t.id)), 'the replay scenario was saved in the draft');
});

await step('a call can be replayed against a published version', async () => {
  await dialog().locator('select').selectOption('0.1.1');
  await dialog().getByRole('button', { name: 'Replay on the runtime' }).click();
  await dialog().getByText('Replay: Version 0.1.1 (latest)').waitFor({ timeout: 30_000 });
});

await step('keeping the call as a test: edit the caller’s words, choose checks, and it lands in the draft unsaved', async () => {
  await dialog().getByRole('button', { name: 'Keep this call as a test' }).click();
  await dialog().getByText('What must hold afterwards').waitFor({ timeout: 15_000 });
  const add = dialog().getByRole('button', { name: 'Add the test to the draft' });
  await dialog().getByLabel('Test name').fill('Not Valid');
  check(await add.isDisabled(), 'a bad name is accepted');
  await dialog().getByText('must start with a letter').waitFor();
  await dialog().getByLabel('Test name').fill('from_a_call');
  await dialog().getByLabel('Caller turn 1').fill('Where is my parcel?');
  // nothing in a failed call is ticked to start with: choose a check
  check(await add.isDisabled(), 'a test with no check is accepted');
  await dialog().getByRole('checkbox', { name: /find_order/ }).first().check();
  check(!(await add.isDisabled()), 'a good test is refused');
  await add.click();
  await page.waitForURL(/\/agents\/acme-support\/build/, { timeout: 20_000 });
  await page.getByText('Added the test “from_a_call” to the draft.').waitFor({ timeout: 20_000 });
  await untilJson('from_a_call', true, 15_000);
  const saved = await call('GET', '/bots/acme-support/draft');
  check(!(saved.config.tests || []).some((t) => t.id === 'from_a_call'), 'the test was saved without Save');
});

await step('Undo takes the kept test back, and Save keeps it', async () => {
  // the notice's own Undo, then the header's Redo
  await page.locator('aside').getByRole('button', { name: 'Undo' }).first().click();
  await untilJson('from_a_call', false, 10_000);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await untilJson('from_a_call', true, 10_000);
  await page.keyboard.press('Control+s');
  for (let i = 0; i < 40; i += 1) {
    const saved = await call('GET', '/bots/acme-support/draft');
    const kept = (saved.config.tests || []).find((t) => t.id === 'from_a_call');
    if (kept) {
      check(kept.turns[0].say === 'Where is my parcel?', 'the edited caller words were not kept');
      check(kept.expect.length >= 1, 'no check was kept');
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('the test is not in the saved draft');
});

await step('Fix this call names what went wrong with its evidence, and suggests a change as a sentence', async () => {
  await openCall(failing);
  await page.getByRole('button', { name: 'Fix this call', exact: true }).click();
  await dialog().getByRole('radiogroup', { name: 'Findings' }).waitFor({ timeout: 15_000 });
  const finding = dialog().getByRole('radiogroup', { name: 'Findings' });
  check(/failed/.test(await finding.innerText()) && /HTTP 503/.test(await finding.innerText()), 'the failed tool and its evidence are not shown');
  const fix = dialog().getByRole('checkbox', { name: /Say what to do when/ });
  await fix.check();
  await dialog().getByLabel('What changes in the draft').getByText(/style rule|How it speaks|rule/i).first().waitFor();
});

await step('the fix can be replayed before it is applied', async () => {
  await dialog().getByRole('button', { name: 'Replay the call with these changes' }).click();
  await dialog().getByRole('checkbox', { name: /costs money/ }).check();
  await dialog().getByRole('button', { name: 'Replay on the runtime' }).click();
  await dialog().getByText('Replay: The draft with these changes').waitFor({ timeout: 30_000 });
});

await step('applying the fix with a test puts both in the draft, unsaved', async () => {
  await dialog().getByRole('button', { name: 'Put in the draft with a test…' }).click();
  await dialog().getByText('What must hold afterwards').waitFor({ timeout: 15_000 });
  check(/fails/.test(await dialog().getByLabel('What should have happened').inputValue()), 'what should have happened is not filled in from the fix');
  await dialog().getByLabel('Test name').fill('order_lookup_fails');
  await dialog().getByRole('button', { name: 'Put the changes and the test in the draft' }).click();
  await page.waitForURL(/\/agents\/acme-support\/build/, { timeout: 20_000 });
  await page.getByText(/Added the test “order_lookup_fails”/).waitFor({ timeout: 20_000 });
  await untilJson('order_lookup_fails', true, 15_000);
  await page.keyboard.press('Control+s');
  for (let i = 0; i < 40; i += 1) {
    const saved = await call('GET', '/bots/acme-support/draft');
    const test = (saved.config.tests || []).find((t) => t.id === 'order_lookup_fails');
    if (test) {
      check((saved.config.persona.style_rules || []).some((r) => /find_order|tool fails/.test(r)), 'the rule is not in the saved draft');
      check(test.expect.some((e) => 'judge' in e), 'the test does not check what should have happened');
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('the fix and its test are not in the saved draft');
});

// Studio's toasts warn in development (ToastItem is not a forwardRef inside AnimatePresence): known, not this suite's.
errors.splice(0, errors.length, ...errors.filter((e) => !/ToastItem/.test(e)));
await finish();
