// Design styles and colours (Settings › Appearance and the top bar's Theme pop-over): pick a style and a colour with the
// pointer and the keyboard, each style keeps its own colour, the choice survives a reload and is on the page before it
// is drawn. Legibility of every style is in e2e/styles-legibility.mjs.
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('styles');

const html = (name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);
const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key);
const token = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim(), name);
const appearance = () => page.locator('section[aria-labelledby="appearance"]');
const radios = (root) => root.getByRole('radiogroup').getByRole('radio');
const checkedLabel = (root) => root.getByRole('radiogroup').locator('[aria-checked="true"]').getAttribute('aria-label');

// the page colour once its short fade has finished
const pageColour = async (expected) => {
  await page.waitForFunction((e) => getComputedStyle(document.body).backgroundColor === e, expected, { timeout: 3000 }).catch(() => {});
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
};

async function openSettings() {
  await page.goto(`${base}/settings`);
  await appearance().waitFor();
}

await step('a newcomer gets Studio, with its own plum, and Settings shows seven styles and five colours', async () => {
  await page.goto(`${base}/`, { timeout: 120_000 }); // the dev server's first page takes a while
  await page.evaluate(() => Object.keys(localStorage).filter((k) => /^weave_(style|accent_)/.test(k)).forEach((k) => localStorage.removeItem(k)));
  await openSettings();
  check((await html('data-style')) === 'studio', `style is ${await html('data-style')}`);
  check((await token('accent')) === '114 48 143', `Studio's accent is ${await token('accent')}`);
  const cards = appearance().locator('[data-style-preview]');
  check((await cards.count()) === 7, `${await cards.count()} cards`);
  check((await appearance().locator('[data-style-preview="studio"]').getAttribute('aria-pressed')) === 'true', 'Studio is the one picked');
  const labels = await radios(appearance()).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check(labels.join(',') === 'Plum,Indigo,Teal,Blue,Graphite', labels.join(','));
  check((await checkedLabel(appearance())) === 'Plum', 'Plum is picked');
  check((await appearance().getByRole('radiogroup').getAttribute('aria-label')) === 'Colour of Studio', 'the group is named for the style');
  check((await appearance().getByText('Kept in this browser').count()) > 0, 'says it is kept in this browser');
});

await step('picking Premium in Settings restyles the page and is remembered', async () => {
  await appearance().locator('[data-style-preview="premium"]').click();
  check((await html('data-style')) === 'premium', `style is ${await html('data-style')}`);
  check((await stored('weave_style')) === 'premium', 'stored');
  const bg = await pageColour('rgb(245, 240, 230)');
  check(bg === 'rgb(245, 240, 230)', `the page is ivory (${bg})`);
  const heading = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily);
  check(/Palatino|Georgia|Iowan/.test(heading), `titles are serif (${heading})`);
  const labels = await radios(appearance()).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check(labels.join(',') === 'Gold,Rose gold,Platinum,Emerald,Sapphire', labels.join(','));
  check((await checkedLabel(appearance())) === 'Gold', 'its own gold to start with');
});

await step('a click picks a colour; the arrow keys move and go round; one keyboard stop', async () => {
  await appearance().getByRole('radio', { name: 'Emerald' }).click();
  check((await html('data-accent')) === 'emerald', `accent is ${await html('data-accent')}`);
  check((await stored('weave_accent_premium')) === 'emerald', 'stored for Premium');
  check(/Colour\s*Emerald/.test(await appearance().getByTestId('accent-head').innerText()), 'the heading names it');
  const before = await token('accent');
  await page.keyboard.press('ArrowRight');
  check((await stored('weave_accent_premium')) === 'sapphire', 'the arrow moves to the next');
  check((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Sapphire', 'focus follows');
  check((await token('accent')) !== before, 'the colours changed');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
  check((await stored('weave_accent_premium')) === 'gold', `goes round (${await stored('weave_accent_premium')})`);
  await page.keyboard.press('End');
  check((await stored('weave_accent_premium')) === 'sapphire', 'End goes to the last');
  const stops = await radios(appearance()).evaluateAll((els) => els.filter((e) => e.tabIndex === 0).length);
  check(stops === 1, `${stops} keyboard stops`);
});

await step('each style keeps its own colour', async () => {
  await appearance().locator('[data-style-preview="calm"]').click();
  check((await checkedLabel(appearance())) === 'Sage', 'Calm starts with its own sage');
  await appearance().getByRole('radio', { name: 'Terracotta' }).click();
  await appearance().locator('[data-style-preview="premium"]').click();
  check((await checkedLabel(appearance())) === 'Sapphire', 'Premium as it was left');
  check((await html('data-accent')) === 'sapphire', 'and on the page');
  await appearance().locator('[data-style-preview="calm"]').click();
  check((await checkedLabel(appearance())) === 'Terracotta', 'Calm as it was left');
});

await step('a colour no longer offered falls back to the style’s own', async () => {
  await page.evaluate(() => localStorage.setItem('weave_accent_professional', 'crimson'));
  await appearance().locator('[data-style-preview="professional"]').click();
  check((await checkedLabel(appearance())) === 'Blue', `picked ${await checkedLabel(appearance())}`);
  check((await token('accent')) === '26 82 189', `Professional's own blue (${await token('accent')})`);
});

await step('the style and its colour survive a reload', async () => {
  await appearance().locator('[data-style-preview="calm"]').click();
  await page.reload();
  await appearance().waitFor();
  check((await html('data-style')) === 'calm' && (await html('data-accent')) === 'terracotta', `${await html('data-style')}/${await html('data-accent')}`);
  check((await appearance().locator('[data-style-preview="calm"]').getAttribute('aria-pressed')) === 'true', 'Calm is shown as picked');
  check((await checkedLabel(appearance())) === 'Terracotta', 'Terracotta is shown as picked');
});

await step('no flash: the style, colour and dark mode are on the page before anything is drawn', async () => {
  const probe = await context.newPage();
  await probe.addInitScript(() => {
    localStorage.setItem('weave_style', 'futuristic');
    localStorage.setItem('weave_accent_futuristic', 'matrix');
    localStorage.setItem('weave_theme', 'dark');
    // what <html> carries the moment <body> is parsed, before any app code runs
    new MutationObserver((_, observer) => {
      if (!document.body) return;
      const r = document.documentElement;
      window.__firstPaint = { style: r.getAttribute('data-style'), accent: r.getAttribute('data-accent'), theme: r.getAttribute('data-theme'), dark: r.classList.contains('dark'), root: document.getElementById('root')?.childElementCount ?? -1 };
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await probe.goto(`${base}/settings`);
  await probe.locator('main').waitFor();
  const first = await probe.evaluate(() => window.__firstPaint);
  await probe.close();
  check(first, 'the page was watched');
  check(first.style === 'futuristic' && first.accent === 'matrix' && first.theme === 'dark' && first.dark, JSON.stringify(first));
  check(first.root <= 0, 'it was set before the app drew anything');
});

const themeButton = () => page.getByRole('banner').getByRole('button', { name: /Theme/ });
const panel = () => page.getByRole('dialog', { name: 'Theme' });

await step('the Theme pop-over opens from the top bar with focus on the current mode', async () => {
  await page.goto(`${base}/agents`);
  await page.locator('main').waitFor();
  await themeButton().click();
  await panel().waitFor();
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  check(focused === 'Light', `focus is on ${focused}`);
  check((await panel().locator('[data-style-preview]').count()) === 7, 'seven styles');
  check((await panel().getByText('Kept in this browser').count()) === 1, 'says it is kept in this browser');
});

await step('in the pop-over: pick Futuristic, its Matrix colour, then Dark', async () => {
  await panel().locator('[data-style-preview="futuristic"]').click();
  check((await html('data-style')) === 'futuristic', 'futuristic');
  check((await panel().getByRole('radiogroup').getAttribute('aria-label')) === 'Colour of Futuristic', 'its colours');
  await panel().getByRole('radio', { name: 'Matrix' }).click();
  check((await stored('weave_accent_futuristic')) === 'matrix', 'matrix kept');
  await panel().getByRole('button', { name: 'Dark' }).click();
  check((await html('data-theme')) === 'dark' && (await page.evaluate(() => document.documentElement.classList.contains('dark'))), 'dark');
  // Matrix at night: a green-black page
  const bg = await pageColour('rgb(2, 10, 6)');
  check(bg === 'rgb(2, 10, 6)', `the green-black page (${bg})`);
});

await step('System follows the computer’s light or dark', async () => {
  await page.emulateMedia({ colorScheme: 'light' });
  await panel().getByRole('button', { name: 'System' }).click();
  check((await html('data-theme')) === 'light', 'light computer, light page');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await panel().getByRole('button', { name: 'Light' }).click();
  await page.emulateMedia({ colorScheme: null });
});

await step('Escape closes the pop-over and gives focus back to the Theme button; a click outside closes it', async () => {
  await page.keyboard.press('Escape');
  await panel().waitFor({ state: 'detached' });
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup'));
  check(focused === 'dialog', 'focus is back on the Theme button');
  await themeButton().click();
  await panel().waitFor();
  await page.locator('main h1').first().click();
  await panel().waitFor({ state: 'detached' });
});

await step('the pop-over and Settings agree', async () => {
  await openSettings();
  check((await appearance().locator('[data-style-preview="futuristic"]').getAttribute('aria-pressed')) === 'true', 'Futuristic in Settings');
  check((await checkedLabel(appearance())) === 'Matrix', 'Matrix in Settings');
  // leave Studio for the next suite
  await appearance().locator('[data-style-preview="studio"]').click();
  check((await html('data-style')) === 'studio', 'back to Studio');
});

await finish();
