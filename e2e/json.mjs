// Build › JSON: the configuration in the code editor (CodeMirror). The editor draws only the lines in sight, so the whole
// text is read through its own hook (weaveJsonText on its frame); writing selects everything and puts the new text in at
// once, as a paste does, then waits until the editor holds exactly that.
//   E2E_API_PORT=8426 E2E_WEB_PORT=5426 node e2e/json.mjs
import { check, suite } from './support/harness.mjs';

const FRAME = '[data-json-frame] [data-json-editor]';

async function readJson(page) {
  await page.waitForSelector('[data-json-frame] .cm-content', { timeout: 60000 });
  await page.waitForFunction((frame) => (document.querySelector(frame)?.weaveJsonText?.() || '').length > 20, FRAME, { timeout: 20000 });
  return page.evaluate((frame) => document.querySelector(frame).weaveJsonText(), FRAME);
}

async function writeJson(page, text) {
  await page.locator('[data-json-frame] .cm-content').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await page.waitForFunction(([frame, wanted]) => document.querySelector(frame)?.weaveJsonText?.() === wanted, [FRAME, text], { timeout: 20000 });
}

const activeLine = (page) => page.locator('[data-json-frame] .cm-activeLine').first().innerText();

const { page, context, base, step, finish, errors } = await suite('json');
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const JSON_VIEW = `${base}/agents/acme-support/build?view=json`;
let original = '';

await step('the JSON view opens in the code editor, with the whole configuration', async () => {
  // the first visit also waits for the dev server to prepare the code editor
  await page.goto(JSON_VIEW, { waitUntil: 'domcontentloaded', timeout: 120000 });
  original = await readJson(page);
  const config = JSON.parse(original);
  check(config.meta?.id === 'acme-support' || config.agents, 'the text is the agent’s configuration');
  check(await page.locator('[data-json-editor="code"]').count() === 1, 'the code editor replaced the plain one');
  check(await page.locator('[data-json-frame] .cm-content[aria-label="Agent configuration JSON"]').count() === 1, 'the editor is labelled');
});

await step('keys, strings and numbers are coloured differently', async () => {
  const colours = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('[data-json-frame] .cm-line span')];
    return new Set(spans.map((s) => getComputedStyle(s).color)).size;
  });
  check(colours >= 3, `only ${colours} colours in the text`);
});

await step('a part folds away and opens again', async () => {
  const markers = page.locator('[data-json-frame] .cm-foldGutter .cm-gutterElement span[aria-hidden="true"]');
  await markers.nth(1).click();
  await page.locator('[data-json-frame] .cm-foldPlaceholder').first().waitFor({ timeout: 5000 });
  await page.locator('[data-json-frame] .cm-foldPlaceholder').first().click();
  await page.waitForFunction(() => !document.querySelector('[data-json-frame] .cm-foldPlaceholder'), null, { timeout: 5000 });
});

await step('Find opens the find bar and marks every match', async () => {
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  const field = page.locator('[data-json-frame] .cm-search input[name="search"]');
  await field.waitFor({ timeout: 5000 });
  await field.pressSequentially('acme');
  await page.waitForFunction(() => document.querySelectorAll('[data-json-frame] .cm-searchMatch').length > 0, null, { timeout: 5000 });
  await field.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-json-frame] .cm-search'), null, { timeout: 5000 });
});

await step('an edit goes into the draft as you type: Save becomes possible', async () => {
  const config = JSON.parse(original);
  config.meta = { ...config.meta, description: 'Edited in the JSON view.' };
  await writeJson(page, JSON.stringify(config, null, 2));
  await page.waitForFunction(() => {
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save');
    return save && !save.disabled;
  }, null, { timeout: 8000 });
  check(await page.getByText('Valid JSON. Edits go into the draft as you type').count() === 1, 'it says the text is valid');
});

await step('a syntax error is held back, marked where it is, with its line and a way to it', async () => {
  const good = await readJson(page);
  const broken = good.replace('"meta": {', '"meta": {\n    "oops" 1,');
  await writeJson(page, broken);
  const alert = page.getByRole('alert').filter({ hasText: 'Your draft keeps the last valid version' });
  await alert.waitFor({ timeout: 5000 });
  check(await page.getByText(/Not applied — line \d+/).count() === 1, 'the line is named');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  check(await save.isDisabled(), 'Save waits until it is fixed');
  await alert.getByRole('button', { name: /Go to line/ }).click();
  check((await activeLine(page)).includes('oops'), 'the cursor is on the bad line');
  // marked where it is (the editor draws only the lines in sight, so after going there)
  await page.locator('[data-json-frame] .cm-lintRange-error').first().waitFor({ timeout: 5000 });
  await writeJson(page, good);
  await page.getByText('Valid JSON. Edits go into the draft as you type').waitFor({ timeout: 5000 });
});

await step('a key written twice is held back and marked at both places', async () => {
  const good = await readJson(page);
  const twice = good.replace('"meta": {', '"meta": {\n    "name": "First",\n    "name": "Second",').replace(/\n {4}"name": "[^"]*",(?=[\s\S]*"name": "First")/, '');
  await writeJson(page, twice);
  await page.getByText(/appears twice/).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Go to the repeated key' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-json-frame] .cm-lintRange-error').length >= 2, null, { timeout: 5000 });
  check((await activeLine(page)).includes('"name"'), 'the cursor is on the repeated key');
  check(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), 'nothing is saved until one goes');
  await writeJson(page, good);
  await page.getByText('Valid JSON. Edits go into the draft as you type').waitFor({ timeout: 5000 });
});

await step('the server’s problems are marked at their setting, and F8 goes to the next one', async () => {
  const config = JSON.parse(await readJson(page));
  config.agents.entry = 'nobody_here';
  await writeJson(page, JSON.stringify(config, null, 2));
  await page.getByText(/problems? from the checks marked in the text/).waitFor({ timeout: 15000 });
  await page.locator('[data-json-frame] .cm-content').focus();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('F8');
  await page.waitForFunction(() => /nobody_here|"entry"/.test(document.querySelector('[data-json-frame] .cm-activeLine')?.textContent || '') || !!document.querySelector('.cm-tooltip-lint'), null, { timeout: 5000 });
});

await step('a problem in the checks beside the text is shown in the text', async () => {
  const button = page.locator('#checks-panel button').filter({ hasText: /./ }).first();
  if (await button.count()) {
    await page.locator('[data-json-frame] .cm-content').focus();
    await page.keyboard.press('ControlOrMeta+Home');
    await button.click();
    await page.waitForTimeout(400);
    check(new URL(page.url()).searchParams.get('view') === 'json', 'it stays in the JSON view');
  }
  const config = JSON.parse(await readJson(page));
  config.agents.entry = config.agents.items[0].id;
  await writeJson(page, JSON.stringify(config, null, 2));
});

await step('Go to a setting puts the cursor on it', async () => {
  await page.locator('#json-go-to').fill('agents.entry');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  check((await activeLine(page)).includes('"entry"'), `the cursor is on ${await activeLine(page)}`);
  await page.locator('#json-go-to').fill('no such thing here[');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  await page.getByText(/Type a setting such as/).waitFor({ timeout: 3000 });
});

await step('Format lays the text out again, and Copy still copies it', async () => {
  const config = JSON.parse(await readJson(page));
  await writeJson(page, JSON.stringify(config));
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.waitForFunction((frame) => (document.querySelector(frame)?.weaveJsonText?.() || '').split('\n').length > 10, FRAME, { timeout: 5000 });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByText('Configuration copied').waitFor({ timeout: 5000 });
});

await step('Import / Export is still beside the views', async () => {
  check(await page.getByRole('button', { name: /Import \/ Export/ }).count() >= 1, 'Import / Export is there');
});

// A known warning of the studio's toasts (ToastItem inside framer-motion's popLayout), not of this view.
for (let i = errors.length - 1; i >= 0; i -= 1) if (errors[i].includes("Function components cannot be given refs") && errors[i].includes("ToastItem")) errors.splice(i, 1);

await finish();
