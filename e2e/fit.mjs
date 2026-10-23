// Nothing is cut off and no words spill out of their box, in a real browser on the demo (nothing reaches an API):
//   1. the test conversation (beside the page on a wide window, sliding over it on a narrower one) shows the whole box to type in at every window
//      size, before a conversation and during one: the orb and the words above it give way, never the box
//   2. the blocks of the Workflow canvas keep every word inside them, with long names and long things to say
//   3. on every page, text meant to fit on one line and end in "…" stays on one line (a style that switches wrapping back on, such as the
//      "text-wrap" shorthand, made such text spill out of its box)
//   4. on every page, what opens in place ("Insert a value", "Preview the prompt", "Using the picture") shows the app's chevron, never the browser's
//      own triangle, and never nothing at all
//
//   npm run dev:demo   then   node e2e/fit.mjs
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (a Chrome or Edge path), E2E_STYLES (default simple,premium), E2E_HEADED=1.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const STYLES = (process.env.E2E_STYLES || 'simple,premium').split(',');
const SIZES = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1280, 720],
  [1280, 640],
  [1280, 600],
  [1100, 720],
];
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

async function open(browser, { width, height, style }) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((s) => {
    if (sessionStorage.getItem('fit')) return;
    sessionStorage.setItem('fit', '1');
    localStorage.setItem('weave_theme', 'light');
    localStorage.setItem('weave_style', s);
    localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e2e@example.test', workspaceName: 'Test', role: 'dev' }));
    localStorage.removeItem('weave_demo_state');
  }, style);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  // the demo answers in the browser: nothing may leave it
  await page.route(
    (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm'),
    (route) => route.abort(),
  );
  await page.goto(BASE);
  await page
    .getByRole('button', { name: /sign in|get started|start/i })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill('e2e@example.test');
  await page.getByPlaceholder('Enter your password').fill('x12345678');
  await page.getByRole('button', { name: /continue to workspace/i }).click();
  await page.waitForSelector('.dashMain');
  return { context, page, problems };
}

const go = async (page, hash, wait = 1200) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForTimeout(wait);
};

// how much of the box to type in can be seen: cut by every box around it that hides what spills out of it, up to the panel
const composerShown = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('.nlTestDock, .nlDrawer');
    const composer = panel?.querySelector('.pvComposer');
    if (!panel || !composer) return { error: `panel ${!!panel}, box ${!!composer}` };
    const r = composer.getBoundingClientRect();
    let top = r.top;
    let bottom = r.bottom;
    for (let a = composer.parentElement; a; a = a.parentElement) {
      const st = getComputedStyle(a);
      if (st.overflowY !== 'visible' || st.overflowX !== 'visible') {
        const box = a.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
      if (a === panel) break;
    }
    bottom = Math.min(bottom, window.innerHeight);
    return { shown: Math.round((Math.max(0, bottom - top) / r.height) * 100) };
  });

// text that should end in "…" on one line but runs onto more lines; and, inside a box of a fixed size, words outside the box
const spills = (page, scope) =>
  page.evaluate((sel) => {
    // the lines the words are on: pieces that overlap from top to bottom are one line (a chip with padding sits a little higher than the words)
    const lines = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top);
      let count = 0;
      let bottom = -Infinity;
      for (const r of rects) {
        if (r.top >= bottom - 2) count += 1;
        bottom = Math.max(bottom, r.bottom);
      }
      return count;
    };
    const out = [];
    const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().slice(0, 30)}"`;
    for (const el of document.querySelectorAll(sel)) {
      if (!el.textContent.trim() || !el.getClientRects().length) continue;
      const st = getComputedStyle(el);
      if (st.textOverflow !== 'ellipsis' || st.overflowX === 'visible' || /\d/.test(st.webkitLineClamp || '')) continue;
      const n = lines(el);
      if (n > 1) out.push(`${name(el)} is on ${n} lines`);
      // and, however short it is today, one-line text whose style has wrapping switched back on (it will spill when its words get longer)
      else if (st.whiteSpace !== 'nowrap' && st.whiteSpace !== 'pre') out.push(`${name(el)} ends in "…" but wraps (white-space: ${st.whiteSpace})`);
    }
    return out.slice(0, 8);
  }, scope);

// every <summary> on the page (opened, so the ones inside show too) that draws the browser's triangle or no open/close cue at all
const bareToggles = async (page) => {
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => document.querySelectorAll('details:not([open])').forEach((d) => (d.open = true)));
    await page.waitForTimeout(200);
  }
  return page.evaluate(() =>
    [...document.querySelectorAll('summary')]
      .filter((s) => s.getClientRects().length)
      .flatMap((s) => {
        const st = getComputedStyle(s);
        const what = `${String(s.parentElement.className).split(' ')[0] || 'details'} "${s.textContent.trim().slice(0, 30)}"`;
        // a summary the browser marks: fine when the marker is the app's chevron (saas.css draws it), not the browser's own triangle
        if (st.display === 'list-item' && st.listStyleType !== 'none')
          return /url\(/.test(getComputedStyle(s, '::marker').content) ? [] : [`${what} shows the browser's triangle`];
        const drawn = ['::before', '::after'].some((p) => !['none', 'normal', ''].includes(getComputedStyle(s, p).content));
        return drawn || s.querySelector('svg') ? [] : [`${what} has nothing that shows it opens`];
      }),
  );
};

const browser = await launch();

// ---- 1. the test conversation fits, at every size
for (const style of STYLES) {
  for (const [width, height] of SIZES) {
    const { context, page, problems } = await open(browser, { width, height, style });
    await go(page, '#/bots/acme-support/agent');
    await page.locator('.nlBar').getByRole('button', { name: /^Test/ }).click();
    await page.waitForTimeout(700);
    const before = await composerShown(page);
    await page
      .locator('.nlTestDock, .nlDrawer')
      .getByRole('button', { name: /Start a simulated chat|Start a conversation/ })
      .first()
      .click();
    await page.waitForTimeout(1500);
    const during = await composerShown(page);
    check(
      `${style} ${width}×${height}: the box to type in is whole, before and during a conversation`,
      before.shown >= 99 && during.shown >= 99 && !problems.length,
      `${before.error || `${before.shown}%`} before, ${during.error || `${during.shown}%`} during${problems.length ? `; ${problems[0]}` : ''}`,
    );
    await context.close();
  }
}

// ---- 2. the Workflow canvas, with long names and long things to say
for (const style of STYLES) {
  const { context, page, problems } = await open(browser, { width: 1440, height: 900, style });
  await go(page, '#/bots/acme-support/settings');
  await page.locator('.nlPageActions button', { hasText: 'Edit as JSON' }).click();
  const box = page.locator('.nlPage textarea').first();
  await page.waitForFunction(() => (document.querySelector('.nlPage textarea')?.value || '').length > 20);
  const config = JSON.parse(await box.inputValue());
  const long = 'Thanks for contacting Nimbus Home Services today. We hope we could help, and have a really great day!';
  // agents are { entry, items: [...] }; a tool's goodbye can be words or a saved message: words here, long ones
  const items = Array.isArray(config.agents?.items) ? config.agents.items : [];
  items.forEach((a) => (a.name = `${a.name || a.id} for the whole of the customer care team in the evenings`));
  (Array.isArray(config.tools) ? config.tools : []).forEach((t) => {
    t.name = `${t.name || t.id} with a much longer name than usual`;
    if (t.builtin === 'end_call' || /end/.test(t.id)) t.params = { ...(t.params || {}), say: long };
  });
  await box.fill(JSON.stringify(config, null, 2));
  await go(page, '#/bots/acme-support/workflow', 1800);
  const nodes = await page.evaluate(() =>
    [...document.querySelectorAll('.wfNode')].map((node) => {
      const n = node.getBoundingClientRect();
      const words = [...node.querySelectorAll('strong, small')].filter((el) => el.textContent.trim() && el.getClientRects().length);
      const outside = words.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top < n.top - 1 || r.bottom > n.bottom + 1 || r.left < n.left - 1 || r.right > n.right + 1;
      });
      const wrapped = words.filter((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        // the lines that can be seen: those a clamp hides (below the element's own box) are laid out, but not shown
        const own = el.getBoundingClientRect();
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0 && r.top < own.bottom - 1).sort((a, b) => a.top - b.top);
        let count = 0;
        let bottom = -Infinity;
        for (const r of rects) {
          if (r.top >= bottom - 2) count += 1;
          bottom = Math.max(bottom, r.bottom);
        }
        // one line, or as many as the block says it shows (its description may take two, cut with "…")
        return count > (Number(getComputedStyle(el).webkitLineClamp) || 1);
      });
      return { id: node.dataset.node, outside: outside.length, wrapped: wrapped.length, tip: !!node.getAttribute('title') };
    }),
  );
  const bad = nodes.filter((n) => n.outside || n.wrapped);
  check(
    `${style}: ${nodes.length} workflow blocks keep every word inside, on the lines they show`,
    nodes.length > 2 && !bad.length,
    JSON.stringify(bad.slice(0, 3)),
  );
  check(
    `${style}: every block has its whole text as a tooltip`,
    nodes.every((n) => n.tip || n.id === 'start'),
  );
  check(`${style}: no page errors on the canvas`, !problems.length, problems[0]);
  await context.close();
}

// ---- 3. one-line text stays on one line, on every page
const ROUTES = [
  '#/home',
  '#/bots',
  '#/bots?new=1',
  '#/calls',
  '#/live',
  '#/monitoring',
  '#/speed',
  '#/alerts',
  '#/voices',
  '#/integrations',
  '#/telephony/numbers',
  '#/team',
  '#/settings',
  ...[
    'home',
    'agent',
    'tools',
    'workflow',
    'channels',
    'guardrails',
    'aftercall',
    'tests',
    'scenarios',
    'releases',
    'calls',
    'monitoring',
    'speed',
    'settings',
  ].map((p) => `#/bots/acme-support/${p}`),
  // the guided setup, step by step (last: moving between its steps saves nothing, so nothing is asked before the next style)
  ...['purpose', 'reach', 'voice', 'knowledge', 'actions', 'try', 'live'].map((s) => `#/bots/front-desk/setup?step=${s}`),
];
for (const style of STYLES) {
  const { context, page } = await open(browser, { width: 1440, height: 900, style });
  const found = [];
  const toggles = new Set();
  for (const route of ROUTES) {
    await go(page, route, 1000);
    (await spills(page, 'body *')).forEach((s) => found.push(`${route}: ${s}`));
    (await bareToggles(page)).forEach((s) => toggles.add(`${route}: ${s}`));
  }
  check(`${style}: text cut to one line with "…" stays on one line on ${ROUTES.length} pages`, !found.length, found.slice(0, 6).join(' | '));
  check(`${style}: everything that opens in place shows a chevron on ${ROUTES.length} pages`, !toggles.size, [...toggles].slice(0, 6).join(' | '));
  await context.close();
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nPASS  all checks passed');
process.exit(failed ? 1 : 0);
