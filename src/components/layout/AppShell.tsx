import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { EyeIcon, FlameIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useStudio } from '../../contexts/StudioContext';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from '../ui/CommandPalette';
import { CreateAgentDialog } from '../agents/CreateAgentDialog';
import { HelpShortcutsModal } from '../ui/HelpShortcutsModal';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Breadcrumbs } from './Breadcrumbs';
import { ConnectivityStrips } from './ConnectivityStrips';
import { SIDEBAR_FOLDED_KEY, agentIdOfPath, sidebarFolded } from './nav';
import { rememberLastAgent } from '../home/lastAgent';
import { isTypingTarget } from '../../utils/keys';

const readFolded = () => {
  try {
    return localStorage.getItem(SIDEBAR_FOLDED_KEY) === 'true';
  } catch {
    return false;
  }
};

/** Moves keyboard focus to the page itself: its first heading, else the main area. */
function skipToContent(event: React.MouseEvent) {
  event.preventDefault();
  const main = document.getElementById('main-content');
  if (!main) return;
  const heading = main.querySelector<HTMLElement>('h1, h2');
  const target = heading ?? main;
  if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  target.focus();
}

export function AppShell() {
  const { user } = useAuth();
  const { activeEnvironment, agents } = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // The sidebar: folded by choice (remembered) outside an agent, folded by itself inside one.
  const agentId = agentIdOfPath(location.pathname);
  const inAgent = agentId !== null;
  const [rememberedFolded, setRememberedFolded] = useState(readFolded);
  const [agentChoice, setAgentChoice] = useState<boolean | null>(null);
  useEffect(() => setAgentChoice(null), [inAgent]);
  const folded = sidebarFolded({ inAgent, remembered: rememberedFolded, agentChoice });
  const toggleFolded = useCallback(() => {
    if (inAgent) {
      setAgentChoice(!folded);
      return;
    }
    setRememberedFolded(!folded);
    try {
      localStorage.setItem(SIDEBAR_FOLDED_KEY, String(!folded));
    } catch {
      // not remembered, still folded for now
    }
  }, [inAgent, folded]);

  // Going anywhere closes the phone drawer.
  useEffect(() => setMobileNavOpen(false), [location.pathname, location.search]);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // Home's "Next step" starts from the agent last opened.
  useEffect(() => {
    if (agentId && agents.some((a) => a.id === agentId)) rememberLastAgent(agentId);
  }, [agentId, agents]);

  // The first-time profile step ends in the Create dialog (SignIn passes { openCreate: true }).
  useEffect(() => {
    const state = location.state as { openCreate?: boolean } | null;
    if (state?.openCreate) {
      setCreateOpen(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    const handleOpenPalette = () => setPaletteOpen(true);
    const handleOpenHelp = () => setHelpOpen(true);
    window.addEventListener('open-command-palette', handleOpenPalette);
    window.addEventListener('open-help-modal', handleOpenHelp);

    const handleKeyDown = (e: KeyboardEvent) => {
      // "?" opens the help, unless the keyboard is busy typing somewhere
      if (isTypingTarget(e.target)) return;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('open-command-palette', handleOpenPalette);
      window.removeEventListener('open-help-modal', handleOpenHelp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!user) {
    // The bare address shows what Weave Studio is; any other address asks to sign in, then comes back to it.
    if (location.pathname === '/' && !location.search) return <Navigate to="/welcome" replace />;
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  }

  return (
    <div className="flex min-h-screen w-full bg-canvas text-ink">
      {/* the first Tab on a page offers to jump past the menu to the page itself */}
      <a
        href="#main-content"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-overlay focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        Skip to content
      </a>
      <Sidebar
        folded={folded}
        onToggleFolded={toggleFolded}
        mobileOpen={mobileNavOpen}
        onCloseMobile={closeMobileNav}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} onOpenMenu={() => setMobileNavOpen(true)} menuOpen={mobileNavOpen} />

        <ConnectivityStrips />

        {user.role === 'viewer' && (
          <div className="flex items-center gap-2 border-b border-info/20 bg-info-soft px-6 py-2 text-[13px] text-info" role="status">
            <EyeIcon className="h-4 w-4 shrink-0" aria-hidden />
            You have view access. You can look at agents and calls; changes are turned off. Ask an admin for editor access.
          </div>
        )}

        {activeEnvironment === 'production' && (
          <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger-soft/60 px-4 py-1.5 text-xs text-danger sm:px-6" role="alert">
            <div className="flex min-w-0 items-center gap-2">
              <FlameIcon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="font-semibold">You are working in Production.</span>
              <span className="hidden text-ink-soft sm:inline">What you deploy here reaches real callers at once.</span>
            </div>
            <Link to="/settings#working-environment" className="shrink-0 font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40">
              Change
            </Link>
          </div>
        )}

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 flex flex-col focus:outline-none">
          {/* the trail only below the top level: a page the menu opens directly needs no "Home › Calls" */}
          {location.pathname.split('/').filter(Boolean).length > 1 && (
            <div className="border-b border-line/60 bg-surface/50 px-4 py-2.5 backdrop-blur-xs sm:px-6 lg:px-10">
              <Breadcrumbs />
            </div>
          )}
          <div className="flex-1">
            {/* a page that breaks says so on its own; the menu and top bar keep working, another page starts afresh */}
            <ErrorBoundary variant="page" resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenCreate={() => setCreateOpen(true)}
      />
      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <HelpShortcutsModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}
