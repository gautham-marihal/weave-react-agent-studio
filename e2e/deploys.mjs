// Putting a version live when the server is slow or says no, in a real browser (the API guide, README 5: "write the UI as if it can be slow").
// The API is the imitation one (e2e/mockApi.mjs) behind request interception, with some answers changed here:
//   - a deploy answers "pending", and GET /bots/{id}/deployments/{id} answers what each case needs (still pending, failed with a reason,
//     unknown, then active);
//   - POST /validate fails for a while, as when the server is down.
// Checked: the publish panel's "Put it live in Development", the Deploy page, the guided setup's last step, and a draft whose check can't run.
//
// Run it with the dev server up WITHOUT demo mode, signing in from e2e/credentials.txt:
//   CREDENTIALS_FILE=e2e/credentials.txt npx vite --port 5181 --strictPort
//   E2E_BASE=http://localhost:5181 node e2e/deploys.mjs
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder.
import { chromium } from 'playwright-core';
import { createMockApi } from './mockApi.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS || '';
const EMAIL = process.env.E2E_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'any-password';
const BOT = 'acme-support';

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

// ---- the server's answers, as each case needs them
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const plan = {
  deploys: [], // what each deploy answers, in order: 'pending' or 'active'
  checks: [], // what each GET of a pending deployment answers, in order: 'pending', 'active', 'failed', 'gone'
  validateDown: false,
  // a protection set up but not enforced, added to every check's answer (the server lists none today)
  security: false,
};
const pendingIds = new Set();
const mock = createMockApi();

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1536, height: 730 } });
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

await page.route(
  (url) => url.pathname.startsWith('/api/'),
  async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (path === '/validate' && req.method() === 'POST' && plan.validateDown) return route.fulfill({ status: 503, body: '' });
    if (path === '/validate' && req.method() === 'POST' && plan.security) {
      const answer = await mock.handle({ request: () => req, fulfill: async (r) => r });
      const body = JSON.parse(answer.body);
      body.unsupported = [
        ...(body.unsupported || []),
        { feature: 'transcript redaction (not applied yet)', where: 'post_call.redaction', severity: 'security' },
      ];
      return route.fulfill(json(body, answer.status));
    }
    const deployOf = /^\/bots\/([^/]+)\/deploy$/.exec(path);
    if (deployOf && req.method() === 'POST' && plan.deploys.length) {
      const how = plan.deploys.shift();
      const answer = await mock.handle({ request: () => req, fulfill: async (r) => r }).catch(() => null);
      // the imitation API has put it live; the answer is made "pending" when the case asks
      const body = JSON.parse(answer.body);
      if (how === 'pending') {
        body.deployment.status = 'pending';
        pendingIds.add(body.deployment.id);
      }
      return route.fulfill(json(body, how === 'pending' ? 202 : answer.status));
    }
    const one = /^\/bots\/([^/]+)\/deployments\/([^/]+)$/.exec(path);
    if (one && req.method() === 'GET' && pendingIds.has(one[2])) {
      const how = plan.checks.shift() || 'active';
      if (how === 'gone') return route.fulfill(json({ detail: 'No such deployment.' }, 404));
      const base = {
        id: one[2],
        environment: 'development',
        version: '0.0.0',
        previous_version: null,
        deployed_at: new Date().toISOString(),
        deployed_by: 'e2e',
        note: null,
      };
      if (how === 'failed') return route.fulfill(json({ ...base, status: 'failed', error: 'The phone dispatch rule could not be made.' }));
      return route.fulfill(json({ ...base, status: how }));
    }
    return mock.handle(route);
  },
);

const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const textOf = async (selector) =>
  (
    await page
      .locator(selector)
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
const until = async (check, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
const go = async (hash, ready) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForSelector(ready, { timeout: 15000 });
};

try {
  console.log(`Deploys when the server is slow or says no, ${BASE}`);
  await page.goto(BASE);
  await page
    .getByRole('button', { name: /sign in|get started|start/i })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill(EMAIL);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: /continue to workspace/i }).click();
  await page.waitForSelector('.dashMain');

  // ---- 1. publish, then "Put it live in Development": pending, then failed with the server's reason; Try again: live
  await go(`#/bots/${BOT}/versions?publish=1`, '.stPublishPanel');
  const panel = page.locator('.stPublishPanel');
  await panel.locator('.modalCreate').first().click(); // Publish
  await panel.getByRole('button', { name: 'Put it live in Development' }).waitFor({ timeout: 15000 });
  plan.deploys.push('pending', 'active');
  plan.checks.push('pending', 'failed');
  await panel.getByRole('button', { name: 'Put it live in Development' }).click();
  step(
    'publish panel: a pending deploy says it is being put live, not that it is live',
    await until(async () => /is being put live in Development/.test(await textOf('.stPublishPanel'))),
    await textOf('.stPublishPanel'),
  );
  await shot('deploys-1-pending');
  step(
    'publish panel: the keyboard stays on the panel’s buttons when they change, not dropped to the page',
    await page.evaluate(() => !!document.activeElement?.closest('.stPublishFooter')),
    await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)),
  );
  step(
    'publish panel: when it fails, it says so with the server’s reason, and offers to try again',
    await until(async () => {
      const t = await textOf('.stPublishPanel');
      return /couldn’t be put live/.test(t) && /dispatch rule could not be made/.test(t) && !/is live in Development/.test(t);
    }),
    await textOf('.stPublishPanel'),
  );
  await shot('deploys-1-failed');
  await panel.getByRole('button', { name: 'Try again' }).click();
  step(
    'publish panel: trying again, an active deploy is live',
    await until(async () => /is live in Development/.test(await textOf('.stPublishPanel'))),
    await textOf('.stPublishPanel'),
  );

  // ---- 2. the Deploy page: pending, then the deployment can't be found: it stops asking and says so; Check again: active
  await go(`#/bots/${BOT}/deploy`, '.stDeployForm');
  plan.deploys.push('pending');
  plan.checks.push('gone', 'active');
  await page.getByRole('button', { name: /^Deploy to / }).click();
  step(
    'Deploy page: a deployment the server no longer knows stops the checks and says so, instead of spinning for ever',
    await until(async () => /Couldn’t check how this deployment is going/.test(await textOf('.stDeploy'))),
    await textOf('.stDeploy'),
  );
  await shot('deploys-2-unknown');
  await page.getByRole('button', { name: 'Check again' }).click();
  step(
    'Deploy page: Check again follows it to active',
    await until(async () => /Latest deployment\s*Active/.test(await textOf('.stDeploy'))),
    await textOf('.stDeploy'),
  );

  // ---- 3. the guided setup's last step: pending, then live
  await go(`#/bots/${BOT}/setup?step=live`, '.suGoLive');
  plan.deploys.push('pending');
  plan.checks.push('pending', 'active');
  await page.locator('.suGoLive').click();
  step(
    'setup: a pending deploy reads “being put live”, not “is live”',
    await until(async () => /is being put live for testing/.test(await textOf('.suDone'))),
    await textOf('.suPage'),
  );
  await shot('deploys-3-pending');
  step('setup: then it is live', await until(async () => /is live for testing/.test(await textOf('.suDone'))), await textOf('.suPage'));

  // ---- 3b. the setup again ("Put my latest changes live"): the deploy fails; trying again puts the SAME version live, without publishing another
  await page.getByRole('button', { name: 'Put my latest changes live' }).click();
  await page.waitForSelector('.suGoLive');
  plan.deploys.push('pending', 'active');
  plan.checks.push('failed');
  const publishes = () => mock.log.filter((line) => /^POST \/bots\/[^/]+\/publish$/.test(line)).length;
  const before = publishes();
  await page.locator('.suGoLive').click();
  step(
    'setup: a failed deploy says so with the reason, and the form is back',
    await until(async () => /couldn’t be put live/.test(await textOf('.suPage')) && /dispatch rule could not be made/.test(await textOf('.suPage'))),
    await textOf('.suPage'),
  );
  await page.locator('.suGoLive').click();
  step('setup: trying again, it is live', await until(async () => /is live for testing/.test(await textOf('.suDone'))), await textOf('.suPage'));
  step('setup: the retry put the same version live, without publishing another', publishes() - before === 1, `${publishes() - before} publishes`);

  // ---- 4. a draft whose check can't run: no old report stays in charge; it says so and offers to check again
  plan.validateDown = true;
  await go(`#/bots/${BOT}/agent`, '.dtPart');
  await page.reload(); // a fresh load: the draft is read and checked again
  await page.waitForSelector('.dtPart', { timeout: 15000 });
  step(
    'a check that can’t run is said on the page, with Check again',
    await until(async () => (await page.getByText('The draft couldn’t be checked').count()) > 0),
    await textOf('.nlBody'),
  );
  await shot('deploys-4-unchecked');
  step(
    'the checks chip says it is not checked, rather than “Checking…” for ever',
    (await textOf('[data-checks]')) === 'Not checked',
    await textOf('[data-checks]'),
  );
  await go(`#/bots/${BOT}/versions?publish=1`, '.stPublishPanel');
  const held = await textOf('.stPublishPanel');
  step(
    'publish panel: an unchecked draft can’t be published, and says why',
    /couldn’t be checked/.test(held) && (await panel.locator('.modalCreate').first().isDisabled()),
    held,
  );
  plan.validateDown = false;
  await panel.getByRole('button', { name: 'Check again' }).click();
  step(
    'once the server answers again, Check again lifts it',
    await until(
      async () => !(await panel.locator('.modalCreate').first().isDisabled()) && (await page.getByText('The draft couldn’t be checked').count()) === 0,
    ),
    await textOf('.stPublishPanel'),
  );

  // ---- 5. the setup's go-live for customers with a protection that isn't enforced: the Deploy page's word is asked for (the guide, section 5)
  plan.security = true;
  await go(`#/bots/${BOT}/agent`, '.dtPart');
  await page.reload(); // checked again, now with the security item
  await page.waitForSelector('.dtPart', { timeout: 15000 });
  await go(`#/bots/${BOT}/setup?step=live`, '.suPage');
  if ((await page.getByRole('button', { name: 'Put my latest changes live' }).count()) > 0)
    await page.getByRole('button', { name: 'Put my latest changes live' }).click();
  await page.locator('.suWhere').getByText('Live for customers').click();
  plan.deploys.push('active');
  await page.locator('.suGoLive').click();
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor({ timeout: 10000 });
  const dialogText = (await dialog.innerText()).replace(/\s+/g, ' ');
  step(
    'setup, for customers: the unenforced protection is named in red, with the word to type',
    /1 protection is declared but not enforced/.test(dialogText) &&
      /post_call\.redaction/.test(dialogText) &&
      /Type production to put it live for customers anyway/.test(dialogText),
    dialogText,
  );
  const confirm = dialog.getByRole('button', { name: 'Put it live for customers anyway' });
  step(
    'setup, for customers: the button waits for the word, and the box to type it in has the keyboard',
    (await confirm.isDisabled()) && (await page.evaluate(() => document.activeElement?.id === 'decisionWord')),
  );
  await shot('deploys-5-word');
  await page.keyboard.type('production');
  step('setup, for customers: typing the word turns the button on', !(await confirm.isDisabled()));
  await confirm.click();
  step('setup, for customers: then it is put live', await until(async () => /is live for customers/.test(await textOf('.suDone'))), await textOf('.suPage'));
  plan.security = false;

  step('no console errors', problems.length === 0, problems.slice(0, 5).join('\n      '));
} catch (error) {
  step('ran to the end', false, error.stack || String(error));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exitCode = failures ? 1 : 0;
