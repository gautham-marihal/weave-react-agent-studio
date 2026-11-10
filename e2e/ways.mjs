// The side Test panel's ways in (FRONTEND_GUIDE section 6): an agent offering web chat and web voice side by side is tried as the one chosen, the
// server is asked for that channel, the panel names it while the conversation runs, and after it ends the other one is a press away. An agent with one
// web channel keeps the single start. Checked in the panel beside the agent's pages and in the guided setup's Try it step, at the user's window size.
// The API is the imitation one (e2e/mockApi.mjs) and livekit-client the fake in e2e/fakeLivekit.js; the made-up session answer names the channel asked
// for, as the real server does.
//
// Run it with the dev server up WITHOUT demo mode, signing in from e2e/credentials.txt:
//   CREDENTIALS_FILE=e2e/credentials.txt npx vite --port 5181 --strictPort
//   E2E_BASE=http://localhost:5181 node e2e/ways.mjs
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createMockApi, fakeSession } from './mockApi.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS || '';
const EMAIL = process.env.E2E_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'any-password';
const FAKE_LIVEKIT = fs.readFileSync(new URL('./fakeLivekit.js', import.meta.url), 'utf8');
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const BOT = 'acme-support'; // given a web voice channel beside its web chat below
const ONE_WAY = 'bookings'; // a web chat only

let failures = 0;
const step = (name, ok, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`);
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
const context = await browser.newContext({ viewport: { width: 1536, height: 730 }, permissions: ['microphone'] });
await context.addInitScript((email) => {
  if (sessionStorage.getItem('e2e-seeded')) return;
  sessionStorage.setItem('e2e-seeded', '1');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'E2E Tester', email, workspaceName: 'E2E', role: 'dev' }));
}, EMAIL);
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !/Failed to load resource/.test(m.text())) problems.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

const mock = createMockApi();
const asked = []; // the channel each session was asked for
await page.route(
  (url) => url.pathname.startsWith('/api/'),
  async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const session = /^\/bots\/([^/]+)\/sessions$/.exec(path);
    if (session && req.method() === 'POST') {
      const body = req.postDataJSON() || {};
      asked.push(body.channel || '');
      const draft = await mock.bots.get(session[1]);
      const channel = (draft?.config?.channels || []).find((c) => c.id === body.channel) || (draft?.config?.channels || [])[0];
      const answer = fakeSession(session[1], body.ref);
      answer.channel = { id: channel.id, type: channel.type, input: channel.modalities.input, output: channel.modalities.output };
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(answer) });
    }
    return mock.handle(route);
  },
);
await page.route('**/livekit-client.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_LIVEKIT }));

const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const until = async (check, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
const textOf = async (selector) =>
  (
    await page
      .locator(selector)
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
// nothing in the panel's head runs past its edge
const headFits = (panel) =>
  page.evaluate((sel) => {
    const head = document.querySelector(`${sel} .pvHead`);
    if (!head) return 'no head';
    const box = head.getBoundingClientRect();
    const out = [...head.children].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && (r.right > box.right + 1 || r.left < box.left - 1);
    });
    return out.length ? `past the edge: ${out.map((el) => el.className || el.tagName).join(', ')}` : '';
  }, panel);

try {
  console.log(`The side panel's ways in, ${BASE}`);
  await page.goto(BASE);
  await page
    .getByRole('button', { name: /sign in|get started|start/i })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill(EMAIL);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: /continue to workspace/i }).click();
  await page.waitForSelector('.dashMain');

  // the agent gets a web voice channel beside its web chat (in the imitation API only)
  const added = await page.evaluate(async (id) => {
    const draft = await (await fetch(`/api/bots/${id}/draft`)).json();
    const config = draft.config;
    config.channels.push({
      id: 'web-voice',
      type: 'web_voice',
      enabled: true,
      entry: { widget_id: `${id}-voice` },
      modalities: { input: ['audio'], output: ['audio'] },
      greeting: { say: 'Hi, thanks for calling Acme Support.' },
    });
    const saved = await fetch(`/api/bots/${id}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, base_revision: draft.revision }),
    });
    return saved.status;
  }, BOT);
  step('the agent now offers web chat and web voice', added === 200, `PUT draft answered ${added}`);

  // ---- 1. the panel beside the agent's pages
  await page.evaluate((id) => (location.hash = `#/bots/${id}/agent`), BOT);
  await page.waitForSelector('.dtPart', { timeout: 15000 });
  await page.locator('.nlBar').getByRole('button', { name: /^Test/ }).click();
  const panel = '.nlTestDock .pvPanel';
  await page.waitForSelector(panel);
  step('ready: the two ways in replace the single start', await until(async () => (await page.locator(`${panel} .pvWay`).count()) === 2), await textOf(panel));
  const ways = (await page.locator(`${panel} .pvWay b`).allInnerTexts()).join(' | ');
  step('ready: they read Chat and Talk', ways === 'Chat | Talk', ways);
  await page.waitForTimeout(400);
  await shot('ways-1-ready');
  // WCAG 2.2 A and AA on the panel, in both themes (the a11y suite's demo agents have one web channel, so it never sees this)
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    // the colours ease in after a theme switch: axe reads them once they have settled (as the a11y suite waits)
    await page.waitForTimeout(800);
    if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
    const found = await page.evaluate(
      (sel) =>
        window.axe
          .run(document.querySelector(sel), {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
            resultTypes: ['violations'],
          })
          .then((r) => r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)),
      panel,
    );
    step(`ready, ${theme}: no accessibility problems in the panel`, found.length === 0, found.join('\n      '));
    if (theme === 'dark') await shot('ways-1-ready-dark');
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

  await page.locator(`${panel} .pvWay`, { hasText: 'Talk' }).click();
  step('Talk: the server is asked for the web voice channel', await until(async () => asked.at(-1) === 'web-voice'), asked.join(','));
  step(
    'Talk: the panel names it while it runs',
    await until(async () => /Web voice/.test(await textOf(`${panel} .pvStatus`))),
    await textOf(`${panel} .pvHead`),
  );
  step('Talk: it is drawn as a call', await until(async () => (await page.locator(`${panel} .pvVoice`).count()) > 0));
  const fit1 = await headFits(panel);
  step('Talk: the panel head fits, nothing cut off', fit1 === '', fit1);
  // the call takes what is left: End (in the box to type in) stays inside the panel and the window, and the orb is drawn at the
  // panel's size, not a fixed 200 px
  await until(async () => (await page.locator(panel).getAttribute('data-state')) === 'live');
  const callFits = await page.evaluate((sel) => {
    const box = document.querySelector(sel).getBoundingClientRect();
    const end = [...document.querySelectorAll(`${sel} button`)].find((b) => /^End/.test(b.textContent.trim()));
    if (!end) return 'no End button';
    const e = end.getBoundingClientRect();
    if (e.bottom > box.bottom + 1 || e.bottom > innerHeight + 1) return `End is out of reach (bottom ${Math.round(e.bottom)}, panel ${Math.round(box.bottom)})`;
    const orb = document.querySelector(`${sel} .vOrb`).getBoundingClientRect();
    return orb.width >= 200 ? `the orb is ${Math.round(orb.width)} px in a short panel` : '';
  }, panel);
  step('Talk: End stays in reach, the call fits the panel', callFits === '', callFits);
  await shot('ways-2-talking');

  // ending it yourself brings the ways in back
  await page.locator(panel).getByRole('button', { name: /^End/ }).first().click();
  step('ended by you: both ways in are back', await until(async () => (await page.locator(`${panel} .pvWay`).count()) === 2), await textOf(panel));
  await page.locator(`${panel} .pvWay`, { hasText: 'Chat' }).click();
  step('Chat: the server is asked for the web chat channel', await until(async () => asked.at(-1) === 'web-chat'), asked.join(','));
  step(
    'Chat: the panel names it, and the agent greets in the chat',
    await until(async () => /Web chat/.test(await textOf(`${panel} .pvStatus`)) && /Hello there/.test(await textOf(`${panel} .pvLog`))),
    await textOf(panel),
  );
  const fit2 = await headFits(panel);
  step('chatting: the panel head fits, nothing cut off', fit2 === '', fit2);
  await shot('ways-3-chatting');

  // ---- 2. the agent ends the conversation: the same channel again is the main choice, the other is beside it
  await page.evaluate(() => {
    const room = window.__fake.rooms[window.__fake.rooms.length - 1];
    room.emit('disconnected');
  });
  step(
    'ended by the agent: chatting again is the main choice, talking instead is beside it',
    await until(async () => /Chat again/.test(await textOf(`${panel} .pvEnded`)) && /Talk instead/.test(await textOf(`${panel} .pvEnded`))),
    await textOf(panel),
  );
  const main = await page.locator(`${panel} .pvEnded button`).first().innerText();
  step('ended by the agent: the first, main button is the same channel again', /Chat again/.test(main), main);
  await shot('ways-4-ended');
  await page
    .locator(`${panel} .pvEnded`)
    .getByRole('button', { name: /Talk instead/ })
    .click();
  step('Talk instead: the server is asked for the web voice channel', await until(async () => asked.at(-1) === 'web-voice'), asked.join(','));
  step('Talk instead: the panel names it', await until(async () => /Web voice/.test(await textOf(`${panel} .pvStatus`))), await textOf(`${panel} .pvHead`));
  await page.locator(panel).getByRole('button', { name: /^End/ }).first().click();
  await until(async () => (await page.locator(`${panel} .pvWay`).count()) === 2);

  // ---- 3. the guided setup's Try it step offers the same
  await page.evaluate((id) => (location.hash = `#/bots/${id}/setup?step=try`), BOT);
  const setupPanel = '.suPage .pvPanel';
  await page.waitForSelector(setupPanel, { timeout: 15000 });
  if ((await page.locator(`${setupPanel} .pvEnded`).count()) === 0)
    step(
      'setup: the ways in are offered on the Try it step',
      await until(async () => (await page.locator(`${setupPanel} .pvWay`).count()) === 2),
      await textOf(setupPanel),
    );
  else
    step(
      'setup: after a conversation, both channels are offered again',
      /again/.test(await textOf(`${setupPanel} .pvEnded`)) && /instead/.test(await textOf(`${setupPanel} .pvEnded`)),
    );
  await shot('ways-5-setup');

  // ---- 4. an agent with one web channel keeps the single start
  await page.evaluate((id) => (location.hash = `#/bots/${id}/agent`), ONE_WAY);
  await page.waitForSelector('.dtPart', { timeout: 15000 });
  if ((await page.locator('.nlTestDock').count()) === 0) await page.locator('.nlBar').getByRole('button', { name: /^Test/ }).click();
  await page.waitForSelector(panel);
  step(
    'one web channel: no choice, the single start as before',
    (await page.locator(`${panel} .pvWay`).count()) === 0 &&
      (await page
        .locator(panel)
        .getByRole('button', { name: /Start a conversation|Start a call/ })
        .count()) > 0,
    await textOf(panel),
  );

  step('no console errors', problems.length === 0, problems.slice(0, 5).join('\n      '));
} catch (error) {
  step('ran to the end', false, error.stack || String(error));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exitCode = failures ? 1 : 0;
