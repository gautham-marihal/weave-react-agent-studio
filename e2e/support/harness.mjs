// What every browser test shares: start the stand-in API and Studio's dev server (or use E2E_BASE), open a signed-in
// browser, run named steps, and stop everything it started. A suite exits non-zero when a step fails.
//   E2E_BASE=http://localhost:5400 node e2e/<suite>.mjs     use a Studio already running against the stand-in
//   E2E_API_PORT / E2E_WEB_PORT                              ports to start them on (default 8400 / 5400)
//   E2E_HEADED=1                                             watch the browser
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Starts a process and resolves once its output matches `ready`. */
function startProcess(args, env, ready, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => reject(new Error(`${label} did not start:\n${output}`)), 60_000);
    const read = (chunk) => {
      output += chunk;
      if (/already in use/i.test(output)) {
        clearTimeout(timer);
        reject(new Error(`${label}: port already in use`));
      } else if (ready.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited (${code}):\n${output}`));
    });
  });
}

/** Stops a process and everything it started (vite leaves esbuild running otherwise). */
function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {
    // already gone
  }
}

/** The Studio under test: E2E_BASE if given, else a fresh stand-in API plus dev server. */
export async function startStudio() {
  if (process.env.E2E_BASE) return { base: process.env.E2E_BASE.replace(/\/$/, ''), stop: async () => {} };
  const apiPort = Number(process.env.E2E_API_PORT || 8400);
  const webPort = Number(process.env.E2E_WEB_PORT || 5400);
  const apiServer = await startProcess([path.join('e2e', 'support', 'standInServer.mjs'), String(apiPort)], {}, /stand-in Agent Builder API on/, 'stand-in API');
  let web;
  try {
    web = await startProcess(
      [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(webPort), '--strictPort'],
      { AGENT_BUILDER_URL: `http://127.0.0.1:${apiPort}`, AGENT_BUILDER_API_KEY: '', BANKING_GATEWAY_URL: '', BANKING_GATEWAY_TOKEN: '' },
      /ready in/,
      'Studio dev server',
    );
  } catch (error) {
    stopProcess(apiServer);
    throw error;
  }
  return {
    base: `http://localhost:${webPort}`,
    stop: async () => {
      stopProcess(web);
      stopProcess(apiServer);
    },
  };
}

/** A browser signed in with the temporary sign-in (admin), in the given theme. Collects page and console errors. */
export async function openBrowser({ theme = 'light', viewport = { width: 1440, height: 900 }, user } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.E2E_HEADED });
  const context = await browser.newContext({ viewport });
  const who = user ?? { id: 'e2e', name: 'Test Person', email: 'test.person@example.com', initials: 'TP', role: 'admin' };
  await context.addInitScript(
    ({ t, u }) => {
      if (u) sessionStorage.setItem('weave_auth_user', JSON.stringify(u));
      localStorage.setItem('weave_theme', t);
    },
    { t: theme, u: who },
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    // A failed request is reported by the page itself when it matters; 404s for optional files are not errors here.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(`console: ${message.text()}`);
  });
  return { browser, context, page, errors };
}

/**
 * A named list of steps. `step(title, fn)` runs one and records pass/fail; `finish()` prints the summary, checks for
 * page errors, stops what was started, and sets the exit code.
 */
export async function suite(name, { theme, viewport, user } = {}) {
  const studio = await startStudio();
  const { browser, context, page, errors } = await openBrowser({ theme, viewport, user });
  const results = [];
  console.log(`\n${name} — ${studio.base}`);
  async function step(title, fn) {
    const started = Date.now();
    try {
      await fn({ page, context, base: studio.base });
      results.push({ title, ok: true });
      console.log(`  ✓ ${title} (${Date.now() - started} ms)`);
    } catch (error) {
      results.push({ title, ok: false, error });
      console.log(`  ✗ ${title}\n      ${String(error?.message || error).split('\n').slice(0, 6).join('\n      ')}`);
      if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `${name}-${results.length}-failed.png`) }).catch(() => {});
    }
  }
  async function finish() {
    const failed = results.filter((r) => !r.ok);
    if (errors.length) {
      failed.push({ title: 'no page or console errors' });
      console.log(`  ✗ no page or console errors\n      ${[...new Set(errors)].slice(0, 8).join('\n      ')}`);
    }
    console.log(`${name}: ${results.length - failed.length + (errors.length ? 1 : 0)}/${results.length + (errors.length ? 1 : 0)} passed`);
    await browser.close();
    await studio.stop();
    process.exitCode = failed.length ? 1 : 0;
  }
  return { page, context, base: studio.base, step, finish, errors };
}

/** Throws with `message` unless `condition` holds. */
export function check(condition, message) {
  if (!condition) throw new Error(message);
}
