// The Live board against the stand-in API, whose calls start, go on and end by the clock: the board finds them by itself,
// their durations count up and their words arrive as they are said, what needs a look is marked and can be shown alone,
// callers' words can be hidden, an agent can be picked, Pause stops it all and Resume picks up, Watch follows one call
// in a side panel, a screen reader is told what changed, and "Open call" opens the call's page.
//   E2E_API_PORT=8421 E2E_WEB_PORT=5421 node e2e/live.mjs
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('live');

const cards = () => page.locator('[data-testid=live-grid] article');
const texts = (sel) => page.locator(sel).allTextContents();
const secondsOf = (t) => {
  const m = String(t).match(/(\d+):(\d+)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number(String(t).replace(/\D/g, ''));
};
const status = () => page.getByTestId('live-status').textContent();

await step('the calls going on are found by themselves', async () => {
  await page.goto(`${base}/live`, { timeout: 120_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=live-grid] article').length >= 2, null, { timeout: 30_000 });
  await page.waitForTimeout(600);
  const n = await cards().count();
  check(Number(await page.getByTestId('live-count').textContent()) === n, 'the count at the top is the number of cards');
  check(/Watching 3 agents/.test(await status()), await status());
});

await step('a phone number never shows whole', async () => {
  const grid = await page.getByTestId('live-grid').textContent();
  check(!/\+\d{6,}/.test(grid), 'no whole number');
});

await step('a call’s time counts up', async () => {
  const label = await cards().first().getAttribute('aria-label');
  const name = label.split(':')[0];
  const before = secondsOf(await cards().first().getByTestId('live-time').textContent());
  await page.waitForTimeout(3200);
  const after = (await page.locator('[data-testid=live-grid] article', { hasText: name }).getByTestId('live-time').allTextContents()).map(secondsOf);
  check(after.some((t) => t >= before + 2), `${before} → ${after.join(',')}`);
});

await step('what is said arrives as it is said', async () => {
  const before = (await texts('[data-testid=live-line]')).join('|');
  let moved = false;
  for (let i = 0; i < 60 && !moved; i += 1) {
    await page.waitForTimeout(1000);
    moved = (await texts('[data-testid=live-line]')).join('|') !== before;
  }
  check(moved, 'new lines within a minute');
});

await step('a call that needs a look is marked, with why, and can be shown alone', async () => {
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=live-grid] article[data-attention]').length > 0, null, { timeout: 120_000 });
  check((await page.locator('article[data-attention] [aria-label="What to know"] li').count()) > 0, 'a flag says why');
  await page.getByRole('switch', { name: 'Only what needs a look' }).click();
  await page.waitForTimeout(200);
  const all = await cards().evaluateAll((list) => list.length > 0 && list.every((c) => c.hasAttribute('data-attention')));
  check(all, 'only the flagged calls');
  await page.getByRole('switch', { name: 'Only what needs a look' }).click();
});

await step('“Hide what callers say” hides every caller line, and is kept in this browser', async () => {
  await page.waitForFunction(() => document.querySelectorAll('[data-who=caller]').length > 0, null, { timeout: 60_000 });
  await page.getByRole('switch', { name: 'Hide what callers say' }).click();
  await page.waitForTimeout(200);
  const said = await texts('[data-who=caller] [data-testid=live-line]');
  check(said.length > 0 && said.every((t) => /^Caller spoke \(\d+ words?\)$/.test(t)), said.slice(0, 3).join(' | '));
  check((await page.evaluate(() => localStorage.getItem('weave_live_private'))) === '1', 'remembered');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=live-grid] article').length > 0, null, { timeout: 30_000 });
  check((await page.getByRole('switch', { name: 'Hide what callers say' }).getAttribute('aria-checked')) === 'true', 'still on after a reload');
  await page.getByRole('switch', { name: 'Hide what callers say' }).click();
});

await step('picking an agent shows only its calls', async () => {
  await page.getByRole('button', { name: /^Agent:/ }).click();
  await page.getByRole('combobox', { name: 'Find an agent' }).fill('front');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const agents = await texts('[data-testid=live-agent]');
  check(agents.length > 0 && agents.every((a) => a === 'Front Desk'), agents.join(', '));
  await page.getByRole('button', { name: /^Agent:/ }).click();
  await page.getByRole('listbox', { name: 'Agents' }).getByRole('option', { name: /All agents/ }).click();
});

await step('Pause stops the clock and Resume starts it again', async () => {
  await page.getByRole('button', { name: 'Pause' }).click();
  check(/Paused/.test(await status()), await status());
  const frozen = await texts('[data-testid=live-time]');
  await page.waitForTimeout(2500);
  check((await texts('[data-testid=live-time]')).join() === frozen.join(), 'the clock stopped');
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForFunction(() => /Watching/.test(document.querySelector('[data-testid=live-status]')?.textContent || ''), null, { timeout: 10_000 });
});

await step('Watch follows one call beside the board; Escape closes it', async () => {
  await cards().first().getByRole('button', { name: 'Watch' }).click();
  const panel = page.getByTestId('watch-panel');
  await panel.waitFor();
  await panel.getByRole('region', { name: 'What happened' }).waitFor({ timeout: 10_000 });
  check((await panel.locator('[aria-label="Records"] li').count()) > 0, 'its records');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await page.getByTestId('watch-panel').count()) === 0, 'closed');
});

await step('calls that ended in the last minutes are listed', async () => {
  await page.getByTestId('live-ended').waitFor({ timeout: 60_000 });
  check((await page.locator('[data-testid=live-ended] li').count()) > 0, 'ended calls');
});

await step('a screen reader is told what changed', async () => {
  await page.waitForFunction(() => (document.querySelector('[data-testid=live-announce]')?.textContent || '').length > 0, null, { timeout: 120_000 });
  const said = await page.getByTestId('live-announce').textContent();
  check(/New call on|ended|was cut off|: /.test(said), said);
});

await step('“Open call” opens the call’s page', async () => {
  await cards().first().getByRole('button', { name: 'Open call' }).click();
  await page.waitForURL(/\/calls\/[^?]+\?agent=/, { timeout: 10_000 });
  await page.getByRole('region', { name: 'What happened' }).waitFor({ timeout: 10_000 });
});

await finish();
