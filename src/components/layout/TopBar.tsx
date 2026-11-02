import React from 'react';
import { MenuIcon, SearchIcon } from 'lucide-react';
import { NotificationCenter } from './NotificationCenter';
import { ProfileMenu } from './ProfileMenu';
import { shortcutLabel } from '../../utils/keys';
import { ThemePopover } from '../theme/ThemePopover';
import { DataSourceSwitch } from '../../sandbox/DataSourceSwitch';

interface TopBarProps {
  onOpenPalette: () => void;
  /** Opens the sidebar as a drawer (phones only: wider screens always show it). */
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}

const iconButton =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

/**
 * The bar above every page: on the left where the data comes from (Live or Sandbox); on the right search, notifications,
 * the theme and the person's account. The working environment and the API's state are in Settings.
 */
export function TopBar({ onOpenPalette, onOpenMenu, menuOpen = false }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open the menu"
            aria-expanded={menuOpen}
            aria-controls="studio-sidebar"
            className={`${iconButton} -ml-1 md:hidden`}
          >
            <MenuIcon className="h-5 w-5" aria-hidden />
          </button>
        )}
        {/* Live (the Agent Builder API) or Sandbox (sample data in this browser) */}
        <DataSourceSwitch />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden h-8 w-56 items-center gap-2 rounded-lg border border-line bg-subtle/60 px-2.5 text-[13px] text-muted transition hover:border-line-strong hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 md:flex lg:w-64"
          title={`Search anything (${shortcutLabel('K')})`}
          aria-label="Search anything"
        >
          <SearchIcon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded bg-surface px-1 py-0.5 font-mono text-[10px] text-muted shadow-sm">{shortcutLabel('K')}</kbd>
        </button>
        {/* on narrow screens the same search, as an icon */}
        <button type="button" onClick={onOpenPalette} className={`${iconButton} md:hidden`} title={`Search anything (${shortcutLabel('K')})`} aria-label="Search anything">
          <SearchIcon className="h-[18px] w-[18px]" aria-hidden />
        </button>

        <NotificationCenter />
        <ThemePopover />
        <div className="mx-1.5 h-5 w-px bg-line" aria-hidden />
        <ProfileMenu />
      </div>
    </header>
  );
}
