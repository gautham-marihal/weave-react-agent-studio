import React, { useState } from 'react';
import { greetingOf, greetingTarget, readSimple, setGreeting, setPersonaField, setRole, setTone } from '../../simple/simpleModel.js';
import { isStarterRole } from '../../setup/setupModel.js';
import { FieldTitle } from '../../setup/StepFields.jsx';

// Who the agent is, in Build's Guided view: company, spoken name, tone, instructions and greeting. "Explain" says
// more on request. (The name in the agents list is changed with Rename, under "More" in the bar.)

// The tones offered, each written into the draft as words the model reads. A tone typed elsewhere stays, none marked.
const TONES = [
  ['Warm', 'warm, friendly, patient'],
  ['Neutral', 'neutral, clear, to the point'],
  ['Formal', 'formal, polite, precise'],
  ['Upbeat', 'upbeat, cheerful, energetic'],
];

const EXPLAIN = {
  company: 'The business it speaks for. It says it in its greeting (“thank you for calling Acme”) and when someone asks who they are talking to.',
  spoken: 'The name it introduces itself by, if it uses one, like “Maya”. Leave it as it is to have it speak only for the business.',
  tone: 'How it sounds in every reply. Warm suits help and care, Neutral information, Formal banks and legal matters, Upbeat sales and bookings.',
  role: 'The brief it works from in every conversation. Write it as you would for a new receptionist: who gets in touch, what they usually want, what to do, and what never to do. For example: “Help people book, move or cancel check-ups. Never give medical advice; pass anyone in pain to the team.”',
  greeting: 'Said word for word as soon as a call is answered or a chat opens. Keep it short and end with a question.',
};

export default function IdentityFields({ config, set }) {
  const simple = readSimple(config);
  const persona = config?.persona || {};
  // the channels the greeting is written to, fixed at the first change (as on the Agent page)
  const [greetingFor, setGreetingFor] = useState(null);
  const greeting = greetingOf(config, greetingFor);
  const tone = TONES.find(([, words]) => words === simple.tone);

  return (
    <div className="tw-grid tw-items-start tw-gap-x-6 tw-gap-y-6 md:tw-grid-cols-2">
      <label className="suField">
        <FieldTitle label="Company name" explain={EXPLAIN.company} />
        <input
          className="stFInput"
          value={persona.company || ''}
          placeholder="e.g. Acme"
          onChange={(event) => set(setPersonaField(config, 'company', event.target.value))}
        />
      </label>
      <label className="suField">
        <FieldTitle label="Agent’s spoken name" explain={EXPLAIN.spoken} />
        <input className="stFInput" value={persona.name || ''} onChange={(event) => set(setPersonaField(config, 'name', event.target.value))} />
        <small>What it calls itself.</small>
      </label>

      <div className="suField md:tw-col-span-2">
        <FieldTitle label="Tone" explain={EXPLAIN.tone} />
        <div className="segmented tw-w-fit" role="group" aria-label="Tone">
          {TONES.map(([label, words]) => (
            <button key={label} type="button" aria-pressed={tone?.[0] === label} onClick={() => set(setTone(config, words))}>
              {label}
            </button>
          ))}
        </div>
        {!tone && simple.tone && <small>Its own now: “{simple.tone}”.</small>}
      </div>

      <label className="suField md:tw-col-span-2">
        <FieldTitle label="Instructions" explain={EXPLAIN.role} />
        <textarea className="stFInput" rows={6} value={simple.role} onChange={(event) => set(setRole(config, event.target.value))} />
        <small>
          {isStarterRole(simple.role)
            ? 'These are the starting point’s own words: make them yours, with what your business does and what people ask about.'
            : 'Plain language works best. Say what to help with, what to never do, and when to hand over.'}
        </small>
      </label>

      <label className="suField md:tw-col-span-2">
        <FieldTitle label="What it says first" explain={EXPLAIN.greeting} />
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
