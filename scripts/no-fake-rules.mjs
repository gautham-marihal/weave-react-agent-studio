// What `npm run check:no-fake` refuses: mock libraries, demo data, simulated replies, invented constants, hardcoded
// server addresses. Kept apart from the runner so the rules themselves are tested (scripts/no-fake-rules.test.mjs).

/** @type {{ re: RegExp, why: string }[]} */
export const FORBIDDEN = [
  { re: /from ['"]msw/, why: 'mock service worker' },
  { re: /setupWorker/, why: 'mock service worker' },
  { re: /mockServiceWorker/, why: 'mock service worker' },
  { re: /\bfaker\b/i, why: 'fake data library' },
  { re: /lorem ipsum/i, why: 'placeholder text' },
  { re: /demo[ _-]?mode/i, why: 'demo mode' },
  { re: /Demo Data/i, why: 'demo data label' },
  { re: /\bmockData\b/, why: 'mock data' },
  { re: /\bsampleData\b/, why: 'sample data' },
  { re: /\bdummy\w*/i, why: 'dummy data' },
  { re: /VITE_USE_MOCK/i, why: 'mock switch' },
  { re: /simulat/i, why: 'simulated behaviour (use the real API, or say it is not available)' },
  { re: /fakeAsync/, why: 'faked async work' },
  { re: /\b(?:const|let|var)\s+has[A-Z]\w*\s*=\s*(?:true|false)\b/, why: 'a hardcoded "has…" flag (derive it from real data)' },
  { re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/, why: 'hardcoded IP address (use AGENT_BUILDER_URL)' },
  { re: /Math\.random\(/, why: 'random values (only allowed for generated ids)' },
  { re: /(?:^|\n)\s*import\s[^;]*?from\s+['"][^'"]*sandbox\/(?:sandboxApi|agentBuilderSandbox|sandboxEngine|banking\/gatewayInBrowser)/, why: 'sample data loaded up front (load src/sandbox/sandboxApi with import(), and only when Sandbox is on)' },
];

// Files allowed to match a rule, and why. Paths use forward slashes, relative to the repo root.
export const ALLOWED_MATCHES = {
  'src/utils/format.ts': ['Math.random('], // randomHex: client-side ids
  'src/components/ui/Toast/toastStore.ts': ['Math.random('], // toast ids
  'src/components/ui/live-orb.tsx': ['Math.random('], // when the orb blinks and where it glances; never data
};

/** Paths never scanned. src/sandbox/ is the one place the app keeps sample data and simulations, loaded with import()
 * on use: in Sandbox (src/sandbox/mode.ts), and in Live only the mock bank for banking agents, labelled as test data
 * on every screen (src/api/gateway.ts). Agents, calls and everything else in Live come from the real API only. */
export const SKIPPED = ['/tests/', '.test.', '.stories.', '/e2e/', '/src/sandbox/'];

/** Whether a path (relative to the repo root) is left out of the scan. */
export const isSkipped = (path) => SKIPPED.some((s) => `/${path}`.includes(s));

/** The rules a piece of text breaks, leaving out the ones allowed for this file. */
export function violations(path, text) {
  const allowed = ALLOWED_MATCHES[path] ?? [];
  return FORBIDDEN.filter(({ re }) => {
    const found = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? [];
    return found.some((m) => !allowed.some((a) => m.startsWith(a)));
  });
}
