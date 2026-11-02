import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon, PhoneCallIcon, PhoneOffIcon, PlusIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { StatusChip, type ChipTone } from '../ui/StatusChip';
import { ConfirmHost } from '../manage/ConfirmHost';
import { api } from '../../api/client';
import { useStudio } from '../../contexts/StudioContext';
import { useAuth } from '../../contexts/AuthContext';
import { currentDeployments } from '../../utils/agentStatus';
import { askConfirm } from '../../models/manageConfirm';
import {
  answeredBy,
  changeWords,
  checkWords,
  createBody,
  environmentOption,
  environmentWord,
  formOf,
  hasPhoneChannel,
  lastCallWords,
  noPhoneSystem,
  normalizeCheck,
  normalizeNumberSettings,
  normalizeNumbers,
  notSupported,
  numberProblem,
  numbersProblem,
  optionWords,
  parseMaxDuration,
  patchBody,
  setUpWords,
  setupWarnings,
  statusWords,
  supportDetails,
  type CheckView,
  type NumberForm,
  type NumberRow,
  type NumberSettingsView,
  type Tone
} from '../../models/numbers';
import { cn, inputClass, inputErrorClass } from '../../utils/styles';

// How often the list is read again while it is on screen, so "Waiting for calls" turns to "Ready" after the first call.
const REFRESH_MS = 30_000;
const ADMIN_NOTE = 'This changes the phone system. There are no roles on the server yet, so treat it as an administrator’s job.';
const TONE: Record<Tone, ChipTone> = { good: 'success', wait: 'info', bad: 'warning', muted: 'neutral' };

type Mode = 'loading' | 'live' | 'unavailable' | 'unsupported' | 'error';

/** The settings and numbers, read again every half minute and when the window comes back. */
function useNumbers() {
  const [state, setState] = useState<{ mode: Mode; rows: NumberRow[]; settings: NumberSettingsView | null; error: string; reloadError: string }>({
    mode: 'loading',
    rows: [],
    settings: null,
    error: '',
    reloadError: ''
  });
  const [loading, setLoading] = useState(false);
  const run = useRef(0);
  const lastRead = useRef(0);
  const load = useCallback(async () => {
    const mine = run.current += 1;
    lastRead.current = Date.now();
    setLoading(true);
    try {
      const [settings, rows] = await Promise.all([api.numberSettings(), api.listNumbers()]);
      if (mine === run.current) setState({ mode: 'live', rows: normalizeNumbers(rows), settings: normalizeNumberSettings(settings), error: '', reloadError: '' });
    } catch (error: unknown) {
      if (mine !== run.current) return;
      setState((old) =>
      old.mode === 'live' && !notSupported(error) && !noPhoneSystem(error) ?
      { ...old, reloadError: numbersProblem(error) } :
      { mode: noPhoneSystem(error) ? 'unavailable' : notSupported(error) ? 'unsupported' : 'error', rows: [], settings: null, error: numbersProblem(error), reloadError: '' }
      );
    } finally {
      if (mine === run.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const fresh = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead.current > 2000) void load();
    };
    const timer = window.setInterval(fresh, REFRESH_MS);
    window.addEventListener('focus', fresh);
    document.addEventListener('visibilitychange', fresh);
    return () => {
      run.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', fresh);
      document.removeEventListener('visibilitychange', fresh);
    };
  }, [load]);
  return { ...state, loading, reload: load };
}

/** The phone numbers the phone system knows: set one up for an agent, change it, release it. */
export function NumbersPanel() {
  const { agents } = useStudio();
  const { can } = useAuth();
  const live = useNumbers();
  const [dialog, setDialog] = useState<{ kind: 'add' } | { kind: 'edit'; row: NumberRow } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);
  const canChange = can('edit') && !!live.settings?.livekitConfigured;

  const release = async (row: NumberRow) => {
    const who = names[row.bot] || row.bot;
    const yes = await askConfirm({
      title: `Release ${row.number}?`,
      body: `Calls to it will no longer be answered by ${who}. This removes the phone line and the routing rule set up for it, and can’t be undone.\n${ADMIN_NOTE}`,
      confirmLabel: 'Release the number',
      tone: 'danger'
    });
    if (!yes) return;
    try {
      await api.releaseNumber(row.bot, row.number);
      await live.reload();
      setNotice({ tone: 'good', text: `${row.number} was released. Calls to it are no longer sent to ${who}.` });
    } catch (error: unknown) {
      setNotice({ tone: 'bad', text: numbersProblem(error) });
    }
  };

  const done = async (text: string) => {
    setDialog(null);
    await live.reload();
    setNotice({ tone: 'good', text });
  };

  if (live.mode === 'unavailable')
    return (
      <div className="mt-6 rounded-xl border border-line bg-surface px-6 py-12 text-center" role="status" data-testid="numbers-unavailable">
        <PhoneOffIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
        <p className="mt-2 text-sm font-medium text-ink">Phone numbers are not available on this server</p>
        <p className="mx-auto mt-1 max-w-lg text-[13px] text-muted">{live.error}</p>
        <Button size="sm" variant="secondary" className="mt-4" onClick={() => void live.reload()}>Check again</Button>
      </div>);

  if (live.mode === 'unsupported')
    return (
      <div className="mt-6 rounded-xl border border-line bg-surface px-6 py-12 text-center" role="status">
        <PhoneOffIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
        <p className="mt-2 text-sm font-medium text-ink">This server can’t manage phone numbers yet</p>
        <p className="mt-1 text-[13px] text-muted">Its Agent Builder API has no numbers endpoints.</p>
      </div>);

  const mine = live.rows.filter((r) => r.managed).length;
  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="max-w-2xl text-[13px] text-muted">
            The numbers callers dial to reach your agents. A number belongs to an agent and an environment, so a call is answered by whatever version is
            deployed there. You give the number; the phone line and the rule that routes it are set up for you.
          </p>
          {live.settings && !live.settings.livekitConfigured &&
          <p className="mt-2 text-xs text-warning" role="alert">This server has no phone-system (LiveKit) credentials, so numbers can be seen but not set up from here yet.</p>
          }
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={() => void live.reload()} disabled={live.loading}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', live.loading && 'animate-spin')} aria-hidden />
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setDialog({ kind: 'add' })}
            disabled={!canChange || agents.length === 0}
            title={!can('edit') ? 'Viewers can’t add numbers' : agents.length === 0 ? 'Create an agent first' : undefined}>
            <PlusIcon className="h-4 w-4" aria-hidden />
            Add a number
          </Button>
        </div>
      </div>

      {live.reloadError &&
      <p role="alert" className="text-[13px] text-warning">
          The list could not be refreshed ({live.reloadError}), so it may be out of date.{' '}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => void live.reload()}>Try again</button>
        </p>
      }
      {notice &&
      <p role="status" className={cn('rounded-lg border px-3 py-2 text-[13px]', notice.tone === 'good' ? 'border-success/30 bg-success-soft/50 text-ink' : 'border-danger/30 bg-danger-soft/50 text-danger')}>
          {notice.text}
        </p>
      }

      {live.mode === 'error' ?
      <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm">
          <p className="text-danger">Could not load the phone numbers: {live.error}</p>
          <Button size="sm" variant="secondary" onClick={() => void live.reload()}>Try again</Button>
        </div> :
      live.mode === 'loading' ?
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-busy="true" aria-label="Loading phone numbers">
          {[0, 1, 2].map((i) =>
        <li key={i} className="flex items-center justify-between gap-3 px-4 py-4">
              <div className="h-4 w-32 animate-pulse rounded bg-subtle" />
              <div className="h-4 w-48 animate-pulse rounded bg-subtle" />
            </li>
        )}
        </ul> :
      live.rows.length === 0 ?
      <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <PhoneCallIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">No phone numbers yet</p>
          <p className="mt-1 text-xs text-muted">Add the number your callers will dial. The server checks it is free and sets it up.</p>
        </div> :

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label="Phone numbers">
          {live.rows.map((row) => <NumberItem key={row.number} row={row} botName={names[row.bot]} canChange={canChange} onEdit={() => setDialog({ kind: 'edit', row })} onRelease={() => void release(row)} />)}
        </ul>
      }

      {live.mode === 'live' &&
      <p className="text-xs text-muted">
          {mine} of {live.rows.length} {live.rows.length === 1 ? 'number was' : 'numbers were'} set up here. The others were set up on the phone system outside
          Studio: they are shown so a number is not used twice, and can’t be changed or released here.
        </p>
      }

      {dialog && live.settings &&
      <NumberDialog existing={dialog.kind === 'edit' ? dialog.row : null} settings={live.settings} onClose={() => setDialog(null)} onDone={done} />
      }
      <ConfirmHost />
    </div>);

}

/** One number: who answers it, its settings, what is left to do, its last call, and details for support. */
function NumberItem({ row, botName, canChange, onEdit, onRelease }: { row: NumberRow; botName?: string; canChange: boolean; onEdit: () => void; onRelease: () => void }) {
  const status = statusWords(row);
  const details = supportDetails(row);
  const last = lastCallWords(row);
  const options = optionWords(row);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5" data-number={row.number}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium text-ink">{row.number}</span>
          <StatusChip tone={TONE[status.tone]} title={status.words} dot>{status.label}</StatusChip>
          {row.managed && row.bot &&
          <span className="text-xs text-muted">
              {botName || row.bot} · {environmentWord(row.environment)}
            </span>
          }
        </div>
        <p className="mt-1 text-[13px] text-ink-soft">{row.managed && row.problems.length > 0 ? 'A call to this number would not be answered yet.' : answeredBy(row, botName)}</p>
        {options && <p className="mt-0.5 text-xs text-muted">{options}</p>}
        {last && <p className="mt-0.5 text-xs text-muted" data-note="last-call">{last}</p>}
        {row.managed && row.routing === 'no_calls_yet' && row.routingNote && <p className="mt-0.5 text-xs text-muted" data-note="routing">{row.routingNote}</p>}
        {row.managed && row.problems.map((p) =>
        <p key={p} className="mt-1 flex items-start gap-1.5 text-xs text-warning" data-note="problem">
            <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {p}
          </p>
        )}
        {details.length > 0 &&
        <details className="mt-1.5 text-xs">
            <summary className="cursor-pointer text-muted hover:text-ink">Details for support</summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {details.map((d) =>
            <div key={d.label} className="contents">
                  <dt className="text-muted">{d.label}</dt>
                  <dd className="font-mono text-ink-soft">{d.value}</dd>
                </div>
            )}
            </dl>
          </details>
        }
      </div>
      {row.managed && row.bot && canChange &&
      <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Change ${row.number}`}>Change…</Button>
          <Button size="sm" variant="ghost" onClick={onRelease} aria-label={`Release ${row.number}`} className="text-danger hover:text-danger">Release…</Button>
        </div>
      }
    </li>);

}

/** What is deployed where for an agent (Studio has the deployments), and whether that version has a phone line on. */
function useDeployedPhone(agentId: string, env: string) {
  const { getAgent, loadVersionConfig } = useStudio();
  const agent = getAgent(agentId);
  const current = useMemo(() => {
    if (!agent) return null;
    return Object.fromEntries(Object.entries(currentDeployments(agent)).map(([e, d]) => [e, { version: d?.version }]));
  }, [agent]);
  const version = current ? current[env]?.version || '' : null;
  const [phones, setPhones] = useState<Record<string, boolean | null>>({});
  const key = `${agentId}@${version}`;
  useEffect(() => {
    if (!version || key in phones) return;
    let gone = false;
    loadVersionConfig(agentId, version).
    then((config) => !gone && setPhones((old) => ({ ...old, [key]: hasPhoneChannel(config) }))).
    catch(() => !gone && setPhones((old) => ({ ...old, [key]: null })));
    return () => {
      gone = true;
    };
  }, [agentId, version, key, phones, loadVersionConfig]);
  return { current, deployed: version, phone: version ? phones[key] ?? null : null };
}

/**
 * Set a number up, or change one of ours. The number is checked as it is typed; before anything is sent the dialog says
 * what will happen, and only what changed is sent (PATCH).
 */
function NumberDialog({ existing, settings, onClose, onDone }: { existing: NumberRow | null; settings: NumberSettingsView; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const { agents } = useStudio();
  const [form, setForm] = useState<NumberForm>(() =>
  existing ?
  formOf(existing, settings.defaults) :
  { number: '', environment: settings.environments[0] ?? 'development', recordAudio: settings.defaults.recordAudio, krisp: settings.defaults.krisp, allowedAddresses: settings.defaults.allowedAddresses.join(', '), maxMinutes: '' }
  );
  const [botId, setBotId] = useState(existing?.bot || agents[0]?.id || '');
  const [check, setCheck] = useState<(CheckView & { number: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState(false);
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);
  const set = (patch: Partial<NumberForm>) => {
    setForm((old) => ({ ...old, ...patch }));
    setReview(false);
  };
  const typed = form.number.trim();
  const shapeProblem = existing ? '' : numberProblem(typed, settings.pattern);
  const max = parseMaxDuration(form.maxMinutes);
  const botName = agents.find((a) => a.id === botId)?.name || botId;
  const where = useDeployedPhone(botId, form.environment);
  // warn about the environment chosen for a new number, or the one an existing number is being moved to
  const warnings = !existing || form.environment !== existing.environment ? setupWarnings({ env: form.environment, deployed: where.deployed, phone: where.phone, botName }) : [];

  // check the number a moment after the last key
  useEffect(() => {
    if (existing || !typed || shapeProblem) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setChecking(true);
      try {
        const raw = await api.checkNumber(typed, { signal: controller.signal });
        if (!controller.signal.aborted) setCheck({ number: typed, ...normalizeCheck(raw) });
      } catch (error: unknown) {
        if (!controller.signal.aborted) setCheck({ number: typed, status: 'error', reason: numbersProblem(error), who: '', trunk: '', warnings: [] });
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [typed, shapeProblem, existing]);

  const checked = !existing && check && check.number === typed ? check : null;
  const words = checked ? checked.status === 'error' ? { tone: 'bad' as Tone, words: checked.reason } : checkWords(checked) : null;
  const body = existing ? patchBody(existing, form) : null;

  // first press: say what will happen; second press (on the review): send it
  const submit = async () => {
    setProblem('');
    if (!existing) {
      if (!typed) return setProblem('Type the number first.');
      if (shapeProblem) return setProblem(shapeProblem);
      if (!checked) return setProblem('One moment: the number is still being checked.');
      if (checked.status !== 'free') return setProblem(words?.words || 'This number can’t be used.');
    }
    if (max.error) return setProblem(`Longest call: ${max.error}`);
    if (existing && body && !Object.keys(body).length) {
      await onDone(`${existing.number} is unchanged.`);
      return;
    }
    if (!review) {
      setReview(true);
      return;
    }
    setSending(true);
    try {
      if (existing && body) {
        await api.changeNumber(existing.bot, existing.number, body as Record<string, unknown>);
        await onDone(`${existing.number} was updated.`);
      } else {
        const result = await api.createNumber(botId, createBody(form, settings.defaults) as { number: string; environment: string });
        await onDone(`${setUpWords(result, { number: typed, botName, env: form.environment })} The list says whether a call to it would be answered.`);
      }
    } catch (error: unknown) {
      setProblem(numbersProblem(error));
      setReview(false);
      setSending(false);
    }
  };

  const answered = where.deployed ? `Calls to it will be answered by version ${where.deployed}, deployed to ${environmentWord(form.environment)} now.` : '';
  const reviewLines = existing && body ? changeWords(body) : [`Set up ${typed} for ${botName}, in ${environmentWord(form.environment)}. ${answered}`.trim(), 'A phone line (trunk) and a routing rule are created on the phone system.'];

  return (
    <Dialog
      open
      onClose={sending ? () => undefined : onClose}
      title={existing ? `Change ${existing.number}` : 'Add a phone number'}
      description={existing ? 'Only what you change is sent.' : 'Type the number your callers will dial. The server checks it is free, then sets up the phone line and the rule that routes it.'}
      footer={
      <>
          {review ?
        <Button variant="ghost" onClick={() => setReview(false)} disabled={sending}>
              <ChevronLeftIcon className="h-4 w-4" aria-hidden />
              Back
            </Button> :

        <Button variant="ghost" onClick={onClose} disabled={sending}>Cancel</Button>
        }
          <Button variant="primary" onClick={() => void submit()} disabled={sending}>
            {sending ? 'Working…' : review ? existing ? 'Save changes' : 'Set up the number' : existing ? 'Review changes…' : 'Set up this number…'}
          </Button>
        </>
      }>
      {review ?
      <div className="space-y-3" data-testid="number-review">
          <p className="text-sm font-medium text-ink">This will:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {reviewLines.map((l) => <li key={l}>{l}</li>)}
          </ul>
          {warnings.length > 0 && <p className="rounded-lg border border-warning/30 bg-warning-soft/50 p-3 text-[13px] text-ink">Before you go on: {warnings.join(' ')}</p>}
          <p className="text-xs text-muted">{ADMIN_NOTE}</p>
          {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
        </div> :

      <div className="space-y-4">
          {!existing &&
        <Field id="number-value" label="Number" help={settings.pattern ? 'Digits, with an optional + at the start.' : undefined} error={shapeProblem || undefined}>
              <input
            id="number-value-input"
            type="tel"
            inputMode="tel"
            className={cn(inputClass, 'font-mono', shapeProblem && inputErrorClass)}
            value={form.number}
            onChange={(e) => set({ number: e.target.value })}
            placeholder="+6563001234"
            aria-describedby="number-check" />
            </Field>
        }
          {!existing && typed && !shapeProblem &&
        <div id="number-check" role="status" aria-live="polite" data-check={checked?.status || (checking ? 'checking' : '')} className={cn('-mt-2 text-xs', words?.tone === 'good' ? 'text-success' : words?.tone === 'bad' ? 'text-warning' : 'text-muted')}>
              {checking && !checked ? 'Checking…' : words?.words || ''}
              {checked?.warnings.map((w) => <span key={w} className="mt-0.5 block text-warning">{w}</span>)}
            </div>
        }
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="number-agent" label="Agent" help={existing ? 'A number stays with the agent it was set up for.' : undefined}>
              <select id="number-agent-input" className={inputClass} value={botId} onChange={(e) => setBotId(e.target.value)} disabled={!!existing}>
                {existing && !agents.some((a) => a.id === existing.bot) && <option value={existing.bot}>{existing.bot}</option>}
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field id="number-env" label="Environment that answers it" help="A call is answered by the version deployed there.">
              <select id="number-env-input" className={inputClass} value={form.environment} onChange={(e) => set({ environment: e.target.value })}>
                {settings.environments.map((env) => <option key={env} value={env}>{environmentOption(env, where.current)}</option>)}
              </select>
            </Field>
          </div>
          {warnings.length > 0 &&
        <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-soft/50 p-3 text-[13px] text-ink" data-note="setup-warning">
              <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              {warnings.join(' ')}
            </p>
        }
          <details className="rounded-lg border border-line px-3 py-2" open={!!existing}>
            <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">Advanced</summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1 accent-[rgb(var(--accent))]" checked={!!form.recordAudio} onChange={(e) => set({ recordAudio: e.target.checked })} />
                <span>
                  Record the call audio
                  <span className="block text-xs text-muted">
                    {form.recordAudio ?
                  `The audio of the whole call is saved${settings.recording.format ? ` (${settings.recording.format})` : ''}. Tell callers, for example in the greeting.` :
                  'The audio of calls is not saved.'}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1 accent-[rgb(var(--accent))]" checked={!!form.krisp} onChange={(e) => set({ krisp: e.target.checked })} />
                <span>
                  Filter background noise
                  <span className="block text-xs text-muted">Noise filtering on the phone line, before the agent hears the caller.</span>
                </span>
              </label>
              <Field id="number-max" label="Longest call (minutes)" help="Leave empty for no limit. Between half a minute and 24 hours." error={max.error || undefined}>
                <input id="number-max-input" inputMode="decimal" className={cn(inputClass, 'w-40', max.error && inputErrorClass)} value={form.maxMinutes} onChange={(e) => set({ maxMinutes: e.target.value })} placeholder="30" />
              </Field>
              <Field id="number-allowed" label="Only accept calls from these addresses" help="IP addresses or networks of your phone system, separated by commas. Leave empty to accept any address.">
                <input id="number-allowed-input" className={cn(inputClass, 'font-mono text-[13px]')} value={form.allowedAddresses} onChange={(e) => set({ allowedAddresses: e.target.value })} spellCheck={false} />
              </Field>
            </div>
          </details>
          {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
          <p className="text-xs text-muted">
            Setting a number up does not make it ring by itself: whoever runs the phone system must also route it to the platform.
          </p>
        </div>
      }
    </Dialog>);

}
