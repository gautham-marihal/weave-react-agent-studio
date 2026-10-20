// Cost and speed in a real browser, on the demo (no backend). The workspace page prices every agent's calls and compares the agents; Front Desk answers the
// phone with an ElevenLabs voice that has no list price, so its cost is marked partial and the page asks for the price; adding one prices the speaking and
// the note goes; the answer-time target changes the share within it; on an agent's own page a cheaper model of the same provider goes into the draft and
// Undo takes it back; a slowest answer opens its call; and the classic layout has the page too. Nothing is written anywhere but the demo.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/cost.mjs
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder to save pictures.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS || '';
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
};
async function launch() {
  const headless = process.env.E2E_HEADED !== '1';
  if (process.env.E2E_BROWSER) return chromium.launch({ executablePath: process.env.E2E_BROWSER, headless });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless });
    } catch {
      /* try the next one */
    }
  }
  throw new Error('No Chrome or Edge found. Set E2E_BROWSER to the path of one.');
}
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  if (sessionStorage.getItem('cost')) return;
  sessionStorage.setItem('cost', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_layout', 'new');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
  localStorage.removeItem('weave_demo_state');
  localStorage.removeItem('weave_prices_v1');
  localStorage.removeItem('weave_speed_target');
});
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});
await page.route(
  (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
  (route) => route.abort(),
);
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/cost-${name}.png`, fullPage: true });
};
const statText = (i) => page.locator('.csStat').nth(i).locator('strong').textContent();

await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill('e2e@example.test');
await page.getByPlaceholder('Enter your password').fill('x12345678');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');

// ---- the workspace ------------------------------------------------------------------------------------------------------------------------------------
await page.locator('.sideLink', { hasText: 'Cost and speed' }).click();
await page.waitForSelector('.csStats', { timeout: 30000 });
check('a call is priced', /^\$0\.\d+$/.test(await statText(0)), await statText(0));
check('a month as lately', /^\$\d/.test(await statText(1)), await statText(1));
check('how fast answers come', /\d(\.\d)? s$/.test(await statText(2)), await statText(2));
check('every agent is compared', (await page.locator('#csAgents ~ table tbody tr, section[aria-labelledby="csAgents"] tbody tr').count()) === 3);
check(
  'an agent whose voice has no price is marked partial',
  /partial/.test(await page.locator('section[aria-labelledby="csAgents"] tr', { hasText: 'Front Desk' }).textContent()),
);
check('and the page asks for the price', /No price for speaking on ElevenLabs eleven_flash_v2_5/.test(await page.locator('.csMissing').textContent()));
check('a call cut off before its end is explained, not hidden', /cut off before the end/.test(await page.locator('.csMissing').textContent()));
await shot('workspace');

// add the missing price
await page.locator('.csMissing').getByRole('button', { name: 'Add a price' }).click();
const input = page.locator('.csPrices tr.missing input').first();
await input.waitFor();
check('“Add a price” opens the prices at that model, ready to type', await input.evaluate((el) => el === document.activeElement));
await input.fill('150');
await input.press('Enter');
await page.waitForFunction(() => !/ElevenLabs/.test(document.querySelector('.csMissing')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
check(
  'with a price, the speaking is priced and the note goes',
  !/ElevenLabs/.test((await page.locator('.csMissing').count()) ? await page.locator('.csMissing').textContent() : ''),
);
check(
  'the price is kept',
  (await page.evaluate(() => JSON.parse(localStorage.getItem('weave_prices_v1')).tts['elevenlabs/eleven_flash_v2_5'].million)) === 150,
);
check('and marked as yours', /1 of yours/.test(await page.locator('.csFold').textContent()));
await shot('prices');
await page.getByRole('button', { name: 'Use the list prices again' }).click();
check('the list prices come back', (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('weave_prices_v1'))).length)) === 0);

// the target
const within = async () => Number((await statText(3)).replace('%', ''));
const at2 = await within();
await page.getByLabel('Target answer time, in seconds').fill('4');
await page.waitForTimeout(200);
check('a longer target, more answers within it', (await within()) > at2, `${at2} → ${await within()}`);
await page.getByLabel('Target answer time, in seconds').fill('2');

// ---- an agent's own page ----------------------------------------------------------------------------------------------------------------------------
await page.locator('section[aria-labelledby="csAgents"] tr', { hasText: 'Front Desk' }).getByRole('button', { name: 'Open' }).click();
await page.waitForSelector('.nlWorkspace .csStats', { timeout: 30000 });
check('“Open” goes to the agent’s own Cost and speed', /#\/bots\/front-desk\/cost/.test(page.url()), page.url());
const nano = page.locator('section[aria-labelledby="csAlt"] tr', { hasText: 'gpt-4.1-nano' });
check('a cheaper model of the same provider shows its saving', /−\d+%/.test(await nano.textContent()), await nano.textContent());
await nano.getByRole('button', { name: 'Use in the draft' }).click();
await page.waitForSelector('.stNotice.good');
check(
  '“Use in the draft” changes the draft, unsaved',
  /gpt-4\.1-nano/.test(await page.locator('.stNotice.good').textContent()) && /Unsaved changes/.test(await page.locator('.nlSaveState').textContent()),
);
await shot('agent');
await page.locator('.stNotice.good').getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(300);
check('Undo puts it back', !/Unsaved changes/.test(await page.locator('.nlSaveState').textContent()));
check('another provider is named, not switched here', (await page.locator('section[aria-labelledby="csAlt"]').getByText('Another provider').count()) > 0);

await page.locator('.csSlow').first().getByRole('button', { name: 'Open the call' }).first().click();
await page.waitForFunction(() => /\/calls\?call=/.test(location.hash), null, { timeout: 10000 }).catch(() => {});
check('a slow answer opens its call', /#\/bots\/front-desk\/calls\?call=/.test(page.url()), page.url());

// the classic layout
await page.evaluate(() => {
  localStorage.setItem('weave_layout', 'classic');
  location.hash = '#/bots/bookings/cost';
  location.reload();
});
await page.waitForSelector('.stStageTabs');
await page.waitForSelector('.csStats', { timeout: 30000 });
check('the classic layout has Cost and speed beside Calls', (await page.locator('.stStageTabs button', { hasText: 'Cost and speed' }).count()) === 1);

check('no errors in the page', problems.length === 0, problems.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
