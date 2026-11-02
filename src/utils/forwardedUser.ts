// Which X-User the dev/preview proxy sends to the Agent Builder API. Used by vite.config.ts (Node), so no DOM here.
//
// The browser sends the temporary sign-in's identity as X-User; saves, publishes and deploys are attributed to it.
// The proxy passes it on when it looks like a name or an email, and otherwise falls back to AGENT_BUILDER_USER.

export const MAX_USER_LENGTH = 200;

/** A usable X-User value, or undefined: trimmed, 1-200 characters, no control characters. */
export function cleanUser(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.length > MAX_USER_LENGTH) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}

/** The browser's X-User if it is usable, else the configured fallback, else none. */
export function forwardedUser(fromBrowser: string | string[] | undefined, fallback: string | undefined): string | undefined {
  return cleanUser(fromBrowser) ?? cleanUser(fallback);
}
