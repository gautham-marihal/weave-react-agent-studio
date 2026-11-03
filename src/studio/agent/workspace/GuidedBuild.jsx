import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import Button from '../../../ui/Button.tsx';
import { Input, TextArea } from '../../../ui/Input.tsx';
import { askConfirm } from '../../../ui/dialogs.js';
import { Switch } from '../../form/fields.jsx';
import AiOrb from '../../preview/AiOrb.jsx';
import { ActionSwitches, KnowledgeBlock, ReachChoices } from '../../setup/SimpleBlocks.jsx';
import { isStarterRole } from '../../setup/setupModel.js';
import { setHandOver } from '../../setup/setupActions.js';
import { STARTERS } from '../../starters.ts';
import {
  LANGUAGES,
  greetingOf,
  greetingTarget,
  languageName,
  readSimple,
  setGreeting,
  setPersonaField,
  setPrimaryLanguage,
  setRole,
  setTone,
} from '../../simple/simpleModel.js';
import { useVoicePreview } from '../../../pages/voicePreview.js';
import { applyVoice, readModels } from '../../models/config.js';
import { useProviders } from '../../models/useProviders.js';
import LanguagePicker from '../pickers/LanguagePicker.jsx';
import VoicePicker from '../pickers/VoicePicker.jsx';
import { filterVoices, voiceFilters, voiceInUse } from '../pickers/pickerLogic.js';
import { addSubagent } from '../../workflow/workflowOps.js';
import { agentLabel } from '../rowNames.js';
import { MOMENTS, BRINGS_HAND_OVER, momentsOf, setMoment, setTopics, topicsOf } from '../blocks/guardrailModel.js';
import { QUESTION_IDEAS, addQuestion, afterCallOf, removeQuestion, setNotice, setRecording, setSummary } from '../blocks/afterCallModel.js';
import { RECORDING_NOTICE } from '../../setup/setupModel.js';
import { ChipList } from '../detailed/Detailed.jsx';
import { GUIDED_IDS, canWords, guidedSteps, reachWords } from './guidedSteps.js';
import './guided.css';
import { fadeIn } from '../../../ui/motion.ts';

// Build's Guided view: the agent in nine steps, one at a time. The steps down the left say where each stands; the step
// in the middle asks one thing with its plain controls (Back and Next below); on the right, "Your agent so far" sums it
// up with its orb, and how many steps are done. The last step lists every answer, with what is left to do.
// Every control writes the draft at once, through the same setters as the Detailed parts, so both always agree.
//   step: the step shown (the address's ?step=); onStep(id): shows another
//   sections/problems: as BuildStage; simpleKnowledge: its documents are the setup's single base (else: a link)
//   latest(): the draft as it is now (an upload finishes after more edits); onUploaded: reads the documents again
//   onOpen(page): a Detailed part; onTest: opens the test panel; onPublish: the publish checklist
export default function GuidedBuild({
  botId,
  config,
  set,
  latest,
  problems = 0,
  simpleKnowledge = true,
  onUploaded,
  onOpen,
  onTest,
  onPublish,
  step: asked,
  onStep,
}) {
  const { steps, todo, done, next } = useMemo(() => guidedSteps(config), [config]);
  const at = Math.max(0, GUIDED_IDS.indexOf(asked));
  const step = steps[at];
  const ready = step.id === 'ready';
  const main = useRef(null);
  // a new step starts at its question, for the keyboard and a screen reader too
  const shown = useRef(step.id);
  useEffect(() => {
    if (shown.current === step.id) return;
    shown.current = step.id;
    main.current?.querySelector('h1')?.focus({ preventScroll: true });
    fadeIn(main.current);
    // back to the top of the steps when they are scrolled away (under the sticky bar: the flow's scroll margin)
    const flow = main.current?.parentElement;
    if (flow && flow.getBoundingClientRect().top < 0) flow.scrollIntoView?.({ block: 'start' });
  }, [step.id]);
  const go = (id) => onStep(id);

  return (
    <div className={`gdFlow ${ready ? 'ready' : ''}`}>
      <StepRail steps={steps} current={step.id} onPick={go} />
      <main className="gdMain" ref={main} aria-labelledby="gd-question">
        {ready ? (
          <ReadyStep config={config} steps={steps} todo={todo} problems={problems} onStep={go} onOpen={onOpen} onTest={onTest} onPublish={onPublish} />
        ) : (
          <>
            <section className="gdCard" data-step={step.id}>
              <header className="gdHead">
                <span className="gdEyebrow">
                  Step {at + 1} of {steps.length}
                  {step.optional ? ' · optional' : ''}
                </span>
                <h1 id="gd-question" tabIndex={-1}>
                  {step.question}
                </h1>
                <p>{step.lead}</p>
              </header>
              <StepBody
                id={step.id}
                botId={botId}
                config={config}
                set={set}
                latest={latest}
                simpleKnowledge={simpleKnowledge}
                onUploaded={onUploaded}
                onOpen={onOpen}
              />
              <p className="gdMore">
                Want every setting?{' '}
                <button type="button" className="gdLink" onClick={() => onOpen(step.page)}>
                  Open {step.title.toLowerCase()} in the Detailed view
                </button>
              </p>
            </section>
            <div className="gdNav">
              <Button type="button" variant="secondary" disabled={at === 0} onClick={() => go(GUIDED_IDS[at - 1])}>
                Back
              </Button>
              <span className="gdSaved">Changes wait in the draft until you save. Every step can be changed later.</span>
              <Button type="button" variant="primary" className="gdNext" onClick={() => go(GUIDED_IDS[at + 1])}>
                Next: {steps[at + 1].title} <Icon name="arrowRight" size={16} />
              </Button>
            </div>
          </>
        )}
      </main>
      {!ready && <SoFar config={config} done={done} total={steps.length - 1} next={next} problems={problems} onStep={go} onTest={onTest} />}
    </div>
  );
}

// ---- the steps down the left -------------------------------------------------------------------------------------
function StepRail({ steps, current, onPick }) {
  return (
    <nav className="gdRail" aria-label="The steps">
      <p className="gdRailTitle">Build it in {steps.length} steps</p>
      <ol>
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`gdStep ${s.state}`}
              aria-current={s.id === current ? 'step' : undefined}
              data-step={s.id}
              onClick={() => onPick(s.id)}
            >
              <span className="gdMark" aria-hidden="true">
                {s.state === 'done' && s.id !== current ? <Icon name="check" size={13} /> : i + 1}
              </span>
              <span className="gdStepText">
                <span className="gdStepTitle">{s.title}</span>
                <span className="gdStepAnswer">
                  <span className="srOnly">{s.state === 'todo' ? 'To do: ' : s.state === 'done' ? 'Done: ' : ''}</span>
                  {s.answer}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---- "Your agent so far" -----------------------------------------------------------------------------------------
function agentFacts(config, problems) {
  const read = readSimple(config);
  const tts = readModels(config).tts;
  const voice = tts?.voiceId ? voiceInUse(tts)?.name || 'its own voice' : '';
  const can = canWords(config);
  const reach = reachWords(config);
  const docs = guidedSteps(config).steps.find((s) => s.id === 'knowledge');
  return [
    {
      k: 'Speaks',
      v: read.primaryLanguage
        ? [languageName(read.primaryLanguage), read.voiceChannel && (voice || 'no voice yet')].filter(Boolean).join(' · ')
        : 'Not chosen yet',
      warn: !read.primaryLanguage || (read.voiceChannel && !voice),
    },
    { k: 'Knows', v: docs.state === 'done' ? docs.answer : 'Its instructions only' },
    { k: 'Can', v: can.length ? can.join(' · ').replace(/^./, (c) => c.toUpperCase()) : 'Only talk' },
    { k: 'Reached on', v: reach.length ? reach.join(' · ') : 'Nowhere yet', warn: !reach.length },
    { k: 'Checks', v: problems ? `${problems} ${problems === 1 ? 'problem' : 'problems'} to fix` : 'No problems', warn: problems > 0 },
  ];
}
const nameOf = (config) => {
  const read = readSimple(config);
  return read.persona || read.name || 'Your agent';
};
const taglineOf = (config) => {
  const read = readSimple(config);
  const company = config?.persona?.company;
  const tone = String(read.tone || '')
    .split(',')
    .slice(0, 2)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
  return [company ? `For ${company}` : '', tone].filter(Boolean).join(' · ') || 'Its tone isn’t chosen yet';
};

function SoFar({ config, done, total, next, problems, onStep, onTest }) {
  const read = readSimple(config);
  const share = total ? done / total : 0;
  const R = 18;
  const around = 2 * Math.PI * R;
  return (
    <aside className="gdAside" aria-label="Your agent so far">
      <section className="gdSoFar" data-orb-surface="dark">
        <span className="gdSoFarLabel">Your agent so far</span>
        <div className="gdWho">
          <AiOrb size={88} />
          <div>
            <strong>{nameOf(config)}</strong>
            <span>{taglineOf(config)}</span>
          </div>
        </div>
        {read.greeting ? <p className="gdBubble">{read.greeting}</p> : <p className="gdBubble empty">It has nothing to say first yet.</p>}
        <dl>
          {agentFacts(config, problems).map((f) => (
            <div key={f.k} className={f.warn ? 'warn' : ''}>
              <dt>{f.k}</dt>
              <dd>{f.v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="gdTalk" onClick={onTest}>
          <Icon name="play" size={14} /> Talk to it now
        </button>
      </section>
      <section className="gdProgress" aria-label="How far along">
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r={R} className="gdRingBack" />
          <circle cx="22" cy="22" r={R} className="gdRingOn" strokeDasharray={`${around * share} ${around}`} transform="rotate(-90 22 22)" />
        </svg>
        <span>
          <strong>
            {done} of {total} done
          </strong>
          {next ? (
            <button type="button" className="gdLink" onClick={() => onStep(next.id)}>
              Next to do: {next.todo.toLowerCase()}
            </button>
          ) : (
            <span>Nothing left to do. Try it!</span>
          )}
        </span>
      </section>
    </aside>
  );
}

// ---- each step's controls ----------------------------------------------------------------------------------------
function StepBody({ id, botId, config, set, latest, simpleKnowledge, onUploaded, onOpen }) {
  switch (id) {
    case 'who':
      return <WhoStep config={config} set={set} />;
    case 'voice':
      return <VoiceStep config={config} set={set} />;
    case 'knowledge':
      return simpleKnowledge ? (
        <KnowledgeBlock botId={botId} config={config} set={set} latest={latest} onPage onUploaded={onUploaded} />
      ) : (
        <Elsewhere
          text="It has knowledge bases of its own, so its documents are set up on the Knowledge part."
          button="Open its documents"
          onOpen={() => onOpen('knowledge')}
        />
      );
    case 'tools':
      return <ActionSwitches config={config} set={set} onPage />;
    case 'channels':
      return <ReachChoices config={config} set={set} botId={botId} onPage />;
    case 'workflow':
      return <FlowStep config={config} set={set} onOpen={onOpen} />;
    case 'guardrails':
      return <LimitsStep config={config} set={set} />;
    case 'aftercall':
      return <AfterStep config={config} set={set} />;
    default:
      return null;
  }
}

function Elsewhere({ text, button, onOpen }) {
  return (
    <div className="gdElsewhere">
      <p>{text}</p>
      <Button type="button" size="compact" onClick={onOpen}>
        {button} <Icon name="arrowRight" size={14} />
      </Button>
    </div>
  );
}

// A row of choices as cards: a title and a line each, one chosen
function Cards({ label, options, value, onPick, className = '' }) {
  return (
    <div className={`gdCards ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className="gdPick" onClick={() => onPick(o.id)}>
          <strong>{o.name}</strong>
          {o.line && <span>{o.line}</span>}
        </button>
      ))}
    </div>
  );
}

// 1 · who it is
const TONES = [
  { id: 'warm', name: 'Warm', line: 'Friendly, kind', words: 'warm, friendly, patient' },
  { id: 'neutral', name: 'Neutral', line: 'Plain, even', words: 'neutral, clear, to the point' },
  { id: 'formal', name: 'Formal', line: 'Polite, proper', words: 'formal, polite, precise' },
  { id: 'upbeat', name: 'Upbeat', line: 'Lively, positive', words: 'upbeat, cheerful, energetic' },
];
const START_FROM = ['support', 'appointment', 'knowledge', 'receptionist'].map((id) => STARTERS.find((s) => s.id === id)).filter(Boolean);
const countWords = (text) => (String(text || '').match(/\S+/g) || []).length;

function WhoStep({ config, set }) {
  const ids = useId();
  const simple = readSimple(config);
  const persona = config?.persona || {};
  const [greetingFor, setGreetingFor] = useState(null);
  const greeting = greetingOf(config, greetingFor);
  const tone = TONES.find((t) => t.words === simple.tone);
  const [ownTone, setOwnTone] = useState(!tone && !!simple.tone);
  const words = countWords(simple.role);

  const startFrom = async (starter) => {
    const mine = words > 0 && !isStarterRole(simple.role);
    if (
      mine &&
      !(await askConfirm({
        title: `Start again from “${starter.label}”?`,
        body: 'Its instructions are replaced with the starting point’s words. What you wrote is lost.',
        confirmLabel: 'Replace them',
        tone: 'danger',
      }))
    )
      return;
    set(setRole(config, starter.role));
  };

  return (
    <div className="gdFields">
      <div className="gdTwo">
        <label className="gdField">
          <span className="gdLabel">It introduces itself as</span>
          <Input value={persona.name || ''} placeholder="e.g. Maya" onChange={(event) => set(setPersonaField(config, 'name', event.target.value))} />
        </label>
        <label className="gdField">
          <span className="gdLabel">For the company</span>
          <Input value={persona.company || ''} placeholder="e.g. Acme" onChange={(event) => set(setPersonaField(config, 'company', event.target.value))} />
        </label>
      </div>
      <div className="gdField">
        <span className="gdLabel" id={`${ids}-tone`}>
          How it sounds
        </span>
        <Cards
          label="Tone"
          className="five"
          options={[...TONES, { id: 'own', name: 'Your own…', line: 'Describe it' }]}
          value={ownTone ? 'own' : tone?.id}
          onPick={(pick) => {
            if (pick === 'own') {
              setOwnTone(true);
              return;
            }
            setOwnTone(false);
            set(setTone(config, TONES.find((t) => t.id === pick).words));
          }}
        />
        {ownTone && (
          <Input
            aria-label="Its tone, in a few words"
            value={simple.tone}
            placeholder="e.g. calm, reassuring, never rushed"
            onChange={(event) => set(setTone(config, event.target.value))}
          />
        )}
      </div>
      <div className="gdField">
        <span className="gdLabel" id={`${ids}-role`}>
          What it should do <span className={`gdCount ${words < 8 ? 'warn' : ''}`}>{words === 1 ? '1 word' : `${words} words`}</span>
        </span>
        <div className="gdStarts">
          <span>Start from:</span>
          {START_FROM.map((s) => (
            <button key={s.id} type="button" className="gdChip" onClick={() => startFrom(s)}>
              {s.label}
            </button>
          ))}
        </div>
        <TextArea aria-labelledby={`${ids}-role`} rows={5} value={simple.role} onChange={(event) => set(setRole(config, event.target.value))} />
        <small className="gdHint">
          {isStarterRole(simple.role)
            ? 'These are the starting point’s own words: make them yours, with what your business does and what people ask about.'
            : words < 8
              ? 'A sentence or two more helps it do the job well: who gets in touch, what they want, and what it must never do.'
              : 'Plain sentences work best. Say what to help with, what never to do, and when to hand over.'}
        </small>
      </div>
      <label className="gdField">
        <span className="gdLabel">What it says first</span>
        <Input
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

// 2 · language and voice: the common languages and three voices as cards; the full pickers one press away
const COMMON = ['en-GB', 'en-US', 'es-ES', 'fr-FR', 'zh-CN'];
const native = (code) => {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code.split('-')[0]) || code;
  } catch {
    return code;
  }
};

function VoiceStep({ config, set }) {
  const read = readSimple(config);
  const mainCode = read.primaryLanguage;
  const [moreLanguages, setMoreLanguages] = useState(false);
  const [moreVoices, setMoreVoices] = useState(false);
  const codes = mainCode && !COMMON.includes(mainCode) ? [mainCode, ...COMMON.slice(0, 4)] : COMMON;
  const languages = codes.map((code) => ({
    id: code,
    name: (LANGUAGES.find(([c]) => c === code)?.[1] || languageName(code)).replace('United Kingdom', 'UK').replace('United States', 'US'),
    line: native(code),
  }));

  return (
    <div className="gdFields">
      <div className="gdField">
        <span className="gdLabel">Main language</span>
        <Cards
          label="Main language"
          className="six"
          options={[...languages, { id: 'more', name: moreLanguages ? 'Fewer choices' : 'More languages…', line: `${LANGUAGES.length} in all` }]}
          value={moreLanguages ? 'more' : mainCode}
          onPick={(code) => {
            if (code === 'more') setMoreLanguages((m) => !m);
            else set(setPrimaryLanguage(config, code));
          }}
        />
        {moreLanguages && (
          <div className="gdInset">
            <LanguagePicker config={config} set={set} brief />
          </div>
        )}
      </div>
      <div className="gdField">
        <span className="gdLabel">
          Its voice <span className="gdSoft">· press play to hear one</span>
        </span>
        {read.voiceChannel ? (
          <>
            <VoiceCards key={mainCode} config={config} set={set} />
            <button type="button" className="gdLink" aria-expanded={moreVoices} onClick={() => setMoreVoices((m) => !m)}>
              {moreVoices ? 'Fewer voices' : 'Search every voice'}
            </button>
            {moreVoices && (
              <div className="gdInset">
                <VoicePicker key={mainCode} config={config} set={set} />
              </div>
            )}
          </>
        ) : (
          <p className="gdNote">It only types, so it needs no voice. Switch on talking or phone calls in step 5, and you choose one here.</p>
        )}
      </div>
      <p className="gdNote">The voice is used only on calls and web voice. A chat-only agent skips it.</p>
    </div>
  );
}

function VoiceCards({ config, set }) {
  const { providers } = useProviders();
  const preview = useVoicePreview();
  const tts = readModels(config).tts;
  const inUse = voiceInUse(tts);
  // three voices that speak its language, the one in use first (fixed when the step opens, so picking doesn't reorder)
  const [voices] = useState(() => {
    const name = languageName(readSimple(config).primaryLanguage);
    const language = voiceFilters().languages.includes(name) ? name : '';
    return filterVoices({ language, current: tts }).slice(0, 3);
  });
  return (
    <div className="gdCards three" role="radiogroup" aria-label="Voice">
      {voices.map((v) => (
        <div key={v.id} className="gdVoice">
          {preview.can && (
            <button
              type="button"
              className="gdPlay"
              aria-label={preview.playing === v.id ? `Stop ${v.name}` : `Listen to ${v.name}`}
              onClick={() => preview.play(v)}
            >
              <Icon name={preview.playing === v.id ? 'stop' : 'play'} size={12} />
            </button>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={inUse?.id === v.id}
            className="gdPick"
            onClick={() => set(applyVoice(config, { provider: v.engine, voiceId: v.voiceId }, providers))}
          >
            <strong>{v.name}</strong>
            <span>
              {v.style} · {v.language}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

// 6 · how a conversation moves: one agent, or a first one passing people to specialists named here
function FlowStep({ config, set, onOpen }) {
  const agents = (Array.isArray(config?.agents?.items) ? config.agents.items : []).filter((a) => a && typeof a === 'object');
  const entry = agents.find((a) => a.id === config?.agents?.entry) || agents[0];
  const [many, setMany] = useState(agents.length > 1);
  const [name, setName] = useState('');
  const several = agents.length > 1;
  const add = () => {
    const clean = name.trim();
    if (!clean || !entry) return;
    set(addSubagent(config, entry.id, { name: clean }).config);
    setName('');
  };
  return (
    <div className="gdFields">
      <div className="gdCards two big" role="radiogroup" aria-label="How a conversation moves">
        <button type="button" role="radio" aria-checked={!many && !several} className="gdPick" disabled={several} onClick={() => setMany(false)}>
          <OneAgentPicture name={entry ? agentLabel(config, entry.id) : 'Your agent'} />
          <strong>One agent answers everything</strong>
          <span>
            {several ? `It has ${agents.length} agents now: remove the others on the Workflow canvas to go back to one.` : 'Simple, and right for most agents.'}
          </span>
        </button>
        <button type="button" role="radio" aria-checked={many || several} className="gdPick" onClick={() => setMany(true)}>
          <ManyAgentsPicture />
          <strong>A first agent passes people on</strong>
          <span>Name the specialists; draw the details on the Workflow canvas.</span>
        </button>
      </div>
      {(many || several) && (
        <div className="gdField">
          <span className="gdLabel">{entry ? `${agentLabel(config, entry.id)} answers first, and passes people to` : 'The specialists'}</span>
          <div className="gdChips">
            {agents
              .filter((a) => a !== entry)
              .map((a) => (
                <span key={a.id} className="gdChip on">
                  {agentLabel(config, a.id)}
                </span>
              ))}
            <form
              className="gdAddInline"
              onSubmit={(event) => {
                event.preventDefault();
                add();
              }}
            >
              <Input size="small" aria-label="A specialist’s name" placeholder="e.g. Billing" value={name} onChange={(event) => setName(event.target.value)} />
              <Button type="submit" size="compact" variant="secondary" disabled={!name.trim()}>
                <Icon name="plus" size={14} /> Add a specialist
              </Button>
            </form>
          </div>
          <p className="gdNote">
            Each one is added to the canvas, ready to wire up.{' '}
            <button type="button" className="gdLink" onClick={() => onOpen('workflow')}>
              Open the Workflow canvas
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
function OneAgentPicture({ name }) {
  return (
    <svg className="gdPicture" width="200" height="76" viewBox="0 0 200 76" aria-hidden="true">
      <rect x="50" y="18" width="100" height="40" rx="10" className="gdBoxOn" />
      <text x="100" y="42" textAnchor="middle">
        {name.length > 16 ? `${name.slice(0, 15)}…` : name}
      </text>
    </svg>
  );
}
function ManyAgentsPicture() {
  return (
    <svg className="gdPicture" width="200" height="76" viewBox="0 0 200 76" aria-hidden="true">
      <rect x="6" y="24" width="56" height="30" rx="8" className="gdBox" />
      <text x="34" y="43" textAnchor="middle">
        First
      </text>
      <path d="M62 39 L120 16 M62 39 L120 39 M62 39 L120 62" className="gdWire" />
      {['Billing', 'Orders', 'Repairs'].map((label, i) => (
        <g key={label}>
          <rect x="120" y={6 + i * 23} width="70" height="20" rx="6" className="gdBox" />
          <text x="155" y={20 + i * 23} textAnchor="middle">
            {label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// 7 · its boundaries: the topics, and the three moments it acts on by itself
function LimitsStep({ config, set }) {
  const ids = useId();
  const topics = topicsOf(config);
  const moments = momentsOf(config);
  return (
    <div className="gdFields">
      <div className="gdField">
        <span className="gdLabel" id={`${ids}-allowed`}>
          It talks about
        </span>
        <ChipList
          id={`${ids}-a`}
          label="It talks about"
          items={topics.allowed}
          placeholder="Add a topic"
          onChange={(items) => set(setTopics(config, 'allowed', items))}
        />
      </div>
      <div className="gdField">
        <span className="gdLabel" id={`${ids}-blocked`}>
          It never talks about
        </span>
        <ChipList
          id={`${ids}-b`}
          label="It never talks about"
          items={topics.blocked}
          placeholder="Add a topic"
          onChange={(items) => set(setTopics(config, 'blocked', items))}
        />
      </div>
      <div className="gdSwitches">
        {MOMENTS.map((m) => {
          const state = moments[m.id];
          const note = state.changed || (!state.possible ? state.why : state.needsHandOver && !state.on ? BRINGS_HAND_OVER : '');
          return (
            <div key={m.id} className="gdSwitchRow">
              <span>
                <strong>{m.label}</strong>
                <small>{note || m.text}</small>
              </span>
              <Switch
                label={m.label}
                checked={state.on}
                disabled={!state.possible && !state.on}
                onChange={(on) => {
                  const base = on && state.needsHandOver ? setHandOver(config, true) : config;
                  set(setMoment(base, m.id, on, { keywords: state.keywords }));
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 8 · after the call: the summary, the common questions (and your own), and what is kept
const KEEPS = [
  { id: 'none', name: 'Nothing', transcript: false, audio: false },
  { id: 'transcript', name: 'The transcript', transcript: true, audio: false },
  { id: 'both', name: 'Transcript and audio', transcript: true, audio: true },
];
function AfterStep({ config, set }) {
  const after = afterCallOf(config);
  const [own, setOwn] = useState('');
  const asked = (text) => after.questions.find((q) => q.question.trim().toLowerCase() === text.trim().toLowerCase());
  const keep = after.recording.audio ? 'both' : after.recording.transcript ? 'transcript' : after.recording.transcript === false ? 'none' : '';
  const ideas = QUESTION_IDEAS.map((idea) => ({ ...idea, have: asked(idea.question) }));
  const others = after.questions.filter((q) => !QUESTION_IDEAS.some((idea) => idea.question.toLowerCase() === q.question.trim().toLowerCase()));
  return (
    <div className="gdFields">
      <div className="gdSwitches">
        <div className="gdSwitchRow">
          <span>
            <strong>Write a summary of each call</strong>
            <small>Why they called, what was done, anything to follow up</small>
          </span>
          <Switch label="Write a summary of each call" checked={after.summary.on === true} onChange={(on) => set(setSummary(config, { on }))} />
        </div>
      </div>
      <div className="gdField">
        <span className="gdLabel">
          Ask about every call <span className="gdSoft">· counted on Monitoring</span>
        </span>
        <div className="gdChips">
          {ideas.map((idea) => (
            <button
              key={idea.question}
              type="button"
              aria-pressed={!!idea.have}
              className={`gdChip ${idea.have ? 'on' : 'add'}`}
              onClick={() => set(idea.have ? removeQuestion(config, idea.have.index) : addQuestion(config, idea))}
            >
              <Icon name={idea.have ? 'check' : 'plus'} size={13} /> {idea.question}
            </button>
          ))}
          {others.map((q) => (
            <button key={q.index} type="button" aria-pressed="true" className="gdChip on" onClick={() => set(removeQuestion(config, q.index))}>
              <Icon name="check" size={13} /> {q.question || 'A question with no words yet'}
            </button>
          ))}
        </div>
        <form
          className="gdAddInline"
          onSubmit={(event) => {
            event.preventDefault();
            if (!own.trim()) return;
            set(addQuestion(config, { question: own.trim(), type: 'string' }));
            setOwn('');
          }}
        >
          <Input
            size="small"
            aria-label="Your own question"
            placeholder="e.g. Did they ask about prices?"
            value={own}
            onChange={(event) => setOwn(event.target.value)}
          />
          <Button type="submit" size="compact" variant="secondary" disabled={!own.trim()}>
            <Icon name="plus" size={14} /> Add it
          </Button>
        </form>
      </div>
      <div className="gdField">
        <span className="gdLabel">What is kept</span>
        <div className="gdChips" role="radiogroup" aria-label="What is kept">
          {KEEPS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={keep === k.id}
              className="gdChip choice"
              onClick={() => {
                const next = setRecording(config, { transcript: k.transcript, audio: k.audio });
                // keeping the audio tells callers first, with the usual line unless one is written
                set(k.audio && !after.notice ? setNotice(next, RECORDING_NOTICE) : next);
              }}
            >
              {k.name}
            </button>
          ))}
        </div>
        <p className="gdNote">{after.notice ? `Callers hear first: “${after.notice}”` : 'Keeping the audio adds a line telling callers at the start.'}</p>
      </div>
    </div>
  );
}

// ---- 9 · ready to try --------------------------------------------------------------------------------------------
function ReadyStep({ config, steps, todo, problems, onStep, onOpen, onTest, onPublish }) {
  const read = readSimple(config);
  const rows = steps.filter((s) => s.id !== 'ready');
  const badges = [
    ...reachWords(config),
    ...canWords(config).map((w) => w.replace(/^./, (c) => c.toUpperCase())),
    rows.find((s) => s.id === 'knowledge').state === 'done' ? rows.find((s) => s.id === 'knowledge').answer : '',
  ].filter(Boolean);
  const left = todo.length;
  return (
    <div className="gdReady">
      <section className="gdReadyCard" aria-label="Your agent" data-orb-surface="dark">
        <span className="gdSoFarLabel">
          Step {steps.length} of {steps.length} · Ready to try
        </span>
        <AiOrb size={180} />
        <div className="gdReadyName">
          <strong>{nameOf(config)}</strong>
          <span>{taglineOf(config)}</span>
        </div>
        {read.greeting && <p className="gdBubble">{read.greeting}</p>}
        {badges.length > 0 && (
          <ul className="gdBadges">
            {badges.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div className="gdReadyActions">
          <button type="button" className="gdTalk" onClick={onTest}>
            <Icon name="play" size={14} /> Talk to it
          </button>
          <button type="button" className="gdGhost" onClick={onPublish}>
            Publish a version
          </button>
        </div>
      </section>
      <section className="gdReadyList">
        <header className="gdHead">
          <h1 id="gd-question" tabIndex={-1}>
            {left ? (left === 1 ? 'Almost there: one thing left' : `Almost there: ${left} things left`) : 'Ready to try'}
          </h1>
          <p>
            {left
              ? 'Try it now, or finish these first. Nothing here is final.'
              : problems
                ? `Everything is chosen. The checks found ${problems === 1 ? 'a problem' : `${problems} problems`} to look at before publishing.`
                : 'Everything it needs is chosen. Talk to it, then publish a version people can reach.'}
          </p>
        </header>
        {todo.map((s) => (
          <div key={s.id} className="gdTodo">
            <span aria-hidden="true">!</span>
            <span>
              <strong>{s.todo}</strong>
              <small>{s.lead}</small>
            </span>
            <Button type="button" variant="primary" size="compact" onClick={() => onStep(s.id)}>
              Do it
            </Button>
          </div>
        ))}
        <ol className="gdAnswers">
          {rows.map((s) => (
            <li key={s.id} className={s.state}>
              <span className="gdMark" aria-hidden="true">
                {s.state === 'done' ? <Icon name="check" size={13} /> : s.state === 'todo' ? '!' : '–'}
              </span>
              <strong>{s.title}</strong>
              <span className="gdAnswer">{s.answer}</span>
              <button type="button" className="gdLink" onClick={() => onStep(s.id)}>
                Change<span className="srOnly"> {s.title.toLowerCase()}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="gdMore">
          Want every setting?{' '}
          <button type="button" className="gdLink" onClick={() => onOpen('agent')}>
            Open the Detailed view
          </button>
          , where each part has all of its fields.
        </p>
      </section>
    </div>
  );
}
