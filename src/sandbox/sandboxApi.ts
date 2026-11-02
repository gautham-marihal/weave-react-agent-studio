// Sandbox mode's Agent Builder API: the generated imitation (agentBuilderSandbox.js), kept in this browser's storage and
// loaded only when Sandbox is on (src/api/client.ts imports this file lazily), so the Live studio never carries it.
import { createDemoApi, type SandboxApi, type SandboxFollow, type SandboxStorage } from './agentBuilderSandbox.js';
import { forgetBankingSample, makeBankingSample } from './bankingSample';

export const SANDBOX_STATE_KEY = 'weave_sandbox_state';
// 'off' leaves out the two weeks of earlier sample calls (for a sandbox of the newest calls only)
const HISTORY_KEY = 'weave_sandbox_history';

function browserStorage(key = SANDBOX_STATE_KEY): SandboxStorage {
  let memory: unknown = null;
  return {
    load: () => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : memory;
      } catch {
        return memory;
      }
    },
    save: (state) => {
      memory = JSON.parse(JSON.stringify(state));
      try {
        window.localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // full or unavailable: kept for this page only
      }
    },
  };
}

const historyOn = (): boolean => {
  try {
    return window.localStorage.getItem(HISTORY_KEY) !== 'off';
  } catch {
    return true;
  }
};

// The configuration schema the real server publishes (a snapshot, refreshed by `npm run schema:snapshot`)
const loadSchema = async (): Promise<unknown> => (await import('../test/fixtures/agent-config.schema.json')).default;

let instance: SandboxApi | null = null;

export function getSandboxApi(): SandboxApi {
  instance ||= createDemoApi({ storage: browserStorage(), loadSchema, history: historyOn(), quietNewAgents: true });
  return instance;
}

// Telephony's sample setup (src/sandbox/telephony/store.ts) is kept apart from the API's sample data
const TELEPHONY_KEY = 'weave_sandbox_telephony';

// The sample banking agent is made before the first answer, so every list already has it (src/sandbox/bankingSample.ts).
let bankingSample: Promise<void> | null = null;
const withBankingSample = (): Promise<void> => (bankingSample ||= makeBankingSample(getSandboxApi()));

/** Puts the sandbox back to the sample agents, calls and telephony setup it started with. */
export function resetSandbox(): void {
  getSandboxApi().reset();
  forgetBankingSample();
  bankingSample = null;
  try {
    window.localStorage.removeItem(TELEPHONY_KEY);
  } catch {
    // storage unavailable: nothing was kept
  }
}

/** One API call answered in the browser, as { status, body }. */
export async function sandboxAnswer(method: string, path: string, body: unknown): Promise<{ status: number; body?: unknown }> {
  // a moment, so loading states are seen as they are with a server
  await Promise.all([new Promise((resolve) => setTimeout(resolve, 30)), withBankingSample()]);
  // a knowledge upload's file is kept as it is; the rest is copied so the imitation can't change the caller's objects
  const isFile = !!body && typeof body === 'object' && (body as { __file?: unknown }).__file !== undefined;
  const payload = body === undefined ? undefined : isFile ? body : JSON.parse(JSON.stringify(body));
  return getSandboxApi().handle(method, path, payload);
}

/** Follows a call as the server's event stream does. Returns a stop. */
export const sandboxFollow = (botId: string, callId: string, handlers: SandboxFollow): (() => void) => getSandboxApi().follow(botId, callId, handlers);

/** Keeps a conversation held in the browser (a simulated test) as one of the agent's calls. */
export const sandboxRecordConversation = (botId: string, conversation: Record<string, unknown>): string => getSandboxApi().recordConversation(botId, conversation);
