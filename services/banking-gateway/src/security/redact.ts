import type { Schema } from '../schema/schema.ts';

/** "501234567890" → "••••7890". Used for any identifier that reaches a log or the model. */
export function maskTail(value: string, keep = 4): string {
  return value.length <= keep ? '•'.repeat(value.length) : `${'•'.repeat(Math.min(4, value.length - keep))}${value.slice(-keep)}`;
}

/**
 * Field names that must never reach the model, a transcript, a log or the channel event stream. Mirrors the
 * runtime's `field_firewall` guardrail so the rule holds even while that guardrail is not enforced in code.
 */
export const FIREWALL_FIELDS = new Set(['pin', 'tpin', 'new_pin', 'current_pin', 'otp', 'nric', 'passport', 'password', 'token', 'capture_token', 'account_number_full', 'card_number', 'cvv']);

/** Arguments as they may appear in an audit record: sensitive → "[redacted]", identifiers → masked. */
export function redactArgs(args: Record<string, unknown>, properties: Readonly<Record<string, Schema<unknown>>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key];
    if (FIREWALL_FIELDS.has(key) || schema?.sensitive) out[key] = '[redacted]';
    else if (schema?.identifier && typeof value === 'string') out[key] = maskTail(value);
    else out[key] = value;
  }
  return out;
}

/** Removes firewalled keys at any depth. Applied to every tool result before it leaves the gateway. */
export function stripFirewalled(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFirewalled);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !FIREWALL_FIELDS.has(k))
      .map(([k, v]) => [k, stripFirewalled(v)]),
  );
}

// A 12-digit run (a full account number) or a Singapore NRIC/FIN must never appear in model-visible text.
const LEAK_PATTERNS = [/\b\d{12}\b/, /\b[STFGM]\d{7}[A-Z]\b/i];

/** True when a model-bound payload contains something shaped like a full account number or an NRIC. */
export function leaksIdentifiers(value: unknown): boolean {
  const text = JSON.stringify(value);
  return LEAK_PATTERNS.some((re) => re.test(text));
}
