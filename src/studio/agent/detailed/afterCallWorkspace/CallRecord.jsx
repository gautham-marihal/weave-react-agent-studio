import React from 'react';
import Icon from '../../../../ui/Icon.jsx';
import { hiddenWords, plural, sampleLine } from './afterCallWords.js';

// The picture at the top of After the call (canvas board P1): what is kept of each call with these settings, drawn as
// one call's record (its summary, the answers to its questions, what was said with the hidden details replaced), beside
// what it keeps and for how long, and what it hides. Each part opens where it is changed. What really happens is a dot:
// done after every call, kept but not done by the server yet, off, or needs a look. Nothing here is a real call: the
// lines are the shape of one, built from the settings.

const HOW = {
  run: 'done after every call',
  kept: 'kept, but the server doesn’t do it yet',
  off: 'off',
  bad: 'needs a look',
};
const Dot = ({ how }) => <i className={`grDot ${how}`} aria-hidden="true" />;

export default function CallRecord({ name, said, onToken, onLine }) {
  const { summary, questions, keeps, hides, notRun } = said;
  const hows = new Set();
  const dot = (how) => {
    hows.add(how);
    return <Dot how={how} />;
  };
  const summaryHow = !summary.on ? 'off' : notRun.summary ? 'kept' : 'run';
  const answersHow = !questions.length ? 'off' : questions.some((q) => q.gap) ? 'bad' : notRun.questions ? 'kept' : 'run';
  const recHow = (on) => (!on ? 'off' : notRun.recording ? 'kept' : 'run');
  const said1 = sampleLine(hides);
  const longest = Math.max(keeps.logDays || 0, keeps.days || 0);
  const bar = (n, how) =>
    n && longest ? (
      <span className="acBar" aria-hidden="true">
        <i className={how === 'kept' ? 'dash' : ''} style={{ width: `${Math.max(6, Math.round((n / longest) * 100))}%` }} />
      </span>
    ) : null;
  const whatWasSaid = keeps.transcript ? 'Transcript' : keeps.log ? 'What was said, in the log' : 'What was said';

  return (
    <figure className="acFigure" aria-label="What is kept of each call">
      <div className="acRecWrap">
        <div className="acRec">
          <div className="acRecHead">
            <span className="acRecIcon" aria-hidden="true">
              <Icon name="phone" size={15} />
            </span>
            <span>
              <b>One call’s record</b>
              <small>what is kept of each call, with these settings</small>
            </span>
          </div>
          <button type="button" className="acSec" onClick={() => onToken('summary')}>
            <span className="acSecHead">
              {dot(summaryHow)}
              <b>Summary</b>
              <em>{!summary.on ? 'not written' : notRun.summary ? 'kept, not written yet' : 'written after every call'}</em>
            </span>
            <span className={`acSecText ${summary.on ? '' : 'muted'}`}>
              {!summary.on ? 'Nothing is written about the call yet.' : summary.prompt || 'Why they called, what was done, anything to follow up.'}
            </span>
          </button>
          <button type="button" className="acSec" onClick={() => onToken('questions')}>
            <span className="acSecHead">
              {dot(answersHow)}
              <b>Answers</b>
              <em>{questions.length ? plural(questions.length, 'question') : 'no questions'}</em>
            </span>
            {questions.length ? (
              questions.slice(0, 4).map((q) => (
                <span key={q.key} className="acQa">
                  <span>{q.name}</span>
                  <b className={q.gap ? 'bad' : ''}>
                    {q.gap ? q.gap.toLowerCase() : q.answers.length ? q.answers.slice(0, 2).join(' / ') + (q.answers.length > 2 ? ' / …' : '') : q.kind}
                  </b>
                </span>
              ))
            ) : (
              <span className="acSecText muted">No questions are asked of it yet.</span>
            )}
            {questions.length > 4 && <span className="acSecText muted">and {plural(questions.length - 4, 'more question')}</span>}
          </button>
          <button type="button" className="acSec" onClick={() => onToken(hides.on ? 'hide' : keeps.transcript ? 'rec' : 'log')}>
            <span className="acSecHead">
              {dot(keeps.transcript ? recHow(true) : keeps.log ? 'run' : 'off')}
              <b>{whatWasSaid}</b>
              <em>{hides.on && said1 ? 'sensitive details hidden' : keeps.transcript || keeps.log ? 'word for word' : 'not kept'}</em>
            </span>
            <span className="acLn">
              <em>Caller</em>
              <span>
                {said1
                  ? said1.map(([text, hidden], i) => (hidden ? <mark key={i}>{text}</mark> : <React.Fragment key={i}>{text}</React.Fragment>))
                  : 'Hello, I’d like some help, please.'}
              </span>
            </span>
            <span className="acLn">
              <em>{name}</em>
              <span>{said1 ? 'Thank you. Let me look into that for you.' : 'Of course. How can I help?'}</span>
            </span>
            {keeps.log && !keeps.transcript && <span className="acSecText muted">… and every tool use and hand-over, as it happened</span>}
          </button>
        </div>

        <div className="acKeeps">
          <h4>What it keeps, and for how long</h4>
          <button type="button" className="acKr" onClick={() => onToken('log')}>
            {dot(keeps.log ? 'run' : 'off')}
            <span className={keeps.log ? '' : 'muted'}>A log of each call</span>
            <small>{keeps.log ? (keeps.logDays ? plural(keeps.logDays, 'day') : 'until deleted') : 'not kept'}</small>
          </button>
          {keeps.log && bar(keeps.logDays, 'run')}
          {[
            ['transcript', 'Transcript'],
            ['audio', 'Audio'],
          ].map(([k, words]) => (
            <React.Fragment key={k}>
              <button type="button" className="acKr" onClick={() => onToken('rec')}>
                {dot(recHow(keeps[k]))}
                <span className={keeps[k] ? '' : 'muted'}>{words}</span>
                <small>{keeps[k] ? (keeps.days ? plural(keeps.days, 'day') : 'until deleted') : 'not kept'}</small>
              </button>
              {keeps[k] && bar(keeps.days, recHow(true))}
            </React.Fragment>
          ))}
          <button type="button" className="acKr" onClick={() => onLine('files')}>
            {dot(keeps.files.length ? 'run' : 'off')}
            <span className={keeps.files.length ? '' : 'muted'}>Files when it ends</span>
            <small>{keeps.files.length || 'none'}</small>
          </button>
          {keeps.files.length > 0 && <span className="acKrMore">{keeps.files.map((f) => f.short).join(' · ')}</span>}

          <h4>{hides.on ? 'What it hides, in all of it' : 'What it hides'}</h4>
          <button type="button" className="acHid" onClick={() => onToken('hide')}>
            {hides.on && (hides.labels.length || hides.patterns.length) ? (
              <span className="acChip">
                {dot('run')}
                {hiddenWords(hides).replace(/^./, (c) => c.toUpperCase())}
              </span>
            ) : hides.on ? (
              <span className="acChip bad">
                {dot('bad')}
                Nothing chosen to look for
              </span>
            ) : null}
            {hides.secrets && (
              <span className="acChip">
                {dot('run')}
                Values it remembers as secret
              </span>
            )}
            {!hides.on && <span className="acKrMore">Card numbers and the like are not looked for yet.</span>}
          </button>
          {hides.on && (
            <span className="acKrMore">
              replaced with <mark>{hides.replacement}</mark>
            </span>
          )}
        </div>
      </div>
      <figcaption className="cxLegend grLegend">
        {['run', 'kept', 'off', 'bad']
          .filter((h) => hows.has(h))
          .map((h) => (
            <span key={h}>
              <Dot how={h} />
              {HOW[h]}
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
