import React, { useEffect, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import LanguagePicker from '../agent/pickers/LanguagePicker.jsx';
import VoicePicker from '../agent/pickers/VoicePicker.jsx';
import { greetingOf, greetingTarget, languageName, readSimple, setAgentName, setGreeting, setRole } from '../simple/simpleModel.js';
import { baseOf } from '../form/messages.ts';
import { starterById } from '../starters.ts';
import { isStarterRole, linesToTranslate, setTranslation, usesVoice, withMainLanguage } from './setupModel.js';
import { Input, TextArea } from '../../ui/Input.tsx';

// Who the agent is (name, purpose, first line) and how it sounds (language, voice): the same fields over the same draft
// in the guided setup and in Build's guided view.

const words = (text) =>
  String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

// A field's title with an "Explain" button that opens a few plain words and an example under it.
export function FieldTitle({ label, explain }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="suFieldHead">
        <span>{label}</span>
        {explain && (
          <button
            type="button"
            className="suExplain"
            aria-expanded={open}
            onClick={(event) => {
              event.preventDefault(); // inside a label: the click explains, it doesn't move the cursor into the field
              setOpen((was) => !was);
            }}
          >
            <Icon name="sparkle" size={13} /> Explain
          </button>
        )}
      </span>
      {open && <small className="suExplainNote">{explain}</small>}
    </>
  );
}

const EXPLAIN = {
  name: 'Only you and your team see this name, in the list of agents. Callers hear what it says first instead.',
  role: 'The brief the agent works from in every conversation. Write it as you would for a new receptionist: who gets in touch, what they usually want, what to say or do, and what never to do. For example: “You answer calls for Smile Dental. Help people book, move or cancel check-ups. Never give medical advice; pass anyone in pain to the team.”',
  greeting:
    'Said word for word when a call is answered or a chat opens, before anyone speaks. Keep it short and end with a question. For example: “Hello, thank you for calling Smile Dental. How can I help?”',
};

// Who it is: its name, what it should do, and the first thing it says.
export function PurposeFields({ config, set }) {
  const simple = readSimple(config);
  // the channels the greeting is written to, fixed at its first change (as on the Agent page): those saying the same
  // line. Others (or one waiting for the caller) are left alone, and a line that is an agent message stays one.
  const [greetingFor, setGreetingFor] = useState(null);
  const greeting = greetingOf(config, greetingFor);
  const example = starterById('support').role;
  return (
    <div className="suFields">
      <label className="suField">
        <FieldTitle label="Its name" explain={EXPLAIN.name} />
        <small>What you and your team see in the list of agents.</small>
        <Input value={config?.meta?.name || ''} onChange={(event) => set(setAgentName(config, event.target.value))} />
      </label>
      <label className="suField">
        <FieldTitle label="What it should do" explain={EXPLAIN.role} />
        <small>Who it helps, what it does for them, and anything it must never do. Plain sentences are best.</small>
        <TextArea rows={8} value={simple.role} onChange={(event) => set(setRole(config, event.target.value))} />
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
        <FieldTitle label="The first thing it says" explain={EXPLAIN.greeting} />
        <small>When someone opens the chat or the call is answered.</small>
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

// How it sounds: its language (with the greeting and goodbye in each other language) and, when it talks, its voice.
//   startLanguage: in the guided setup, give an agent with no main language the browser's (elsewhere nothing changes)
export function VoiceFields({ config, set, startLanguage = false }) {
  const voice = usesVoice(config);
  const main = readSimple(config).primaryLanguage;
  useEffect(() => {
    if (startLanguage && !main) set(withMainLanguage(config, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main]);
  return (
    <div className="suFields">
      <section className="suBlock" aria-labelledby="suLanguage">
        <h3 id="suLanguage">Language</h3>
        <LanguagePicker config={config} set={set} brief />
      </section>
      <FixedLinesIn config={config} set={set} />
      <section className="suBlock" aria-labelledby="suVoice">
        <h3 id="suVoice">Voice</h3>
        {voice ? (
          // drawn again when the language changes, so the voices listed first are the ones that speak it
          <VoicePicker key={main} config={config} set={set} />
        ) : (
          <p className="suNote">It only types, so it needs no voice. Switch on talking or phone calls where people reach it, and you choose one here.</p>
        )}
      </section>
    </div>
  );
}

// The greeting and goodbye in each other language, right where languages are added (said word for word, so each needs
// its own text). Fixed lines on the Agent page hold every line; these are the first and last a caller hears.
function FixedLinesIn({ config, set }) {
  const { primaryLanguage, speaks } = readSimple(config);
  const main = baseOf(primaryLanguage) || 'en';
  const others = [...new Set(speaks.map(baseOf))].filter((code) => code && code !== main);
  const lines = linesToTranslate(config);
  if (!others.length || !lines.length) return null;
  return (
    <section className="suBlock" aria-labelledby="suLines">
      <h3 id="suLines">Its greeting and goodbye in {others.map(languageName).join(' and ')}</h3>
      <p className="suNote">These are said word for word, so each language needs its own text. Everything else it words itself, in the caller’s language.</p>
      {others.map((code) =>
        lines.map((line, index) => (
          // by place, not by line: typing makes a greeting a fixed line (a new key), and the box must keep the cursor
          <label className="suField" key={`${code}-${index}`}>
            <span>
              {line.label}, in {languageName(code)}
            </span>
            {line.text[main] && (
              <small>
                In {languageName(main)}: “{line.text[main]}”
              </small>
            )}
            <Input
              value={line.text[code] || ''}
              placeholder={`Write it in ${languageName(code)}`}
              onChange={(event) => set(setTranslation(config, line.key, code, event.target.value))}
            />
          </label>
        )),
      )}
    </section>
  );
}
