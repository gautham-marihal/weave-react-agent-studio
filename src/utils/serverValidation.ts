// What the server's checks (POST /validate, or the report PUT /draft returns) say about a config. The server is the
// authority: the studio shows its report and never refuses anything on a list of its own. One shared store, so the
// editor, the agent list, Home and the release pages read the same answer for the same config.
import type { AgentConfig, ValidationReport } from '../types/studio';
import { api } from '../api/client';

export interface ValidationEntry {
  /** The config last sent to be checked, as JSON text. */
  json: string;
  checking: boolean;
  /** The failure for `json`, when the check could not be run. */
  error: string | null;
  /** The newest report the server gave, and the config it is about. */
  report: ValidationReport | null;
  reportJson: string;
}

/** What to show for a config: checked (with the report), checking (maybe with the previous report), failed, or not yet. */
export type ValidationStatus = 'unknown' | 'checking' | 'checked' | 'failed';

export interface ValidationView {
  status: ValidationStatus;
  /** The report for this exact config; null while unknown, checking or failed. */
  report: ValidationReport | null;
  /** The last report the server gave for an earlier version of this config (shown faded while checking). */
  previous: ValidationReport | null;
  error: string | null;
}

/** How an entry reads for one config. Pure. */
export function viewOf(entry: ValidationEntry | undefined, json: string): ValidationView {
  if (!entry) return { status: 'unknown', report: null, previous: null, error: null };
  if (entry.report && entry.reportJson === json) return { status: 'checked', report: entry.report, previous: null, error: null };
  if (entry.json === json && entry.checking) return { status: 'checking', report: null, previous: entry.report, error: null };
  if (entry.json === json && entry.error) return { status: 'failed', report: null, previous: entry.report, error: entry.error };
  return { status: 'unknown', report: null, previous: entry.report, error: null };
}

/** The errors of a report, or none while it is not known. */
export const errorsOf = (report: ValidationReport | null | undefined) => report?.errors ?? [];

const entries = new Map<string, ValidationEntry>();
const listeners = new Set<() => void>();
const inflight = new Map<string, { json: string; controller: AbortController }>();
let version = 0;

const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export const subscribeValidation = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Changes whenever any entry changes (for useSyncExternalStore). */
export const validationVersion = () => version;
export const getValidation = (key: string): ValidationEntry | undefined => entries.get(key);

/** Record a report the server already gave (the one PUT /draft returns), without asking again. */
export function putValidation(key: string, config: AgentConfig, report: ValidationReport) {
  const json = JSON.stringify(config);
  inflight.get(key)?.controller.abort();
  inflight.delete(key);
  entries.set(key, { json, checking: false, error: null, report, reportJson: json });
  emit();
}

/** Ask the server about a config, unless it already answered (or is answering) for exactly this config. */
export async function checkValidation(key: string, config: AgentConfig): Promise<void> {
  const json = JSON.stringify(config);
  const current = entries.get(key);
  if (current?.report && current.reportJson === json) return;
  const running = inflight.get(key);
  if (running?.json === json) return;
  running?.controller.abort();
  const controller = new AbortController();
  inflight.set(key, { json, controller });
  entries.set(key, { json, checking: true, error: null, report: current?.report ?? null, reportJson: current?.reportJson ?? '' });
  emit();
  try {
    const report = await api.validate(config, { signal: controller.signal });
    if (inflight.get(key)?.controller !== controller) return;
    inflight.delete(key);
    entries.set(key, { json, checking: false, error: null, report, reportJson: json });
  } catch (err: unknown) {
    if (controller.signal.aborted) return;
    inflight.delete(key);
    const prev = entries.get(key);
    entries.set(key, { json, checking: false, error: err instanceof Error ? err.message : 'The server’s checks could not be run.', report: prev?.report ?? null, reportJson: prev?.reportJson ?? '' });
  }
  emit();
}

/** Forget every answer (tests). */
export function resetValidation() {
  inflight.forEach((r) => r.controller.abort());
  inflight.clear();
  entries.clear();
  emit();
}
