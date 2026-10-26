import React, { useEffect, useRef } from 'react';
import {
  ANSWER_KINDS,
  QUESTION_IDEAS,
  SENSITIVE,
  addQuestion,
  afterCallOf,
  notDoneYet,
  removeQuestion,
  setNotice,
  setQuestion,
  setRecording,
  setRedaction,
  setSummary,
} from './afterCallModel.js';
import { Card, ListBox, NumberBox } from './SimpleParts.jsx';
import { readSimple } from '../../simple/simpleModel.js';
import { RECORDING_NOTICE } from '../../setup/setupModel.js';
import { describeRecords, readRecords, setLogDays, setLogEnabled } from '../../records/recordsModel.js';
import { TryRedactionView } from '../../form/TryPanels.jsx';
import Select from '../../../ui/Select.tsx';

// The top of the After the call page, in plain words: a summary of each call, questions answered about it, what is
// recorded (and what callers are told), and the sensitive details hidden in what is kept. The rest of the page (the
// model that writes summaries, files sent after the call, closing messages, call records and logs) is in the settings
// below, which no longer ask for any of this.
//   unsupported: the validator's `unsupported` list: a card whose part the server says it doesn't do yet says so (none is listed today)

export function SummaryBlock({ config, set, unsupported }) {
  const { summary } = afterCallOf(config);
  return (
    <Card
      icon="records"
      title="Write a summary of each call"
      text="A few lines on what happened, kept with the call."
      on={summary.on}
      unset="Not set: the server decides whether it writes one."
      pending={
        summary.on && notDoneYet(unsupported).summary ? 'Saved with the agent, but the server doesn’t write summaries yet, so calls won’t have one.' : ''
      }
      onToggle={(on) => set(setSummary(config, { on }))}
    >
      {summary.on && (
        <label className="suField">
          <span>What it should cover</span>
          <small>In your own words. Leave it empty for a general summary.</small>
          <textarea
            className="stFInput"
            rows={3}
            value={summary.prompt}
            placeholder="The reason for the call, what was done, and anything to follow up."
            onChange={(event) => set(setSummary(config, { prompt: event.target.value }))}
          />
        </label>
      )}
    </Card>
  );
}

// Each row writes to its own place in the configuration (`q.index`), which is not its place in the list when something there is not a question.
export function QuestionsBlock({ config, set, unsupported }) {
  const { questions } = afterCallOf(config);
  const ideas = QUESTION_IDEAS.filter((idea) => !questions.some((q) => q.question.trim().toLowerCase() === idea.question.toLowerCase()));
  // The answers to choose from of a question switched away from "One of a list", so switching it back brings them back (the configuration keeps a
  // list only with "One of a list").
  const keptValues = useRef(new Map());
  // Where the focus goes once a question is added or removed (the row it is in, or the "Add a question" button), so it is not lost with the button
  // that was pressed: { row, count } waits for the list to have `count` questions.
  const listRef = useRef(null);
  const addRef = useRef(null);
  const focusNext = useRef(null);
  useEffect(() => {
    const next = focusNext.current;
    if (!next || questions.length !== next.count) return;
    focusNext.current = null;
    const row = listRef.current?.querySelectorAll(':scope > li')[next.row];
    (row?.querySelector('input') || addRef.current)?.focus();
  });
  const add = (idea) => {
    focusNext.current = { row: questions.length, count: questions.length + 1 };
    set(addQuestion(config, idea));
  };
  const remove = (q, i) => {
    focusNext.current = { row: i, count: questions.length - 1 };
    set(removeQuestion(config, q.index));
  };
  const setKind = (q, type) => {
    const key = `${q.index}:${q.id}`;
    if (q.type === 'enum' && type !== 'enum') keptValues.current.set(key, q.values);
    const kept = type === 'enum' ? keptValues.current.get(key) : null;
    set(setQuestion(config, q.index, kept?.length ? { type, values: kept } : { type }));
  };
  return (
    <Card
      icon="help"
      title="Answer questions about each call"
      text="When a call ends it is read once more, and these are answered from it: for example, whether the problem was solved."
      pending={questions.length && notDoneYet(unsupported).questions ? 'Saved with the agent, but the server doesn’t answer these questions yet.' : ''}
    >
      {questions.length > 0 && (
        <ul className="smQuestions" aria-label="Questions about each call" ref={listRef}>
          {questions.map((q, i) => (
            <li key={`${q.index}:${q.id}`}>
              <input
                className="stFInput"
                value={q.question}
                placeholder="Type a question about the call"
                aria-label={`Question ${i + 1}`}
                aria-invalid={!q.question.trim() ? true : undefined}
                onChange={(event) => set(setQuestion(config, q.index, { question: event.target.value }))}
              />
              <Select className="stFInput" value={q.type} aria-label={`The answer to question ${i + 1}`} onChange={(event) => setKind(q, event.target.value)}>
                {!q.type && (
                  <option value="" disabled>
                    Choose…
                  </option>
                )}
                {ANSWER_KINDS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
              <button type="button" className="linkButton" onClick={() => remove(q, i)}>
                Remove
              </button>
              {q.type === 'enum' && (
                // the choices sit under their question with a label of their own, so they don't read as another question
                <label className="smValuesField">
                  <span>Answers it can pick from</span>
                  <ListBox
                    className="stFInput smValues"
                    values={q.values}
                    aria-label={`The answers to choose from for question ${i + 1}, separated by commas`}
                    placeholder="Separated by commas, for example: A question, A problem, A complaint"
                    onChange={(values) => set(setQuestion(config, q.index, { values }))}
                  />
                </label>
              )}
              {!q.question.trim() && <small className="smEmptyQuestion">Empty: type a question, or remove it. An empty one is not asked.</small>}
            </li>
          ))}
        </ul>
      )}
      <div className="suActionButtons">
        <button type="button" className="quietButton" ref={addRef} onClick={() => add({ question: '', type: 'boolean' })}>
          Add a question
        </button>
        {ideas.map((idea) => (
          <button key={idea.question} type="button" className="suChip" onClick={() => add(idea)}>
            {idea.question}
          </button>
        ))}
      </div>
    </Card>
  );
}

// What is kept of each call: its log (on unless switched off), the audio and the transcript, each for as long as it
// says, and what callers are told. A box the agent doesn't set is marked as the server's own default; the card ends
// with what all of it means.
export function RecordingBlock({ config, set, unsupported }) {
  const { recording, notice } = afterCallOf(config);
  const records = readRecords(config);
  const voice = readSimple(config).voiceChannel;
  const { lines, problems } = describeRecords(config, { unsupported });
  const recordingPending = (recording.audio || recording.transcript) && notDoneYet(unsupported).recording;
  const serverDefault = <em className="smDefault">Server’s default</em>;
  return (
    <Card
      icon="mic"
      title="Recording"
      text="What is kept of each call, for how long, and what callers are told."
      pending={recordingPending ? 'Saved with the agent, but the server doesn’t record calls this way yet.' : ''}
    >
      <div className="smKept">
        <label className="suCheck">
          <input type="checkbox" checked={records.logOn} onChange={(event) => set(setLogEnabled(config, event.target.checked))} />
          Keep a log of each call <small>what was said, each tool and each request to your systems</small>
          {!records.logExplicit && serverDefault}
        </label>
        {records.logOn && (
          <label className="suField smIndent">
            <span>Delete call logs after</span>
            <span className="smWithUnit">
              <NumberBox
                value={records.logDays ?? ''}
                placeholder="Never"
                aria-label="Delete call logs after, in days"
                onChange={(v) => set(setLogDays(config, v))}
              />
              <span className="smUnit">days</span>
            </span>
          </label>
        )}
        <label className="suCheck">
          <input type="checkbox" checked={recording.audio === true} onChange={(event) => set(setRecording(config, { audio: event.target.checked }))} />
          Keep the audio
          {recording.audio === null && serverDefault}
        </label>
        <label className="suCheck">
          <input
            type="checkbox"
            checked={recording.transcript === true}
            onChange={(event) => set(setRecording(config, { transcript: event.target.checked }))}
          />
          Keep the transcript
          {recording.transcript === null && serverDefault}
        </label>
        {(recording.audio || recording.transcript) && (
          <label className="suField smIndent">
            <span>Delete audio and transcripts after</span>
            <span className="smWithUnit">
              <NumberBox
                value={recording.days ?? ''}
                placeholder="Never"
                aria-label="Delete audio and transcripts after, in days"
                onChange={(v) => set(setRecording(config, { days: v }))}
              />
              <span className="smUnit">days</span>
            </span>
          </label>
        )}
      </div>
      <label className="suField">
        <span>Recording notice</span>
        <small>
          {voice
            ? 'Said at the start of phone and voice calls, before the greeting. Many places require it when calls are kept.'
            : 'Said at the start of phone and voice calls, before the greeting. This agent has none yet, so nothing is said.'}
        </small>
        <input
          className="stFInput"
          value={notice}
          placeholder="This call may be recorded to improve our service."
          onChange={(event) => set(setNotice(config, event.target.value))}
          aria-label="Recording notice"
        />
      </label>
      {/* people who talk to it (a phone line, talking on the website) and are told nothing: said here, where the line is written */}
      {!notice.trim() && voice && (
        <p className="suNote warn" role="status">
          People who talk to it aren’t told that calls are kept. Many places require it.{' '}
          <button type="button" className="linkButton" onClick={() => set(setNotice(config, RECORDING_NOTICE))}>
            Use the usual sentence
          </button>
        </p>
      )}
      <div className="smMeans">
        <span className="suFieldLabel">What this means</span>
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {problems.map((line) => (
            <li key={line} className="warn">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function SensitiveBlock({ config, set, unsupported }) {
  const { redaction } = afterCallOf(config);
  return (
    <Card
      icon="shield"
      title="Hide sensitive details in what is kept"
      text="Replaced before a transcript, a log or a summary is written or sent anywhere."
      on={redaction.on}
      pending={
        redaction.on && notDoneYet(unsupported).redaction
          ? 'Saved with the agent, but the server doesn’t hide these yet: what is kept still holds everything that was said.'
          : ''
      }
      onToggle={(on) => set(setRedaction(config, { on }))}
    >
      {redaction.on && (
        <>
          <span className="suFieldLabel">What it looks for</span>
          <div className="suChecks">
            {SENSITIVE.map(([id, label]) => {
              const checked = redaction.entities.includes(id);
              return (
                <label key={id} className="suCheck">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => set(setRedaction(config, { entities: checked ? redaction.entities.filter((e) => e !== id) : [...redaction.entities, id] }))}
                  />
                  {label}
                </label>
              );
            })}
          </div>
          {!redaction.entities.length && (
            <p className="suNote warn" role="status">
              Nothing is ticked, so only values marked sensitive are hidden.
            </p>
          )}
          <p className="suNote">
            To keep these out of the conversation itself, add a check on the Guardrails page. Your own patterns are in the settings below.
          </p>
          <TryRedactionView config={config} />
        </>
      )}
    </Card>
  );
}
