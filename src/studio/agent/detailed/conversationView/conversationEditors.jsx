import React from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Fold from '../../../../ui/Fold.jsx';
import Select from '../../../../ui/Select.tsx';
import { TextArea } from '../../../../ui/Input.tsx';
import Button from '../../../../ui/Button.tsx';
import { NumberInput, Switch } from '../../../form/fields.jsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { DetailedRow } from '../Detailed.jsx';
import { speaks } from '../agentProfile/speaks.js';
import { navigate, routeHref, useRoute } from '../../../route.js';
import { WaitSketch } from './CallDrawing.jsx';
import {
  QUIET,
  RETRY_FIELDS,
  SERVICES,
  WAIT_CHOICES,
  addCheckIn,
  checkIns,
  quietStory,
  readQuiet,
  readWait,
  removeCheckIn,
  retryPath,
  setAdapt,
  setCheckInText,
  setGoodbye,
  setQuietTimeout,
  setUpQuiet,
  setThen,
  setWaitChoice,
  timeWords,
  transfersOf,
  waitWords,
} from './conversationWords.js';
import './conversation.css';

// Build › Conversation's own editors, used as rows of the part (conversationPart.jsx), so they are the same in the
// overview and in All settings: how long it waits, a quiet caller's script, and the retries of each service.
// Each gets the row's context ({ config, set, id, … }).

const nameOf = (config) => readSimple(config).persona || 'It';

// ---- how long it waits: Quick, The usual or Patient, and whether the pause adapts to each caller ------------------
export function WaitChoice({ config, set, id }) {
  const wait = readWait(config);
  const words = waitWords(config);
  return (
    <div className="cvWait" id={id}>
      <div className="cvChoices" role="group" aria-label="How long it waits">
        {WAIT_CHOICES.map((choice, i) => (
          <button
            key={choice.id}
            type="button"
            className={`cvChoice ${wait.choice === choice.id ? 'on' : ''}`}
            aria-pressed={wait.choice === choice.id}
            onClick={() => set(setWaitChoice(config, choice.id))}
          >
            <WaitSketch gap={[6, 16, 34][i]} />
            <b>{choice.name}</b>
            <span className="cvSec">{choice.id === 'usual' ? 'the engine’s timing' : `${choice.min} to ${choice.max} s`}</span>
            <small>{choice.what}</small>
          </button>
        ))}
      </div>
      {wait.choice === 'own' && <p className="cvOwn">Your own: {words.span}. Pick one above to use it instead, or change the seconds below.</p>}
      <div className="cvSwitchRow">
        <span>
          <b>Adapt to each caller</b>
          <small>Learns how long this caller tends to pause, inside the two limits.</small>
        </span>
        <Switch checked={wait.adapt} label="Adapt to each caller" onChange={(on) => set(setAdapt(config, on))} />
      </div>
    </div>
  );
}

// ---- a quiet caller: the script, top to bottom ------------------------------------------------------------------------

// A line the script doesn't edit in place: a fixed line (its words are changed in Agent › Fixed lines), one in several
// languages, or one it words itself. It shows what is said, where it is changed, and offers words of its own instead.
function OtherLine({ said, repeats, onOwnWords }) {
  const route = useRoute();
  const fixedLines = routeHref(route.botId, 'agent');
  const quote = said.text ? `“${said.text}”` : '';
  return (
    <div className="cvQuote">
      {repeats && <span className="cvMuted">Says the last line again:</span>}
      {quote && <span className="cvQuoteText">{quote}</span>}
      <span className="cvMuted">
        {said.message ? (
          <>
            A fixed line: its words are changed in{' '}
            <a
              href={fixedLines}
              onClick={(event) => {
                event.preventDefault();
                navigate(fixedLines);
              }}
            >
              Agent › Fixed lines
            </a>
            .
          </>
        ) : said.what === 'words it makes up itself' ? (
          'It words this itself, following the instruction above.'
        ) : (
          'In several languages: change it in the form below.'
        )}
      </span>
      <button type="button" className="cvAdd" onClick={onOwnWords}>
        Write its own words here
      </button>
    </div>
  );
}
const THEN_CHOICES = (call) => [
  { kind: 'end', name: call ? 'Says goodbye and ends the call' : 'Says goodbye and closes the chat' },
  { kind: 'person', name: 'Passes them to a person' },
  { kind: 'nothing', name: 'Does nothing more' },
];

export function QuietScript(c) {
  const { config, set, id } = c;
  const call = speaks(config);
  const name = nameOf(config);
  const q = readQuiet(config);
  const steps = checkIns(config);
  const transfers = transfersOf(config);
  const wait = q.timeout ? timeWords(q.timeout) : '';
  const story = quietStory(config, call);
  const chooseThen = (kind) => {
    if (kind === q.then.kind) return;
    const goodbye = kind === 'end' ? (call ? 'Thank you for your time. Goodbye.' : 'I’ll close this chat now. Come back any time.') : '';
    set(setThen(config, kind, { transfer: transfers[0]?.id || '', goodbye }));
  };
  return (
    <div className="cvScript" id={id}>
      {q.state === 'unset' && (
        <div className="cvSetup">
          <span className="cvSetupIcon" aria-hidden="true">
            <Icon name="clock" size={16} />
          </span>
          <span className="cvSetupText">
            <b>{name} doesn’t check in yet</b>
            <span>
              {call ? 'A caller who goes quiet keeps the line open until they hang up.' : 'Someone who stops replying keeps the chat open.'} Fill in the script
              below, or start with the usual: two check-ins, then a goodbye.
            </span>
          </span>
          <Button type="button" variant="secondary" size="small" onClick={() => set(setUpQuiet(config, call))}>
            Start with the usual
          </Button>
        </div>
      )}
      <ol className="cvSteps">
        <li className="cvStep">
          <span className="cvDot" aria-hidden="true">
            <Icon name="clock" size={14} />
          </span>
          <div className="cvStepBody">
            <label className="cvInline" htmlFor={`${id}-wait`}>
              {call ? 'The caller goes quiet for' : 'Someone stops replying for'}
            </label>
            <span className="cvInline">
              <NumberInput id={`${id}-wait`} value={q.timeout} min={1} nullable placeholder="seconds" onChange={(n) => set(setQuietTimeout(config, n))} />
              <span className="cvMuted">seconds{q.timeout >= 60 ? ` · ${wait}` : ''}</span>
            </span>
          </div>
        </li>
        {steps.map((step) => (
          <li key={step.at} className="cvStep">
            <span className="cvDot ink" aria-hidden="true">
              {step.at + 1}
            </span>
            <div className="cvStepBody">
              <span className="cvH">
                {step.at === 0 ? `${name} checks in` : `${name} checks in again`}
                <button type="button" className="cvRemove" aria-label={`Remove check-in ${step.at + 1}`} onClick={() => set(removeCheckIn(config, step.at))}>
                  <Icon name="close" size={14} />
                </button>
              </span>
              {step.plain ? (
                <TextArea
                  rows={2}
                  aria-label={`Check-in ${step.at + 1}: what ${name} says`}
                  value={step.repeats ? '' : step.text}
                  placeholder={step.repeats ? `Says the last line again: “${step.text}”` : 'What it says'}
                  onChange={(event) => set(setCheckInText(config, step.at, event.target.value))}
                />
              ) : (
                <OtherLine said={step} repeats={step.repeats} onOwnWords={() => set(setCheckInText(config, step.at, step.text || 'Are you still there?'))} />
              )}
              {wait && <span className="cvMuted">then waits the same {wait}</span>}
            </div>
          </li>
        ))}
        <li className="cvStep">
          <span className="cvDot" aria-hidden="true">
            <Icon name="plus" size={14} />
          </span>
          <div className="cvStepBody">
            <button type="button" className="cvAdd" onClick={() => set(addCheckIn(config))}>
              Add a check-in
            </button>
          </div>
        </li>
        <li className="cvStep last">
          <span className="cvDot end" aria-hidden="true">
            <Icon name="phone" size={14} />
          </span>
          <div className="cvStepBody">
            <span className="cvH">Still nothing: then it</span>
            <div className="cvPills" role="group" aria-label="Then it">
              {THEN_CHOICES(call).map((choice) => {
                const none = choice.kind === 'person' && !transfers.length;
                return (
                  <button
                    key={choice.kind}
                    type="button"
                    aria-pressed={q.then.kind === choice.kind}
                    className={q.then.kind === choice.kind ? 'on' : ''}
                    disabled={none}
                    title={none ? 'Add a transfer under Connections first.' : undefined}
                    onClick={() => chooseThen(choice.kind)}
                  >
                    {choice.name}
                  </button>
                );
              })}
              {q.then.kind === 'own' && (
                <button type="button" aria-pressed className="on" disabled>
                  {q.then.count} steps of its own
                </button>
              )}
            </div>
            {q.then.kind === 'end' &&
              (q.then.goodbye.plain ? (
                <TextArea
                  rows={2}
                  aria-label="What it says as it ends"
                  placeholder="What it says as it ends (or nothing)"
                  value={q.then.goodbye.text}
                  onChange={(event) => set(setGoodbye(config, event.target.value))}
                />
              ) : (
                <OtherLine said={q.then.goodbye} onOwnWords={() => set(setGoodbye(config, q.then.goodbye.text || 'Goodbye.'))} />
              ))}
            {q.then.kind === 'end' && <span className="cvMuted">The goodbye is always played in full before it {call ? 'hangs up' : 'closes'}.</span>}
            {q.then.kind === 'person' && transfers.length > 1 && (
              <Select aria-label="Pass them to" value={q.then.transfer} onChange={(event) => set(setThen(config, 'person', { transfer: event.target.value }))}>
                {transfers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            {q.then.kind === 'person' && transfers.length === 1 && <span className="cvMuted">To {transfers[0].name}.</span>}
            {!transfers.length && <span className="cvMuted">To pass them to a person, add a transfer under Connections first.</span>}
          </div>
        </li>
      </ol>
      {story && <p className="cvStory">{story}</p>}
      <p className="cvNote">
        <Icon name="info" size={14} />
        Tests can’t wait on a real clock, so check-ins only happen in a real {call ? 'call' : 'chat'}. Use Try a {call ? 'call' : 'chat'}.
      </p>
      <Fold className="cvForms">
        <summary>Edit the script as a form</summary>
        <div className="cvFormRows">
          <DetailedRow row={{ id: 'nudgeLines', label: 'What it says', kind: 'form', path: [...QUIET, 'nudges'] }} ctx={c} partId="conversation" />
          <DetailedRow row={{ id: 'quietThen', label: 'Then', kind: 'form', path: [...QUIET, 'on_exhausted'] }} ctx={c} partId="conversation" />
        </div>
      </Fold>
    </div>
  );
}

// ---- the retries of each service, in one grid -----------------------------------------------------------------------
export function RetryGrid({ config, set, id }) {
  return (
    <div className="cvRetry" id={id} role="group" aria-label="Retries per service">
      <span />
      {SERVICES.map(([stage, label]) => (
        <span key={stage} className="cvHd">
          {label}
        </span>
      ))}
      {RETRY_FIELDS.map((f) => (
        <React.Fragment key={f.field}>
          <span className="cvRowName">
            {f.label} <span className="cvMuted">({f.unit})</span>
          </span>
          {SERVICES.map(([stage, label]) => {
            const path = retryPath(stage, f.field);
            const inputId = `${id}-${stage}-${f.field}`;
            return (
              <span key={stage}>
                <label className="srOnly" htmlFor={inputId}>
                  {label}: {f.label.toLowerCase()} ({f.unit})
                </label>
                <NumberInput
                  id={inputId}
                  value={getAtPath(config, path) ?? null}
                  nullable
                  min={0}
                  integer={f.integer}
                  placeholder={String(f.usual)}
                  onChange={(n) => set(setPath(config, path, n === null ? undefined : n))}
                />
              </span>
            );
          })}
        </React.Fragment>
      ))}
      <span className="cvMuted cvSpan">Empty means the usual: 3 tries, 2 s apart, giving up after 10 s.</span>
    </div>
  );
}
