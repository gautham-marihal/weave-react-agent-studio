import { useEffect, useRef } from 'react';
import type { Path } from '../types/studio';

// "Show me this setting": a deep link, the search, a problem's "Show me" or the Build page ask for a place in the
// config, and the settings form on the page that can show it opens its screen, unfolds what holds it and flashes it.
// A request no mounted form can show waits for one (the "All settings" view that is about to open).

/** A form that is on the page: shows `path` and says true, or says false when the path is not its part. */
type Handler = (path: Path) => boolean;

const handlers = new Map<string, Set<Handler>>();
let pending: { agentId: string; path: Path; at: number } | null = null;
// A request older than this is stale: a form opened later by hand does not jump.
const FRESH_MS = 4000;

/** Ask the form on the page to show a place. True when a form showed it now; otherwise it waits for one. */
export function requestSettingFocus(agentId: string, path: Path): boolean {
  for (const handler of handlers.get(agentId) ?? []) if (handler(path)) return true;
  pending = { agentId, path, at: Date.now() };
  return false;
}

/** Whether a form for this agent that can show `path` is on the page right now (without showing it). */
export function hasSettingForm(agentId: string): boolean {
  return (handlers.get(agentId)?.size ?? 0) > 0;
}

/** A form takes the requests for its agent while it is mounted, and a waiting one when it mounts. */
export function useSettingFocus(agentId: string, handler: Handler | null): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!agentId) return undefined;
    const own: Handler = (path) => !!ref.current && ref.current(path);
    const set = handlers.get(agentId) ?? new Set<Handler>();
    set.add(own);
    handlers.set(agentId, set);
    const waiting = pending;
    if (waiting && waiting.agentId === agentId && Date.now() - waiting.at < FRESH_MS && own(waiting.path)) pending = null;
    return () => {
      set.delete(own);
    };
  }, [agentId]);
}
