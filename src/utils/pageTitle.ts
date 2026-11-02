// The browser tab's title for an address: most specific first, so a row of tabs still tells them apart
// ("Tools · Acme Support · Weave Studio"). Pure: the caller passes the address, the route's own title and the agents.

import { BUILD_SECTIONS } from '../models/agentPages';

export const APP_NAME = 'Weave Studio';

export interface TitleInput {
  pathname: string;
  /** The title the matched route gives itself (its `handle.title`), if it gives one. */
  routeTitle?: string;
  /** The agents known so far; null while the list is still being read (an agent is then not "not found" yet). */
  agents: { id: string; name: string }[] | null;
}

const AGENT_PAGES: Record<string, string> = {
  overview: 'Overview',
  build: 'Build',
  test: 'Test',
  release: 'Release',
  monitor: 'Monitor',
  setup: 'Setup',
};

/** "call-detail" -> "Call detail": a readable name for a page that does not name itself. */
export function readableSegment(segment: string): string {
  let text = segment;
  try {
    text = decodeURIComponent(segment);
  } catch {
    // keep it as it is
  }
  text = text.replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** The name of one of an agent's pages, from the part of the address after the agent: "build/tools" -> "Tools". */
export function agentPageLabel(rest: string): string {
  const [stage = '', section = ''] = rest.split('/').filter(Boolean);
  if (stage === 'build' && section) return BUILD_SECTIONS.find((s) => s.id === section)?.label ?? 'Build';
  // an unknown page of an agent opens its Overview (see AgentWorkspace)
  return AGENT_PAGES[stage] ?? 'Overview';
}

export function pageTitle({ pathname, routeTitle, agents }: TitleInput): string {
  const parts = pathname.split('/').filter(Boolean);
  const join = (...items: (string | undefined)[]) => [...items.filter(Boolean), APP_NAME].join(' · ');

  if (parts[0] === 'agents' && parts[1]) {
    let id = parts[1];
    try {
      id = decodeURIComponent(parts[1]);
    } catch {
      // keep it as it is
    }
    const agent = agents?.find((a) => a.id === id);
    if (agents && !agent) return join('Agent not found');
    return join(agentPageLabel(parts.slice(2).join('/')), agent?.name || id);
  }
  if (routeTitle) return join(routeTitle);
  if (parts.length === 0) return join('Home');
  return join(readableSegment(parts[0]));
}
