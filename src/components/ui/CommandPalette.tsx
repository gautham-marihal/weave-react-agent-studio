import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3Icon,
  BookOpenIcon,
  BotIcon,
  CornerDownLeftIcon,
  FileTextIcon,
  HelpCircleIcon,
  HistoryIcon,
  HouseIcon,
  LibraryIcon,
  MoonIcon,
  PhoneCallIcon,
  PhoneForwardedIcon,
  PhoneIcon,
  PlusIcon,
  RadioIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  SlidersIcon,
  SunIcon,
  ZapIcon,
} from 'lucide-react';
import { useStudio } from '../../contexts/StudioContext';
import { useTheme } from '../../contexts/ThemeContext';
import { api } from '../../api/client';
import type { PhoneNumber } from '../../api/types';
import { loadSchema } from '../../hooks/useSchema';
import { buildSettingsIndex, searchSettings, type SettingEntry } from '../../models/schemaForm/settingsSearch';
import { paletteGroups, rememberPick, searchKey, RECENT_KEPT, type PaletteCall, type PaletteItem, type PaletteNumber, type PaletteTelephony } from '../../models/paletteSearch';
import { isSandbox } from '../../sandbox/mode';
import { toCallRecord } from '../../utils/callRecords';
import { formatDuration, timeAgo } from '../../utils/format';
import { shortcutLabel } from '../../utils/keys';
import { cn } from '../../utils/styles';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenCreate?: () => void;
}

// The recent picks are kept in this browser only (keys of results, never anything private).
const RECENT_KEY = 'weave_search_recent';
const readRecent = (): string[] => {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(kept) ? kept.filter((k): k is string => typeof k === 'string').slice(0, RECENT_KEPT) : [];
  } catch {
    return [];
  }
};

const CHANNEL_WORDS: Record<string, string> = { web_chat: 'Web chat', web_voice: 'Web voice', phone: 'Phone' };

const PAGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: HouseIcon,
  agents: BotIcon,
  live: RadioIcon,
  calls: PhoneCallIcon,
  knowledge: BookOpenIcon,
  library: LibraryIcon,
  telephony: PhoneForwardedIcon,
  analytics: BarChart3Icon,
  settings: SettingsIcon,
};
function iconOf(item: PaletteItem): React.ComponentType<{ className?: string }> {
  if (item.kind === 'page') return PAGE_ICONS[item.id] ?? FileTextIcon;
  if (item.kind === 'agent') return BotIcon;
  if (item.kind === 'setting') return SlidersIcon;
  if (item.kind === 'number') return PhoneIcon;
  if (item.kind === 'telephony') return PhoneForwardedIcon;
  if (item.kind === 'call') return PhoneCallIcon;
  if (item.kind === 'agentAction' || item.kind === 'agentPage') return item.id.includes('publish') || item.id.includes('deploy') ? RocketIcon : ZapIcon;
  if (item.action === 'create') return PlusIcon;
  if (item.action === 'help') return HelpCircleIcon;
  if (item.action === 'theme') return item.title === 'Dark theme' ? MoonIcon : SunIcon;
  return SlidersIcon;
}

/**
 * The search (Ctrl/⌘ K): pages, actions, agents and, on an agent, its own pages, tasks and every setting in the
 * schema; with a word typed, also each agent's Publish/Test/Deploy/Calls, phone numbers and recent calls. Grouped,
 * the best match first, the recent picks while nothing is typed.
 */
export function CommandPalette({ open, onClose, onOpenCreate }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, technicalNames, setTechnicalNames, getAgent } = useStudio();
  const { theme, toggleTheme, density, setDensity } = useTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [index, setIndex] = useState<SettingEntry[] | null>(null);
  const [numbers, setNumbers] = useState<PaletteNumber[] | null>(null);
  const [calls, setCalls] = useState<PaletteCall[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const listId = useId();
  // the agent whose pages are open (its settings and pages are offered first)
  const openAgentId = matchPath('/agents/:agentId/*', location.pathname)?.params.agentId ?? null;
  const openAgent = openAgentId ? getAgent(openAgentId) : undefined;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    setRecent(readRecent());
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  // Ctrl/⌘ K anywhere opens and closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
        else window.dispatchEvent(new CustomEvent('open-command-palette'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // the settings index is built from GET /schema the first time the search opens on an agent
  useEffect(() => {
    if (!open || !openAgentId || index) return undefined;
    let off = false;
    loadSchema()
      .then((schema) => !off && setIndex(buildSettingsIndex(schema)))
      .catch(() => undefined); // without the schema, settings are not offered; everything else still is
    return () => {
      off = true;
    };
  }, [open, openAgentId, index]);

  // numbers and recent calls are read once a word is typed (they are only listed then)
  const typed = /[\p{L}\p{N}]/u.test(query);
  useEffect(() => {
    if (!open || !typed || numbers) return undefined;
    let off = false;
    api
      .listNumbers()
      .then((res) => {
        // GET /numbers is a list; an answer wrapped as { numbers } is read too
        const raw: unknown = res;
        const list = (Array.isArray(raw) ? raw : (res.numbers ?? [])) as PhoneNumber[];
        if (!off) setNumbers(list.map((n) => ({ number: n.number, bot: n.bot, environment: n.environment })));
      })
      .catch(() => !off && setNumbers([]));
    return () => {
      off = true;
    };
  }, [open, typed, numbers]);
  useEffect(() => {
    if (!open || !typed || calls) return undefined;
    let off = false;
    const ids = openAgentId ? [openAgentId] : agents.slice(0, 5).map((a) => a.id);
    Promise.all(ids.map((id) => api.listCalls(id, { limit: openAgentId ? 20 : 10 }).then((r) => r.calls.map((c) => toCallRecord(c, id))).catch(() => [])))
      .then((lists) => {
        if (off) return;
        setCalls(
          lists
            .flat()
            .sort((a, b) => b.started_at.localeCompare(a.started_at))
            .slice(0, 40)
            .map((c) => ({ id: c.id, agentId: c.agentId, channel: CHANNEL_WORDS[c.channel] ?? c.channel, when: c.started_at ? timeAgo(c.started_at) : 'time unknown', duration: formatDuration(c.duration_s) })),
        );
      })
      .catch(() => !off && setCalls([]));
    return () => {
      off = true;
    };
  }, [open, typed, calls, openAgentId, agents]);
  // a new agent opened: its calls are read again
  useEffect(() => setCalls(null), [openAgentId]);
  // Sandbox only: the test numbers, dispatch rules and trunks kept in this browser (loaded when first needed)
  const [telephony, setTelephony] = useState<PaletteTelephony[]>([]);
  useEffect(() => {
    if (!open || !typed || !isSandbox()) return undefined;
    let off = false;
    const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));
    import('../../sandbox/telephony/palette')
      .then((m) => !off && setTelephony(m.sandboxTelephonyResults(names)))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [open, typed, agents]);

  const actions = useMemo<PaletteItem[]>(
    () => [
      { kind: 'action', id: 'create', title: 'Create an agent', description: 'Start from a starter, or a blank agent', words: 'new add make agent', action: 'create' },
      { kind: 'action', id: 'theme', title: theme === 'dark' ? 'Light theme' : 'Dark theme', description: 'Switch the theme', words: 'theme mode appearance light dark night', action: 'theme' },
      {
        kind: 'action',
        id: 'density',
        title: density === 'comfortable' ? 'Compact layout' : 'Comfortable layout',
        description: `The layout is ${density} now`,
        words: 'density compact comfortable spacing',
        action: 'density',
      },
      {
        kind: 'action',
        id: 'technical-names',
        title: `${technicalNames ? 'Hide' : 'Show'} technical names`,
        description: 'Each setting’s name in the file (persona.company) beside its label',
        words: 'technical names keys paths developer',
        action: 'technical-names',
      },
      { kind: 'action', id: 'help', title: 'Help & shortcuts', description: 'Keyboard shortcuts', words: 'help keyboard keys shortcuts', action: 'help' },
    ],
    [theme, density, technicalNames],
  );

  const settings = useMemo(() => (index && openAgentId ? searchSettings(index, query, 24) : []), [index, openAgentId, query]);
  const groups = useMemo(
    () =>
      paletteGroups({
        query,
        actions,
        agents: agents.map((a) => ({ id: a.id, name: a.name, latest: a.versions[0]?.version ?? null })),
        openAgentId,
        openConfig: openAgent?.draft.config ?? null,
        numbers: numbers ?? [],
        calls: calls ?? [],
        telephony,
        settings,
        recent,
      }),
    [query, actions, agents, openAgentId, openAgent, numbers, calls, telephony, settings, recent],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((item) => ({ group: g.group, item }))), [groups]);

  useEffect(() => setSelected(0), [query]);
  // the chosen result is scrolled into view when the keys move it (not the mouse, which would chase itself)
  const byKeys = useRef(false);
  useEffect(() => {
    if (!byKeys.current) return;
    byKeys.current = false;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (item: PaletteItem) => {
    if (item.kind !== 'setting') {
      const next = rememberPick(recent, searchKey(item));
      setRecent(next);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // a browser that keeps nothing still opens the result
      }
    }
    onClose();
    if (item.href) {
      navigate(item.href);
      return;
    }
    if (item.action === 'create') onOpenCreate?.();
    else if (item.action === 'theme') toggleTheme();
    else if (item.action === 'density') setDensity(density === 'comfortable' ? 'compact' : 'comfortable');
    else if (item.action === 'technical-names') setTechnicalNames(!technicalNames);
    else if (item.action === 'help') window.dispatchEvent(new CustomEvent('open-help-modal'));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = flat.length;
    byKeys.current = ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (n ? (s + 1) % n : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (n ? (s - 1 + n) % n : 0));
    } else if (e.key === 'Home' && !query) {
      e.preventDefault();
      setSelected(0);
    } else if (e.key === 'End' && !query) {
      e.preventDefault();
      setSelected(Math.max(0, n - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[selected]) choose(flat[selected].item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;
  const optionId = (i: number) => `${listId}-option-${i}`;
  let position = -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-16 backdrop-blur-sm sm:pt-24" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-surface shadow-overlay" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="sr-only">
          Search Weave Studio
        </h2>
        <div className="flex items-center border-b border-line px-4">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? optionId(selected) : undefined}
            aria-label="Search pages, agents, settings, numbers and calls"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={openAgentId ? 'Search this agent’s pages and settings, or anything else…' : 'Search pages, agents, actions, numbers and calls…'}
            className="w-full bg-transparent px-3 py-3.5 text-sm text-ink outline-none placeholder:text-muted"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" onClick={onClose} className="hidden rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted hover:text-ink sm:inline-block">
            Esc
          </button>
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto p-2">
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted" role="status">
              <p className="font-medium text-ink">No matches for “{query.trim()}”</p>
              <p className="mt-1">Search by agent name, a page such as Calls, or a setting such as “voice” on an agent’s page.</p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.group} role="group" aria-labelledby={`${listId}-${g.group}`} className="mb-1">
                <p id={`${listId}-${g.group}`} className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {g.group === 'Recent' && <HistoryIcon className="h-3 w-3" aria-hidden />}
                  {g.group}
                </p>
                {g.items.map((item) => {
                  position += 1;
                  const i = position;
                  const active = i === selected;
                  const Icon = iconOf(item);
                  return (
                    <div
                      key={`${g.group}:${searchKey(item)}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={active}
                      data-kind={item.kind}
                      onClick={() => choose(item)}
                      onMouseEnter={() => setSelected(i)}
                      className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors', active ? 'bg-accent-soft' : 'hover:bg-subtle')}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', active ? 'bg-accent/10 text-accent' : 'bg-subtle text-muted')}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className={cn('truncate text-sm font-medium', active ? 'text-accent' : 'text-ink')}>{item.title}</p>
                          {item.description && <p className="truncate text-xs text-muted">{item.description}</p>}
                        </div>
                      </div>
                      {active && <CornerDownLeftIcon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-canvas/60 px-4 py-2 text-[12px] text-muted">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono font-semibold">↑↓</kbd> to move
            </span>
            <span>
              <kbd className="font-mono font-semibold">↵</kbd> to open
            </span>
            <span>
              <kbd className="font-mono font-semibold">{shortcutLabel('K')}</kbd> to close
            </span>
          </div>
          <span>Recent picks are kept in this browser</span>
        </div>
      </div>
    </div>
  );
}
