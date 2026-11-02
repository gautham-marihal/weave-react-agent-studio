import React, { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { PanelLeftCloseIcon, PanelLeftOpenIcon, XIcon } from 'lucide-react';
import { WeaveMark } from '../ui/WeaveMark';
import { cn } from '../../utils/styles';
import { NAV_GROUPS } from './nav';
import { badgeText, badgeWords, useNavBadges } from './navBadges';

interface SidebarProps {
  /** Folded to its icons (on wide screens; below them it is always icons, and a drawer on a phone). */
  folded: boolean;
  onToggleFolded: () => void;
  /** On a phone the sidebar is a drawer over the page, opened from the top bar's menu button. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

// What shows only when the sidebar has room for words: always in the phone drawer, from `lg` up when not folded.
const wide = (folded: boolean, display: 'block' | 'flex' | 'inline') =>
  folded
    ? 'md:hidden'
    : display === 'flex'
      ? 'md:hidden lg:flex'
      : display === 'inline'
        ? 'md:hidden lg:inline'
        : 'md:hidden lg:block';
// ...and what shows only as icons (the opposite).
const narrow = (folded: boolean) => (folded ? 'hidden md:block' : 'hidden md:block lg:hidden');
// A link's name: read aloud always, shown when there is room.
const nameClass = (folded: boolean) => (folded ? 'md:sr-only' : 'md:sr-only lg:not-sr-only');

const iconButton =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

/**
 * The studio's menu: the logo with the fold button, then the pages in groups set apart by a line. Search, help and the
 * person's account are in the top bar.
 */
export function Sidebar({ folded, onToggleFolded, mobileOpen, onCloseMobile }: SidebarProps) {
  const badges = useNavBadges();
  const closeRef = useRef<HTMLButtonElement>(null);

  // The phone drawer: Escape closes it, and focus starts on its close button.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onCloseMobile]);

  const foldLabel = folded ? 'Expand the sidebar' : 'Collapse the sidebar';
  const foldButton = (
    <button
      type="button"
      onClick={onToggleFolded}
      aria-label={foldLabel}
      aria-expanded={!folded}
      aria-controls="studio-sidebar"
      title={foldLabel}
      className={cn(iconButton, 'hidden lg:flex')}
    >
      {folded ? <PanelLeftOpenIcon className="h-[18px] w-[18px]" aria-hidden /> : <PanelLeftCloseIcon className="h-[18px] w-[18px]" aria-hidden />}
    </button>
  );

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-ink/40 md:hidden" onClick={onCloseMobile} aria-hidden data-testid="nav-scrim" />}
      <aside
        id="studio-sidebar"
        aria-label="Studio menu"
        data-folded={folded ? 'true' : 'false'}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-screen w-72 shrink-0 flex-col border-r border-line bg-surface transition-all duration-200 ease-out',
          'md:sticky md:top-0 md:z-auto md:translate-x-0 md:visible md:shadow-none',
          mobileOpen ? 'translate-x-0 shadow-overlay' : 'invisible -translate-x-full',
          folded ? 'md:w-16' : 'md:w-16 lg:w-60'
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-line px-4', folded ? 'md:justify-center md:px-0' : 'md:justify-center md:px-0 lg:justify-between lg:px-4')}>
          <div className="flex min-w-0 items-center gap-2.5">
            <WeaveMark />
            <span className={cn('truncate text-[15px] font-semibold tracking-tight text-ink', wide(folded, 'inline'))}>Weave Studio</span>
          </div>
          {!folded && foldButton}
          <button ref={closeRef} type="button" onClick={onCloseMobile} aria-label="Close the menu" className={cn(iconButton, 'ml-auto md:hidden')}>
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* folded: the button that opens it again sits right under the logo */}
        {folded && <div className="hidden justify-center pt-2 lg:flex">{foldButton}</div>}

        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.id} role="group" aria-label={group.label}>
              {gi > 0 && <div className="mx-2.5 my-3 h-px bg-line" aria-hidden />}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const badge = badges[item.to];
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      title={item.label}
                      onClick={onCloseMobile}
                      className={({ isActive }) =>
                        cn(
                          'flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                          folded ? 'md:justify-center' : 'md:justify-center lg:justify-start',
                          isActive ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-subtle hover:text-ink'
                        )
                      }
                    >
                      <span className="relative shrink-0">
                        <item.icon className="h-[18px] w-[18px]" aria-hidden />
                        {badge && (
                          <span
                            className={cn(
                              'absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-surface',
                              badge.tone === 'danger' ? 'bg-danger' : 'bg-accent',
                              narrow(folded)
                            )}
                            aria-hidden
                          />
                        )}
                      </span>
                      <span className={cn('min-w-0 flex-1 truncate', nameClass(folded))}>{item.label}</span>
                      {badge && (
                        <>
                          <span
                            className={cn(
                              'ml-auto min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums',
                              badge.tone === 'danger' ? 'bg-danger text-white' : 'bg-subtle text-ink-soft',
                              wide(folded, 'inline')
                            )}
                            aria-hidden
                            data-nav-badge={item.to}
                          >
                            {badgeText(badge.count)}
                          </span>
                          <span className="sr-only">, {badgeWords(badge)}</span>
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
