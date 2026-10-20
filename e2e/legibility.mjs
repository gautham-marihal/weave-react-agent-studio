// Can it be read? In a real browser, on the demo (no backend needed), in both themes and both layouts: no text a person reads is smaller than 12 px, and none
// is below the contrast of 4.5:1 against what is behind it. It looks at computed styles, which a test of the stylesheets cannot see (a size set in `em`, a
// colour set by a theme). Text over a gradient (the primary buttons, the avatars) cannot be measured this way and is skipped; check those by eye.
//
//   npm run dev:demo      (in one terminal)
//   npm run e2e:legibility
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const MIN_SIZE = 12;
const MIN_CONTRAST = 4.5;

// runs in the page: every piece of visible text, its computed size, and its contrast with the colour behind it
function measure({ minSize, minContrast }) {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const behind = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) {
      const style = getComputedStyle(e);
      if (/gradient|url\(/.test(style.backgroundImage)) return null; // not measurable
      const c = parse(style.backgroundColor);
      if (c && c.a > 0) {
        chain.push(c);
        if (c.a >= 1) break;
      }
    }
    const root = parse(getComputedStyle(document.body).backgroundColor);
    let base = root && root.a > 0 ? { ...root, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    for (const c of chain.reverse()) base = over(c, base);
    return base;
  };
  const found = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || !el || el.closest('script,style,svg,[aria-hidden="true"]')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 || el.closest(':disabled,[aria-disabled="true"]')) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const key = `${el.tagName}.${el.className}|${text.slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const size = parseFloat(style.fontSize);
    const where = `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`;
    if (size < minSize) found.push({ kind: 'small', text: text.slice(0, 40), where, detail: `${size.toFixed(1)} px` });
    const fg = parse(style.color);
    const bg = behind(el);
    if (!fg || !bg) continue;
    const front = fg.a < 1 ? over(fg, bg) : fg;
    const [hi, lo] = [lum(front), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : minContrast)) found.push({ kind: 'contrast', text: text.slice(0, 40), where, detail: `${ratio.toFixed(2)}:1` });
  }
  return found;
}

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
const problems = [];
let screens = 0;

for (const layout of ['classic', 'new']) {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(
      ([t, l]) => {
        if (sessionStorage.getItem('legibility')) return;
        sessionStorage.setItem('legibility', '1');
        localStorage.setItem('weave_theme', t);
        localStorage.setItem('weave_layout', l);
        localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
        localStorage.removeItem('weave_demo_state');
      },
      [theme, layout],
    );
    const page = await context.newPage();
    await page.route(
      (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
      (route) => route.abort(),
    );
    const open = async (hash, selector) => {
      await page.evaluate((h) => {
        window.location.hash = h;
      }, hash);
      await page.waitForSelector(selector, { timeout: 15000 });
      await page.waitForTimeout(500);
    };
    const look = async (name) => {
      const found = await page.evaluate(measure, { minSize: MIN_SIZE, minContrast: MIN_CONTRAST });
      screens += 1;
      found.forEach((item) => problems.push(`${layout}/${theme}/${name}: ${item.kind} ${item.detail}  “${item.text}”  (${item.where})`));
    };

    await page.goto(BASE);
    await page
      .getByRole('button', { name: /sign in|get started|start/i })
      .first()
      .click();
    await page.getByPlaceholder('you@company.com').fill('e2e@example.test');
    await page.getByPlaceholder('Enter your password').fill('x12345678');
    await page.getByRole('button', { name: /continue to workspace/i }).click();
    await page.waitForSelector('.dashMain');

    // set-up, in the new layout (it has a JSON editor on one page): a scripted and a live scenario, a published version, and a run, so that the pills have words in them
    await page.evaluate(() => {
      localStorage.setItem('weave_layout', 'new');
      window.location.reload();
    });
    await page.waitForTimeout(1500);
    await open('#/bots/acme-support/settings', '.nlWorkspace');
    await page.locator('.nlParts button', { hasText: 'JSON' }).click();
    const box = page.locator('.nlPage textarea').first();
    const config = JSON.parse(await box.inputValue());
    const channel = (config.channels.find((c) => c.enabled !== false) || config.channels[0]).id;
    config.tests = [
      { id: 'scripted_one', channel, turns: [{ say: 'Hello' }], model_script: ['Hi there.'], expect: [{ said_matches: '.' }] },
      { id: 'live_one', channel, turns: [{ say: 'Hello' }], expect: [{ said_matches: '.' }] },
    ];
    await box.fill(JSON.stringify(config, null, 2));
    await page.waitForTimeout(600);
    await page
      .locator('.nlBar')
      .getByRole('button', { name: /^Save$/ })
      .click();
    await page.waitForTimeout(900);
    await open('#/bots/acme-support/versions?publish=1', '.stPublishPanel .modalCreate');
    await page.locator('.stPublishPanel .modalCreate').first().click();
    await page.waitForTimeout(1200);
    await open('#/bots/acme-support/scenarios', '.scTab');
    await page.getByRole('button', { name: /^Run all/ }).click();
    await page.waitForTimeout(3500);
    await page.evaluate((l) => {
      localStorage.setItem('weave_layout', l);
      window.location.reload();
    }, layout);
    await page.waitForTimeout(1800);

    await open('#/bots', '.dashMain');
    await look('agents');
    await open('#/bots/acme-support/home', '.dashMain');
    await look('agent home');
    await open('#/bots/acme-support/scenarios', '.scTab');
    await look('scenarios');
    await open('#/bots/acme-support/versions', '.dashMain');
    await look('versions');
    await open('#/bots/acme-support/deploy', '.dashMain');
    await look('deploy');
    await open('#/bots/acme-support/questions', '.inQ');
    await page.locator('.inQ .inMore').first().click();
    await look('questions');
    await page.locator('.inBell').click();
    await page.waitForSelector('.inAlert', { timeout: 15000 });
    await look('alerts');
    await page.locator('.sideLink', { hasText: 'Live' }).click();
    await page.waitForSelector('.lvCard', { timeout: 20000 });
    await page.waitForTimeout(800);
    await look('live');
    await page.locator('.sideLink', { hasText: 'Cost and speed' }).click();
    await page.waitForSelector('.csStats', { timeout: 30000 });
    await page.locator('.csFold').click();
    await look('cost');
    await open('#/bots/front-desk/cost', '.csStats');
    await look('agent cost');
    await context.close();
  }
}
await browser.close();

console.log(`${screens} screens looked at (2 themes, 2 layouts)`);
if (problems.length) {
  console.log(`FAIL  ${problems.length} things too small or too faint to read well:`);
  [...new Set(problems)].forEach((line) => console.log(`      ${line}`));
  process.exitCode = 1;
} else console.log('PASS  nothing is smaller than 12 px or below 4.5:1 contrast');
