import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, groupIssues } from '../../api/client.ts';
import Icon from '../../ui/Icon.jsx';
import { askConfirm } from '../../ui/dialogs.js';
import { AgentNumbers, useLiveNumbers } from '../../pages/LiveNumbers.jsx';
import ChatPreview from '../preview/ChatPreview.jsx';
import { useGateStatus } from '../release/gate.js';
import { navigate, replaceRoute, routeHref } from '../route.js';
import { Notice, envLabel } from '../ui.jsx';
import { describeIssue } from '../validation/issues.js';
import { KNOWLEDGE_ID, STEPS, STEP_IDS, knowledgeOf, reachOf, stepForPath, stepIndex, stepStates } from './setupModel.js';
import { useSetupProgress } from './setupProgress.js';
import { ActionSwitches, KnowledgeBlock, ReachChoices } from './SimpleBlocks.jsx';
import { PurposeFields, VoiceFields } from './StepFields.jsx';
import './setup.css';
import Button from '../../ui/Button.tsx';

// The guided setup: one step per screen, with Next to move on. Every move saves the draft, so "Continue setup"
// returns to the same step. The side menu opens any step at any time.

// [id, name here, what it is for, "live …"]: plain words first, the technical name (envLabel) small after
const ENVIRONMENTS = [
  ['development', 'Testing', 'just you and your team, to try it for real', 'for testing'],
  ['staging', 'Final check', 'one last look before customers', 'for a final check'],
  ['production', 'Live for customers', 'everyone who calls or chats', 'for customers'],
];
const envOf = (id) => ENVIRONMENTS.find((e) => e[0] === id) || ENVIRONMENTS[0];
// the most public place it is live (after a reload the setup knows only what the server says is deployed)
const liveFrom = (deployed) => {
  const env = ['production', 'staging', 'development'].find((id) => deployed?.[id]);
  return env ? { version: deployed[env], environment: env, status: 'active', current: null } : null;
};

// ---- the steps down the side
function StepList({ step, states, onStep, busy }) {
  const [slot, setSlot] = useState(null);
  useLayoutEffect(() => {
    const wide = window.matchMedia ? window.matchMedia('(min-width: 901px)') : { matches: true, addEventListener() {}, removeEventListener() {} };
    const pick = () => setSlot(wide.matches ? document.getElementById('agentNavSlot') : null);
    pick();
    wide.addEventListener?.('change', pick);
    return () => wide.removeEventListener?.('change', pick);
  }, []);
  const done = STEP_IDS.filter((id) => states[id] === 'done').length;
  const list = (
    <nav className="suSteps" aria-label="Setup steps">
      <div className="suStepsHead">
        <strong>Setting it up</strong>
        <span>
          {done} of {STEPS.length} done
        </span>
      </div>
      <ol>
        {STEPS.map((s, i) => {
          const state = states[s.id];
          const current = s.id === step;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`suStep ${state} ${current ? 'current' : ''}`}
                aria-current={current ? 'step' : undefined}
                disabled={s.id === 'start' || busy}
                onClick={() => onStep(s.id)}
              >
                <span className="suStepMark" aria-hidden="true">
                  {state === 'done' ? <Icon name="check" size={13} /> : i + 1}
                </span>
                <span className="suStepText">
                  {s.label}
                  {s.optional && state !== 'done' && <small>optional</small>}
                </span>
                {/* the small "optional" already says so; a screen reader also hears whether it is done */}
                <span className="srOnly">{state === 'done' ? ' (done)' : s.optional ? '' : ' (to do)'}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
  return slot ? createPortal(list, slot) : list;
}

// ---- 7. try it
function TryStep({ botId, editor, session, sessionMode, modeLocked, setSessionMode, onTried }) {
  const spoke = (session?.messages || []).some((m) => m.role === 'user');
  useEffect(() => {
    if (spoke) onTried();
  }, [spoke, onTried]);
  const { files, pages } = knowledgeOf(editor.parsed.value);
  return (
    <div className="suTry">
      <div className="suTryPanel">
        <ChatPreview session={session} mode={sessionMode} modeLocked={modeLocked} onMode={setSessionMode} botId={botId} editor={editor} />
      </div>
      <aside className="suTryTips" aria-label="Things to try">
        <strong>Things to try</strong>
        <ul>
          <li>Ask what it can help with.</li>
          {(files.length > 0 || pages.length > 0) && <li>Ask something your documents answer.</li>}
          <li>Ask for a person.</li>
          <li>Say goodbye, and see that it ends politely.</li>
        </ul>
        <p className="suNote">Not what you expected? Go back to a step, change it, and try again: your changes are used straight away.</p>
      </aside>
    </div>
  );
}

// ---- 8. go live
//   done: what was put live, { version, environment, status, current }; kept by the setup because the agent is
//   read again after going live, which redraws this step
function LiveStep({ botId, name, editor, summary, states, onStep, done, onLive, bump }) {
  const config = editor.parsed.value;
  const [environment, setEnvironment] = useState('development');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // live already, and asked to put the latest changes live: the form again
  const [again, setAgain] = useState(false);
  const gate = useGateStatus(botId, editor);
  const numbers = useLiveNumbers(!!done && reachOf(config).sip_voice, { botId });
  const problems = useMemo(
    () =>
      groupIssues(editor.report)
        .filter((i) => i.severity === 'error')
        .map((i) => ({ ...describeIssue(i, { config }), step: stepForPath(i.path) })),
    [editor.report, config],
  );
  const missing = STEPS.filter((s) => !s.optional && !['start', 'try', 'live'].includes(s.id) && states[s.id] !== 'done');
  const blocked = problems.length > 0 || (gate.enabled && !gate.check.ok);

  const goLive = async () => {
    if (environment === 'production') {
      const yes = await askConfirm({
        title: `Put ${name} live for customers?`,
        body: 'Everyone who calls or chats reaches this version from now on. “Testing” is the place to try it for real first.',
        confirmLabel: 'Put it live for customers',
      });
      if (!yes) return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editor.dirty) {
        const saved = await editor.save();
        if (!saved) throw new Error('The draft couldn’t be saved, so nothing was put live.');
      }
      const published = await api.publish(botId);
      const result = await api.deploy(botId, { version: published.version, environment, note: 'Put live from the setup' });
      const deployments = await api.listDeployments(botId).catch(() => null);
      onLive({ version: published.version, environment, status: result?.deployment?.status || 'active', current: deployments?.current || null });
      setAgain(false);
      // read again: publishing moved the draft on to the next version number
      editor.reload();
      bump?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (done && !again) {
    const reach = reachOf(config);
    const widgets = (config.channels || []).filter((c) => c?.enabled !== false && ['web_chat', 'web_voice'].includes(c.type));
    return (
      <div className="suFields">
        <div className="suDone" role="status">
          <span className="suDoneMark" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <div>
            <strong>
              {name} is live {envOf(done.environment)[3]}
            </strong>
            <p>
              Version {done.version}
              {done.status === 'pending' ? ' is being set up; the one before keeps answering until it is ready.' : ' answers from now on.'}{' '}
              <span className="suEnvName">({envLabel(done.environment)})</span>
            </p>
          </div>
        </div>
        {/* what each way of reaching it still needs: nothing here pretends a channel works before it does */}
        <section className="suReach" aria-labelledby="suReachTitle">
          <h3 id="suReachTitle">How people reach it</h3>
          <ul>
            {reach.sip_voice && (
              <li>
                <Icon name="phone" size={16} />
                <span>
                  <strong>Phone calls</strong>
                  <small>
                    {numbers.mode === 'live'
                      ? numbers.rows?.length
                        ? `Callers dial ${numbers.rows.map((r) => r.number).join(' or ')}.`
                        : 'Add a phone number below, and callers who dial it reach it.'
                      : 'Phone numbers are added on the Releases page, under Deploy, once this server can set them up.'}
                  </small>
                </span>
              </li>
            )}
            {widgets.map((c) => (
              <li key={c.id}>
                <Icon name={c.type === 'web_voice' ? 'mic' : 'chat'} size={16} />
                <span>
                  <strong>{c.type === 'web_voice' ? 'Talk on your website' : 'Chat on your website'}</strong>
                  <small>
                    Needs the website widget, which your server team adds to your site. Give them the agent’s id <code>{botId}</code>
                    {c.entry?.widget_id ? (
                      <>
                        {' '}
                        and the widget id <code>{c.entry.widget_id}</code>
                      </>
                    ) : null}
                    .
                  </small>
                </span>
              </li>
            ))}
            <li>
              <Icon name="test" size={16} />
              <span>
                <strong>You, now</strong>
                <small>Talk to it yourself any time on its Test page, or with “Try it again” below.</small>
              </span>
            </li>
          </ul>
        </section>
        {reach.sip_voice && numbers.mode === 'live' && <AgentNumbers live={numbers} botId={botId} botName={name} current={done.current} />}
        <div className="suActionButtons">
          <Button type="button" variant="primary" onClick={() => navigate(routeHref(botId, 'home'), { guard: false })}>
            Go to the agent
          </Button>
          <Button type="button" onClick={() => onStep('try')}>
            Try it again
          </Button>
          <Button type="button" onClick={() => setAgain(true)}>
            Put my latest changes live
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="suFields">
      <ul className="suReview" aria-label="What is set">
        {STEPS.filter((s) => !['start', 'live'].includes(s.id)).map((s) => (
          <li key={s.id} className={states[s.id]}>
            <span className="suStepMark" aria-hidden="true">
              {states[s.id] === 'done' ? <Icon name="check" size={13} /> : '–'}
            </span>
            <span>
              {s.label}
              <small>{states[s.id] === 'done' ? 'Done' : s.optional ? 'Skipped (optional)' : s.id === 'try' ? 'Not tried yet' : 'Still to do'}</small>
            </span>
            <button type="button" className="linkButton" onClick={() => onStep(s.id)}>
              {states[s.id] === 'done' ? 'Change' : 'Go there'}
            </button>
          </li>
        ))}
      </ul>

      {missing.length > 0 && (
        <p className="suNote warn">
          {missing.map((s) => s.label).join(' and ')} {missing.length === 1 ? 'isn’t' : 'aren’t'} done yet. It can go live, but it will work better once{' '}
          {missing.length === 1 ? 'it is' : 'they are'}.
        </p>
      )}
      {states.try !== 'done' && (
        <p className="suNote">
          You haven’t tried it yet. A short conversation is the quickest way to catch a mistake before people meet it.{' '}
          <button type="button" className="linkButton" onClick={() => onStep('try')}>
            Try it first
          </button>
        </p>
      )}
      {problems.length > 0 && (
        <section className="suProblems" aria-label="What needs fixing first">
          <strong>Fix {problems.length === 1 ? 'this' : `these ${problems.length}`} first</strong>
          <ul>
            {problems.map((p, i) => (
              <li key={`${p.raw}|${i}`}>
                <span>{p.text}</span>
                {p.fixes[0] ? (
                  <Button type="button" size="small" onClick={() => editor.setValue(p.fixes[0].apply(config))}>
                    {p.fixes[0].label}
                  </Button>
                ) : p.step ? (
                  <button type="button" className="linkButton" onClick={() => onStep(p.step)}>
                    Go to {STEPS[stepIndex(p.step)].label.toLowerCase()}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      {gate.enabled && !gate.check.ok && (
        <p className="suNote warn">
          Your tests must pass before it is published: {gate.check.why}{' '}
          <button type="button" className="linkButton" onClick={() => navigate(routeHref(botId, 'scenarios'), { guard: false })}>
            Open the tests
          </button>
        </p>
      )}

      <fieldset className="suWhere">
        <legend>Where it goes live</legend>
        {ENVIRONMENTS.map(([id, label, text]) => (
          <label key={id} className={`suCheck ${environment === id ? 'on' : ''}`}>
            <input type="radio" name="suEnv" value={id} checked={environment === id} onChange={() => setEnvironment(id)} />
            <span>
              <strong>{label}</strong> <small>{text}</small> <small className="suEnvName">({envLabel(id)})</small>
            </span>
          </label>
        ))}
      </fieldset>
      {summary?.deployed?.[environment] && (
        <p className="suNote">Version {summary.deployed[environment]} is live there now. Going live again puts your latest changes there.</p>
      )}
      {error && (
        <Notice kind="error" title="It couldn’t be put live">
          {error.message}
          {Array.isArray(error.errors) && error.errors.length > 0 && ` (${error.errors.length} problem${error.errors.length === 1 ? '' : 's'} in the agent)`}
        </Notice>
      )}
      <Button type="button" variant="primary" className="suGoLive" onClick={goLive} disabled={busy || blocked}>
        <Icon name="release" size={16} /> {busy ? 'Putting it live…' : `Put it live ${envOf(environment)[3]}`}
      </Button>
    </div>
  );
}

// ---- the setup
//   notices: what the agent's pages say about a refused or failed save (shown under the step's heading)
export default function SetupWizard({
  botId,
  name,
  editor,
  summary,
  session,
  sessionMode,
  modeLocked,
  setSessionMode,
  bump,
  initialStep = '',
  notices = null,
}) {
  const [progress, update] = useSetupProgress(botId);
  const [step, setStep] = useState(() => (STEP_IDS.includes(initialStep) && initialStep !== 'start' ? initialStep : progress.step || 'purpose'));
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [wentLive, setWentLive] = useState(null); // what the last step put live, while the setup is open
  const mainRef = useRef(null);
  const headRef = useRef(null);
  const builtFor = useRef('');
  const config = editor.parsed.value;
  const latest = useRef(config);
  latest.current = config;
  const set = (next) => {
    latest.current = next;
    editor.setValue(next);
  };
  const states = useMemo(() => (config ? stepStates(config, { progress, summary }) : {}), [config, progress, summary]);
  const at = stepIndex(step);
  const meta = STEPS[at];

  // each step is a new screen: its heading takes focus so the keyboard and a screen reader start there
  const loaded = editor.status !== 'loading' && !!config;
  useEffect(() => {
    if (loaded) headRef.current?.focus({ preventScroll: true });
  }, [step, loaded]);
  // an address that names a step (from "Continue setup", or the menu's "Getting it ready") opens it
  useEffect(() => {
    if (STEP_IDS.includes(initialStep) && initialStep !== 'start') setStep(initialStep);
  }, [initialStep]);
  useEffect(() => {
    if (step && progress.step !== step) update({ step });
  }, [step, progress.step, update]);

  // Leaving What it knows (for another step, or to finish later) starts reading the documents, once per change.
  const readWhatItKnows = () => {
    if (step !== 'knowledge') return;
    const k = knowledgeOf(latest.current);
    const sources = JSON.stringify([k.files, k.pages]);
    if ((k.files.length || k.pages.length) && sources !== builtFor.current) {
      builtFor.current = sources;
      api.buildKnowledge(botId, KNOWLEDGE_ID).catch(() => {});
    }
  };
  // Every move saves the draft first, so nothing is lost and the next step (Try it, Go live) uses what was just set.
  const goTo = async (target) => {
    if (target === step) return;
    setMoving(true);
    setMoveError('');
    if (editor.dirty && !editor.parsed.error) {
      const saved = await editor.save();
      if (!saved) {
        setMoving(false);
        // what went wrong (and any conflict choice) is in the note under the heading; `editor` here predates the save
        setMoveError('Your changes couldn’t be saved, so it stayed on this step. The note above says why.');
        return;
      }
    }
    readWhatItKnows();
    setMoving(false);
    // coming back to the last step after changing something offers to put it live again
    if (step === 'live') setWentLive(null);
    setStep(target);
    // the address names the step, so a reload or a copied link opens this step, not the one the setup was opened at
    replaceRoute(routeHref(botId, 'setup', { step: target }));
    mainRef.current?.scrollIntoView?.({ block: 'start' });
  };
  const leave = async () => {
    if (editor.dirty && !editor.parsed.error) {
      setMoving(true);
      const saved = await editor.save();
      setMoving(false);
      // not saved (the note above says why): it stays, so the edits are not left behind unsaved
      if (!saved) {
        setMoveError('Your changes couldn’t be saved, so it stayed here. The note above says why.');
        return;
      }
    }
    readWhatItKnows();
    navigate(routeHref(botId, 'home'), { guard: false });
  };

  if (editor.status === 'loading' || !config) {
    return (
      <div className="suPage" aria-busy="true">
        <p className="stMuted">Loading the agent…</p>
      </div>
    );
  }

  const next = STEPS[at + 1];
  const prev = at > 1 ? STEPS[at - 1] : null;
  let body = null;
  if (step === 'purpose') body = <PurposeFields config={config} set={set} />;
  else if (step === 'reach') body = <ReachChoices config={config} set={set} botId={botId} />;
  else if (step === 'voice') body = <VoiceFields config={config} set={set} startLanguage />;
  else if (step === 'knowledge') body = <KnowledgeBlock botId={botId} config={config} set={set} latest={() => latest.current} />;
  else if (step === 'actions') body = <ActionSwitches config={config} set={set} />;
  else if (step === 'try')
    body = (
      <TryStep
        botId={botId}
        editor={editor}
        session={session}
        sessionMode={sessionMode}
        modeLocked={modeLocked}
        setSessionMode={setSessionMode}
        onTried={() => !progress.tried && update({ tried: true })}
      />
    );
  else if (step === 'live')
    body = (
      <LiveStep
        botId={botId}
        name={name}
        editor={editor}
        summary={summary}
        states={states}
        onStep={goTo}
        done={wentLive || (progress.finished ? liveFrom(summary?.deployed) : null)}
        onLive={(result) => {
          setWentLive(result);
          update({ finished: true });
        }}
        bump={bump}
      />
    );

  return (
    <div className="suPage" ref={mainRef}>
      <StepList step={step} states={states} onStep={goTo} busy={moving} />
      <header className="suHead">
        <div>
          <span className="suEyebrow">
            Setting up {name} · Step {at + 1} of {STEPS.length}
            {meta.optional ? ' · optional' : ''}
          </span>
          <h1 ref={headRef} tabIndex={-1}>
            {meta.title}
          </h1>
          <p>{meta.lead}</p>
        </div>
        <span className="suSaved" aria-live="polite">
          {editor.saving || moving ? 'Saving…' : editor.dirty ? 'Changes not saved yet' : 'Saved'}
        </span>
      </header>
      {notices}
      <div className="suBody">{body}</div>
      {moveError && (
        <p className="suNote warn" role="alert">
          {moveError}
        </p>
      )}
      <footer className="suFoot">
        <Button type="button" onClick={leave} disabled={moving}>
          Save and finish later
        </Button>
        <span className="suFootRight">
          {prev && (
            <Button type="button" onClick={() => goTo(prev.id)} disabled={moving}>
              <Icon name="arrowLeft" size={15} /> Back
            </Button>
          )}
          {next && meta.optional && states[step] !== 'done' && (
            <Button type="button" onClick={() => goTo(next.id)} disabled={moving}>
              Skip this step
            </Button>
          )}
          {next && (
            <Button type="button" variant="primary" onClick={() => goTo(next.id)} disabled={moving}>
              Next: {next.label} <Icon name="arrowRight" size={15} />
            </Button>
          )}
        </span>
      </footer>
    </div>
  );
}
