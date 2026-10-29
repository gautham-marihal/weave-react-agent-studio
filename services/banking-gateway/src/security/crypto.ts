import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '')}`;

/** 256-bit, URL-safe; for one-time capture tokens and confirmation ids the model must not be able to guess. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Constant-time string comparison (bearer tokens, PIN re-entry). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // spend the same time either way
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export interface LiveKitClaims {
  readonly identity: string;
  readonly room: string;
  readonly exp: number;
}

/**
 * Verifies a LiveKit access token (HS256 JWT signed with the LiveKit API secret) and returns the room it grants.
 * The browser already holds this token from POST /bots/{id}/sessions, so presenting it proves "I am a participant in
 * this call" without a second login. Returns null for anything malformed, expired, mis-signed or without a room.
 */
export function verifyLiveKitToken(token: string, apiSecret: string, nowMs: number): LiveKitClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string };
    if (head.alg !== 'HS256') return null;
    const expected = createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url');
    if (!safeEqual(expected, signature)) return null;
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown; nbf?: unknown; video?: { room?: unknown; roomJoin?: unknown } };
    const now = Math.floor(nowMs / 1000);
    if (typeof body.exp !== 'number' || body.exp <= now) return null;
    if (typeof body.nbf === 'number' && body.nbf > now + 5) return null;
    if (typeof body.sub !== 'string' || typeof body.video?.room !== 'string' || body.video.roomJoin !== true) return null;
    return { identity: body.sub, room: body.video.room, exp: body.exp };
  } catch {
    return null;
  }
}

/** Mints a LiveKit-shaped token. Used by tests and the mock harness; production tokens come from the Agent Builder API. */
export function signLiveKitToken(claims: { identity: string; room: string; ttlS: number }, apiSecret: string, nowMs: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(nowMs / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: claims.identity, nbf: now, exp: now + claims.ttlS, video: { room: claims.room, roomJoin: true } })).toString('base64url');
  const signature = createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
