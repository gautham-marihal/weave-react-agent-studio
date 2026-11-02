import {
  BarChart3Icon,
  BookOpenIcon,
  BotIcon,
  HouseIcon,
  LibraryIcon,
  PhoneCallIcon,
  PhoneForwardedIcon,
  RadioIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

// The sidebar's links, in groups: the workspace's own pages, the shared library, then the people and settings. The groups
// are set apart by a line; their names are for screen readers, not shown.
// Everything about ONE agent lives inside that agent. A new page adds one line to its group; a count beside a link
// is set with setNavBadge (navBadges.ts).

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Marked as open only on this exact address (Home), not on the pages under it. */
  end?: boolean;
}

export interface NavGroup {
  id: string;
  /** The group's name, read to screen readers (the sidebar shows groups apart by a line, without headings). */
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: HouseIcon, end: true },
      { to: '/agents', label: 'Agents', icon: BotIcon },
      { to: '/live', label: 'Live', icon: RadioIcon },
      { to: '/calls', label: 'Calls', icon: PhoneCallIcon },
      { to: '/analytics', label: 'Analytics', icon: BarChart3Icon },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    items: [
      { to: '/library', label: 'Library', icon: LibraryIcon },
      { to: '/knowledge', label: 'Knowledge', icon: BookOpenIcon },
      { to: '/telephony', label: 'Telephony', icon: PhoneForwardedIcon },
    ],
  },
  {
    id: 'manage',
    label: 'Team and settings',
    items: [
      { to: '/team', label: 'Team', icon: UsersIcon },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

/** The agent an address is about ("/agents/acme/build" -> "acme"), or null outside an agent. */
export function agentIdOfPath(pathname: string): string | null {
  const match = /^\/agents\/([^/]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Whether the sidebar is folded to its icons. Outside an agent it is the person's own choice, remembered. Inside an
 * agent it folds by itself so the agent's pages get the width; unfolding it there lasts until they leave the agent.
 */
export function sidebarFolded({ inAgent, remembered, agentChoice }: { inAgent: boolean; remembered: boolean; agentChoice: boolean | null }): boolean {
  return inAgent ? agentChoice ?? true : remembered;
}

export const SIDEBAR_FOLDED_KEY = 'weave_sidebar_folded';
