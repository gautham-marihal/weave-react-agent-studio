import { leaksIdentifiers, stripFirewalled } from '../security/redact.ts';
import type { NextStep, ToolDefinition, ToolOutcome } from '../tools/define.ts';

// What the agent runtime receives for a tool call. Flat, so the runtime's `result.to_llm` whitelist can name fields.
// Business outcomes (declined, host errors) are HTTP 200 with ok:false, so the model can explain them to the caller;
// HTTP errors are reserved for protocol problems (unknown tool, no session, bad credentials).

export type ToolResponse =
  | ({ readonly ok: true; readonly next?: NextStep } & Readonly<Record<string, unknown>>)
  | ({ readonly ok: false; readonly error_code: string; readonly error_message: string; readonly next: NextStep } & Readonly<Record<string, unknown>>);

/** Fields any declined outcome may carry, whatever the tool's own whitelist. */
const DECLINE_FIELDS = ['accounts', 'currencies', 'options', 'attempts_remaining', 'retryable'];

export function shape(tool: ToolDefinition, outcome: ToolOutcome): { response: ToolResponse; leak: boolean } {
  const allowed = new Set(outcome.status === 'ok' ? tool.llmFields : [...tool.llmFields, ...DECLINE_FIELDS]);
  const data = Object.fromEntries(Object.entries(outcome.data ?? {}).filter(([k]) => allowed.has(k)));
  const safe = stripFirewalled(data) as Record<string, unknown>;
  const response: ToolResponse =
    outcome.status === 'ok'
      ? { ok: true, ...safe, ...(outcome.next ? { next: outcome.next } : {}) }
      : { ok: false, ...safe, error_code: outcome.code, error_message: outcome.message, next: outcome.next };
  return { response, leak: leaksIdentifiers(response) };
}

export function failure(code: string, message: string, next: NextStep): ToolResponse {
  return { ok: false, error_code: code, error_message: message, next };
}
