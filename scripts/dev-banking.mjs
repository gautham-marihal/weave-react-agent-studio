#!/usr/bin/env node
// Single-command orchestrator for local Weave Studio + Banking Gateway development.
// Usage: npm run dev
//
// Which bank the gateway runs on: CIMB (services/banking-gateway/src/main.ts, the bank's real systems; Live mode uses
// it, Studio's own Live test sessions included) when CIMB_BASE_URL is set in .env or the environment, otherwise the
// mock bank (mock/main.ts). Sandbox always uses the mock bank, in the browser.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const gatewayDir = resolve(rootDir, 'services/banking-gateway');
const envPath = resolve(rootDir, '.env');
const tokenPath = resolve(rootDir, 'node_modules/.cache/weave-dev/gateway-token');

const GATEWAY_PORT = 8790;
const STUDIO_PORT = 5173;
const GATEWAY_HOST = 'localhost';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

function log(label, message, color = ANSI.cyan) {
  const prefix = `${color}${ANSI.bold}[${label}]${ANSI.reset} `;
  const lines = String(message).split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (line.includes('[MOCK SMS]')) {
      console.log(`${prefix}${ANSI.bold}${ANSI.yellow}>>> ${line} <<<${ANSI.reset}`);
    } else {
      console.log(`${prefix}${line}`);
    }
  }
}

/** Check if a port is in use on localhost (IPv4 or IPv6). */
function isPortInUse(port) {
  return new Promise((resolveCheck) => {
    const socket = new Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolveCheck(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      tryListen(port, resolveCheck);
    });
    socket.once('error', () => {
      tryListen(port, resolveCheck);
    });
    socket.connect(port, 'localhost');
  });
}

function tryListen(port, resolveCheck) {
  const server = createServer();
  server.once('error', (err) => {
    resolveCheck(err.code === 'EADDRINUSE');
  });
  server.once('listening', () => {
    server.close(() => resolveCheck(false));
  });
  server.listen(port);
}

/** Check health and token match on the mock gateway. */
async function checkGatewayStatus(url, token) {
  try {
    const healthRes = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    if (!healthRes.ok) return { reachable: true, healthy: false, tokenMatch: false };
    const health = await healthRes.json();
    if (!health || health.ok !== true) return { reachable: true, healthy: false, tokenMatch: false };
    const hosts = health.hosts === 'live' ? 'live' : 'mock';

    // Verify token with /v1/tools
    const toolsRes = await fetch(`${url}/v1/tools`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    return { reachable: true, healthy: true, tokenMatch: toolsRes.ok, hosts };
  } catch {
    return { reachable: false, healthy: false, tokenMatch: false };
  }
}

/**
 * The local mock gateway's token, kept the same across runs so a gateway that is still running can be reused. It lives
 * in node_modules/.cache (ignored by git), never in .env: npm run dev hands the gateway's address and token to Studio
 * through the environment of the Studio process, so .env needs only AGENT_BUILDER_URL (and its API key).
 */
function devGatewayToken() {
  try {
    const saved = readFileSync(tokenPath, 'utf8').trim();
    if (/^[A-Za-z0-9_-]{32,}$/.test(saved)) return saved;
  } catch {
    // none saved yet
  }
  // one that an older npm run dev wrote into .env, so a gateway it started still matches
  const legacy = existsSync(envPath) ? /^\s*BANKING_GATEWAY_TOKEN\s*=\s*["']?([A-Za-z0-9_-]{32,})/m.exec(readFileSync(envPath, 'utf8'))?.[1] : undefined;
  const token = legacy ?? randomBytes(24).toString('base64url');
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, token, 'utf8');
  return token;
}

/** A KEY=value from the environment, else from .env (no quotes, no expansion). */
function setting(key) {
  if (process.env[key]?.trim()) return process.env[key].trim();
  if (!existsSync(envPath)) return '';
  const match = new RegExp(String.raw`^\s*${key}\s*=\s*["']?([^"'\r\n#]*)`, 'm').exec(readFileSync(envPath, 'utf8'));
  return match?.[1]?.trim() ?? '';
}

/** CIMB settings when the gateway should run on CIMB's systems; null for the mock bank. */
function cimbSettings() {
  const baseUrl = setting('CIMB_BASE_URL');
  return baseUrl ? { CIMB_BASE_URL: baseUrl, CIMB_REGION: setting('CIMB_REGION') || 'DB2' } : null;
}

const childProcesses = new Set();

function killProcess(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    // Ignore shutdown errors
  }
}

function cleanup() {
  for (const proc of childProcesses) {
    killProcess(proc);
  }
  childProcesses.clear();
}

process.on('SIGINT', () => {
  console.log(`\n${ANSI.yellow}Shutting down local banking development servers...${ANSI.reset}`);
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

process.on('exit', () => {
  cleanup();
});

async function main() {
  console.log(`\n${ANSI.bold}${ANSI.cyan}==================================================================${ANSI.reset}`);
  console.log(`${ANSI.bold}  Weave Studio + Banking AI Agent - One-Command Local Startup${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}==================================================================${ANSI.reset}\n`);

  const token = devGatewayToken();
  const cimb = cimbSettings();
  const wantHosts = cimb ? 'live' : 'mock';
  const bankName = cimb ? `CIMB Banking Gateway (${cimb.CIMB_BASE_URL}, region ${cimb.CIMB_REGION})` : 'mock Banking Gateway';
  log('setup', cimb ? `CIMB_BASE_URL is set: the gateway runs on CIMB's systems (Live mode). Sandbox keeps the mock bank.` : 'No CIMB_BASE_URL: the gateway runs on the mock bank.', ANSI.green);
  log('setup', 'Banking gateway settings go to Studio directly; .env needs only AGENT_BUILDER_URL (and its API key).', ANSI.green);

  // Check port 8790
  const gatewayPortTaken = await isPortInUse(GATEWAY_PORT);
  let gatewayRunning = false;
  if (gatewayPortTaken) {
    const status = await checkGatewayStatus(`http://${GATEWAY_HOST}:${GATEWAY_PORT}`, token);
    if (status.healthy && status.tokenMatch && status.hosts !== wantHosts) {
      console.error(`${ANSI.red}${ANSI.bold}Wrong bank:${ANSI.reset} the Banking Gateway on port ${GATEWAY_PORT} runs on ${status.hosts === 'live' ? 'a real bank' : 'the mock bank'}, but this run wants ${cimb ? 'CIMB' : 'the mock bank'}.`);
      console.error('Please stop the process on port ' + GATEWAY_PORT + ' and run npm run dev again.');
      process.exit(1);
    } else if (status.healthy && status.tokenMatch) {
      log('gateway', `Existing ${bankName} is already running on port ${GATEWAY_PORT} with matching token. Reusing instance.`, ANSI.green);
      gatewayRunning = true;
    } else if (status.healthy && !status.tokenMatch) {
      console.error(`${ANSI.red}${ANSI.bold}Gateway token mismatch:${ANSI.reset} A Banking Gateway is running on port ${GATEWAY_PORT} but using an old or mismatched token.`);
      console.error('Please stop the process on port ' + GATEWAY_PORT + ' so npm run dev can start it with the synchronized token.');
      process.exit(1);
    } else {
      console.error(`${ANSI.red}${ANSI.bold}Port conflict:${ANSI.reset} Port ${GATEWAY_PORT} is in use by another non-gateway process.`);
      console.error('Please free port ' + GATEWAY_PORT + ' and try again.');
      process.exit(1);
    }
  }

  if (!gatewayRunning) {
    log('gateway', `Starting ${bankName} on http://${GATEWAY_HOST}:${GATEWAY_PORT}...`, ANSI.cyan);
    const gatewayEnv = {
      ...process.env,
      NODE_ENV: 'development',
      GATEWAY_TOKEN: token,
      PORT: String(GATEWAY_PORT),
      HOST: GATEWAY_HOST,
      CHANNEL_ORIGINS: `http://localhost:${STUDIO_PORT}`,
      // On CIMB: Studio may hold its own banking test conversations on the bank's systems (src/http/test-sessions.ts).
      ...(cimb ? { ...cimb, STUDIO_TEST_SESSIONS: 'on' } : {}),
    };

    const gatewayProc = spawn(process.execPath, [cimb ? 'src/main.ts' : 'mock/main.ts'], {
      cwd: gatewayDir,
      env: gatewayEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    childProcesses.add(gatewayProc);

    gatewayProc.stdout.on('data', (data) => log('gateway', data.toString(), ANSI.cyan));
    gatewayProc.stderr.on('data', (data) => log('gateway', data.toString(), ANSI.red));
    gatewayProc.on('exit', (code) => {
      childProcesses.delete(gatewayProc);
      if (code !== 0 && code !== null) {
        log('gateway', `Process exited with code ${code}`, ANSI.red);
      }
    });

    // Wait for gateway to become ready
    let attempts = 0;
    const maxAttempts = 30; // up to 15 seconds
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
      const status = await checkGatewayStatus(`http://${GATEWAY_HOST}:${GATEWAY_PORT}`, token);
      if (status.healthy) {
        gatewayRunning = true;
        break;
      }
    }

    if (!gatewayRunning) {
      console.error(`${ANSI.red}The ${bankName} failed to respond on http://${GATEWAY_HOST}:${GATEWAY_PORT} within 15s.${ANSI.reset}`);
      cleanup();
      process.exit(1);
    }
    log('gateway', `${bankName} is READY.`, ANSI.green);
  }

  // Check Studio port
  const studioPortTaken = await isPortInUse(STUDIO_PORT);
  if (studioPortTaken) {
    console.error(`${ANSI.red}${ANSI.bold}Port conflict:${ANSI.reset} Port ${STUDIO_PORT} is already in use.`);
    console.error(`Please stop the existing process on port ${STUDIO_PORT} and try again.`);
    cleanup();
    process.exit(1);
  }

  // Start Vite Studio frontend
  log('studio', `Starting Weave Studio frontend on http://localhost:${STUDIO_PORT}...`, ANSI.green);
  const studioEnv = {
    ...process.env,
    BANKING_GATEWAY_URL: `http://localhost:${GATEWAY_PORT}`,
    BANKING_GATEWAY_TOKEN: token,
    BANKING_GATEWAY_REHEARSALS: 'on',
  };

  const vitePath = resolve(rootDir, 'node_modules/vite/bin/vite.js');
  const studioProc = spawn(process.execPath, [vitePath, '--port', String(STUDIO_PORT), '--strictPort'], {
    cwd: rootDir,
    env: studioEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  childProcesses.add(studioProc);

  studioProc.stdout.on('data', (data) => log('studio', data.toString(), ANSI.green));
  studioProc.stderr.on('data', (data) => log('studio', data.toString(), ANSI.red));
  studioProc.on('exit', (code) => {
    childProcesses.delete(studioProc);
    if (code !== 0 && code !== null) {
      log('studio', `Vite process exited with code ${code}`, ANSI.red);
    }
  });

  console.log(`\n${ANSI.bold}${ANSI.green}✓ All services running!${ANSI.reset}`);
  console.log(`  ${ANSI.bold}Banking:${ANSI.reset}        any agent → Build › Tools → Make this a banking agent → Test (Live or Sandbox)`);
  console.log(`  ${ANSI.bold}Studio Home:${ANSI.reset}    http://localhost:${STUDIO_PORT}`);
  console.log(`  ${ANSI.bold}Gateway Health:${ANSI.reset} http://${GATEWAY_HOST}:${GATEWAY_PORT}/health\n`);
  if (cimb) {
    console.log(`${ANSI.bold}Banking runs on CIMB (Live mode):${ANSI.reset} sign in with a CIMB customer id as the 7-digit Phone Code and their 6-digit passcode as the PIN.`);
    console.log(`  Sandbox mode keeps the mock bank in the browser, with the test logins below.
`);
  }
  console.log(`${ANSI.bold}Test credentials for demo${cimb ? ' (mock bank, Sandbox)' : ''}:${ANSI.reset}`);
  console.log(`  1. Phone Code:  ${ANSI.bold}1234567${ANSI.reset}  | PIN: ${ANSI.bold}135790${ANSI.reset} (3 accounts: SGD, Omnibus, EUR/USD)`);
  console.log(`  2. Account OTP: ${ANSI.bold}500000000201${ANSI.reset} | NRIC: ${ANSI.bold}1234567${ANSI.reset} (SMS OTP printed in console logs)`);
  console.log(`  3. Entitlement: ${ANSI.bold}500000000301${ANSI.reset} | NRIC: ${ANSI.bold}7654321${ANSI.reset} (Authorised Contact, balance refused)\n`);
  console.log(`${ANSI.dim}Press Ctrl+C to stop all services cleanly.${ANSI.reset}\n`);
}

main().catch((err) => {
  console.error(`${ANSI.red}Startup error:${ANSI.reset}`, err);
  cleanup();
  process.exit(1);
});
