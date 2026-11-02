// Types for the generated imitation of the Agent Builder API (agentBuilderSandbox.js).

export interface SandboxStorage {
  load: () => unknown;
  save: (state: unknown) => void;
}

export interface SandboxAnswer {
  status: number;
  body?: unknown;
}

export interface SandboxFollow {
  after?: number;
  onOpen?: (call: unknown) => void;
  onRecord?: (record: unknown) => void;
  onEnd?: () => void;
}

export interface SandboxApi {
  /** Answers one API call: the path is what follows the API base, query included ("/bots?limit=5"). */
  handle: (method: string, path: string, body?: unknown) => Promise<SandboxAnswer>;
  /** Follows a call as the server's event stream would; returns a stop. */
  follow: (botId: string, callId: string, handlers: SandboxFollow) => () => void;
  /** Keeps a conversation held in the browser as one of the agent's calls; returns its id. */
  recordConversation: (botId: string, conversation: Record<string, unknown>) => string;
  /** Back to the sample agents and calls it started with. */
  reset: () => void;
}

export function createDemoApi(options?: {
  storage?: SandboxStorage;
  loadSchema?: () => Promise<unknown>;
  now?: () => string;
  seed?: boolean;
  stepMs?: number;
  history?: boolean;
  quietNewAgents?: boolean;
}): SandboxApi;

export function memoryStorage(initial?: unknown): SandboxStorage;
