// Fixed lines and how things are said aloud, on the Agent page: lines added with a text per language, put in another
// order by mouse and by keyboard (Escape puts one back), deleted with Undo; pronunciation rules added and a line tried
// with POST /preview/speech, showing what the server answers.
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('build-messages');
const AGENT = 'front-desk';
const draft = () => page.evaluate(async (id) => (await (await fetch(`/api/bots/${id}/draft`)).json()).config, AGENT);
const save = async () => {
  await page.locator('main h2').first().click();
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);
};
const lines = page.locator('section[aria-label="Fixed lines"]');
const order = () => lines.locator('[data-line]').evaluateAll((els) => els.map((e) => e.getAttribute('data-line')));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a drag by mouse from the middle of a handle to just above the first card, in small moves (as a hand does)
const dragTo = async (handle, target) => {
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + from.width / 2, from.y + (to.y + to.height / 2 - from.y - from.height / 2) * (i / 12), { steps: 2 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);
};

let start = [];
await step('the Agent page shows Fixed lines and adds three', async () => {
  await page.goto(`${base}/agents/${AGENT}/build/agent`);
  await lines.waitFor({ timeout: 20_000 });
  start = await order();
  for (const text of ['Alpha line.', 'Bravo line.', 'Charlie line.']) {
    await lines.getByRole('button', { name: 'Add a fixed line' }).click();
    await page.waitForTimeout(150);
    await lines.locator('[data-line]').last().locator('textarea').first().fill(text);
  }
  check((await order()).length === start.length + 3, `three lines added: ${JSON.stringify(await order())}`);
});

await step('a line is written in another language too, and a missing one is named', async () => {
  const last = lines.locator('[data-line]').last();
  await last.getByRole('button', { name: /Write it in more than one language/ }).click();
  await last.getByLabel(/Another language code/).fill('es');
  await last.getByRole('button', { name: 'Add language' }).click();
  await last.getByLabel(/in es$/).fill('Línea Charlie.');
  await last.getByLabel(/Another language code/).fill('English');
  await last.getByRole('button', { name: 'Add language' }).click();
  check(await last.getByRole('alert').isVisible(), 'a bad language code is refused in words');
});

await step('a mouse drag moves a line', async () => {
  const ids = await order();
  const [a, b, c] = ids.slice(-3);
  await dragTo(lines.getByRole('button', { name: `Drag ${c}`, exact: true }), lines.locator('[data-line]').nth(ids.length - 3));
  const now = (await order()).slice(-3);
  check(same(now, [c, a, b]), `moved by mouse: ${JSON.stringify(now)}`);
});

await step('the keyboard moves a line (Space, an arrow, Space) and Escape puts one back', async () => {
  const before = (await order()).slice(-3);
  const handle = lines.getByRole('button', { name: `Drag ${before[1]}`, exact: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await page.waitForTimeout(350);
  const moved = (await order()).slice(-3);
  check(same(moved, [before[0], before[2], before[1]]), `moved by keyboard: ${JSON.stringify(moved)}`);
  const again = lines.getByRole('button', { name: `Drag ${moved[2]}`, exact: true });
  await again.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  check(same((await order()).slice(-3), moved), `Escape put it back: ${JSON.stringify(await order())}`);
});

await step('the order and the texts are what is saved', async () => {
  const shown = await order();
  await save();
  const c = await draft();
  check(same(c.messages.map((m) => m.id), shown), `saved order: ${JSON.stringify(c.messages.map((m) => m.id))}`);
  const charlie = c.messages.find((m) => typeof m.text === 'object');
  check(charlie && charlie.text.es === 'Línea Charlie.', `per language: ${JSON.stringify(charlie)}`);
});

await step('a line is deleted and Undo brings it back', async () => {
  const before = await order();
  await lines.getByRole('button', { name: `Delete ${before.at(-1)}`, exact: true }).click();
  check((await order()).length === before.length - 1, 'gone');
  await lines.getByRole('button', { name: 'Undo' }).click();
  check(same(await order(), before), 'back where it was');
});

const speech = page.locator('section[aria-label="How it says things aloud"]');
await step('pronunciation rules are added from cards', async () => {
  await speech.getByRole('button', { name: 'Add a rule' }).click();
  await speech.getByRole('button', { name: /Say amounts of money in words/ }).click();
  await speech.getByRole('button', { name: 'Add a rule' }).click();
  await speech.getByRole('button', { name: /Say times of day aloud/ }).click();
  check((await speech.locator('[data-rule]').count()) === 2, 'two rules');
  check(await speech.getByText('Says amounts after $ in dollars and cents').isVisible(), 'a rule reads in words');
});

await step('Try a line shows what the server says the voice is given', async () => {
  const tryIt = page.locator('section[aria-label="Try how a line is said"]');
  const channel = tryIt.getByLabel('On which channel');
  if (await channel.count()) await channel.selectOption('phone');
  await tryIt.getByLabel('A line the agent might say').fill('It costs $12.50 at 4:30 PM.');
  await tryIt.getByRole('button', { name: 'Try it' }).click();
  const spoken = tryIt.locator('pre[aria-label="What the voice is given"]');
  await spoken.waitFor({ timeout: 15_000 });
  const said = await spoken.innerText();
  check(/dollars/.test(said), `the server's spoken form is shown: ${said}`);
  check((await tryIt.locator('[aria-label="What was changed"] li').count()) >= 2, 'each change names its rule');
  await tryIt.getByLabel('Whose words').selectOption('fixed');
  await tryIt.getByRole('button', { name: 'Try it' }).click();
  await tryIt.getByText(/Fixed lines|not changed/).first().waitFor({ timeout: 15_000 });
  await tryIt.getByLabel('Whose words').selectOption('model');
  await tryIt.locator('summary', { hasText: 'Type it as it streams' }).click();
  await tryIt.getByLabel('Pieces, separated by |').fill('at 4|:30 P|M');
  await tryIt.getByRole('button', { name: 'Try it' }).click();
  await tryIt.locator('[data-block="streaming"] li').first().waitFor({ timeout: 15_000 });
  check((await tryIt.locator('[data-block="streaming"] li').count()) >= 1, 'the pieces are shown as they arrive');
});

await finish();
