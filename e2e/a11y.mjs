// Can everyone use it? In a real browser, on the demo (no backend needed): every workspace page, every page of an agent, the setup's steps and the
// dialogs and panels that open over them, each checked by axe-core against WCAG 2.2 A and AA (names on every control, labels that point at their box,
// contrast, landmarks, ids, ARIA used as it is meant). Light and dark, and any style asked for. It fails on any violation, and says where.
//
//   npm run dev:demo      (in one terminal)
//   npm run e2e:a11y
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch,
//   STYLES=simple,calm (default: simple), THEMES=light,dark (default: both), E2E_REPORT=file.json for every place found, with its HTML.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const STYLES = (process.env.STYLES || 'simple').split(',');
const THEMES = (process.env.THEMES || 'light,dark').split(',');
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

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

const B = '#/bots/acme-support';
// [name, address, what shows when it is ready]
const PAGES = [
  ...['home', 'bots', 'calls', 'live', 'monitoring', 'speed', 'alerts', 'voices', 'integrations', 'team', 'settings'].map((p) => [p, `#/${p}`, '.dashMain']),
  ...['home', 'agent', 'knowledge', 'tools', 'workflow', 'channels', 'guardrails', 'aftercall', 'tests', 'scenarios', 'checks', 'callers']
    .concat(['versions', 'deploy', 'calls', 'monitoring', 'questions', 'speed', 'settings'])
    .map((p) => [`agent ${p}`, `${B}/${p}`, '.nlWorkspace']),
];
// the setup's steps, looked at last: its language step gives an agent with no main language the browser's, as a change to save, so leaving it then asks
const SETUP = ['purpose', 'reach', 'voice', 'knowledge', 'actions', 'try', 'live'].map((s) => [`setup ${s}`, `${B}/setup?step=${s}`, '.suPage']);
// what opens over a page: [name, address, the control that opens it, what shows once it is open]
const OVERLAYS = [
  ['create an agent', '#/bots?new=1', null, '[role=dialog]'],
  ['a tool’s panel', `${B}/tools`, '.nlRow button, .nlRows button', '.nlDrawer'],
  ['a channel’s panel', `${B}/channels`, '.nlRow button, .nlRows button', '.nlDrawer'],
  ['the test panel', `${B}/home`, '.nlBar button:has-text("Test")', '.nlTestDock'],
  ['Describe', `${B}/home`, '.nlBar button:has-text("Describe")', '.nlDrawer'],
  ['a new scenario', `${B}/scenarios`, 'button:has-text("New scenario")', 'form.scForm'],
  ['a block of the workflow', `${B}/workflow`, '.wfNode[data-type="agent"]', '.wfInspector'],
  ['the search', '#/home', 'button:has-text("Search")', '[role=dialog]'],
];

const browser = await launch();
const found = new Map(); // rule id -> { impact, help, url, where: Set<string> }
const details = []; // every place, with its HTML and what is wrong there, for E2E_REPORT
let screens = 0;

for (const style of STYLES) {
  for (const theme of THEMES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
    await context.addInitScript(
      ([s, t]) => {
        if (sessionStorage.getItem('a11y')) return;
        sessionStorage.setItem('a11y', '1');
        localStorage.setItem('weave_style', s);
        localStorage.setItem('weave_theme', t);
        localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
        localStorage.removeItem('weave_demo_state');
      },
      [style, theme],
    );
    const page = await context.newPage();
    await page.route(
      (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
      (route) => route.abort(),
    );
    const go = async (hash, selector) => {
      await page.evaluate((h) => {
        window.location.hash = h;
      }, hash);
      await page.waitForSelector(selector, { timeout: 15000 });
      await page.waitForTimeout(700);
    };
    const check = async (name) => {
      // a page reading its data dims what it showed before (aria-busy) for a moment: it is looked at once it has finished
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(300);
      if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
      const result = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), RULES);
      screens += 1;
      result.violations.forEach((v) => {
        if (!found.has(v.id)) found.set(v.id, { impact: v.impact, help: v.help, url: v.helpUrl, where: new Set() });
        v.nodes.forEach((n) => {
          found.get(v.id).where.add(`${style} ${theme} / ${name}: ${n.target.join(' ')}`);
          details.push({ rule: v.id, style, theme, screen: name, target: n.target.join(' '), html: n.html.slice(0, 300), why: n.failureSummary });
        });
      });
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

    for (const [name, hash, ready] of PAGES) {
      await go(hash, ready);
      await check(name);
    }
    for (const [name, hash, opener, open] of OVERLAYS) {
      await go(hash, 'body');
      if (opener) {
        const button = page.locator(opener).first();
        if (!(await button.count())) {
          found.set(`(could not open: ${name})`, { impact: 'serious', help: `Nothing matched ${opener}`, url: '', where: new Set([`${style} ${theme}`]) });
          continue;
        }
        await button.click();
      }
      const shown = await page
        .waitForSelector(open, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!shown) {
        if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/a11y-${name.replace(/\W+/g, '-')}.png` });
        found.set(`(did not open: ${name})`, { impact: 'serious', help: `${open} did not show`, url: '', where: new Set([`${style} ${theme}`]) });
        continue;
      }
      await page.waitForTimeout(600);
      await check(name);
      await page.keyboard.press('Escape');
    }
    for (const [name, hash, ready] of SETUP) {
      await go(hash, ready);
      await check(name);
    }
    await context.close();
  }
}
await browser.close();
if (process.env.E2E_REPORT) writeFileSync(process.env.E2E_REPORT, JSON.stringify(details, null, 1));

console.log(`${screens} screens checked (${STYLES.join(', ')} × ${THEMES.join(', ')}), WCAG 2.2 A and AA`);
if (found.size) {
  for (const [id, f] of found) {
    console.log(`FAIL  ${id} (${f.impact}): ${f.help}  ${f.url}`);
    [...f.where].slice(0, 8).forEach((w) => console.log(`        ${w}`));
    if (f.where.size > 8) console.log(`        … and ${f.where.size - 8} more`);
  }
  console.log(`\n${found.size} rule(s) broken`);
  process.exitCode = 1;
} else console.log('PASS  no violations');
