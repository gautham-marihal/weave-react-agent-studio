// Pictures (FRONTEND_GUIDE 7.1, MEDIA_PROTOCOL.md): a test conversation answers the agent's picture requests, Build edits
// the four picture steps, and a scenario carries sample pictures. The API is the imitation one (e2e/mockApi.mjs) and
// livekit-client is the fake in e2e/fakeLivekit.js, so the runtime's messages are sent from here on agent-builder.ui, as
// the runtime sends them, and what the screen sends back (a file on a byte stream, the camera) is read from the fake.
// The simulated agent runs its picture steps in the browser, with Chrome's stand-in camera.
//
// Run it with the dev server up WITHOUT demo mode, signing in from e2e/credentials.txt:
//   CREDENTIALS_FILE=e2e/credentials.txt npx vite --port 5181 --strictPort
//   E2E_BASE=http://localhost:5181 node e2e/pictures.mjs
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createMockApi } from './mockApi.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS || '';
const EMAIL = process.env.E2E_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'any-password';
const FAKE_LIVEKIT = fs.readFileSync(new URL('./fakeLivekit.js', import.meta.url), 'utf8');
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const BOT = 'acme-support';
const MB = 1024 * 1024;

let failures = 0;
const step = (name, ok, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`);
};

async function launch() {
  const headless = process.env.E2E_HEADED !== '1';
  // Chrome's stand-in camera, and no permission prompt: the simulated agent takes frames from it
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  if (process.env.E2E_BROWSER) return chromium.launch({ executablePath: process.env.E2E_BROWSER, headless, args });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless, args });
    } catch {
      /* try the next one */
    }
  }
  throw new Error('No Chrome or Edge found. Set E2E_BROWSER to the path of one.');
}

const browser = await launch();
// the user's window size: nothing may be cut off there
const context = await browser.newContext({ viewport: { width: 1536, height: 730 }, permissions: ['camera'] });
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
await page.route(
  (url) => url.pathname.startsWith('/api/'),
  (route) => mock.handle(route),
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
const textOf = async (sel) =>
  (
    await page
      .locator(sel)
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');

// the runtime tells the screen something, on agent-builder.ui
const tell = (message) =>
  page.evaluate((text) => {
    const room = window.__fake.rooms[window.__fake.rooms.length - 1];
    room.streams['agent-builder.ui'](
      {
        info: { id: `ui-${Math.random()}`, attributes: {} },
        async *[Symbol.asyncIterator]() {
          yield text;
        },
      },
      { identity: 'agent-1' },
    );
  }, JSON.stringify(message));
// the studio's selects are styled lists: open, then pick the choice by its words
const pick = async (scope, label, option) => {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};
// the camera is shared after a short get-ready countdown in the large view; Share now skips it
const shareNow = async () => {
  const go = page.locator('.pcStage').getByRole('button', { name: 'Share now' });
  await go.waitFor();
  await page.waitForFunction(() => !document.querySelector('.pcStage .pcStageMain')?.disabled);
  await go.click();
};
const sent = (kind) => page.evaluate((k) => window.__fake.sent.filter((s) => s.kind === k), kind);
// a real PNG drawn in the page: a sharp pattern, or a flat grey (no edges: as blurred as a picture gets)
const png = (sharp) =>
  page.evaluate((isSharp) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 504;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c9d3e4';
    ctx.fillRect(0, 0, 800, 504);
    if (isSharp) {
      ctx.fillStyle = '#1d2433';
      for (let y = 0; y < 504; y += 8) for (let x = (y / 8) % 2 ? 0 : 8; x < 800; x += 16) ctx.fillRect(x, y, 8, 8);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, sharp);
const fileOf = async (name, sharp = true) => ({ name, mimeType: 'image/png', buffer: Buffer.from(await png(sharp), 'base64') });

// the card sits inside the window and inside the panel that holds it, and the box to type in stays in view
const fits = (holder, card = '.pcCard') =>
  page.evaluate(
    ([sel, cardSel]) => {
      const box = document.querySelector(sel);
      const el = document.querySelector(`${sel} ${cardSel}`);
      if (!box || !el) return 'no card';
      const b = box.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      if (c.left < b.left - 1 || c.right > b.right + 1)
        return `wider than its panel (${Math.round(c.left)}–${Math.round(c.right)} in ${Math.round(b.left)}–${Math.round(b.right)})`;
      const cut = [...el.querySelectorAll('*')].filter(
        (n) =>
          n.scrollWidth > n.clientWidth + 1 &&
          getComputedStyle(n).overflowX === 'hidden' &&
          n.clientWidth > 0 &&
          !n.matches('video, .pcView, .pcThumb, .pcCard, .srOnly'),
      );
      if (cut.length) return `cut off inside: ${cut.map((n) => n.className).join(', ')}`;
      const composer = box.querySelector('.pvComposer');
      const k = composer?.getBoundingClientRect();
      if (composer && (k.bottom > window.innerHeight + 1 || k.bottom > b.bottom + 1)) return 'the box to type in is pushed out of view';
      return '';
    },
    [holder, card],
  );
const axe = async (sel) => {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
  return page.evaluate(
    (s) =>
      window.axe
        .run(document.querySelector(s), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
          resultTypes: ['violations'],
        })
        .then((r) =>
          // each node with axe's own reason, which names the element in the way
          r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} (${n.any?.[0]?.message || n.all?.[0]?.message || ''})`).join(', ')}`),
        ),
    sel,
  );
};
const bothThemes = async (name, sel) => {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    // the colours ease to the new theme: checked once they have settled
    await page.waitForTimeout(700);
    const found = await axe(sel);
    step(`${name}, ${theme}: no accessibility problems`, found.length === 0, found.join('\n      '));
    if (theme === 'dark') await shot(`pictures-${name.replace(/\W+/g, '-')}-dark`);
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
};

// the agent's draft, in the imitation API: its web chat takes photos and the camera, and its first agent asks for both
// as it takes over (for the simulated agent and the Build editor)
const prepare = () =>
  page.evaluate(async (id) => {
    const draft = await (await fetch(`/api/bots/${id}/draft`)).json();
    const config = draft.config;
    const web = config.channels.find((c) => c.type === 'web_chat');
    web.modalities = { ...(web.modalities || {}), input: ['text', 'image', 'video'] };
    web.inputs = { image: { accepted_mime: ['image/png', 'image/jpeg'], max_bytes: 8 * 1024 * 1024 } };
    config.state = config.state || {};
    config.state.variables = {
      ...(config.state.variables || {}),
      id_photo: { type: 'string' },
      selfie: { type: 'string' },
      full_name: { type: 'string' },
      typed_name: { type: 'string', initial: 'Jane Sample' },
      names_match: { type: 'boolean' },
    };
    const entry = config.agents.items.find((a) => a.id === config.agents.entry) || config.agents.items[0];
    entry.on_enter = [
      { type: 'say', text: 'Please upload a photo of the front of your ID card.' },
      {
        type: 'request_image',
        kind: 'upload',
        into: 'id_photo',
        prompt: 'Upload a photo of the front of your ID card',
        timeout_s: 120,
        quality: { min_sharpness: 8 },
      },
      { type: 'analyze_image', images: ['id_photo'], instructions: 'Read the name on the card.', fields: { full_name: { type: 'string' } } },
      { type: 'say', text: 'Now hold the card up to your camera.' },
      { type: 'request_image', kind: 'camera', into: 'selfie', timeout_s: 120 },
      { type: 'compare_values', pairs: [{ left: 'full_name', right: 'typed_name', label: 'name' }], into: { matched: 'names_match' } },
      { type: 'discard_image', images: ['id_photo', 'selfie'] },
      { type: 'say', text: 'All done, thank you.' },
    ];
    config.meta = { ...config.meta, schema_version: '1.2' };
    if (config.schema_version) config.schema_version = '1.2';
    const saved = await fetch(`/api/bots/${id}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, base_revision: draft.revision }),
    });
    return saved.status;
  }, BOT);

try {
  console.log(`Pictures, ${BASE}`);
  await page.goto(BASE);
  await page
    .getByRole('button', { name: /sign in|get started|start/i })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill(EMAIL);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: /continue to workspace/i }).click();
  await page.waitForSelector('.dashMain');
  const status = await prepare();
  step('the test agent asks for pictures (imitation API only)', status === 200, String(status));

  // ---- 1. the real agent, in the side panel: the runtime's messages, and what the screen sends back
  await page.evaluate((id) => (location.hash = `#/bots/${id}/agent`), BOT);
  await page.waitForSelector('.dtPart', { timeout: 15000 });
  await page.locator('.nlBar').getByRole('button', { name: /^Test/ }).click();
  const panel = '.pvPanel';
  await page.waitForSelector(panel);
  await page
    .locator(panel)
    .getByRole('button', { name: /Start a (conversation|call)|Start chatting/ })
    .first()
    .click();
  step('real: the conversation starts', await until(async () => /Hello there/.test(await textOf(panel))));

  await tell({ type: 'something_new', request_id: 'x' });
  await tell({
    type: 'request_image',
    request_id: 'r_1',
    kind: 'upload',
    prompt: 'Upload a photo of the front of your ID card',
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    max_bytes: 8 * MB,
    timeout_s: 180,
  });
  step(
    'real: a message of a type it doesn’t know is ignored, the request is shown',
    await until(async () => (await page.locator(`${panel} .pcCard`).count()) === 1),
  );
  const card = await textOf(`${panel} .pcCard`);
  step(
    'real: the card says what is wanted, in the agent’s words',
    /The agent needs a photo/.test(card) && /Upload a photo of the front of your ID card/.test(card),
    card,
  );
  step(
    'real: it says what it takes and how long the agent waits',
    /JPG/.test(card) && /PNG/.test(card) && /WebP/.test(card) && /up to 8 MB/.test(card) && /\d:\d\d/.test(card),
    card,
  );
  step('real: and only what the server guarantees about privacy', /Kept only in this call’s memory, never saved or logged/.test(card), card);
  step(
    'real: the file picker takes only what the agent accepts',
    (await page.locator(`${panel} .pcCard input[type=file]`).getAttribute('accept')) === 'image/jpeg,image/png,image/webp',
  );
  await page.waitForTimeout(500);
  await shot('pictures-1-upload-asked');
  const fit1 = await fits(panel);
  step('real: the card fits the panel at 1536×730, nothing cut off', fit1 === '', fit1);
  await bothThemes('the photo request card', `${panel} .pcCard`);

  // too big: stopped before it is sent
  await page.locator(`${panel} .pcCard input[type=file]`).setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(9 * MB, 1) });
  step(
    'real: a photo over the limit is stopped before sending, and says why',
    await until(async () => /Not sent: that photo is 9 MB, and this agent takes up to 8 MB/.test(await textOf(`${panel} .pcCard`))),
  );
  step('real: nothing was sent', (await sent('file')).length === 0);

  const first = await fileOf('id-front.png', false);
  await page.locator(`${panel} .pcCard input[type=file]`).setInputFiles(first);
  step(
    'real: a good photo goes on agent-builder.image, as the file itself',
    await until(async () => (await sent('file')).some((f) => f.topic === 'agent-builder.image' && f.name === 'id-front.png')),
  );
  step('real: the card says it is being checked', await until(async () => /The agent is checking it/.test(await textOf(`${panel} .pcCard`))));
  await tell({
    type: 'image_rejected',
    request_id: 'r_1',
    code: 'too_blurry',
    message: 'That photo is blurry. Please hold the card still, in good light, and take it again.',
  });
  step(
    'real: a refusal shows the agent’s own sentence, and the request stays open',
    await until(
      async () =>
        /That photo is blurry\. Please hold the card still/.test(await textOf(`${panel} .pcCard`)) &&
        /Choose another photo/.test(await textOf(`${panel} .pcCard`)),
    ),
  );
  await page.waitForTimeout(400);
  await shot('pictures-2-turned-down');
  await page.locator(`${panel} .pcCard input[type=file]`).setInputFiles(first);
  step(
    'real: the same file is never sent twice',
    (await until(async () => /already sent this photo/.test(await textOf(`${panel} .pcCard`)))) && (await sent('file')).length === 1,
  );
  // a picture taken with the camera, in the large view, is sent as the photo
  await page.locator(`${panel} .pcCard`).getByRole('button', { name: 'Take a picture' }).click();
  step(
    'real: Take a picture opens the large view with a private preview and a shutter',
    await until(
      async () =>
        (await page.locator('.pcStage video').count()) === 1 && (await page.locator('.pcStage').getByRole('button', { name: 'Take picture' }).isEnabled()),
    ),
  );
  step('real: nothing is shared while the preview is open', (await sent('camera')).length === 0 && (await sent('file')).length === 1);
  const fit0 = await fits('.pcStageScrim', '.pcStage');
  step('real: the take-a-picture view fits the window, nothing cut off', fit0 === '', fit0);
  await bothThemes('the take-a-picture view', '.pcStage');
  await page.locator('.pcStage').getByRole('button', { name: 'Take picture' }).click();
  step(
    'real: the picture taken is sent as the photo, and the view closes',
    (await until(async () => (await sent('file')).length === 2)) && (await until(async () => (await page.locator('.pcStage').count()) === 0)),
  );
  await tell({ type: 'request_done', request_id: 'r_1', kind: 'upload', status: 'received' });
  step(
    'real: done, the card folds into one line',
    await until(async () => (await page.locator(`${panel} .pcCard`).count()) === 0 && /Photo received/.test(await textOf(`${panel} .pvPictureLine`))),
  );

  // the camera
  await tell({
    type: 'request_image',
    request_id: 'r_2',
    kind: 'camera',
    prompt: 'Hold the front of your ID card up to the camera',
    accept: [],
    max_bytes: 0,
    timeout_s: 120,
  });
  step(
    'real: the camera is asked for with a button to press (browsers want a click)',
    await until(async () => (await page.locator(`${panel} .pcCard`).getByRole('button', { name: 'Turn on camera' }).count()) === 1),
  );
  step('real: the camera is not switched on by itself', (await sent('camera')).length === 0);
  step('real: a photo can’t be attached while the camera is wanted', await page.locator(`${panel} [aria-label="Attach a picture"]`).isDisabled());
  await page.locator(`${panel} .pcCard`).getByRole('button', { name: 'Turn on camera' }).click();
  step(
    'real: first a private preview with a countdown; the camera is not shared yet',
    (await until(async () => /Get ready/.test(await textOf('.pcStage')) && (await page.locator('.pcStage .pcReady b').count()) === 1)) &&
      (await sent('camera')).length === 0,
  );
  await page.locator('.pcStage').getByRole('button', { name: 'Share now' }).click();
  step('real: Share now (or the end of the countdown) publishes the camera', await until(async () => (await sent('camera')).some((c) => c.on)));
  step(
    'real: a live view is shown, with no outlines over it',
    (await until(async () => (await page.locator('.pcStage .pcView video').count()) === 1 && /Camera on/.test(await textOf('.pcStage .pcView')))) &&
      (await page.locator('.pcStage .pcGuide').count()) === 0,
  );
  await tell({ type: 'image_rejected', request_id: 'r_2', code: 'too_blurry', message: 'That frame is blurry. Hold it still.' });
  step(
    'real: a refused frame is said over the camera view, and the camera stays on',
    (await until(async () => /That frame is blurry/.test(await textOf('.pcStage .pcView')))) && (await sent('camera')).filter((c) => !c.on).length === 0,
  );
  await page.waitForTimeout(500);
  await shot('pictures-3-camera');
  const fit2 = await fits(panel);
  step('real: the camera card fits too', fit2 === '', fit2);
  const fit3 = await fits('.pcStageScrim', '.pcStage');
  step('real: the large camera view fits the window, nothing cut off', fit3 === '', fit3);
  await bothThemes('the camera card', `${panel} .pcCard`);
  await bothThemes('the large camera view', '.pcStage');
  await tell({ type: 'request_done', request_id: 'r_2', kind: 'camera', status: 'received' });
  step(
    'real: done, the camera is switched off and the line says so',
    await until(async () => (await sent('camera')).some((c) => !c.on) && /Picture taken from your camera/.test(await textOf(`${panel} .pvLog`))),
  );

  // nothing came in time; a refused camera permission
  await tell({ type: 'request_image', request_id: 'r_3', kind: 'upload', prompt: null, accept: ['image/png'], max_bytes: MB, timeout_s: 30 });
  await until(async () => (await page.locator(`${panel} .pcCard`).count()) === 1);
  await tell({ type: 'request_done', request_id: 'r_3', kind: 'upload', status: 'timeout' });
  step('real: when the agent stops waiting, the line says so', await until(async () => /The agent stopped waiting/.test(await textOf(`${panel} .pvLog`))));
  await page.evaluate(() => (window.__fake.cameraDenied = true));
  await tell({ type: 'request_image', request_id: 'r_4', kind: 'camera', prompt: null, timeout_s: 60 });
  await page.locator(`${panel} .pcCard`).getByRole('button', { name: 'Turn on camera' }).click();
  await shareNow();
  step(
    'real: a camera the browser may not use says how to allow it',
    await until(async () => /not allowed to use the camera/.test(await textOf(`${panel} .pcCard`))),
  );
  await page.evaluate(() => (window.__fake.cameraDenied = false));
  await page.locator(panel).getByRole('button', { name: 'End', exact: true }).click();

  // ---- 2. the simulated agent: its own picture steps, measured in the browser
  await page.locator(panel).getByRole('radio', { name: 'Simulated' }).click();
  await page
    .locator(panel)
    .getByRole('button', { name: /Start a simulated/ })
    .first()
    .click();
  step(
    'simulated: the agent’s first steps ask for a photo',
    await until(async () => (await page.locator(`${panel} .pcCard`).count()) === 1 && /Please upload a photo/.test(await textOf(panel)), 15000),
  );
  step('simulated: the card says nothing leaves the browser', /nothing is sent anywhere/.test(await textOf(`${panel} .pcCard`)));
  await page.locator(`${panel} .pcCard input[type=file]`).setInputFiles(await fileOf('flat.png', false));
  step(
    'simulated: a blurred photo is measured and turned down by the step’s standard',
    await until(async () => /blurry/.test(await textOf(`${panel} .pcCard`)), 8000),
  );
  await page.locator(`${panel} .pcCard input[type=file]`).setInputFiles(await fileOf('sharp.png', true));
  step(
    'simulated: a sharp one is received and the steps carry on: reading is said to be impossible here, then the camera',
    await until(
      async () =>
        /Photo received/.test(await textOf(`${panel} .pvLog`)) &&
        /can’t read pictures/.test(await textOf(`${panel} .pvLog`)) &&
        /Turn on camera/.test(await textOf(`${panel} .pcCard`)),
      10000,
    ),
  );
  await page.locator(`${panel} .pcCard`).getByRole('button', { name: 'Turn on camera' }).click();
  await shareNow();
  step(
    'simulated: the stand-in camera’s frames are taken and the flow ends',
    await until(
      async () => /Picture taken from your camera/.test(await textOf(`${panel} .pvLog`)) && /All done, thank you/.test(await textOf(`${panel} .pvLog`)),
      15000,
    ),
  );
  await shot('pictures-4-simulated');
  await page.locator(panel).getByRole('button', { name: 'End', exact: true }).click();

  // ---- 2b. the Test page: the same card in its wider conversation, whole (never squeezed by the list), and the
  // call record's Pictures filter with the measurements
  await page.evaluate((id) => (location.hash = `#/bots/${id}/test`), BOT);
  await page.waitForSelector('.stTMessages', { timeout: 15000 });
  const simulatedChoice = page.getByRole('radio', { name: 'Simulated' }).first();
  if (await simulatedChoice.count()) await simulatedChoice.click();
  await page
    .getByRole('button', { name: /^Start/ })
    .first()
    .click();
  step('Test page: the card is shown in the conversation', await until(async () => (await page.locator('.stTMessages .pcCard').count()) === 1, 15000));
  const whole = await page.evaluate(() => {
    const card = document.querySelector('.stTMessages .pcCard');
    return card ? card.scrollHeight - card.clientHeight : -1;
  });
  step('Test page: the card is whole, nothing of it cut off', whole === 0, `hidden ${whole}px`);
  await page.locator('.stTMessages .pcCard input[type=file]').setInputFiles(await fileOf('test-page.png', true));
  step('Test page: a photo is received', await until(async () => /Photo received/.test(await textOf('.stTMessages')), 10000));
  await page.locator('.stTMessages .pcCard').getByRole('button', { name: 'Turn on camera' }).click();
  await shareNow();
  step(
    'Test page: the camera button can be pressed, and the picture is taken',
    await until(async () => /Picture taken from your camera/.test(await textOf('.stTMessages')), 15000),
  );
  const chip = page.locator('.trChip', { hasText: 'Pictures' });
  step('Test page: the record has a Pictures filter', await until(async () => (await chip.count()) === 1));
  step('Test page: pictures are measured in the record', (await page.locator('.trMeter').count()) >= 4);
  await page
    .getByRole('button', { name: /End conversation|^End$/ })
    .first()
    .click()
    .catch(() => {});

  // ---- 3. Build: the steps it runs as it takes over, with the Pictures group and "Only when…"
  await page.evaluate((id) => (location.hash = `#/bots/${id}/subagents`), BOT);
  await page.waitForSelector('.dtPart', { timeout: 15000 });
  // Subagents opens on "Who answers"; the cards with "On taking over, it first…" are under All settings, where every
  // Advanced fold starts open
  await page.locator('.apSeg').getByRole('button', { name: 'All settings', exact: true }).click();
  const fold = page.locator('details.dtAdv').filter({ hasText: 'On taking over' }).first();
  await fold.waitFor({ timeout: 15000 });
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click();
  // a short list opens with Edit; a longer one shows its steps as cards, with Edit all the steps under them
  await fold.getByRole('button', { name: /^(Edit|Edit all the steps|Set it) On taking over/ }).click();
  const ask = page.locator('.psAsk').first();
  step('Build: “Ask for a picture” has its own editor', await until(async () => (await page.locator('.psAsk').count()) > 0, 15000));
  await ask.scrollIntoViewIfNeeded();
  // how picky, in three words, with the exact numbers folded under them, and what the customer sees
  step(
    'Build: Relaxed, Standard or Strict, one of them chosen or none for numbers of its own',
    (await ask.locator('.psStrict').getByRole('radio').count()) === 3,
  );
  step('Build: a preview of what the customer sees', (await ask.locator('.psPreview').count()) === 1);
  await ask.locator('details.psExact > summary').click();
  const tiles = ask.locator('.psTiles').getByRole('radio');
  step(
    'Build: Upload a photo / Show the camera, as two tiles',
    (await tiles.count()) === 2 && (await ask.getByRole('radio', { name: /Upload a photo/ }).getAttribute('aria-checked')) === 'true',
  );
  step(
    'Build: the sharpness scale says what its numbers mean',
    /blurred upload/.test(await textOf('.psAsk')) && /blurred camera frame/.test(await textOf('.psAsk')) && /crisp card/.test(await textOf('.psAsk')),
  );
  const overlap = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('.psAsk .psMark')].map((m) => m.getBoundingClientRect());
    return marks.some((a, i) => marks.slice(i + 1).some((b) => a.right > b.left && b.right > a.left));
  });
  step('Build: the scale’s numbers never overlap', !overlap);
  await ask.getByRole('radio', { name: /Show the camera/ }).click();
  step(
    'Build: on the camera, an upload’s 8 is called too low (video lifts blur to about 10)',
    await until(async () => /Too low for the camera/.test(await textOf('.psAsk'))),
  );
  await ask.getByRole('button', { name: 'Use 25' }).click();
  step('Build: “Use 25” sets it', await until(async () => (await ask.locator('.psScaleNum').inputValue()) === '25'));
  await page.waitForTimeout(300);
  await shot('pictures-5-build');
  step('Build: “Read a picture” carries the honest note', /A demo-grade check, not identity verification/.test(await textOf('.psStep')));
  step('Build: every step can run “Only when…”', (await page.getByRole('button', { name: 'Only when…' }).count()) >= 8);
  const addStep = page.getByRole('combobox', { name: /Add a step to/ }).first();
  await addStep.click();
  const menu = await textOf('[role=listbox]');
  step(
    'Build: the Add a step menu has a Pictures group with the four steps',
    /Pictures/.test(menu) && /Ask for a picture/.test(menu) && /Read a picture/.test(menu) && /Compare values/.test(menu) && /Forget pictures/.test(menu),
    menu.slice(0, 300),
  );
  await page.keyboard.press('Escape');
  await bothThemes('the Ask for a picture editor', '.psAsk');

  // ---- 4. Tests › Scenarios: sample pictures, picture turns, the three checks; and it can be saved
  await page.evaluate((id) => (location.hash = `#/bots/${id}/scenarios`), BOT);
  await page.waitForTimeout(800);
  const newButton = page.getByRole('button', { name: /New scenario|Add a scenario|Write a scenario/ }).first();
  if (await newButton.count()) {
    await newButton.click();
    const form = page.locator('form.scForm');
    await form.waitFor({ timeout: 10000 });
    await form.getByRole('button', { name: /Add a sample card/ }).click();
    await form.getByRole('button', { name: /^Blur$/ }).click();
    step(
      'Scenarios: a sample card with blur switched on',
      /Sample pictures/.test(await textOf('form.scForm')) && (await form.getByRole('button', { name: /^Blur$/ }).getAttribute('aria-pressed')) === 'true',
    );
    await form.getByRole('button', { name: /Add a turn/ }).click();
    await pick(form, 'Turn 2: kind', 'Uploads a picture');
    step('Scenarios: a turn uploads the sample picture', /clear/.test(await textOf('form.scForm [aria-label="Turn 2: the sample picture uploaded"]')));
    await form.getByLabel('Turn 1: what the caller says').fill('I’d like to open an account.');
    await pick(form, 'Expectation 1: what to check', 'The screen was told');
    await pick(form, 'Expectation 1: message', 'Turned a picture down');
    await form.getByRole('button', { name: /Add an expectation/ }).click();
    await pick(form, 'Expectation 2: what to check', 'Pictures still held at the end');
    await form.getByRole('button', { name: /Add an expectation/ }).click();
    await pick(form, 'Expectation 3: what to check', 'The agent never said anything matching');
    await form.getByLabel('Expectation 3: pattern it must never match').fill('S1234567D');
    await page.waitForTimeout(300);
    await shot('pictures-6-scenario');
    await form.locator('.spItem').first().scrollIntoViewIfNeeded();
    await shot('pictures-6-sample-card');
    await bothThemes('the scenario’s sample pictures', 'form.scForm');
    await form.getByRole('button', { name: /Add the scenario/ }).click();
    step(
      'Scenarios: a scenario with picture turns and checks is saved (it couldn’t be before)',
      await until(async () => (await page.locator('form.scForm').count()) === 0),
    );
  } else step('Scenarios: the new scenario button is found', false, await textOf('main'));

  step('no console errors', problems.length === 0, problems.slice(0, 5).join('\n      '));
} catch (error) {
  step('ran to the end', false, error.stack || String(error));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exitCode = failures ? 1 : 0;
