// Typing speed on a big agent, in a real browser. It makes agents with 3, 27 and 100 HTTP tools in demo mode (nothing reaches an API), opens
// the Tools section with every card expanded (the worst case: tens of thousands of DOM nodes), types 40 letters into one description, and
// times each from the keystroke to the second animation frame. A keystroke should re-render ONE card, not all of them, so the time must not
// grow with the number of tools: past about 100 ms typing feels sticky.
//
//   npm run build -- --mode demo      then      npx vite preview --mode demo --port 4180      then      E2E_BASE=http://localhost:4180 npm run e2e:typing
//
// Measure a PRODUCTION build: the dev server (npm run dev:demo) adds React's development checks and is several times slower.
// The budget: with 100 tools expanded the median stays within 40 ms of the 3-tool median (which is the browser's two-frame floor, about 33 ms).
// Environment: E2E_BASE (default http://localhost:4180), E2E_BROWSER (Chrome or Edge), E2E_TOOLS (comma list, default 3,27,100), E2E_STYLE (a design
// style: simple, premium, futuristic or vibrant; default simple) and E2E_THEME (light or dark), to time the styles that blur and glow too.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:4180';
const SIZES = (process.env.E2E_TOOLS || '3,27,100').split(',').map(Number);
const BUDGET_MS = 40;
const STYLE = process.env.E2E_STYLE || 'simple';
const THEME = process.env.E2E_THEME || 'light';

function bigConfig(n) {
  const tools = Array.from({ length: n }, (_, i) => ({
    id: `tool_${i}`,
    type: 'http',
    connection: 'api',
    description: `Looks up record number ${i} for the caller when they ask about it`,
    request: { method: 'GET', path: `/records/${i}/{{args.record_id}}`, query: { v: '2' } },
    parameters: { type: 'object', required: ['record_id'], properties: { record_id: { type: 'string', description: 'The id of the record' } } },
    result: { to_llm: ['found', 'summary'] },
    timeout_s: 6,
  }));
  return {
    schema_version: '1.2',
    meta: { id: 'big', name: 'Big', version: '0.1.0', status: 'draft' },
    runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
    defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } }, conversation: {} },
    persona: { name: 'Big' },
    connections: { api: { type: 'http', base_url: 'https://api.example.com' } },
    channels: [
      {
        id: 'web-chat',
        type: 'web_chat',
        enabled: true,
        entry: { widget_id: 'big-widget' },
        modalities: { input: ['text'], output: ['text'] },
        greeting: { say: 'Hello!' },
      },
    ],
    agents: {
      entry: 'assistant',
      items: [{ id: 'assistant', name: 'Assistant', kind: 'standalone', instructions: { role: 'You help.' }, tools: tools.slice(0, 20).map((t) => t.id) }],
    },
    tools,
  };
}

async function launch() {
  if (process.env.E2E_BROWSER) return chromium.launch({ executablePath: process.env.E2E_BROWSER, headless: true });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try the next */
    }
  }
  throw new Error('No Chrome or Edge found. Set E2E_BROWSER to the path of one.');
}

async function measure(browser, tools) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await context.addInitScript(
    ([cfg, style, theme]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('weave_layout', 'classic'); // this script types in the classic layout's config form
      localStorage.setItem('weave_style', style);
      localStorage.setItem('weave_theme', theme);
      localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E', email: 'e@t.dev', workspaceName: 'Test', role: 'dev' }));
      const now = new Date().toISOString();
      localStorage.setItem(
        'weave_demo_state',
        JSON.stringify({
          v: 1,
          bots: { big: { id: 'big', name: 'Big', revision: 1, savedAt: now, savedBy: 'demo', config: cfg, versions: [], deployments: [], deployed: {} } },
        }),
      );
    },
    [bigConfig(tools), STYLE, THEME],
  );
  const page = await context.newPage();
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => route.abort(),
  ); // demo mode never calls it; this makes sure
  await page.goto(BASE);
  await page
    .getByRole('button', { name: /sign in|get started|start/i })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill('e@t.dev');
  await page.getByPlaceholder('Enter your password').fill('whatever123');
  await page.getByRole('button', { name: /continue to workspace/i }).click();
  await page.waitForSelector('.dashMain');
  await page.goto(`${BASE}/#/bots/big/config`);
  await page.waitForSelector('.smCard');
  await page.getByRole('button', { name: 'All settings', exact: true }).click();
  await page.waitForSelector('.stForm');
  await page.getByRole('tab', { name: /^What it can do/ }).click(); // "All settings" is grouped by task: the tools are under "What it can do"
  await page.locator('[data-section="tools"]').click();
  await page.waitForSelector('.stFSection');
  for (let pass = 0; pass < 4; pass += 1) {
    // expand every card and every fold: the worst case
    await page.evaluate(() => {
      document.querySelectorAll('.stForm details:not([open])').forEach((d) => {
        d.open = true;
      });
      // (a deeper part opens in a panel over the page, one at a time: those stay closed)
      document.querySelectorAll('.stFGroup:not(.drill) > header .stFGroupToggle[aria-expanded=false]').forEach((b) => b.click());
    });
    await page.waitForTimeout(700);
  }
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  const target = page.locator('.stTool').first().getByLabel('Description').first();
  await target.scrollIntoViewIfNeeded();
  await target.click();
  const times = await page.evaluate(async () => {
    const el = document.activeElement;
    const out = [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const set = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
    for (let i = 0; i < 40; i += 1) {
      const t0 = performance.now();
      set.call(el, `${el.value}x`);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await frame();
      out.push(performance.now() - t0);
    }
    return out;
  });
  await context.close();
  times.sort((a, b) => a - b);
  const at = (p) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))]);
  return { tools, nodes, median: at(0.5), p95: at(0.95), max: Math.round(times[times.length - 1]) };
}

const browser = await launch();
const rows = [];
for (const size of SIZES) {
  rows.push(await measure(browser, size));
  console.log(JSON.stringify(rows[rows.length - 1]));
}
await browser.close();
const floor = rows[0].median;
const worst = rows[rows.length - 1];
const ok = worst.median <= floor + BUDGET_MS;
console.log(
  `${ok ? 'PASS' : 'FAIL'}  ${worst.tools} tools expanded: median ${worst.median} ms, budget ${floor + BUDGET_MS} ms (the ${rows[0].tools}-tool floor ${floor} ms + ${BUDGET_MS})`,
);
process.exit(ok ? 0 : 1);
