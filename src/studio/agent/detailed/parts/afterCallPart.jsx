import React, { useEffect, useRef } from 'react';
import { Input } from '../../../../ui/Input.tsx';
import Button from '../../../../ui/Button.tsx';
import { TryRedactionView } from '../../../form/TryPanels.jsx';
import {
  ANSWER_KINDS,
  QUESTION_IDEAS,
  SENSITIVE,
  addQuestion,
  afterCallOf,
  removeQuestion,
  setNotice,
  setQuestion,
  setRecording,
  setRedaction,
  setSummary,
} from '../../blocks/afterCallModel.js';
import { setPath } from '../schemaFacts.js';
import { ChipList } from '../Detailed.jsx';

// 10 · After the call: what happens once it hangs up: what it writes (a summary, answers to questions), how the call
// closes, what is kept and for how long, and what is hidden in it. afterCallModel.js writes post_call and the recording
// notice; the call logs are observability.session_log; closing messages are wrapups.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const LOG = ['observability', 'session_log'];
const RED = ['post_call', 'redaction'];

// The field that should take the keyboard once it is drawn: a question just added, or after a removal the row that
// took its place (else "A question of your own"). Set by Add and Remove; taken by the add row, drawn after them all.
let wanted = null;
const questionId = (index) => `dt-aftercall-q${index}`;
const OWN = 'dt-aftercall-own';

// one question asked of every call: its words, the kind of answer, and the answers it may pick from
function QuestionRow({ ctx, id, q }) {
  const change = (patch) => ctx.set(setQuestion(ctx.config, q.index, patch));
  // the answers of "One of a list", kept while another kind is tried, so switching back brings them back
  const kept = useRef(null);
  const pickKind = (type) => {
    if (q.type === 'enum' && type !== 'enum') kept.current = q.values;
    change(type === 'enum' && kept.current?.length ? { type, values: kept.current } : { type });
  };
  const remove = () => {
    const shown = afterCallOf(ctx.config).questions;
    const next = shown[shown.findIndex((x) => x.index === q.index) + 1];
    // the next question moves up one place in the list
    wanted = next ? questionId(next.index - 1) : OWN;
    ctx.set(removeQuestion(ctx.config, q.index));
  };
  return (
    <div className="dtStack">
      <span className="dtInline">
        <Input id={id} value={q.question} placeholder="Was the caller’s problem solved?" onChange={(event) => change({ question: event.target.value })} />
        <Button type="button" size="small" variant="quiet" onClick={remove} aria-label={`Remove question “${q.question || q.index + 1}”`}>
          Remove
        </Button>
      </span>
      <div className="dtPills" role="radiogroup" aria-label={`Kind of answer to question ${q.index + 1}`}>
        {ANSWER_KINDS.map(([kind, label]) => (
          <button key={kind} type="button" role="radio" aria-checked={q.type === kind} className={q.type === kind ? 'on' : ''} onClick={() => pickKind(kind)}>
            {label}
          </button>
        ))}
      </div>
      {q.type === 'enum' && (
        <ChipList id={`${id}-values`} label="Answers it can pick from" items={q.values} onChange={(values) => change({ values })} placeholder="+ An answer" />
      )}
    </div>
  );
}

// "Add a question": the ideas not asked yet, and one of your own; a new question takes the keyboard
function AddQuestions({ ctx }) {
  useEffect(() => {
    const el = wanted && document.getElementById(wanted);
    if (!el) return;
    wanted = null;
    el.focus();
  });
  const add = (idea) => {
    wanted = questionId(list(ctx.config?.post_call?.analysis).length);
    ctx.set(addQuestion(ctx.config, idea));
  };
  return (
    <div className="dtPills">
      {QUESTION_IDEAS.filter((idea) => !afterCallOf(ctx.config).questions.some((q) => q.question === idea.question)).map((idea) => (
        <button key={idea.question} type="button" onClick={() => add(idea)}>
          + {idea.question}
        </button>
      ))}
      <button type="button" id={OWN} className="on" onClick={() => add({})}>
        + A question of your own
      </button>
    </div>
  );
}

// the first closing message: how long it waits, and what it does when the caller stays silent
const WRAP = (config) => (list(config?.wrapups).some(isObj) ? ['wrapups', list(config.wrapups).findIndex(isObj)] : null);
const wrapRow = (key, row) => ({
  ...row,
  pathFor: (config) => (WRAP(config) ? [...WRAP(config), key] : null),
  disabled: (config) => !WRAP(config),
});

export const afterCallPart = {
  id: 'aftercall',
  num: '10',
  title: 'After the call',
  question: 'What happens once it hangs up? What it writes, what it keeps, and what it hides.',
  cols: [
    [
      {
        id: 'summary',
        title: 'Summary',
        rows: [
          {
            id: 'summary',
            label: 'Write a summary of each call',
            kind: 'sw',
            errPath: ['post_call', 'summary'],
            get: (c) => afterCallOf(c).summary.on === true,
            put: (c, on) => setSummary(c, { on }),
          },
          {
            id: 'cover',
            label: 'What it should cover',
            kind: 'long',
            rows: 2,
            placeholder: 'Why they called, what was done, anything to follow up.',
            disabled: (c) => afterCallOf(c).summary.on !== true,
            get: (c) => afterCallOf(c).summary.prompt,
            put: (c, prompt) => setSummary(c, { prompt: prompt ?? '' }),
          },
        ],
        adv: [{ id: 'llm', label: 'Model that writes the summaries', kind: 'form', path: ['post_call', 'summary', 'llm'] }],
      },
      {
        id: 'questions',
        title: 'Questions about each call',
        lead: 'Answered after every call, so you can count them on Monitoring.',
        rowsFor: (c) => [
          ...afterCallOf(c.config).questions.map((q) => ({
            id: `q${q.index}`,
            label: q.question || `Question ${q.index + 1}`,
            hint: 'Its words, and the kind of answer',
            errPath: ['post_call', 'analysis', q.index],
            render: (ctx) => <QuestionRow ctx={ctx} id={ctx.id} q={q} />,
          })),
          {
            id: 'add',
            label: 'Add a question',
            hint: 'Or start from one of these',
            render: (ctx) => <AddQuestions ctx={ctx} />,
          },
        ],
      },
      {
        id: 'closing',
        title: 'Closing the call',
        body: (c) =>
          !WRAP(c.config) ? (
            <div className="dtCardAction">
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() => c.set(setPath(c.config, ['wrapups'], [{ id: 'closing', wait_s: 10, on_silence: [{ type: 'end_call' }] }]))}
              >
                Add a closing message
              </Button>
            </div>
          ) : null,
        rows: [
          wrapRow('wait_s', { id: 'wait', label: 'Wait before closing', kind: 'num', unit: 'seconds' }),
          wrapRow('on_silence', { id: 'silent', label: 'When the caller stays silent', kind: 'form' }),
        ],
      },
    ],
    [
      {
        id: 'recording',
        title: 'Recording and keeping',
        rows: [
          { id: 'log', label: 'Keep a log of each call', path: [...LOG, 'enabled'] },
          { id: 'logdays', label: 'Delete logs after', unit: 'days', path: [...LOG, 'retention_days'] },
          {
            id: 'audio',
            label: 'Keep the audio',
            kind: 'sw',
            get: (c) => afterCallOf(c).recording.audio === true,
            put: (c, audio) => setRecording(c, { audio }),
          },
          {
            id: 'transcript',
            label: 'Keep the transcript',
            kind: 'sw',
            get: (c) => afterCallOf(c).recording.transcript === true,
            put: (c, transcript) => setRecording(c, { transcript }),
          },
          {
            id: 'days',
            label: 'Delete audio and transcripts after',
            kind: 'num',
            unit: 'days',
            integer: true,
            get: (c) => afterCallOf(c).recording.days ?? undefined,
            put: (c, days) => setRecording(c, { days: days ?? null }),
          },
          {
            id: 'notice',
            label: 'Recording notice',
            hint: 'Said at the start when anything is kept',
            kind: 'text',
            errPath: ['persona', 'disclosures'],
            get: (c) => afterCallOf(c).notice,
            put: (c, text) => setNotice(c, text ?? ''),
          },
        ],
        adv: [
          { id: 'files', label: 'Files saved after the call', kind: 'form', path: ['post_call', 'artifacts'] },
          { id: 'folder', label: 'Log folder', path: [...LOG, 'directory'] },
          { id: 'detail', label: 'How much to record', path: [...LOG, 'detail'] },
        ],
      },
      {
        id: 'privacy',
        title: 'Privacy',
        rows: [
          {
            id: 'hide',
            label: 'Hide sensitive details in what is kept',
            kind: 'sw',
            get: (c) => afterCallOf(c).redaction.on,
            put: (c, on) => setRedaction(c, { on }),
          },
          {
            id: 'entities',
            label: 'What it looks for',
            kind: 'multi',
            options: SENSITIVE.map(([value, label]) => ({ value, label })),
            disabled: (c) => !afterCallOf(c).redaction.on,
            get: (c) => afterCallOf(c).redaction.entities,
            put: (c, entities) => setRedaction(c, { entities }),
          },
          { id: 'replace', label: 'Replace it with', placeholder: '[REDACTED]', disabled: (c) => !afterCallOf(c).redaction.on, path: [...RED, 'replacement'] },
          { id: 'patterns', label: 'Your own patterns', disabled: (c) => !afterCallOf(c).redaction.on, path: [...RED, 'patterns'] },
          { id: 'try', label: 'Try a line', tags: 'p', render: (c) => <TryRedactionView config={c.config} /> },
        ],
        adv: [
          { id: 'secrets', label: 'Also hide remembered secrets', path: [...RED, 'mask_sensitive_state'] },
          { id: 'pii', label: 'Log personal details', path: ['observability', 'log_pii'] },
          { id: 'requests', label: 'Keep full model requests', path: ['observability', 'log_llm_requests'] },
          { id: 'metrics', label: 'Collect metrics', path: ['observability', 'metrics'] },
          { id: 'level', label: 'Log detail', path: ['observability', 'log_level'] },
          { id: 'tracing', label: 'Tracing', path: ['observability', 'tracing'] },
        ],
      },
    ],
  ],
};
