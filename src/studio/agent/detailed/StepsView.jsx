import React, { Suspense, lazy, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import Button from '../../../ui/Button.tsx';
import { describeAction } from '../../form/effects.js';
import { describeCondition } from '../../form/promptPreview.js';
import { PICTURE_STEPS } from '../../pictures/pictureSteps.js';
import { strictnessOf } from '../../pictures/strictness.js';
import { countSteps, isStepList, plural, joinAnd } from './describe.js';

export { isStepList };

const FormEditor = lazy(() => import('../../form/FormEditor.jsx'));

// A list of steps (what happens when a form is sent, a tool's effects…) as a person reads it: numbered cards in order,
// each with what kind of step it is, what it does in words, and when it only runs; photo and video requests show what
// the customer is asked and how strict the check is. Bookkeeping steps (remembering values) are counted, not listed,
// until asked for. Each step opens its own editor in place; the whole list stays editable as before.
//   steps: the list; path: where it is in the draft; ctx: the Detailed context; label: the row's name

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// what kind of step each is, with its icon: the badge on its card
const KINDS = {
  generate: { label: 'Answers', icon: 'sparkle' },
  play_sound: { label: 'Plays a sound', icon: 'sound' },
  collect_dtmf: { label: 'Keypad', icon: 'keypad' },
  log: { label: 'Notes in the log', icon: 'note' },
  handoff: { label: 'Hands over', icon: 'subagent' },
  return_to_entry: { label: 'Goes back', icon: 'arrowLeft' },
  wrapup: { label: 'Wraps up', icon: 'flag' },
  say: { label: 'Says', icon: 'chat' },
  send_form: { label: 'Shows a form', icon: 'list' },
  analyze_image: { label: 'Reads a picture', icon: 'read', media: true },
  compare_values: { label: 'Compares', icon: 'compare', media: true },
  discard_image: { label: 'Forgets pictures', icon: 'forget', media: true },
  http: { label: 'Calls a system', icon: 'plug' },
  set_state: { label: 'Remembers', icon: 'pin' },
  transfer: { label: 'Hands over', icon: 'phoneTransfer' },
  end_call: { label: 'Ends', icon: 'endCall' },
  notify: { label: 'Sends a message', icon: 'mail' },
};
export function kindOfStep(step) {
  if (step?.type === 'request_image')
    return step.kind === 'camera' ? { label: 'Video check', icon: 'camera', media: true } : { label: 'Photo', icon: 'image', media: true };
  return KINDS[step?.type] || { label: String(step?.type || 'Step').replace(/_/g, ' '), icon: 'bolt' };
}

// its words without the "only when…" (that is said on its own line)
const wordsOf = (step) => {
  if (!isObj(step)) return String(step);
  const { when: _when, ...rest } = step;
  return describeAction(rest);
};

// the filters over the list
const VIEWS = [
  { id: 'main', label: 'Main steps', keep: (s) => s?.type !== 'set_state' },
  { id: 'media', label: 'Photo and video', keep: (s) => PICTURE_STEPS.has(s?.type) },
  { id: 'all', label: 'Every step', keep: () => true },
];
const FIRST = 12;

// what a photo or video request asks for, in a few words
function PictureFacts({ step }) {
  const facts = [];
  if (step.timeout_s)
    facts.push(`${step.timeout_s >= 60 && step.timeout_s % 60 === 0 ? plural(step.timeout_s / 60, 'minute') : `${step.timeout_s} seconds`} to send it`);
  const strict = strictnessOf(step.kind, step.quality);
  if (strict) facts.push(strict === 'custom' ? 'own picture standard' : `${strict} picture check`);
  else facts.push('no picture check');
  if (step.into) facts.push(`kept as ${step.into}`);
  return (
    <div className="svPicture">
      {step.prompt && <q className="svPrompt">{step.prompt}</q>}
      <span className="svFacts">{facts.join(' · ')}</span>
    </div>
  );
}

// One step as a card: its number, its kind, what it does, when it only runs, and its editor in place when open.
//   path: the step's own place in the draft
export function StepCard({ step, number, path, ctx, open, onToggle }) {
  const kind = kindOfStep(step);
  return (
    <li className={`svStep ${kind.media ? 'media' : ''} ${open ? 'open' : ''}`} data-step={path.join('.')}>
      <div className="svHead">
        <span className="svNum" aria-hidden="true">
          {number}
        </span>
        <span className="svKind">
          <Icon name={kind.icon} size={13} />
          {kind.label}
        </span>
        <span className="svWords">{wordsOf(step)}</span>
        <Button type="button" variant="quiet" size="small" aria-expanded={open} onClick={onToggle}>
          {open ? 'Done' : 'Edit'}
          <span className="srOnly"> step {number}</span>
        </Button>
      </div>
      {isObj(step) && step.type === 'request_image' && <PictureFacts step={step} />}
      {isObj(step) && step.when && <span className="svWhen">Only when {describeCondition(step.when)}</span>}
      {open && (
        <Suspense fallback={null}>
          <div className="dtForm svEditor">
            <FormEditor editor={ctx.editor} itemPath={path} subtree embedded />
          </div>
        </Suspense>
      )}
    </li>
  );
}

export default function StepsView({ steps, path, ctx, label }) {
  const [view, setView] = useState('main');
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(null);
  const counts = countSteps(steps);
  const kept = VIEWS.find((v) => v.id === view);
  const rows = steps.map((step, i) => ({ step, i })).filter(({ step }) => kept.keep(step));
  const shown = more || view === 'media' ? rows : rows.slice(0, FIRST);
  const hidden = steps.filter((s) => s?.type === 'set_state').length;
  const extras = [
    counts.photo && plural(counts.photo, 'photo request'),
    counts.video && plural(counts.video, 'video check'),
    counts.read && plural(counts.read, 'picture reading', 'picture readings'),
    counts.compare && plural(counts.compare, 'comparison'),
    counts.call && plural(counts.call, 'call to a system', 'calls to systems'),
    counts.transfer && plural(counts.transfer, 'hand-over'),
  ].filter(Boolean);
  const hasMedia = counts.photo + counts.video + counts.read + counts.compare > 0;
  return (
    <div className="svBox">
      <div className="svTop">
        <p className="svSum">
          <b>{plural(steps.length, 'step')}</b>
          {extras.length > 0 && <span>: {joinAnd(extras)}</span>}
        </p>
        <div className="svViews segmented" role="group" aria-label={`Show which steps of ${label}`}>
          {VIEWS.filter((v) => v.id !== 'media' || hasMedia).map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              className={view === v.id ? 'on' : ''}
              onClick={() => {
                setView(v.id);
                setMore(false);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {view === 'main' && hidden > 0 && (
        <p className="svNote">
          {plural(hidden, 'step')} that only remember values are left out here.{' '}
          <button type="button" className="stLink" onClick={() => setView('all')}>
            Show every step
          </button>
        </p>
      )}
      <ol className="svList" aria-label={label}>
        {shown.map(({ step, i }) => (
          <StepCard key={i} step={step} number={i + 1} path={[...path, i]} ctx={ctx} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
        ))}
      </ol>
      {!more && view !== 'media' && rows.length > FIRST && (
        <Button type="button" variant="secondary" size="small" className="svMore" onClick={() => setMore(true)}>
          Show {plural(rows.length - FIRST, 'more step')}
        </Button>
      )}
    </div>
  );
}
