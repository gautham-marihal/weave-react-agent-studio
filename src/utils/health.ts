// Reads the answer (or failure) of GET /health into what the top bar shows. Pure: the caller measures the time.

export type HealthState = 'unknown' | 'healthy' | 'degraded' | 'down';

export interface HealthCheck {
  state: HealthState;
  /** Measured round trip in ms; null when nothing was measured yet. */
  latencyMs: number | null;
  /** Plain words: what the API said, or why it could not be asked. */
  detail: string;
  checkedAt: number | null;
}

export const NOT_CHECKED: HealthCheck = { state: 'unknown', latencyMs: null, detail: 'Not checked yet.', checkedAt: null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The API answered with a 2xx. Healthy only if it said {"ok": true}. */
export function readHealthAnswer(body: unknown, latencyMs: number, checkedAt: number): HealthCheck {
  if (isRecord(body) && body.ok === true) {
    return { state: 'healthy', latencyMs, detail: 'Answered {"ok": true}.', checkedAt };
  }
  return {
    state: 'degraded',
    latencyMs,
    detail: `Answered, but did not report ok: ${JSON.stringify(body)}`,
    checkedAt,
  };
}

/** The request failed: no answer at all is "down", an error status is "degraded". */
export function readHealthFailure(error: unknown, latencyMs: number, checkedAt: number): HealthCheck {
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { state: 'down', latencyMs, detail: `No answer within ${Math.round(latencyMs / 1000)} s.`, checkedAt };
  }
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
  const kind = isRecord(error) && typeof error.kind === 'string' ? error.kind : 'network';
  const message = error instanceof Error ? error.message : String(error);
  if (status === 0 || kind === 'network') {
    return { state: 'down', latencyMs, detail: status ? `HTTP ${status}: ${message}` : message, checkedAt };
  }
  return { state: 'degraded', latencyMs, detail: `HTTP ${status}: ${message}`, checkedAt };
}

/** How often the API is asked: every minute while it answers, every 15 s while it can't be reached. */
export const CHECK_EVERY_MS = 60_000;
export const RECHECK_WHILE_DOWN_MS = 15_000;

export function nextCheckDelay(state: HealthState): number {
  return state === 'down' ? RECHECK_WHILE_DOWN_MS : CHECK_EVERY_MS;
}

/**
 * Which strip goes across every page: none, "You're offline" (no network at all), or "Can't reach the server" (the
 * network is up but the API does not answer). An API that answers with an error is not "unreachable": the pages say
 * what went wrong themselves.
 */
export type ConnectivityStrip = 'offline' | 'server_down' | null;

export function connectivityStrip(online: boolean, state: HealthState): ConnectivityStrip {
  if (!online) return 'offline';
  return state === 'down' ? 'server_down' : null;
}
