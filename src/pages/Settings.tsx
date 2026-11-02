import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2Icon, CircleHelpIcon, CircleAlertIcon, LandmarkIcon, RefreshCwIcon, ShieldCheckIcon, UsersIcon, XCircleIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStudio } from '../contexts/StudioContext';
import { useTheme } from '../contexts/ThemeContext';
import { Toggle } from '../components/ui/Toggle';
import { Segmented } from '../components/ui/Segmented';
import { StatusChip } from '../components/ui/StatusChip';
import { Button } from '../components/ui/Button';
import { gateway } from '../api/gateway';
import { api, API_BASE } from '../api/client';
import type { TestLogin } from '../api/gatewayTypes';
import { useBankingSource } from '../hooks/useBankingSource';
import { BANKING_DEPLOY_NEEDS, bankingStatus } from '../models/bankingStatus';
import { BankingSourceNotice } from '../components/banking/BankingSourceNotice';
import { useApiHealth } from '../hooks/useApiHealth';
import { runningText, runningWhere } from '../models/runningWhere';
import { cn, pageClass } from '../utils/styles';
import { AppearanceSection } from '../components/theme/AppearanceSection';
import { DataSourceCard } from '../sandbox/DataSourceCard';
import { isSandbox } from '../sandbox/mode';
import { SystemHealthIndicator } from '../components/ui/SystemHealthIndicator';
import { envLabel, environments } from '../utils/agentStatus';
import type { EnvironmentName } from '../types/studio';

// Settings, one section after another. Each section is its own block below, marked with a "---- Section" comment, so
// a new one (Appearance, say) is added between two of them without touching the others.

const roleText = {
  admin: 'Can edit, publish and deploy anywhere, including Production.',
  editor: 'Can edit, publish and deploy to Development and Staging.',
  viewer: 'Can look at agents and calls. Can’t change anything.'
} as const;

/**
 * How many agents are removed from the agent list on this browser. The agent list's "Remove from my list" keeps them;
 * when it exists, pass its count here (null shows nothing).
 */
function useRemovedAgentsCount(): number | null {
  return null;
}

export function Settings() {
  const { user } = useAuth();
  const { technicalNames, setTechnicalNames } = useStudio();
  const { theme, setTheme, density, setDensity } = useTheme();
  if (!user) return null;

  return (
    <div className={cn(pageClass, '[&>*]:max-w-3xl')}>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>

      {/* ---- Section: your account ---- */}
      <section aria-labelledby="profile" className="mt-8 border-b border-line pb-8">
        <h2 id="profile" className="text-sm font-semibold text-ink">Your account</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-[160px_1fr]">
          <dt className="text-sm text-muted">Name</dt>
          <dd className="text-sm text-ink">{user.name}</dd>
          <dt className="text-sm text-muted">Email</dt>
          <dd className="text-sm text-ink">{user.email}</dd>
          <dt className="text-sm text-muted">Workspace</dt>
          <dd className="text-sm text-ink">{user.workspaceName || <span className="text-muted">Not named yet</span>}</dd>
          <dt className="text-sm text-muted">Role</dt>
          <dd className="text-sm text-ink">
            <span className="font-medium capitalize">{user.role}</span> — {roleText[user.role]}
            <p className="mt-0.5 text-xs text-muted">Set by your company identity provider. Ask IT to change it.</p>
          </dd>
        </dl>
      </section>

      {/* ---- Section: interface (theme, density, technical names) ---- */}
      <section aria-labelledby="interface" className="mt-8 border-b border-line pb-8">
        <h2 id="interface" className="text-sm font-semibold text-ink">Interface</h2>
        <div className="mt-4 space-y-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-ink">Theme</p>
              <p className="text-[13px] text-muted">Select light mode, dark mode, or follow your system appearance.</p>
            </div>
            <Segmented
              label="Theme mode"
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
              value={theme}
              onChange={(v) => setTheme(v as any)}
            />
          </div>

          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-ink">Display density</p>
              <p className="text-[13px] text-muted">Compact density fits more information on screen by tightening spacing and table rows.</p>
            </div>
            <Segmented
              label="Density"
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
              value={density}
              onChange={(v) => setDensity(v as any)}
            />
          </div>

          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-ink">Technical names</p>
              <p className="text-[13px] text-muted">Show configuration keys like <code className="font-mono">persona.company</code> instead of plain labels in the Detailed view.</p>
            </div>
            <Toggle checked={technicalNames} onChange={setTechnicalNames} label="Technical names" />
          </div>
        </div>
      </section>

      {/* ---- Section: appearance (style and colour) ---- */}
      <AppearanceSection />

      {/* ---- Section: what is running where ---- */}
      <RunningWhereSection />

      {/* ---- Section: data source (Live or Sandbox) ---- */}
      <DataSourceCard />

      {/* ---- Section: the environment the person is working in ---- */}
      <WorkingEnvironmentSection />

      {/* ---- Section: connection to the Agent Builder API ---- */}
      <ApiConnectionSection />

      {/* ---- Section: banking gateway ---- */}
      <BankingGatewaySection />

      {/* ---- Section: about your session ---- */}
      <section aria-labelledby="security" className="mt-8">
        <h2 id="security" className="text-sm font-semibold text-ink">About your session</h2>
        <ul className="mt-4 space-y-2.5">
          {[
          'This is a temporary sign-in: your email or phone is sent to the API as your name, and no password is checked yet.',
          'API keys and secrets live only on the server-side gateway, never in your browser.',
          'Roles are not enforced by the server yet; until real sign-in arrives, everyone signed in here can edit, publish and deploy.',
          'Transcripts and prompts are always shown as plain text.'].
          map((t) =>
          <li key={t} className="flex gap-2.5 text-sm text-ink-soft">
              <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              {t}
            </li>
          )}
        </ul>
        <p className="mt-6 flex items-center gap-2 text-[13px] text-muted">
          <UsersIcon className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Who works here, and on which agents, is on the{' '}
            <Link to="/team" className="font-medium text-accent hover:underline">
              Team page
            </Link>{' '}
            (kept in this browser for now).
          </span>
        </p>
      </section>
    </div>);

}

/** Each environment the server has (GET /environments), with the agents deployed there and their versions. */
function RunningWhereSection() {
  const { agents, loading } = useStudio();
  const removed = useRemovedAgentsCount();
  const [envs, setEnvs] = useState<string[] | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [envLoading, setEnvLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    api
      .environments({ signal: controller.signal })
      .then((list) => {
        setEnvs(Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : []);
        setEnvError(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setEnvError(e instanceof Error ? e.message : 'The list of environments could not be read.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setEnvLoading(false);
      });
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => runningWhere(envs, agents), [envs, agents]);

  return (
    <section aria-labelledby="running-where" className="mt-8 border-b border-line pb-8">
      <h2 id="running-where" className="text-sm font-semibold text-ink">What is running where</h2>
      <p className="mt-1 text-[13px] text-muted">You choose this per agent, under its Release page. Read from the server now.</p>
      {envLoading || loading ? (
        <div className="mt-4 space-y-2" aria-busy="true" aria-label="Reading environments">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-subtle" />
          ))}
        </div>
      ) : (
        <>
          {envError && (
            <p className="mt-3 text-[13px] text-warning" role="status">
              The list of environments could not be read ({envError}). Shown: the environments your agents are deployed to.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No environments to show yet.</p>
          ) : (
            <dl className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface" data-testid="running-where">
              {rows.map((row) => (
                <div key={row.env} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[160px_1fr]">
                  <dt className="font-medium text-ink">{row.label}</dt>
                  <dd className={cn(row.agents.length ? 'text-ink-soft' : 'text-muted')}>
                    {row.agents.length === 0
                      ? runningText(row)
                      : row.agents.slice(0, 3).map((a, i) => (
                          <React.Fragment key={a.id}>
                            {i > 0 && ', '}
                            <Link to={`/agents/${encodeURIComponent(a.id)}/release`} className="text-ink hover:underline">
                              {a.name}
                            </Link>{' '}
                            <span className="font-mono text-xs">{a.version}</span>
                          </React.Fragment>
                        ))}
                    {row.agents.length > 3 && ` and ${row.agents.length - 3} more`}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
      {removed !== null && (
        <p className="mt-3 text-[13px] text-muted">
          {removed > 0 ? (
            <>
              {removed} agent{removed === 1 ? ' is' : 's are'} removed from your list on this browser.{' '}
              <Link to="/agents" className="font-medium text-accent hover:underline">
                Manage them on the Agents page
              </Link>
              .
            </>
          ) : (
            'Nothing is removed from your list.'
          )}
        </p>
      )}
    </section>
  );
}

/** Whether the Agent Builder API answers, the same answer as the top bar's indicator, with a way to ask again. */
function ApiConnectionSection() {
  const { check, checking, recheck } = useApiHealth();
  const Icon = check.state === 'healthy' ? CheckCircle2Icon : check.state === 'degraded' ? CircleAlertIcon : check.state === 'down' ? XCircleIcon : CircleHelpIcon;
  const tone = check.state === 'healthy' ? 'text-success' : check.state === 'degraded' ? 'text-warning' : check.state === 'down' ? 'text-danger' : 'text-muted';
  // Sandbox asks no server: its answers come from the imitation kept in this browser
  const sandbox = isSandbox();
  const title = sandbox
    ? 'Sandbox, no server'
    : check.state === 'healthy'
      ? `Connected · ${check.latencyMs} ms`
      : check.state === 'degraded'
        ? 'Answers, with a problem'
        : check.state === 'down'
          ? 'Not reachable'
          : checking
            ? 'Checking…'
            : 'Not checked yet';
  const note = sandbox
    ? 'Nothing here talks to the Agent Builder API: Sandbox answers in this browser. Switch to Live under Data source to use the server.'
    : check.state === 'healthy'
      ? 'Agents, drafts, versions and deployments are read from and saved to the server. This does not check the worker or provider keys.'
      : check.state === 'unknown'
        ? 'The studio asks the API every minute, and every 15 seconds while it does not answer.'
        : check.detail;

  return (
    <section aria-labelledby="api-connection" className="mt-8 border-b border-line pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="api-connection" className="text-sm font-semibold text-ink">Agent Builder API</h2>
        {/* every check, voice (LiveKit) included, in one dialog */}
        {!sandbox && <SystemHealthIndicator />}
      </div>
      <div className="mt-4 flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface p-4" role="status" aria-live="polite">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink" data-testid="api-state">{title}</p>
          <p className="mt-0.5 break-words text-xs text-ink-soft">{note}</p>
          <p className="mt-1 font-mono text-[11px] text-muted">GET {API_BASE}/health</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void recheck()} disabled={checking}>
          <RefreshCwIcon className={cn('h-3.5 w-3.5', checking && 'animate-spin')} aria-hidden />
          Check again
        </Button>
      </div>
    </section>
  );
}

const ENVIRONMENT_NOTE: Record<EnvironmentName, string> = {
  development: 'Where agents are built and tried. Nothing here reaches real callers.',
  staging: 'A rehearsal of Production, for checks before going live.',
  production: 'Real callers. While you work here, a red bar on every page reminds you that a deploy reaches them at once.',
};

/** Which environment the person is working in (it was a pill in the top bar). Production puts a warning on every page. */
function WorkingEnvironmentSection() {
  const { activeEnvironment, setActiveEnvironment } = useStudio();
  return (
    <section id="working-environment" aria-labelledby="working-environment-title" className="mt-8 scroll-mt-20 border-b border-line pb-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h2 id="working-environment-title" className="text-sm font-semibold text-ink">Working environment</h2>
          <p className="mt-1 text-[13px] text-muted">{ENVIRONMENT_NOTE[activeEnvironment]}</p>
        </div>
        <Segmented
          label="Working environment"
          options={environments.map((env) => ({ value: env, label: envLabel(env) }))}
          value={activeEnvironment}
          onChange={(v) => setActiveEnvironment(v as EnvironmentName)}
        />
      </div>
    </section>
  );
}

/**
 * The banking gateway, as it is for this page (bankingSource): the bank's real systems, or the mock bank's test data
 * (Sandbox, and Live without a gateway on real systems), said plainly; and the test logins the mock bank documents,
 * which Studio's own test sessions use in either mode (rehearsalSource).
 */
function BankingGatewaySection() {
  const source = useBankingSource();
  const status = source ? bankingStatus(source) : null;
  const sourceKnown = !!source;
  const [logins, setLogins] = useState<TestLogin[] | null>(null);
  const [loginsNote, setLoginsNote] = useState('');
  const [loginsError, setLoginsError] = useState('');

  useEffect(() => {
    if (!sourceKnown) return;
    const controller = new AbortController();
    gateway.rehearsal
      .testLogins(controller.signal)
      .then((answer) => {
        setLogins(answer.logins);
        setLoginsNote(answer.otp_source);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setLoginsError(e instanceof Error ? e.message : 'The test logins could not be read.');
      });
    return () => controller.abort();
  }, [sourceKnown]);

  return (
    <section aria-labelledby="banking-gateway" className="mt-8 border-b border-line pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LandmarkIcon className="h-4 w-4 text-muted" aria-hidden />
          <h2 id="banking-gateway" className="text-sm font-semibold text-ink">Banking gateway</h2>
        </div>
        {status && <StatusChip tone={status.tone}>{status.chip}</StatusChip>}
      </div>
      <p className="mt-1 text-[13px] text-muted">
        Banking agents call the bank’s gateway, which enforces sign-in, entitlements, masked account numbers and confirmations in code. Make any agent a banking agent from its Build › Tools, or create one from the Banking assistant starter.
      </p>
      <BankingSourceNotice source={source} className="mt-3 text-[13px] text-ink" />
      <p className="mt-2 text-[13px] text-ink-soft">To deploy a banking agent: {BANKING_DEPLOY_NEEDS}</p>

      {sourceKnown && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-4 text-[13px]">
          <p className="font-medium text-ink">Test logins</p>
          {logins?.length !== 0 && (
            <p className="text-xs text-muted">
              From the mock bank: test data only, never a real customer. They work in every test session Studio starts on the mock bank; secrets are keyed in on the secure keypad.
            </p>
          )}
          {loginsError ? (
            <p className="mt-2 text-xs text-danger">{loginsError}</p>
          ) : !logins ? (
            <p className="mt-2 text-xs text-muted" role="status">Reading the test logins…</p>
          ) : logins.length === 0 ? (
            // A gateway on the bank's real systems that opens test sessions: no test logins, it says how customers sign in.
            <p className="mt-2 text-xs text-ink">None: Studio’s test sessions run on the bank’s real systems. {loginsNote}</p>
          ) : (
            <dl aria-label="Test logins" className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[minmax(0,200px)_1fr]">
              {logins.map((l) => (
                <React.Fragment key={l.id}>
                  <dt className="text-muted">{l.label}</dt>
                  <dd className="font-mono text-ink">
                    {l.identifier} · {l.secret}
                    {l.otp ? ' · then the SMS one-time password' : ''}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
