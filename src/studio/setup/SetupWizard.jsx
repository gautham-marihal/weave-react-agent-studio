import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, groupIssues } from '../../api/client.ts';
import Icon from '../../ui/Icon.jsx';
import { askConfirm } from '../../ui/dialogs.js';
import { AgentNumbers, useLiveNumbers } from '../../pages/LiveNumbers.jsx';
import LanguagePicker from '../agent/pickers/LanguagePicker.jsx';
import VoicePicker from '../agent/pickers/VoicePicker.jsx';
import ChatPreview from '../preview/ChatPreview.jsx';
import { useGateStatus } from '../release/gate.js';
import { navigate, replaceRoute, routeHref } from '../route.js';
import { greetingOf, greetingTarget, readSimple, setAgentName, setGreeting, setRole } from '../simple/simpleModel.js';
import { starterById } from '../starters.ts';
import { Notice } from '../ui.jsx';
import { describeIssue } from '../validation/issues.js';
import {
  KNOWLEDGE_ID,
  STEPS,
  STEP_IDS,
  isStarterRole,
  knowledgeOf,
  reachOf,
  stepForPath,
  stepIndex,
  stepStates,
  usesVoice,
  withMainLanguage,
} from './setupModel.js';
import { useSetupProgress } from './setupProgress.js';
import { ActionSwitches, KnowledgeBlock, ReachChoices } from './SimpleBlocks.jsx';
import './setup.css';

// The guided setup: one step at a time, everything for that step on one screen, Next to move on. The draft is saved at
// every move, so leaving keeps the work and "Continue setup" comes back to the same step. The steps are in the menu at
// the side; any can be opened at any time.

const ENVIRONMENTS = [
  ['development', 'Development', 'for you and your team to try it for real'],
  ['staging', 'Staging', 'for a last check before everyone'],
  ['production', 'Production', 'for everyone'],
];
const words = (text) =>
  String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

// ---- the steps down the side ----------------------------------------------------------------------------------------------------------------------
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

// ---- 2. what it does
// ---------------------------------------------------------------------------------------------------------------------------------
function PurposeStep({ config, set }) {
  const simple = readSimple(config);
  // the channels the greeting is written to, kept from its first change (as on the Agent page): those that say the same line; a channel that says
  // something else (or waits for the caller) is left as it is, and a line that is one of the agent's messages stays that message
  const [greetingFor, setGreetingFor] = useState(null);
  const greeting = greetingOf(config, greetingFor);
  const example = starterById('support').role;
  return (
    <div className="suFields">
      <label className="suField">
        <span>Its name</span>
        <small>What you and your team see in the list of agents.</small>
        <input className="stFInput" value={config?.meta?.name || ''} onChange={(event) => set(setAgentName(config, event.target.value))} />
      </label>
      <label className="suField">
        <span>What it should do</span>
        <small>Who it helps, what it does for them, and anything it must never do. Plain sentences are best.</small>
        <textarea className="stFInput" rows={8} value={simple.role} onChange={(event) => set(setRole(config, event.target.value))} />
        <span className="suFieldFoot">
          <small className={words(simple.role) < 8 ? 'suWarn' : ''}>
            {words(simple.role)} word{words(simple.role) === 1 ? '' : 's'}
            {words(simple.role) < 8 ? ' · a sentence or two more helps it do the job well' : ''}
          </small>
          {!simple.role.trim() && (
            <button type="button" className="linkButton" onClick={() => set(setRole(config, example))}>
              Start from an example
            </button>
          )}
        </span>
        {isStarterRole(simple.role) && (
          <small className="suTip">
            These are the starting point’s own words. Make them yours: what your business does, what people usually ask about (hours, prices, how to book), and
            what it must never do.
          </small>
        )}
      </label>
      <label className="suField">
        <span>The first thing it says</span>
        <small>When someone opens the chat or the call is answered.</small>
        <input
          className="stFInput"
          value={greeting.text}
          placeholder="Hello! How can I help you today?"
          onChange={(event) => {
            const target = greetingFor || greetingTarget(config);
            if (!greetingFor) setGreetingFor(target);
            set(setGreeting(config, event.target.value, target));
          }}
        />
      </label>
    </div>
  );
}

// ---- 3. where people reach it
// --------------------------------------------------------------------------------------------------------------------
// ---- 4. language and voice
// -------------------------------------------------------------------------------------------------------------------------
function VoiceStep({ config, set }) {
  const voice = usesVoice(config);
  const main = readSimple(config).primaryLanguage;
  // an agent with no main language starts with the person's own (the browser's), shown here to change
  useEffect(() => {
    if (!main) set(withMainLanguage(config, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main]);
  return (
    <div className="suFields">
      <section className="suBlock" aria-labelledby="suLanguage">
        <h3 id="suLanguage">Language</h3>
        <LanguagePicker config={config} set={set} brief />
      </section>
      <section className="suBlock" aria-labelledby="suVoice">
        <h3 id="suVoice">Voice</h3>
        {voice ? (
          // drawn again when the language changes, so the voices listed first are the ones that speak it
          <VoicePicker key={main} config={config} set={set} />
        ) : (
          <p className="suNote">It only types, so it needs no voice. Switch on talking or phone calls in the step before, and you choose one here.</p>
        )}
      </section>
    </div>
  );
}

// ---- 6. what it can do
// -----------------------------------------------------------------------------------------------------------------------------
// ---- 7. try it
// ------------------------------------------------------------------------------------------------------------------------------------
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

// ---- 8. go live -----------------------------------------------------------------------------------------------------------------------------------
//   done: what was put live, { version, environment, status, current } (kept by the
//   setup: the agent is read again after it goes live, which redraws this step)
function LiveStep({ botId, name, editor, summary, states, onStep, done, onLive, bump }) {
  const config = editor.parsed.value;
  const [environment, setEnvironment] = useState('development');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
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
        title: `Put ${name} live for everyone?`,
        body: 'Production is what your customers reach. Development is the place to try it for real first.',
        confirmLabel: 'Put it live in Production',
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
      // read again: publishing moved the draft on to the next version number
      editor.reload();
      bump?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const where = ENVIRONMENTS.find((e) => e[0] === done.environment)[1];
    return (
      <div className="suFields">
        <div className="suDone" role="status">
          <span className="suDoneMark" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <div>
            <strong>
              {name} is live in {where}
            </strong>
            <p>
              Version {done.version}
              {done.status === 'pending' ? ' is being set up; the one before keeps answering until it is ready.' : ' answers from now on.'}
            </p>
          </div>
        </div>
        {reachOf(config).sip_voice && numbers.mode === 'live' && <AgentNumbers live={numbers} botId={botId} botName={name} current={done.current} />}
        {reachOf(config).sip_voice && numbers.mode !== 'live' && (
          <p className="suNote">Phone numbers are added on the Releases page, under Deploy, once this server can set them up.</p>
        )}
        <div className="suActionButtons">
          <button type="button" className="primaryCta" onClick={() => navigate(routeHref(botId, 'home'), { guard: false })}>
            Go to the agent
          </button>
          <button type="button" className="quietButton" onClick={() => onStep('try')}>
            Try it again
          </button>
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
                  <button type="button" className="quietButton small" onClick={() => editor.setValue(p.fixes[0].apply(config))}>
                    {p.fixes[0].label}
                  </button>
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
              <strong>{label}</strong> <small>{text}</small>
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
      <button type="button" className="primaryCta suGoLive" onClick={goLive} disabled={busy || blocked}>
        <Icon name="release" size={16} /> {busy ? 'Putting it live…' : `Put it live in ${ENVIRONMENTS.find((e) => e[0] === environment)[1]}`}
      </button>
    </div>
  );
}

// ---- the setup
// ---------------------------------------------------------------------------------------------------------------------------------------
// notices: what the agent's pages say about a save that was refused or failed (shown under the step's heading)
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

  // each step is a new screen: its heading takes the focus, so the keyboard starts there and a screen reader reads where it is
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

  // Leaving What it knows (to another step, or to finish later) starts reading the documents, once each time they change.
  const readWhatItKnows = () => {
    if (step !== 'knowledge') return;
    const k = knowledgeOf(latest.current);
    const sources = JSON.stringify([k.files, k.pages]);
    if ((k.files.length || k.pages.length) && sources !== builtFor.current) {
      builtFor.current = sources;
      api.buildKnowledge(botId, KNOWLEDGE_ID).catch(() => {});
    }
  };
  // Every move saves the draft first, so nothing is lost and the next step (Try it, Go live) works on what was just set.
  const goTo = async (target) => {
    if (target === step) return;
    setMoving(true);
    setMoveError('');
    if (editor.dirty && !editor.parsed.error) {
      const saved = await editor.save();
      if (!saved) {
        setMoving(false);
        // (what went wrong, and the choice after a conflict, is in the note under the heading: `editor` here is from
        // before the save, so it can't say)
        setMoveError('Your changes couldn’t be saved, so it stayed on this step. The note above says why.');
        return;
      }
    }
    readWhatItKnows();
    setMoving(false);
    // coming back to the last step after changing something offers to put it live again
    if (step === 'live') setWentLive(null);
    setStep(target);
    // the address names the step, so a reload (or a link copied now) opens this step and not the one the setup was opened at
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
  if (step === 'purpose') body = <PurposeStep config={config} set={set} />;
  else if (step === 'reach') body = <ReachChoices config={config} set={set} botId={botId} />;
  else if (step === 'voice') body = <VoiceStep config={config} set={set} />;
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
        done={wentLive}
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
        <button type="button" className="quietButton" onClick={leave} disabled={moving}>
          Save and finish later
        </button>
        <span className="suFootRight">
          {prev && (
            <button type="button" className="quietButton" onClick={() => goTo(prev.id)} disabled={moving}>
              <Icon name="arrowLeft" size={15} /> Back
            </button>
          )}
          {next && meta.optional && states[step] !== 'done' && (
            <button type="button" className="quietButton" onClick={() => goTo(next.id)} disabled={moving}>
              Skip this step
            </button>
          )}
          {next && (
            <button type="button" className="primaryCta" onClick={() => goTo(next.id)} disabled={moving}>
              Next: {next.label} <Icon name="arrowRight" size={15} />
            </button>
          )}
        </span>
      </footer>
    </div>
  );
}
