import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { api } from '../../api/client.ts';
import { isDemoMode } from '../../demo/demoMode.js';
import { ASSISTANT, MIN_DESCRIPTION, generateDraft } from '../../demo/draftAssistant.js';
import { minimalConfig } from '../../demo/minimalConfig.js';
import { isObj } from '../form/engine.js';
import { useSchema } from '../form/useSchema.js';
import { navigate, routeHref } from '../route.js';
import { entryAgent, languageName, readSimple } from '../simple/simpleModel.js';
import { Notice, Spinner } from '../ui.jsx';
import { usePref } from '../usePref.js';
import { buildWorkflow, describeWorkflow } from '../workflow/workflowModel.js';
import { countChanges, diffConfigs, groupChanges } from './diffConfig.js';
import { askAssistant, loadStatus, postToModel } from './engine.js';
import Select from '../../ui/Select.tsx';
import './assistant.css';
import { askConfirm } from '../../ui/dialogs.js';
import Button from '../../ui/Button.tsx';
import { TextArea } from '../../ui/Input.tsx';

// "Describe it": say in plain English what the agent should be and do, and the AI makes the settings. Nothing changes
// behind anyone's back: the answer is a proposal, checked by the same validator as a hand-made draft, that enters the
// draft only on "Apply". It edits the same draft as Config, Workflow and the JSON, so it can all be edited by hand.
const EXAMPLES = [
  {
    title: 'A clinic receptionist',
    text: 'A friendly receptionist for a dental clinic. It answers the phone and the website chat, books and moves appointments, answers questions about opening hours and prices, and passes anything urgent to a person straight away. It should never give medical advice.',
  },
  {
    title: 'Billing support, two roles',
    text: 'A customer care assistant for a phone company. A front desk agent finds out what the caller needs and passes billing questions to a billing specialist. Calm, short sentences. Never promise a refund. Spanish and English.',
  },
  {
    title: 'A shop’s order helper',
    text: 'A web chat helper for an online shop. It tells customers where their order is, explains the returns policy, and collects the details for a return. If the customer is upset or asks for a person, hand over. Keep replies short and friendly.',
  },
  {
    title: 'Change what is here',
    text: 'Make it sound more formal, add a Spanish greeting, and let it end the call politely when the caller says they have nothing else.',
  },
];
const FOLLOW_UPS = ['Add a Spanish greeting', 'Make it shorter and friendlier', 'Let it transfer to a person', 'Add a rule: never promise a refund'];
const PHASES = [
  ['thinking', 'Building'],
  ['checking', 'Checking'],
  ['fixing', 'Fixing'],
];
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nf = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const clip = (t, n) => {
  const x = String(t || '')
    .replace(/\s+/g, ' ')
    .trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};
// A change's path in the form's terms (list items by id become positions), so "All settings" and the JSON open there.
function settingsPath(config, path) {
  const out = [];
  let at = config;
  for (const part of path) {
    if (isObj(part)) {
      const i = Array.isArray(at) ? at.findIndex((x) => x?.id === part.id) : -1;
      if (i < 0) break;
      out.push(i);
      at = at[i];
    } else {
      out.push(part);
      at = at?.[part];
    }
    if (at === undefined) {
      out.pop();
      break;
    }
  }
  return out;
}
let counter = 0;
const nextId = () => {
  counter += 1;
  return `t${counter}`;
};

//   onShowSetting(path), onShowJson(path): open the page and panel that hold a setting, or the JSON
export default function AssistantTab({ editor, botId, name, onShowSetting = null, onShowJson = null }) {
  const config = editor.parsed?.value;
  const ok = editor.status === 'ready' && !editor.parsed?.error && isObj(config);
  const { schema, error: schemaError } = useSchema();
  const demo = isDemoMode();
  const [status, setStatus] = useState(demo ? { configured: false, demo: true } : null);
  const [consent, setConsent] = usePref('weave_ai_consent', '0');
  const [modelPref, setModelPref] = usePref('weave_ai_model', '');
  const [text, setText] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!demo) {
      let off = false;
      loadStatus().then((s) => {
        if (!off) setStatus(s);
      });
      return () => {
        off = true;
      };
    }
    return undefined;
  }, [demo]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [thread.length, busy]);

  const models = status?.models || [];
  const model = models.includes(modelPref) ? modelPref : status?.model || models[0] || '';
  const ai = !!status?.configured && !demo;
  const canSend = ok && !busy && text.trim().length >= (ai ? 4 : MIN_DESCRIPTION) && (!ai || (!!schema && consent === '1'));

  const patchTurn = useCallback((id, patch) => setThread((old) => old.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);

  const send = async () => {
    if (!canSend) return;
    const request = text.trim();
    const before = config;
    const turn = nextId();
    const earlier = thread.filter((t) => t.role === 'user').map((t) => t.text);
    setThread((old) => [...old, { id: `${turn}u`, role: 'user', text: request }, { id: turn, role: 'assistant', state: 'working', step: 'thinking', request }]);
    setText('');
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      let result;
      if (ai) {
        result = await askAssistant({
          request,
          config: before,
          schema,
          model,
          earlier,
          signal: controller.signal,
          onStep: (step) => patchTurn(turn, { step }),
          post: (body, signal) => postToModel(body, signal),
          validate: (c, signal) => api.validate(c, { signal }),
        });
        result.source = 'ai';
      } else {
        const made = generateDraft(request, minimalConfig(before?.meta?.id || botId, before?.meta?.name || name || 'New agent'));
        if (!made.ok) throw new Error(made.message || 'The built-in rules could not make a draft from that.');
        const checked = await api.validate(made.config, { signal: controller.signal }).catch(() => ({ errors: [], warnings: [] }));
        const s = made.summary || {};
        result = {
          config: made.config,
          summary: `A first draft of a ${s.kind || 'support'} agent${s.name ? ` called ${s.name}` : ''}${s.channels?.length ? ` on ${s.channels.join(' and ')}` : ''}${s.tone ? `, in a ${s.tone} tone` : ''}.`,
          assumptions: made.assumptions || [],
          questions: made.questions || [],
          issues: { errors: checked.errors || [], warnings: checked.warnings || [] },
          repairs: 0,
          usage: null,
          source: 'rules',
          replaces: true,
        };
      }
      const raw = diffConfigs(before, result.config).filter((c) => c.path[0] !== 'builder');
      const changes = groupChanges(raw);
      const drawn = buildWorkflow(result.config);
      const flow = describeWorkflow(drawn).slice(0, 12);
      const where = {
        path: settingsPath(result.config, raw[0]?.path || []),
        agents: drawn.nodes.filter((n) => n.type === 'agent').length,
        handovers: drawn.edges.filter((e) => e.kind === 'handoff').length,
        sections: changes.map((g) => g.section),
      };
      patchTurn(turn, { state: 'done', result: { ...result, changes, counts: countChanges(changes), flow, where, before, model: ai ? model : null } });
    } catch (error) {
      patchTurn(turn, { state: error?.name === 'AbortError' ? 'cancelled' : 'error', error: error?.message || 'Something went wrong.' });
    } finally {
      abort.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  };
  const cancel = () => abort.current?.abort();

  const apply = (turn) => {
    editor.setValue(turn.result.config);
    patchTurn(turn.id, { applied: true, undone: false, appliedAt: Date.now() });
  };
  const undo = async (turn) => {
    if (
      !sameJson(config, turn.result.config) &&
      !(await askConfirm({
        title: 'Undo anyway?',
        body: 'The draft has changed since this was applied. Undoing puts it back as it was before, and loses those later changes.',
        confirmLabel: 'Undo',
        tone: 'danger',
      }))
    )
      return;
    editor.setValue(turn.result.before);
    patchTurn(turn.id, { applied: false, undone: true });
  };
  const discard = (turn) => patchTurn(turn.id, { discarded: true });
  const go = (tab) => navigate(routeHref(botId, tab), { guard: false });
  const openIn = (view, path) => {
    if (view === 'json') onShowJson?.(path);
    else onShowSetting?.(path?.length ? path : ['meta']);
  };
  const askFor = (phrase) => {
    setText(phrase);
    inputRef.current?.focus();
  };

  if (editor.status === 'loading') return <Spinner label="Loading the draft" />;
  if (!ok)
    return (
      <Notice
        kind="warn"
        title="The draft can’t be changed yet"
        actions={
          <Button type="button" onClick={() => onShowJson?.()}>
            Open the JSON
          </Button>
        }
      >
        {editor.parsed?.error ? 'The JSON has a syntax error. Fix it in Settings › Edit as JSON first.' : 'The draft could not be read.'}
      </Notice>
    );

  const applied = thread.filter((t) => t.role === 'assistant' && t.applied);
  const latestApplied = applied[applied.length - 1];
  const empty = thread.length === 0;
  return (
    <div className="asTab">
      <header className="asHead">
        <div>
          <h2>Describe it</h2>
          <p>
            Tell the {ai ? 'AI' : 'assistant'} what you need in plain English: who the agent talks to, what it should do, how it should sound, what it must
            never do. It makes the settings; you read what it did, then apply it.
          </p>
        </div>
        <div className="asEngine" aria-live="polite">
          {status === null ? (
            <span className="asBadge">Checking…</span>
          ) : ai ? (
            <span className="asBadge ai">
              <Icon name="sparkle" size={14} /> AI ·{' '}
              {models.length > 1 ? (
                <Select aria-label="Which AI model" value={model} onChange={(event) => setModelPref(event.target.value)} disabled={busy}>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              ) : (
                model
              )}
            </span>
          ) : (
            <span className="asBadge off" title={ASSISTANT.description}>
              Built-in rules, not AI
            </span>
          )}
        </div>
      </header>

      {status && !ai && (
        <Notice kind={demo ? 'info' : 'warn'} title={demo ? 'The AI is not used in demo mode' : 'No AI model is set up on this server'}>
          {demo ? (
            'Demo mode keeps everything in this browser, so nothing can be sent to an AI service. What you write here is read by simple built-in rules instead: they are not an AI model, they only look for keywords, and they make a first draft that replaces what is there.'
          ) : (
            <>
              Until the person who runs Weave turns it on, what you write here is read by simple built-in rules: they are not an AI model, they only look for
              keywords, and they make a first draft that replaces what is there.
              <details className="stErrDetail">
                <summary>Details for the person who runs the server</summary>
                <p>
                  Add <code>ANTHROPIC_API_KEY</code> to the studio’s environment and restart it to let an AI model build and change agents from what people
                  write.
                </p>
              </details>
            </>
          )}
        </Notice>
      )}
      {ai && consent !== '1' && (
        <Notice
          kind="info"
          title="Before you use the AI"
          actions={
            <Button type="button" variant="primary" size="compact" onClick={() => setConsent('1')}>
              I understand, continue
            </Button>
          }
        >
          What you write, and this draft, are sent to the AI service (Anthropic) using the key kept on this server. Secrets are never part of a draft (it holds
          only their names), but do not type passwords or personal details into the box. Nothing changes in the draft until you press Apply.
        </Notice>
      )}
      {schemaError && (
        <Notice kind="error" title="The settings schema could not be loaded">
          The assistant needs it to know what an agent can have.
        </Notice>
      )}

      <div className="asLayout">
        <div className="asMain">
          <div className="asThread" role="log" aria-label="The conversation" aria-live="polite">
            {empty && (
              <div className="asEmpty">
                <h3>Start with a few sentences</h3>
                <p>
                  You can come back at any time and ask for changes: “add a Spanish greeting”, “make it stricter about refunds”, “let it transfer to a person”.
                </p>
                <ul className="asExamples" aria-label="Examples">
                  {EXAMPLES.map((e) => (
                    <li key={e.title}>
                      <button type="button" onClick={() => askFor(e.text)}>
                        <strong>{e.title}</strong>
                        <span>{e.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {thread.map((turn, i) =>
              turn.role === 'user' ? (
                <div key={turn.id} className="asMe">
                  <span className="asWho">You</span>
                  <p>{turn.text}</p>
                </div>
              ) : (
                <Answer
                  key={turn.id}
                  turn={turn}
                  phase={turn.step}
                  onApply={() => apply(turn)}
                  onUndo={() => undo(turn)}
                  onDiscard={() => discard(turn)}
                  go={go}
                  draftNow={config}
                  canUndo={latestApplied?.id === turn.id}
                  last={i === thread.length - 1}
                  openIn={openIn}
                  onFollowUp={askFor}
                  onSave={editor.save}
                  dirty={editor.dirty}
                  saving={editor.saving}
                />
              ),
            )}
            <div ref={endRef} />
          </div>

          <form
            className="asComposer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label htmlFor="as-input" className="srOnly">
              What do you need?
            </label>
            <TextArea
              id="as-input"
              ref={inputRef}
              rows={3}
              value={text}
              disabled={busy}
              placeholder={empty ? 'e.g. A friendly phone agent for a dental clinic that books appointments…' : 'Ask for a change, or answer its questions…'}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="asComposerRow">
              <small>{ai ? 'Sent to the AI with the current draft. Ctrl+Enter to send.' : 'Read by simple rules in this browser. Ctrl+Enter to send.'}</small>
              {busy ? (
                <Button type="button" onClick={cancel}>
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  size="compact"
                  disabled={!canSend}
                  title={!canSend && text.trim().length < (ai ? 4 : MIN_DESCRIPTION) ? 'Write a little more first' : undefined}
                >
                  <Icon name="sparkle" size={15} /> {ai ? (empty ? 'Build it' : 'Send') : 'Make a first draft'}
                </Button>
              )}
            </div>
          </form>
        </div>

        <aside className="asAside" aria-label="The agent and what changed">
          <NowCard config={config} />
          <Ledger applied={applied} dirty={editor.dirty} saving={editor.saving} onSave={editor.save} />
        </aside>
      </div>
    </div>
  );
}

// ---- what the agent is now, in a few lines (so a change can be seen against it)
function NowCard({ config }) {
  const read = useMemo(() => readSimple(config), [config]);
  const agents = Array.isArray(config?.agents?.items) ? config.agents.items.filter(isObj) : [];
  const tools = Array.isArray(config?.tools) ? config.tools.length : 0;
  const entry = entryAgent(config);
  const speaks = [...new Set([read.primaryLanguage, ...read.speaks].filter(Boolean).map((c) => languageName(c)))];
  return (
    <section className="asCard">
      <h3>The agent now</h3>
      <p className="asNowName">{config?.meta?.name || read.name || 'Unnamed'}</p>
      {entry?.instructions?.role && <p className="asNowRole">{clip(entry.instructions.role, 170)}</p>}
      <dl className="asFacts">
        <div>
          <dt>Answers on</dt>
          <dd>{read.channels.length ? read.channels.map((c) => `${c.name}${c.enabled ? '' : ' (off)'}`).join(', ') : 'No channels yet'}</dd>
        </div>
        <div>
          <dt>Speaks</dt>
          <dd>{speaks.length ? speaks.join(', ') : 'Not set'}</dd>
        </div>
        <div>
          <dt>Tone</dt>
          <dd>{read.tone || 'Not set'}</dd>
        </div>
        <div>
          <dt>Agents</dt>
          <dd>{agents.length ? agents.map((a) => a.name || a.id).join(', ') : 'None'}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{tools}</dd>
        </div>
      </dl>
    </section>
  );
}

// ---- everything applied here so far, newest first, with the plain sentences of each
function Ledger({ applied, dirty, saving, onSave }) {
  const entries = [...applied].reverse();
  const totals = entries.reduce(
    (n, t) => ({ added: n.added + t.result.counts.added, changed: n.changed + t.result.counts.changed, removed: n.removed + t.result.counts.removed }),
    { added: 0, changed: 0, removed: 0 },
  );
  return (
    <section className="asCard">
      <h3>Changes made here</h3>
      {entries.length === 0 ? (
        <p className="asMuted">Nothing yet. When you apply an answer, a summary of exactly what it changed is kept here.</p>
      ) : (
        <>
          <p className="asTotals">
            <b className="asVerb added">{totals.added} added</b> <b className="asVerb changed">{totals.changed} changed</b>{' '}
            <b className="asVerb removed">{totals.removed} removed</b>
          </p>
          <ol className="asLedger">
            {entries.map((t) => (
              <li key={t.id}>
                <details>
                  <summary>
                    <span>{clip(t.request, 70)}</span>
                    <small>
                      {t.result.counts.total} change{t.result.counts.total === 1 ? '' : 's'}
                    </small>
                  </summary>
                  {t.result.changes.map((g) => (
                    <div key={g.section} className="asGroup">
                      <strong>{g.section}</strong>
                      <ul>
                        {g.items.map((c, i) => (
                          <li key={i}>{c.text}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="asSave">
        {dirty ? (
          <span className="asWarnText">Not saved yet</span>
        ) : (
          <span className="asOk">
            <Icon name="check" size={14} /> Saved
          </span>
        )}
        <Button type="button" onClick={() => onSave()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
      </div>
    </section>
  );
}

function Answer({ turn, phase, onApply, onUndo, onDiscard, go, draftNow, canUndo, last, onFollowUp, onSave, dirty, saving, openIn }) {
  const r = turn.result;
  const changed = r ? !sameJson(draftNow, r.before) && !turn.applied : false; // the draft is no longer the one this answer was made from
  if (turn.state === 'working') {
    return (
      <div className="asBot working">
        <span className="asWho">Assistant</span>
        <p>
          <span className="asDots" aria-hidden="true" />{' '}
          {phase === 'fixing'
            ? 'The checker found a problem; asking the AI to fix it…'
            : phase === 'checking'
              ? 'Checking what it built with the same checker as a hand-made draft…'
              : 'Reading what you wrote and building the settings…'}
        </p>
        <ol className="asPhases" aria-hidden="true">
          {PHASES.filter(([id]) => id !== 'fixing' || phase === 'fixing').map(([id, label]) => (
            <li key={id} className={id === phase ? 'on' : ''}>
              {label}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (turn.state === 'cancelled')
    return (
      <div className="asBot">
        <span className="asWho">Assistant</span>
        <p className="asMuted">Stopped. Nothing was changed.</p>
      </div>
    );
  if (turn.state === 'error')
    return (
      <div className="asBot error" role="alert">
        <span className="asWho">Assistant</span>
        <p>{turn.error}</p>
      </div>
    );
  const errors = r.issues?.errors || [];
  const warnings = r.issues?.warnings || [];
  const { counts } = r;
  const done = turn.applied;
  return (
    <div className={`asBot ${turn.discarded ? 'discarded' : ''} ${done ? 'applied' : ''}`}>
      <span className="asWho">Assistant{r.source === 'rules' ? ' (built-in rules, not AI)' : r.model ? ` · ${r.model}` : ''}</span>
      {done && (
        <p className="asDone">
          <Icon name="check" size={16} /> Applied to the draft. {counts.total} change{counts.total === 1 ? '' : 's'}: {counts.added} added, {counts.changed}{' '}
          changed, {counts.removed} removed.
        </p>
      )}
      <p className="asSummary">{r.summary || 'Here is what I made.'}</p>
      {r.replaces && !done && <p className="asWarn">This replaces the whole draft with a fresh one.</p>}
      {r.questions.length > 0 && (
        <section className="asBlock ask">
          <h4>It needs your answer</h4>
          <ul>
            {r.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <small>Answer in the box below and it will update the settings.</small>
        </section>
      )}
      {r.assumptions.length > 0 && (
        <section className="asBlock">
          <h4>It assumed</h4>
          <ul>
            {r.assumptions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="asBlock changes">
        <h4>{done ? 'What changed' : `What would change (${counts.total})`}</h4>
        {counts.total > 0 && (
          <p className="asTotals">
            <b className="asVerb added">{counts.added} added</b> <b className="asVerb changed">{counts.changed} changed</b>{' '}
            <b className="asVerb removed">{counts.removed} removed</b>
          </p>
        )}
        {r.changes.length === 0 ? (
          <p className="asMuted">Nothing differs from the draft you have.</p>
        ) : (
          r.changes.map((g) => (
            <div key={g.section} className="asGroup">
              <strong>{g.section}</strong>
              <ul className="asChanges">
                {g.items.map((c, i) => (
                  <li key={i}>
                    <i className={`asDot ${c.verb.toLowerCase()}`} aria-hidden="true" />
                    {c.text}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
      {r.flow.length > 0 && (
        <details className="asBlock">
          <summary>
            <h4>How a call moves</h4>
          </summary>
          <ul>
            {r.flow.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="asCheck" role="status">
        {errors.length === 0 ? (
          <span className="asOk">
            <Icon name="check" size={14} /> Checked: no errors
            {warnings.length ? `, ${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth a look` : ''}
            {r.repairs ? ` (it fixed ${r.repairs} problem${r.repairs === 1 ? '' : 's'} on the way)` : ''}
          </span>
        ) : (
          <span className="asBad">
            <Icon name="alert" size={14} /> {errors.length} problem{errors.length === 1 ? '' : 's'} the checker still finds
          </span>
        )}
        {r.usage && (
          <small>
            {nf(r.usage.input)} in · {nf(r.usage.output)} out{r.usage.cached ? ` · ${nf(r.usage.cached)} cached` : ''}
          </small>
        )}
      </div>
      {errors.length > 0 && (
        <ul className="asErrors">
          {errors.slice(0, 6).map((e, i) => (
            <li key={i}>
              <code>{Array.isArray(e.path) ? e.path.join('.') : ''}</code> {e.message}
            </li>
          ))}
        </ul>
      )}

      {!turn.discarded && !done && (
        <div className="asActions">
          {changed && <p className="asWarn">The draft has been changed since this was made. Applying replaces it with this version.</p>}
          <Button type="button" variant="primary" size="compact" onClick={onApply} disabled={counts.total === 0 && !r.replaces}>
            {changed ? 'Apply anyway' : 'Apply to the draft'}
          </Button>
          <Button type="button" onClick={onDiscard}>
            Not this
          </Button>
          {errors.length > 0 && <small>You can apply it and fix the rest by hand.</small>}
        </div>
      )}
      {done && r.where && (
        <section className="asBlock where" aria-label="Where it shows up">
          <h4>It is now in</h4>
          <ul className="asWhere">
            <li>
              <b>Settings</b>
              <span>{r.where.sections.join(', ') || 'No setting changed'}</span>
              <span className="asRow">
                <Button type="button" onClick={() => openIn('form', r.where.path)}>
                  Show me
                </Button>
                <Button type="button" onClick={() => openIn('json', r.where.path)}>
                  Open in JSON
                </Button>
              </span>
            </li>
            <li>
              <b>Workflow</b>
              <span>
                {r.where.agents} agent{r.where.agents === 1 ? '' : 's'}, {r.where.handovers} hand-over{r.where.handovers === 1 ? '' : 's'}
              </span>
              <span className="asRow">
                <Button type="button" onClick={() => go('workflow')}>
                  See the workflow
                </Button>
              </span>
            </li>
          </ul>
          <small>
            It is one draft: what was just applied is what every page of the agent shows, and a change made on any of them is what the next request starts from.
          </small>
        </section>
      )}
      {done && (
        <div className="asActions applied">
          <span className="asWarnText">{dirty ? 'Not saved yet' : 'Saved'}</span>
          <Button type="button" variant="primary" size="compact" onClick={() => onSave()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
          <Button type="button" onClick={() => go('test')}>
            Test it
          </Button>
          {canUndo && (
            <Button type="button" onClick={onUndo}>
              Undo
            </Button>
          )}
        </div>
      )}
      {done && last && (
        <ul className="asFollow" aria-label="Ask for more">
          {FOLLOW_UPS.map((f) => (
            <li key={f}>
              <button type="button" onClick={() => onFollowUp(f)}>
                {f}
              </button>
            </li>
          ))}
        </ul>
      )}
      {turn.undone && <p className="asMuted">Undone. The draft is as it was.</p>}
      {turn.discarded && <p className="asMuted">Set aside. Nothing was changed.</p>}
    </div>
  );
}
