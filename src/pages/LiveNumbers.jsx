import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { DialogField, TelephonyDialog, TelephonyTablePanel } from './telephonyParts.jsx';
import Icon from '../ui/Icon.jsx';
import {
  answeredBy,
  checkWords,
  createBody,
  environmentWord,
  normalizeCheck,
  normalizeNumberSettings,
  normalizeNumbers,
  notSupported,
  numberProblem,
  numbersProblem,
  optionWords,
  parseMaxDuration,
  patchBody,
  statusWords,
} from './numbersModel.js';

// The real phone numbers of the platform (FRONTEND_GUIDE 10.5): the list (ours, and the ones set up by hand, read-only), a form that checks a number as it is
// typed, and changing or releasing one of ours. Reading is always safe. Creating, changing and releasing change the phone system, so each is sent only when a
// person confirms it. If the server has no numbers feature, the page returns to the local preview instead of showing an empty list.

// Loads the settings and the list once; `mode` is 'loading' | 'live' | 'preview' (this server cannot do numbers, or could not be asked).
export function useLiveNumbers(enabled) {
  const [state, setState] = useState({ mode: 'loading', rows: [], settings: null, error: null, reloadError: null });
  const run = useRef(0);
  const load = useCallback(async () => {
    const mine = (run.current += 1);
    try {
      const [settings, rows] = await Promise.all([api.numberSettings(), api.listNumbers()]);
      if (mine === run.current)
        setState({ mode: 'live', rows: normalizeNumbers(rows), settings: normalizeNumberSettings(settings), error: null, reloadError: null });
    } catch (error) {
      if (mine !== run.current) return;
      setState((old) =>
        old.mode === 'live' && !notSupported(error)
          ? { ...old, reloadError: error }
          : { mode: 'preview', rows: [], settings: null, error: notSupported(error) ? null : error },
      );
    }
  }, []);
  useEffect(() => {
    if (enabled) load();
    return () => {
      run.current += 1;
    };
  }, [enabled, load]);
  return { ...state, reload: load };
}

const PILL = { good: 'telephonyPill good', wait: 'telephonyPill wait', bad: 'telephonyPill bad', muted: 'telephonyPill' };

function useBotNames(agents) {
  return useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name || a.id])), [agents]);
}

export function LiveNumbersPage({ live, agents }) {
  const names = useBotNames(agents);
  const [dialog, setDialog] = useState(null); // { kind: 'add' } | { kind: 'edit', row }
  const [notice, setNotice] = useState(null); // { tone, text }
  const rows = live.rows.map((row) => {
    const status = statusWords(row);
    return {
      id: row.number,
      readOnly: !row.managed,
      row,
      searchText: `${row.number} ${row.bot} ${names[row.bot] || ''} ${row.environment} ${status.label} ${row.trunk?.name || ''}`,
      cells: [
        row.number,
        row.managed ? names[row.bot] || row.bot || '—' : row.rule?.agents.join(', ') || row.trunk?.name || 'Set up by hand',
        row.managed ? environmentWord(row.environment) : '—',
        <span key="s" className={PILL[status.tone]} title={status.words}>
          {status.label}
        </span>,
        <span key="d">
          {row.managed && row.problems.length > 0 ? 'A call to this number would not be answered yet.' : answeredBy(row, names[row.bot])}
          {optionWords(row) && <small className="telephonyCellNote">{optionWords(row)}</small>}
          {row.managed && row.routing === 'no_calls_yet' && row.routingNote && (
            <small className="telephonyCellNote warn" data-note="routing">
              {row.routingNote}
            </small>
          )}
          {row.managed && row.problems.length > 0 && (
            <small className="telephonyCellNote warn" data-note="problem">
              {row.problems.join(' ')}
            </small>
          )}
        </span>,
      ],
    };
  });
  const release = async (number) => {
    const row = live.rows.find((r) => r.number === number);
    if (!row) return;
    try {
      await api.releaseNumber(row.bot, row.number);
      await live.reload();
      setNotice({ tone: 'good', text: `${row.number} was released. Calls to it are no longer sent to ${names[row.bot] || row.bot}.` });
    } catch (error) {
      setNotice({ tone: 'bad', text: numbersProblem(error) });
    }
  };
  const mine = live.rows.filter((r) => r.managed).length;
  return (
    <>
      <section className="telephonyPageHeader">
        <div>
          <h2>Phone numbers</h2>
          <p>
            The numbers callers dial to reach your agents. A number belongs to an agent and an environment, so a call is answered by whatever version is
            deployed there.
          </p>
        </div>
        <button
          className="primaryCta compactCta"
          type="button"
          onClick={() => setDialog({ kind: 'add' })}
          disabled={!agents.length}
          title={agents.length ? undefined : 'Create an agent first'}
        >
          <Icon name="plus" size={14} /> Add a number
        </button>
      </section>
      {live.settings && !live.settings.livekitConfigured && (
        <p className="telephonyCallout" role="alert">
          This server has no phone-system (LiveKit) credentials, so numbers can be seen but not set up from here yet.
        </p>
      )}
      {live.reloadError && (
        <p className="telephonyNotice bad" role="alert">
          The list could not be refreshed ({numbersProblem(live.reloadError)}), so it may be out of date.{' '}
          <button type="button" className="stLink" onClick={live.reload}>
            Try again
          </button>
        </p>
      )}
      {notice && (
        <p className={`telephonyNotice ${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}
      <TelephonyTablePanel
        title="Phone numbers"
        columns={['NUMBER', 'AGENT', 'ENVIRONMENT', 'STATUS', 'WHAT HAPPENS']}
        rows={rows}
        itemLabel="phone number"
        deleteLabel="Release"
        monoFirst
        emptyTitle="No phone numbers yet"
        emptyText="Add the number your callers will dial. The server checks it is free and sets it up."
        emptyAction={agents.length ? { label: 'Add a number', onClick: () => setDialog({ kind: 'add' }) } : null}
        onEdit={(number) => setDialog({ kind: 'edit', row: live.rows.find((r) => r.number === number) })}
        onDelete={release}
        confirmDelete={(row) =>
          `Release ${row.id}? Calls to it will no longer be answered by ${names[live.rows.find((r) => r.number === row.id)?.bot] || 'this agent'}. This removes the trunk and dispatch rule this builder made for it, and can’t be undone.`
        }
      />
      <p className="telephonyDialogNote">
        {mine} of {live.rows.length} {live.rows.length === 1 ? 'number was' : 'numbers were'} set up here. The others were set up on the phone system by hand:
        they are shown so a number is not used twice, and can’t be changed from this page.
      </p>
      {dialog?.kind === 'add' && (
        <NumberDialog
          agents={agents}
          settings={live.settings}
          onClose={() => setDialog(null)}
          onDone={async (text) => {
            setDialog(null);
            await live.reload();
            setNotice({ tone: 'good', text });
          }}
        />
      )}
      {dialog?.kind === 'edit' && dialog.row && (
        <NumberDialog
          existing={dialog.row}
          agents={agents}
          settings={live.settings}
          onClose={() => setDialog(null)}
          onDone={async (text) => {
            setDialog(null);
            await live.reload();
            setNotice({ tone: 'good', text });
          }}
        />
      )}
    </>
  );
}

// Add a number, or change one of ours. The number is checked as it is typed.
function NumberDialog({ existing = null, agents, settings, onClose, onDone }) {
  const defaults = settings?.defaults || { recordAudio: true, krisp: false, allowedAddresses: [] };
  const environments = settings?.environments || ['development', 'staging', 'production'];
  const [form, setForm] = useState(() => ({
    number: existing?.number || '',
    bot: existing?.bot || agents[0]?.id || '',
    environment: existing?.environment || environments[0],
    recordAudio: existing?.options.recordAudio ?? defaults.recordAudio,
    krisp: existing?.options.krisp ?? defaults.krisp,
    allowedAddresses: (existing?.options.allowedAddresses || defaults.allowedAddresses).join(', '),
    maxMinutes: existing?.options.maxCallDurationS ? String(Math.round((existing.options.maxCallDurationS / 60) * 100) / 100) : '',
  }));
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const set = (patch) => setForm((old) => ({ ...old, ...patch }));
  const typed = form.number.trim();
  const shapeProblem = existing ? '' : numberProblem(typed, settings?.pattern);
  const max = parseMaxDuration(form.maxMinutes);

  // check the number as it is typed, a moment after the last key
  useEffect(() => {
    if (existing || !typed || shapeProblem) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const raw = await api.checkNumber(typed, { signal: controller.signal });
        if (!controller.signal.aborted) setCheck({ number: typed, ...normalizeCheck(raw) });
      } catch (error) {
        if (error?.name !== 'AbortError' && !controller.signal.aborted)
          setCheck({ number: typed, status: 'error', reason: numbersProblem(error), who: '', trunk: '', warnings: [] });
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [typed, shapeProblem, existing]);

  const current = !existing && check && check.number === typed ? check : null;
  const words = current ? (current.status === 'error' ? { tone: 'bad', words: current.reason } : checkWords(current)) : null;
  const blocked = existing ? false : !typed || !!shapeProblem || (current ? current.status !== 'free' : true);

  const submit = async () => {
    setSubmitted(true);
    setProblem('');
    if (blocked) {
      setProblem(
        !typed
          ? 'Type the number first.'
          : shapeProblem || (!current ? 'One moment: the number is still being checked.' : words?.words || 'This number cannot be used.'),
      );
      return;
    }
    if (max.error) {
      setProblem(`Longest call: ${max.error}`);
      return;
    }
    if (!form.bot) return;
    setSending(true);
    try {
      if (existing) {
        const body = patchBody(existing, form);
        if (!Object.keys(body).length) {
          onDone(`${existing.number} is unchanged.`);
          return;
        }
        await api.changeNumber(existing.bot, existing.number, body);
        onDone(`${existing.number} was updated.`);
      } else {
        await api.createNumber(form.bot, createBody(form, defaults));
        onDone(
          `${typed} was set up for ${agents.find((a) => a.id === form.bot)?.name || form.bot} in ${environmentWord(form.environment)}. The list says whether a call to it would be answered.`,
        );
      }
    } catch (error) {
      setProblem(numbersProblem(error));
      setSending(false);
    }
  };

  return (
    <TelephonyDialog
      live
      eyebrow="PHONE NUMBER"
      title={existing ? `Change ${existing.number}` : 'Add a phone number'}
      subtitle={existing ? 'Only what you change is sent.' : 'Type the number your callers will dial. The server checks it is free, then sets it up.'}
      onClose={sending ? () => {} : onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="modalCreate" disabled={sending}>
            {sending ? 'Working…' : existing ? 'Save changes' : 'Set up this number'}
          </button>
        </>
      }
    >
      {!existing && (
        <DialogField label="Number" hint={settings?.pattern ? 'Digits, with an optional + at the start.' : ''} error={shapeProblem}>
          <input
            autoFocus
            inputMode="tel"
            value={form.number}
            onChange={(event) => set({ number: event.target.value })}
            placeholder="+6563001234"
            aria-label="Number"
          />
        </DialogField>
      )}
      {!existing && typed && !shapeProblem && (
        <p className={`telephonyCheck ${words?.tone || 'muted'}`} role="status" aria-live="polite" data-check={current?.status || (checking ? 'checking' : '')}>
          {checking && !current ? 'Checking…' : words?.words || ''}
          {current?.warnings.map((w) => (
            <small key={w} className="telephonyCellNote warn">
              {w}
            </small>
          ))}
        </p>
      )}
      <div className="telephonyFieldRow">
        <DialogField label="Agent" hint={existing ? 'A number stays with the agent it was set up for.' : ''}>
          <select value={form.bot} onChange={(event) => set({ bot: event.target.value })} disabled={!!existing} aria-label="Agent">
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogField label="Environment" hint="A call is answered by the version deployed to this environment.">
          <select value={form.environment} onChange={(event) => set({ environment: event.target.value })} aria-label="Environment">
            {environments.map((env) => (
              <option key={env} value={env}>
                {environmentWord(env)}
              </option>
            ))}
          </select>
        </DialogField>
      </div>
      <details className="telephonyAdvanced">
        <summary>Advanced</summary>
        <label className="telephonyCheckbox">
          <input type="checkbox" checked={!!form.recordAudio} onChange={(event) => set({ recordAudio: event.target.checked })} /> Record the call audio
        </label>
        <small className="telephonyFieldHint">
          {form.recordAudio
            ? `${settings?.recording?.format ? `The audio of the whole call is saved (${settings.recording.format}).` : 'The audio of the whole call is saved.'} This is a recording of callers: tell them, for example in the greeting.`
            : 'The audio of calls is not saved.'}
        </small>
        <label className="telephonyCheckbox">
          <input type="checkbox" checked={!!form.krisp} onChange={(event) => set({ krisp: event.target.checked })} /> Filter background noise
        </label>
        <DialogField label="Longest call (minutes)" hint="Leave empty for no limit. Between half a minute and 24 hours." error={submitted && max.error}>
          <input
            inputMode="decimal"
            value={form.maxMinutes}
            onChange={(event) => set({ maxMinutes: event.target.value })}
            placeholder="30"
            aria-label="Longest call (minutes)"
          />
        </DialogField>
        <DialogField
          label="Only accept calls from these addresses"
          hint="IP addresses or networks, separated by commas. Leave empty to accept any address, as the older numbers do."
        >
          <input
            value={form.allowedAddresses}
            onChange={(event) => set({ allowedAddresses: event.target.value })}
            placeholder="203.0.113.7, 10.0.0.0/8"
            aria-label="Allowed addresses"
          />
        </DialogField>
      </details>
      {problem && (
        <p className="telephonyFieldError" role="alert">
          {problem}
        </p>
      )}
      <p className="telephonyDialogNote">
        Setting up a number creates a trunk and a dispatch rule on the phone system. It does not make the number ring: whoever runs the phone system must also
        route it to the platform.
      </p>
    </TelephonyDialog>
  );
}
