import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AudioLinesIcon,
  KeyRoundIcon,
  PhoneIcon,
  PlugIcon,
  RefreshCwIcon,
  ServerIcon,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { NumbersPanel } from '../components/library/NumbersPanel';
import { VoicesPanel } from '../components/library/VoicesPanel';
import { IntegrationsPanel } from '../components/library/IntegrationsPanel';
import { VOICE_CATALOG } from '../data/voiceCatalog';
import { INTEGRATIONS_CATALOG } from '../data/integrationsCatalog';
import { useProviders, useSecretKeys } from '../hooks/useProviders';
import { cn, pageClass } from '../utils/styles';
import { currentSearchParams } from '../utils/searchParams';

type Tab = 'voices' | 'providers' | 'integrations' | 'numbers';
const TABS: Tab[] = ['voices', 'providers', 'integrations', 'numbers'];

const STAGE_WORDS: Record<string, string> = { stt: 'Speech to text', tts: 'Text to speech', llm: 'Language model', realtime: 'Realtime voice' };

/** A coloured dot and a few words: the status style used across the Library cards. */
function Dot({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-soft">
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone)} />
      {children}
    </span>
  );
}

export function Library() {
  // The tab is in the address (?tab=numbers), so a link can open it.
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'voices';
  const setTab = (next: Tab) => {
    const p = currentSearchParams();
    if (next === 'voices') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  // GET /providers, shared with the pickers in Build (and the secret checks below)
  const secretKeys = useSecretKeys();
  const { answer: providersAnswer, error: providersError, loading: loadingProviders, reload: loadProviders } = useProviders();
  const providers = useMemo(() => providersAnswer?.providers ?? [], [providersAnswer]);

  const installedCount = providers.filter((p) => p.installed).length;
  const keysSet = providers.filter((p) => p.default_secret && p.key_available).length;
  const keysNeeded = providers.filter((p) => p.default_secret).length;

  const tabs: { id: Tab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'voices', label: 'Voices', icon: AudioLinesIcon, count: VOICE_CATALOG.length },
    { id: 'providers', label: 'Providers', icon: ServerIcon, count: providersAnswer ? providers.length : undefined },
    { id: 'integrations', label: 'Integrations', icon: PlugIcon, count: INTEGRATIONS_CATALOG.length },
    { id: 'numbers', label: 'Phone numbers', icon: PhoneIcon },
  ];

  return (
    <div className={pageClass}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Library</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Voices, model providers, systems your tools can call, and phone numbers. Shared by every agent.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="-mx-4 mt-6 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div role="group" aria-label="Library section" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
          {tabs.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', active && 'text-accent')} aria-hidden />
                {t.label}
                {t.count !== undefined && (
                  <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', active ? 'bg-accent-soft text-accent' : 'bg-surface/70 text-muted')}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* =========================================================================
          TAB 1: VOICES (recorded samples, used by, favourites, use in an agent)
      ========================================================================= */}
      {tab === 'voices' && <VoicesPanel providers={providers} />}

      {/* =========================================================================
          TAB 2: RUNTIME PROVIDERS (LIVE GET /providers)
      ========================================================================= */}
      {tab === 'providers' && (
        <div className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-2xl text-[13px] text-muted">
              What the server reports from <code className="font-mono text-xs">GET /providers</code>.{providersAnswer?.note ? ` ${providersAnswer.note}` : ''}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void loadProviders()} disabled={loadingProviders}>
              <RefreshCwIcon className={cn('h-3.5 w-3.5', loadingProviders && 'animate-spin')} aria-hidden />
              Refresh
            </Button>
          </div>

          {providersError && (
            <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
              Could not load the providers: {providersError}
            </div>
          )}

          {providersAnswer && (
            <dl className="mt-4 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface">
              {[
                { label: 'Providers', value: providers.length },
                { label: 'Plugins installed', value: installedCount },
                { label: 'Keys set', value: `${keysSet} of ${keysNeeded}` },
              ].map((s) => (
                <div key={s.label} className="px-4 py-3">
                  <dt className="text-xs text-muted">{s.label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy={loadingProviders}>
            {loadingProviders && !providersAnswer && [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl border border-line bg-subtle/50" aria-hidden />)}
            {providers.map((p) => {
              const hasKey = !!p.key_available;
              const needsKey = !!p.default_secret;
              return (
                <div key={p.name} className={cn('flex flex-col rounded-xl border border-line bg-surface p-4', !p.installed && 'bg-canvas/60')}>
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold uppercase',
                        p.installed ? 'bg-accent-soft text-accent' : 'bg-subtle text-muted'
                      )}
                      aria-hidden
                    >
                      {p.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold capitalize text-ink">{p.name}</h3>
                      <p className="truncate font-mono text-[11px] text-muted" title={p.plugin || undefined}>{p.plugin || 'built in'}</p>
                    </div>
                  </div>

                  <div className="mb-4 mt-3 flex flex-wrap gap-1">
                    {p.stages.map((s) => (
                      <span key={s} className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-soft">
                        {STAGE_WORDS[s.toLowerCase()] ?? s}
                      </span>
                    ))}
                  </div>

                  <div className="mt-auto space-y-1.5 border-t border-line/60 pt-3">
                    <Dot tone={p.installed ? 'bg-success' : 'bg-line-strong'}>{p.installed ? 'Plugin installed' : 'Plugin not installed'}</Dot>
                    <div className="flex items-center justify-between gap-2">
                      <Dot tone={!needsKey ? 'bg-line-strong' : hasKey ? 'bg-success' : 'bg-warning'}>
                        {!needsKey ? 'No key needed' : hasKey ? 'Key set' : 'Key missing'}
                      </Dot>
                      {needsKey && (
                        <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted" title={p.default_secret ?? undefined}>
                          <KeyRoundIcon className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{p.default_secret}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: INTEGRATIONS (add one to an agent as a draft connection)
      ========================================================================= */}
      {tab === 'integrations' && <IntegrationsPanel secretKeys={secretKeys} />}

      {tab === 'numbers' && <NumbersPanel />}
    </div>
  );
}
