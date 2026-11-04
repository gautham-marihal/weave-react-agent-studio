import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { askConfirm } from '../ui/dialogs.js';
import { DialogField, TelephonyDialog, TelephonyTablePanel } from './telephonyParts.jsx';
import Icon from '../ui/Icon.jsx';
import {
  answeredBy,
  changeWords,
  checkWords,
  createBody,
  environmentOption,
  environmentWord,
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
} from './numbersModel.js';
import Button from '../ui/Button.tsx';

// The platform's real phone numbers (FRONTEND_GUIDE 10.5): the list, a form that checks a number as it is typed, and
// changing or releasing ours. Those changes alter the phone system, so each is sent only after the person confirms.
// The same pieces draw the Telephony page (every number) and an agent's Deploy page (its own numbers).

// How often the list is read again while it is on screen, so "Waiting for calls" turns to "Ready" after the first call
const REFRESH_MS = 30000;

// Loads the settings and numbers (all, or one agent's), re-reading every half minute and when the window returns.
// `mode`: 'loading' | 'live' | 'preview' (no numbers feature) | 'unavailable' (no phone-system credentials: 503).
export function useLiveNumbers(enabled, { botId = '' } = {}) {
  const [state, setState] = useState({ mode: 'loading', rows: [], settings: null, error: null, reloadError: null });
  const run = useRef(0);
  const lastRead = useRef(0);
  const load = useCallback(async () => {
    const mine = (run.current += 1);
    lastRead.current = Date.now();
    try {
      const [settings, rows] = await Promise.all([api.numberSettings(), botId ? api.listBotNumbers(botId) : api.listNumbers()]);
      if (mine === run.current)
        setState({ mode: 'live', rows: normalizeNumbers(rows), settings: normalizeNumberSettings(settings), error: null, reloadError: null });
    } catch (error) {
      if (mine !== run.current) return;
      setState((old) =>
        old.mode === 'live' && !notSupported(error) && !noPhoneSystem(error)
          ? { ...old, reloadError: error }
          : {
              mode: noPhoneSystem(error) ? 'unavailable' : 'preview',
              rows: [],
              settings: null,
              error: notSupported(error) || noPhoneSystem(error) ? null : error,
              reloadError: null,
            },
      );
    }
  }, [botId]);
  useEffect(() => {
    if (!enabled) return undefined;
    load();
    // a window coming back into view says "focus" and "visible" together: read once
    const fresh = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead.current > 2000) load();
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
  }, [enabled, load]);
  return { ...state, reload: load };
}

const PILL = { good: 'telephonyPill good', wait: 'telephonyPill wait', bad: 'telephonyPill bad', muted: 'telephonyPill' };

function useBotNames(agents) {
  return useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name || a.id])), [agents]);
}

// Where a call to this number goes, its settings, what is left to do, its last call, and (folded) support details.
function NumberInfo({ row, botName }) {
  const details = supportDetails(row);
  const last = lastCallWords(row);
  return (
    <span className="numberInfo">
      {row.managed && row.problems.length > 0 ? 'A call to this number would not be answered yet.' : answeredBy(row, botName)}
      {optionWords(row) && <small className="telephonyCellNote">{optionWords(row)}</small>}
      {last && (
        <small className="telephonyCellNote" data-note="last-call">
          {last}
        </small>
      )}
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
      {details.length > 0 && (
        <details className="numberDetails">
          <summary>Details for support</summary>
          <dl>
            {details.map((d) => (
              <div key={d.label}>
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </span>
  );
}

const ADMIN_NOTE = 'There are no roles on the server yet, so anyone who can open this page can do this: treat it as an administrator’s job.';

// Release one of ours, once the person has said yes. Resolves to the sentence to show, or null when they said no.
async function releaseNumber(row, botName) {
  const yes = await askConfirm({
    title: `Release ${row.number}?`,
    body: `Calls to it will no longer be answered by ${botName}. This removes the trunk and dispatch rule the builder made for it, and can’t be undone.\n\n${ADMIN_NOTE}`,
    confirmLabel: 'Release the number',
    tone: 'danger',
  });
  if (!yes) return null;
  await api.releaseNumber(row.bot, row.number);
  return `${row.number} was released. Calls to it are no longer sent to ${botName}.`;
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
        row.managed ? names[row.bot] || row.bot || '—' : row.rule?.agents.join(', ') || 'Set up outside the builder',
        row.managed ? environmentWord(row.environment) : '—',
        <span key="s" className={PILL[status.tone]} title={status.words}>
          {status.label}
        </span>,
        <NumberInfo key="d" row={row} botName={names[row.bot]} />,
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
  const done = async (text) => {
    setDialog(null);
    await live.reload();
    setNotice({ tone: 'good', text });
  };
  const mine = live.rows.filter((r) => r.managed).length;
  return (
    <>
      <section className="telephonyPageHeader">
        <div>
          <h2>Phone numbers</h2>
          <p>
            The numbers callers dial to reach your agents. A number belongs to an agent and an environment, so a call is answered by whatever version is
            deployed there. You give the number; the phone line and the rule that routes it are set up for you.
          </p>
        </div>
        <Button
          variant="primary"
          size="compact"
          type="button"
          onClick={() => setDialog({ kind: 'add' })}
          disabled={!agents.length}
          title={agents.length ? undefined : 'Create an agent first'}
        >
          <Icon name="plus" size={14} /> Add a number
        </Button>
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
        confirmDelete={(row) => ({
          title: `Release ${row.id}?`,
          body: `Calls to it will no longer be answered by ${names[live.rows.find((r) => r.number === row.id)?.bot] || 'this agent'}. This removes the trunk and dispatch rule the builder made for it, and can’t be undone.\n\n${ADMIN_NOTE}`,
        })}
      />
      <p className="telephonyDialogNote">
        {mine} of {live.rows.length} {live.rows.length === 1 ? 'number was' : 'numbers were'} set up here. The others were set up outside the builder: they are
        shown so a number is not used twice, and can’t be changed or released from this page. {ADMIN_NOTE}
      </p>
      {dialog?.kind === 'add' && <NumberDialog agents={agents} settings={live.settings} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'edit' && dialog.row && (
        <NumberDialog existing={dialog.row} agents={agents} settings={live.settings} onClose={() => setDialog(null)} onDone={done} />
      )}
    </>
  );
}

// One agent's numbers on its Deploy page; hidden, not empty, when the server has no numbers feature or credentials.
//   live: useLiveNumbers(…, { botId }), read by the page so its environment cards can name their numbers too
//   current: what is deployed where (GET deployments' `current`)
export function AgentNumbers({ live, botId, botName, current }) {
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  if (live.mode !== 'live') return null;
  const agents = [{ id: botId, name: botName }];
  // eslint-disable-next-line sonarjs/no-identical-functions -- the page's three steps, on this card's own dialog and note
  const done = async (text) => {
    setDialog(null);
    await live.reload();
    setNotice({ tone: 'good', text });
  };
  const release = async (row) => {
    try {
      const text = await releaseNumber(row, botName);
      if (!text) return;
      await live.reload();
      setNotice({ tone: 'good', text });
    } catch (error) {
      setNotice({ tone: 'bad', text: numbersProblem(error) });
    }
  };
  return (
    <section className="stCard agentNumbers" aria-labelledby="agentNumbersTitle">
      <header className="agentNumbersHead">
        <div>
          <h3 id="agentNumbersTitle">Phone numbers</h3>
          <p>
            The numbers people dial to reach {botName}. You give the number; the phone line and its routing are set up for you. Each number answers with what is
            live in the place it is added for (testing, final check or customers).
          </p>
        </div>
        <Button type="button" variant="secondary" size="compact" onClick={() => setDialog({ kind: 'add' })}>
          <Icon name="plus" size={14} /> Add a number
        </Button>
      </header>
      {live.settings && !live.settings.livekitConfigured && (
        <p className="telephonyCallout" role="alert">
          This server has no phone-system (LiveKit) credentials, so numbers can be seen but not set up from here yet.
        </p>
      )}
      {live.reloadError && (
        <p className="telephonyNotice bad" role="alert">
          The numbers could not be refreshed ({numbersProblem(live.reloadError)}), so they may be out of date.{' '}
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
      {live.rows.length === 0 ? (
        <p className="agentNumbersEmpty">No number yet. Add one, and callers who dial it reach {botName} (it needs phone calls switched on in what is live).</p>
      ) : (
        <ul className="agentNumbersList">
          {live.rows.map((row) => {
            const status = statusWords(row);
            return (
              <li key={row.number} data-number={row.number}>
                <div className="agentNumbersTop">
                  <code>{row.number}</code>
                  <span className="agentNumbersEnv">{environmentWord(row.environment)}</span>
                  <span className={PILL[status.tone]} title={status.words}>
                    {status.label}
                  </span>
                  {row.managed && (
                    <span className="agentNumbersActions">
                      <Button type="button" size="small" onClick={() => setDialog({ kind: 'edit', row })}>
                        Change…
                      </Button>
                      <Button type="button" size="small" className="dangerText" onClick={() => release(row)}>
                        Release…
                      </Button>
                    </span>
                  )}
                </div>
                <NumberInfo row={row} botName={botName} />
              </li>
            );
          })}
        </ul>
      )}
      {dialog?.kind === 'add' && <NumberDialog agents={agents} settings={live.settings} current={current} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'edit' && (
        <NumberDialog existing={dialog.row} agents={agents} settings={live.settings} current={current} onClose={() => setDialog(null)} onDone={done} />
      )}
    </section>
  );
}

// What is deployed where for an agent, and whether a version has a phone line that is on.
//   given: the deployments when the page already has them (Deploy page); else read for the agent chosen in the form
function useDeployedPhone(botId, env, given) {
  const [read, setRead] = useState({ bot: '', current: null });
  const [phones, setPhones] = useState({}); // "bot@version" -> true | false
  useEffect(() => {
    if (given || !botId) return undefined;
    let gone = false;
    api
      .listDeployments(botId)
      .then((result) => !gone && setRead({ bot: botId, current: result?.current || {} }))
      .catch(() => !gone && setRead({ bot: botId, current: null }));
    return () => {
      gone = true;
    };
  }, [botId, given]);
  const current = given || (read.bot === botId ? read.current : null);
  const version = current ? current[env]?.version || '' : null;
  const key = `${botId}@${version}`;
  useEffect(() => {
    if (!version || key in phones) return undefined;
    let gone = false;
    api
      .getVersion(botId, version)
      .then((record) => !gone && setPhones((old) => ({ ...old, [key]: hasPhoneChannel(record?.config) })))
      .catch(() => !gone && setPhones((old) => ({ ...old, [key]: null })));
    return () => {
      gone = true;
    };
  }, [botId, version, key, phones]);
  return { current, deployed: version, phone: version ? (phones[key] ?? null) : null };
}

// Add a number, or change one of ours. The number is checked as typed, and the person confirms what will happen first.
function NumberDialog({ existing = null, agents, settings, current: givenCurrent = null, onClose, onDone }) {
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
  const botName = agents.find((a) => a.id === form.bot)?.name || form.bot;
  const where = useDeployedPhone(form.bot, form.environment, givenCurrent);
  // warn about the environment chosen for a new number, or the one an existing number is being moved to
  const warnings = !existing || form.environment !== existing.environment ? setupWarnings({ env: form.environment, ...where, botName }) : [];

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

  const checked = !existing && check && check.number === typed ? check : null;
  const words = checked ? (checked.status === 'error' ? { tone: 'bad', words: checked.reason } : checkWords(checked)) : null;
  const blocked = existing ? false : !typed || !!shapeProblem || (checked ? checked.status !== 'free' : true);

  const submit = async () => {
    setSubmitted(true);
    setProblem('');
    if (blocked) {
      setProblem(
        !typed
          ? 'Type the number first.'
          : shapeProblem || (!checked ? 'One moment: the number is still being checked.' : words?.words || 'This number cannot be used.'),
      );
      return;
    }
    if (max.error) {
      setProblem(`Longest call: ${max.error}`);
      return;
    }
    if (!form.bot) return;
    const answered = where.deployed ? `Calls to it will be answered by version ${where.deployed}, deployed to ${environmentWord(form.environment)} now.` : '';
    const caution = warnings.length ? `\n\nBefore you go on: ${warnings.join(' ')}` : '';
    if (existing) {
      const body = patchBody(existing, form);
      if (!Object.keys(body).length) {
        onDone(`${existing.number} is unchanged.`);
        return;
      }
      const yes = await askConfirm({
        title: `Change ${existing.number}?`,
        body: `${changeWords(existing, body).join('\n')}${caution}\n\nThis changes the phone system. ${ADMIN_NOTE}`,
        confirmLabel: 'Save changes',
      });
      if (!yes) return;
      setSending(true);
      try {
        await api.changeNumber(existing.bot, existing.number, body);
        onDone(`${existing.number} was updated.`);
      } catch (error) {
        setProblem(numbersProblem(error));
        setSending(false);
      }
      return;
    }
    const yes = await askConfirm({
      title: `Set up ${typed}?`,
      body: `For ${botName}, in ${environmentWord(form.environment)}. ${answered} This creates a phone line (trunk) and a dispatch rule on the phone system.${caution}\n\n${ADMIN_NOTE}`,
      confirmLabel: 'Set up the number',
    });
    if (!yes) return;
    setSending(true);
    try {
      const result = await api.createNumber(form.bot, createBody(form, defaults));
      onDone(`${setUpWords(result, { number: typed, botName, env: form.environment })} The list says whether a call to it would be answered.`);
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
      subtitle={
        existing
          ? 'Only what you change is sent.'
          : 'Type the number your callers will dial. The server checks it is free, then sets up the phone line and the rule that routes it.'
      }
      onClose={sending ? () => {} : onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="modalCreate" disabled={sending}>
            {sending ? 'Working…' : existing ? 'Save changes…' : 'Set up this number…'}
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
        <p className={`telephonyCheck ${words?.tone || 'muted'}`} role="status" aria-live="polite" data-check={checked?.status || (checking ? 'checking' : '')}>
          {checking && !checked ? 'Checking…' : words?.words || ''}
          {checked?.warnings.map((w) => (
            <small key={w} className="telephonyCellNote warn">
              {w}
            </small>
          ))}
        </p>
      )}
      <div className="telephonyFieldRow">
        <DialogField label="Agent" hint={existing ? 'A number stays with the agent it was set up for.' : ''}>
          <select value={form.bot} onChange={(event) => set({ bot: event.target.value })} disabled={!!existing || agents.length < 2} aria-label="Agent">
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogField label="Environment" hint="A call to this number is answered by the version deployed to this environment.">
          <select value={form.environment} onChange={(event) => set({ environment: event.target.value })} aria-label="Environment">
            {environments.map((env) => (
              <option key={env} value={env}>
                {environmentOption(env, where.current)}
              </option>
            ))}
          </select>
        </DialogField>
      </div>
      {warnings.length > 0 && (
        <p className="telephonyCallout" role="note" data-note="setup-warning">
          {warnings.join(' ')}
        </p>
      )}
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
        Setting up a number creates a phone line (trunk) and a dispatch rule on the phone system; you never set those up yourself. It does not make the number
        ring: whoever runs the phone system must also route it to the platform.
      </p>
    </TelephonyDialog>
  );
}
