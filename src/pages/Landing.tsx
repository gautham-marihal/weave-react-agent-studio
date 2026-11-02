import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  FlaskConicalIcon,
  HammerIcon,
  MoonIcon,
  RocketIcon,
  ActivityIcon,
  SunIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { starters } from '../data/starters';
import { Button } from '../components/ui/Button';
import { WeaveMark } from '../components/ui/WeaveMark';
import { HelpShortcutsModal } from '../components/ui/HelpShortcutsModal';
import { cn } from '../utils/styles';

// The page before sign-in: what Weave Studio is, what people build with it, and the two ways in (Start, Sign in).
// Signed-in people go straight to their workspace.

const START = '/signin?start=1';

// The starters people can begin from (the same ones the Create dialog offers), as use cases.
const useCases = starters.filter((s) => s.id !== 'blank').slice(0, 6);

const stages = [
  { icon: HammerIcon, label: 'Build', text: 'Pick a starter and say what it should do in plain words. The technical configuration stays underneath, ready to export.' },
  { icon: FlaskConicalIcon, label: 'Test', text: 'Talk or type to your draft before anyone else does, and keep good conversations as tests.' },
  { icon: RocketIcon, label: 'Release', text: 'Publish a version, deploy it with checks, and roll back in two clicks.' },
  { icon: ActivityIcon, label: 'Monitor', text: 'Read every call and watch how each release is doing.' },
];

/** "Use cases": a menu of what people build, each leading to Start. Escape or a click outside closes it. */
function UseCaseMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Use cases
        <ChevronDownIcon className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Use cases"
          onKeyDown={onKey}
          className="absolute left-0 top-full z-40 mt-2 w-80 rounded-lg border border-line bg-surface p-1.5 shadow-overlay"
        >
          {useCases.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              onClick={() => navigate(START)}
              className="block w-full rounded-md px-3 py-2 text-left hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
            >
              <span className="block text-sm font-semibold text-ink">{s.name}</span>
              <span className="block text-xs leading-relaxed text-muted">{s.summary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Landing() {
  const { user } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const isDark = resolvedTheme === 'dark';

  if (user) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen w-full bg-canvas text-ink">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <WeaveMark />
          <span className="text-[15px] font-semibold tracking-tight">Weave Studio</span>
        </div>
        <nav aria-label="Main" className="flex items-center gap-1">
          <UseCaseMenu />
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:inline-flex"
          >
            <CircleHelpIcon className="h-4 w-4" aria-hidden />
            Help
          </button>
        </nav>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={isDark}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {isDark ? <SunIcon className="h-4 w-4" aria-hidden /> : <MoonIcon className="h-4 w-4" aria-hidden />}
          </button>
          <Link
            to="/signin"
            className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-ink-soft hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Sign in
          </Link>
          <Link
            to={START}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-ink shadow-sm hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Start
            <ArrowRightIcon className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-20" aria-labelledby="hero-title">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">The AI agent workspace</p>
            <h1 id="hero-title" className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
              Turn an idea into an agent people can actually use.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft">
              Weave Studio builds the voice and chat agents that talk to your customers. Describe what you need, tune the important details, try it
              out, and put it live with checks.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to={START}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-ink shadow-sm hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Create your first agent
                <ArrowRightIcon className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                to="/signin"
                className="inline-flex h-11 items-center rounded-md border border-line-strong bg-surface px-5 text-sm font-medium text-ink shadow-sm hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Sign in
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
              {['Guided setup', 'Voice and chat', 'Versions you can roll back'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <CheckIcon className="h-4 w-4 text-success" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <ol className="space-y-3" aria-label="From idea to live">
            {stages.map((s, i) => (
              <li key={s.label} className="flex gap-4 rounded-xl border border-line bg-surface p-4 shadow-panel">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden>
                  <s.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">
                    <span className="mr-1.5 font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                    {s.label}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-line bg-surface/60" aria-labelledby="use-cases-title">
          <div className="mx-auto w-full max-w-6xl px-6 py-12">
            <h2 id="use-cases-title" className="text-lg font-semibold text-ink">
              Start from what you need
            </h2>
            <p className="mt-1 text-sm text-muted">Each starter is a beginning: you make its words your business’s own.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {useCases.map((s) => (
                <Link
                  key={s.id}
                  to={START}
                  className="group rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <span className="flex items-center justify-between text-sm font-semibold text-ink">
                    {s.name}
                    <ArrowRightIcon className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-muted">{s.summary}</span>
                </Link>
              ))}
            </div>
            <div className="mt-8">
              <Button variant="secondary" onClick={() => setHelpOpen(true)}>
                <CircleHelpIcon className="h-4 w-4" aria-hidden />
                Help & shortcuts
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-6 py-6 text-xs text-muted">
        <span>Built for product, operations and engineering teams</span>
        <span>Weave Studio · AI agent workspace</span>
      </footer>

      <HelpShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
