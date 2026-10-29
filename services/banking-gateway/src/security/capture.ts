import { newToken, sha256 } from './crypto.ts';

// Secure capture: how a PIN, NRIC or OTP gets from the caller to the host without passing through the language
// model, the transcript or the logs.
//
//   1. A tool (e.g. start_authentication) asks for a capture. The gateway issues a one-time token bound to the
//      session and a purpose, and pushes it on the session's channel stream (not to the model).
//   2. The channel client renders a masked keypad (web/mobile chat) or, on the phone, the runtime collects DTMF
//      with echo disabled, and posts the value with the token straight to the gateway.
//   3. The gateway verifies it with the host and moves the state machine. The model learns only the outcome
//      ("verified", "2 attempts left") by calling get_auth_status.
//
// Tokens are stored hashed, expire, and work once. Values are never stored here.

export type CapturePurpose = 'pin' | 'nric' | 'otp' | 'current_pin' | 'new_pin' | 'confirm_new_pin';

export const CAPTURE_FORMAT: Readonly<Record<CapturePurpose, { readonly min: number; readonly max: number; readonly label: string; readonly pattern: RegExp }>> = {
  pin: { min: 6, max: 6, label: 'six-digit Phone PIN', pattern: /^\d{6}$/ },
  current_pin: { min: 6, max: 6, label: 'current six-digit Phone PIN', pattern: /^\d{6}$/ },
  new_pin: { min: 6, max: 6, label: 'new six-digit Phone PIN', pattern: /^\d{6}$/ },
  confirm_new_pin: { min: 6, max: 6, label: 'new Phone PIN again', pattern: /^\d{6}$/ },
  otp: { min: 6, max: 6, label: 'six-digit one-time password from the SMS', pattern: /^\d{6}$/ },
  // Deck p34: "Please key the digits of your NRIC or Passport # [Min = 1; Max = 15]", digits only.
  nric: { min: 1, max: 15, label: 'digits of your NRIC or passport number', pattern: /^\d{1,15}$/ },
};

export interface CaptureRequest {
  readonly token: string;
  readonly purpose: CapturePurpose;
  readonly label: string;
  readonly minDigits: number;
  readonly maxDigits: number;
  readonly expiresAt: number;
}

interface Pending {
  readonly sessionId: string;
  readonly purpose: CapturePurpose;
  readonly expiresAt: number;
}

export type CaptureClaim =
  | { readonly ok: true; readonly sessionId: string; readonly purpose: CapturePurpose; readonly value: string }
  | { readonly ok: false; readonly reason: 'unknown_or_used' | 'expired' | 'wrong_session' | 'bad_format'; readonly purpose?: CapturePurpose };

export class CaptureService {
  readonly #pending = new Map<string, Pending>();
  readonly #ttlMs: number;

  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs;
  }

  /** Issues a capture and revokes any earlier one for the same session, so only one keypad is ever live. */
  issue(sessionId: string, purpose: CapturePurpose, now: number): CaptureRequest {
    this.revokeSession(sessionId);
    const token = newToken();
    const expiresAt = now + this.#ttlMs;
    this.#pending.set(sha256(token), { sessionId, purpose, expiresAt });
    const format = CAPTURE_FORMAT[purpose];
    return { token, purpose, label: format.label, minDigits: format.min, maxDigits: format.max, expiresAt };
  }

  /** Consumes a token. Wrong format still burns the token: the caller gets a fresh keypad, not unlimited guesses. */
  claim(token: string, value: string, sessionId: string, now: number): CaptureClaim {
    const key = sha256(token);
    const pending = this.#pending.get(key);
    if (!pending) return { ok: false, reason: 'unknown_or_used' };
    if (pending.sessionId !== sessionId) return { ok: false, reason: 'wrong_session' };
    this.#pending.delete(key);
    if (pending.expiresAt <= now) return { ok: false, reason: 'expired', purpose: pending.purpose };
    const digits = value.replace(/\s/g, '');
    if (!CAPTURE_FORMAT[pending.purpose].pattern.test(digits)) return { ok: false, reason: 'bad_format', purpose: pending.purpose };
    return { ok: true, sessionId, purpose: pending.purpose, value: digits };
  }

  /** The purpose of the live capture for a session, if any (for get_auth_status). */
  activePurpose(sessionId: string, now: number): CapturePurpose | null {
    return this.active(sessionId, now)?.purpose ?? null;
  }

  /** The live capture for a session, without its token (for the device's state view). */
  active(sessionId: string, now: number): { purpose: CapturePurpose; expiresAt: number } | null {
    for (const p of this.#pending.values()) {
      if (p.sessionId === sessionId && p.expiresAt > now) return { purpose: p.purpose, expiresAt: p.expiresAt };
    }
    return null;
  }

  /** The purpose of the session's latest unclaimed capture, expired or not (so an expired keypad can be reissued). */
  lastPurpose(sessionId: string): CapturePurpose | null {
    let last: CapturePurpose | null = null;
    for (const p of this.#pending.values()) if (p.sessionId === sessionId) last = p.purpose;
    return last;
  }

  revokeSession(sessionId: string): void {
    for (const [key, p] of this.#pending) if (p.sessionId === sessionId) this.#pending.delete(key);
  }
}
