import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useMatches } from 'react-router-dom';
import { useStudio } from '../contexts/StudioContext';
import { APP_NAME, pageTitle } from '../utils/pageTitle';

// The browser tab's title, set once for the whole app (App.tsx). A route names itself with `handle: { title }`; a
// screen whose name depends on its own state (a step of the sign-in) says it with useTitleOverride.

export interface RouteHandle {
  title?: string | ((search: URLSearchParams) => string);
}

let overrides: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const latestOverride = () => overrides[overrides.length - 1] ?? null;

/** While the calling component shows, the tab is called `title` (most specific first, the studio's name added). */
export function useTitleOverride(title: string | null): void {
  useEffect(() => {
    if (!title) return undefined;
    overrides = [...overrides, title];
    emit();
    return () => {
      const at = overrides.lastIndexOf(title);
      overrides = overrides.filter((_, i) => i !== at);
      emit();
    };
  }, [title]);
}

/** Keeps document.title in step with the address, the route's own title and the agents' names. */
export function usePageTitle(): string {
  const location = useLocation();
  const matches = useMatches();
  const { agents, loading } = useStudio();
  const override = useSyncExternalStore(subscribe, latestOverride, latestOverride);

  const handle = [...matches].reverse().find((m) => (m.handle as RouteHandle | undefined)?.title)?.handle as RouteHandle | undefined;
  const routeTitle =
    typeof handle?.title === 'function' ? handle.title(new URLSearchParams(location.search)) : handle?.title;
  const title = override
    ? `${override} · ${APP_NAME}`
    : pageTitle({ pathname: location.pathname, routeTitle, agents: loading ? null : agents });

  useEffect(() => {
    document.title = title;
  }, [title]);
  return title;
}
