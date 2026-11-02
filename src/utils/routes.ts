/** A call's page. The agent goes in the link: a call id alone does not say which agent's records to read. */
export const callPath = (agentId: string, callId: string): string =>
  `/calls/${encodeURIComponent(callId)}?agent=${encodeURIComponent(agentId)}`;

/** The address of one of an agent's pages. */
export const agentPath = (agentId: string, page = ''): string => `/agents/${encodeURIComponent(agentId)}${page ? `/${page}` : ''}`;

const RETURN_BASE = 'https://weave-studio.invalid';

/**
 * Where signing in may send someone back to: only a page of this app. The address it came from is whatever was typed
 * or linked, so anything that could leave the app (`//host`, `/\host`, `https:`, `javascript:`, a tab or newline the
 * browser strips to make `//`) goes Home instead.
 */
export function safeReturnPath(from: unknown, fallback = '/'): string {
  if (typeof from !== 'string' || !from.startsWith('/')) return fallback;
  // a backslash reads as a slash, and whitespace or control characters are dropped, when the browser parses an address
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(from) || from.startsWith('//')) return fallback;
  try {
    return new URL(from, RETURN_BASE).origin === RETURN_BASE ? from : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Whether moving from one address to another leaves this agent's pages (another agent, or another page of the app).
 * Moving between the agent's own pages keeps its editor, and its unsaved edits, as they are.
 */
export function leavesAgent(agentId: string, nextPathname: string): boolean {
  const base = agentPath(agentId);
  return !(nextPathname === base || nextPathname.startsWith(`${base}/`));
}
