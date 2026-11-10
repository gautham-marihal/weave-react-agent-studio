import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { groupIssues } from '../../../../api/client.ts';
import { readSimple } from '../../../simple/simpleModel.js';
import { setPath } from '../schemaFacts.js';
import { AllSettings, Line, More, Popover, Rows, ViewSwitch, hasProblem, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import CallRecord from './CallRecord.jsx';
import { LINES, MORE, TOKENS } from './afterCallLayout.js';
import { afterCallIn, forHowLong, hiddenWords, plural, summaryLine } from './afterCallWords.js';
import './afterCallWorkspace.css';

// Build › After the call as what happens once a call ends (design: canvas page "9 · After the call, redesigned"), for
// any agent. A sentence says what it writes (a summary, answers to questions), what it keeps and for how long, what it
// hides, and how a call closes (what is not set is a grey blank after "Not yet:"); under it, one call's record as these
// settings keep it. Then three chapters: how it closes and what it writes, what it keeps, what it hides. A question
// opens in place on its own line. All settings: every setting, searchable. Every view edits with the part's own rows
// (afterCallForm); what the server keeps but doesn't do yet is said from its own report.

const VIEWS = makeViewStore('weave_aftercall_view', 'overview');
const FIRST = ['overview', 'After a call'];
const LABEL = 'How to see after the call';

const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

function joined(nodes, last = 'and') {
  return nodes.map((node, i) => (
    <React.Fragment key={i}>
      {i > 0 && (i === nodes.length - 1 ? ` ${last} ` : ', ')}
      {node}
    </React.Fragment>
  ));
}
const NEW_CLOSING = { id: 'closing', wait_s: 10, on_silence: [{ type: 'end_call' }] };

function Overview({ ctx, form, view }) {
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const config = ctx.config;
  const cards = useMemo(() => Object.fromEntries(form.cols.flat().map((c) => [c.id, c])), [form]);
  // every row by "card.row", with one row for each question ("questions.q<index>")
  const rows = useMemo(
    () => ({ ...rowsOf(form), ...Object.fromEntries(cards.questions.rowsFor(ctx).map((row) => [`questions.${row.id}`, row])) }),
    [form, cards, ctx],
  );
  const unsupported = ctx.editor?.report?.unsupported;
  const said = afterCallIn(config, unsupported);
  const { summary, questions, closing, keeps, hides, notRun } = said;
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';

  // a question just added opens its line (the field takes the keyboard); one removed from an open line leaves the
  // keyboard on the next question, or on "Add a question" when it was the last
  const count = useRef(questions.length);
  useEffect(() => {
    const before = count.current;
    count.current = questions.length;
    if (questions.length > before) setOpen({ line: `q${questions.at(-1).index}` });
    else if (questions.length < before && /^q\d+$/.test(open?.line || '') && !rows[`questions.${open.line}`]) setOpen({ line: 'addQuestion' });
  }, [questions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // what the checks found (errors and warnings) by where they are, else what is plainly missing
  const found = groupIssues(ctx.editor?.report).filter((i) => Array.isArray(i.path));
  const at = (base) => found.find((i) => base.every((p, n) => String(i.path[n]) === String(p)))?.message || '';
  const problem = {
    close: closing ? at(['wrapups', closing.index]) || (closing.started ? '' : 'Nothing starts it, so it never runs') : '',
    summary: at(['post_call', 'summary']),
    log: at(['observability', 'session_log']),
    rec: at(['post_call', 'recording']),
    files: at(['post_call', 'artifacts']),
    notice: at(['persona', 'disclosures']),
    hide: at(['post_call', 'redaction']) || hides.gap,
  };
  const questionProblem = (q) => at(['post_call', 'analysis', q.index]) || q.gap;
  const problems = Object.values(problem).filter(Boolean).length + questions.filter(questionProblem).length;

  const openLine = (line) => {
    setOpen({ line });
    requestAnimationFrame(() => reveal(document.querySelector(`.acWrap [data-line="${line}"]`)));
  };
  const openToken = (k) => {
    setOpen({ token: k });
    reveal(hero.current);
  };
  const addClosing = () => {
    ctx.set(setPath(config, ['wrapups'], [NEW_CLOSING]));
    openLine('close');
  };

  const tok = (k, words, blank = false) => (
    <button
      key={`${k}:${words}`}
      type="button"
      ref={(el) => {
        anchors.current[k] = el;
      }}
      className={['apTok', blank && 'blank optional', open?.token === k && 'on'].filter(Boolean).join(' ')}
      aria-expanded={open?.token === k}
      aria-haspopup="dialog"
      onClick={() => (open?.token === k ? close() : openToken(k))}
    >
      {blank ? TOKENS[k].blank : words}
      <span className="srOnly"> ({TOKENS[k].title}: change)</span>
    </button>
  );
  const s = { open, setOpen, openToken, close, rows, ctx, filled: {}, anchors, tokens: TOKENS, partId: 'aftercall' };

  // ---- the sentence: what it writes, what it keeps and hides, how a call closes; then "Not yet:" for what isn't set
  const writes = [
    summary.on && tok('summary', 'writes a summary'),
    questions.length > 0 && <React.Fragment key="q">answers {tok('questions', plural(questions.length, 'question'))}</React.Fragment>,
  ].filter(Boolean);
  const kept = [];
  if (keeps.log)
    kept.push(
      <React.Fragment key="log">
        {tok('log', keeps.logDays ? 'a log' : 'a log of each call')}
        {keeps.logDays ? <> for {tok('logdays', plural(keeps.logDays, 'day'))}</> : null}
      </React.Fragment>,
    );
  if (keeps.audio || keeps.transcript)
    kept.push(
      <React.Fragment key="rec">
        {tok('rec', keeps.audio && keeps.transcript ? 'the audio and the transcript' : keeps.audio ? 'the audio' : 'the transcript')}
        {keeps.days ? <> for {tok('days', plural(keeps.days, 'day'))}</> : null}
      </React.Fragment>,
    );
  const start = writes.length ? 'It' : `When a call ends, ${name}`;
  const hidesPart = hides.on ? <>, and hides {tok('hide', hides.gap ? 'nothing chosen yet' : hiddenWords(hides))} in all of it</> : null;
  const blanks = [!summary.on && tok('summary', '', true), !questions.length && tok('questions', '', true), !hides.on && tok('hide', '', true)].filter(Boolean);

  // ---- what a part of the sentence opens: its own settings, or the list of questions
  const popover = () => {
    const k = open.token;
    if (k === 'questions')
      return (
        <div className="cxTokenList">
          {questions.length ? (
            <ul className="cxUses">
              {questions.map((q) => (
                <li key={q.key}>
                  <span className="cxIcon" aria-hidden="true">
                    <Icon name="quote" size={14} />
                  </span>
                  <span className="cxText">
                    <b>{q.name}</b>
                    <small>{questionProblem(q) ? `${q.words} · needs a look` : q.words}</small>
                  </span>
                  <Button
                    type="button"
                    variant="quiet"
                    size="small"
                    onClick={() => {
                      close();
                      openLine(`q${q.index}`);
                    }}
                  >
                    Open
                    <span className="srOnly"> {q.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="apNone">None yet.</p>
          )}
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => {
              close();
              openLine('addQuestion');
            }}
          >
            <Icon name="plus" size={14} />
            Add a question
          </Button>
          {notRun.questions && questions.length > 0 && (
            <p className="cxNote">
              <Icon name="info" size={14} />
              Kept, but the server doesn’t answer questions after calls yet.
            </p>
          )}
        </div>
      );
    const note =
      k === 'summary' && summary.on && notRun.summary
        ? 'Kept, but the server doesn’t write summaries yet: nothing appears on Monitoring from it.'
        : (k === 'rec' || k === 'days') && (keeps.audio || keeps.transcript) && notRun.recording
          ? 'Kept, but the server doesn’t keep the audio or the transcript yet. The log of each call does run.'
          : k === 'hide'
            ? `Replaced in everything kept or sent. ${name} still hears the whole line during the call.`
            : k === 'close'
              ? 'A wait you start at a set moment, with the step “Start a closing message”. A caller who goes quiet at any other time is handled on Conversation.'
              : '';
    return (
      <>
        <Rows ids={TOKENS[k].ids} rows={rows} ctx={ctx} partId="aftercall" />
        {note && (
          <p className="cxNote">
            <Icon name="info" size={14} />
            {note}
          </p>
        )}
      </>
    );
  };

  // ---- the chapters, each line in its own place: a line that needs a look says so where it is (one that moved while
  // its field is typed in would lose the keyboard), and the line under the name counts them
  const first = (lines) => lines.map((l) => <React.Fragment key={l.key}>{l.el}</React.Fragment>);
  // the line says "Needs a look" itself when the checks found an error in its rows; a plain gap gets the pill
  const badPill = (ids) => (hasProblem(ids, rows, ctx) ? null : <span className="tlPill bad">Needs a look</span>);
  const notRunPill = <span className="tlPill warn">Not run yet</span>;

  const writesLines = [
    {
      key: 'close',
      bad: !!problem.close,
      el: closing ? (
        <Line s={s} k="close" icon="endCall" label="Closing a call" ids={LINES.close} action={problem.close ? 'Fix' : 'Change'}>
          {problem.close || `Waits ${closing.waitWords} after a natural end point`}
          <span className="apDim">
            {problem.close
              ? ' · add the step “Start a closing message” where the wait should begin'
              : ` · then ${closing.then} · started by the step “Start a closing message”`}
          </span>
          {problem.close && badPill(LINES.close)}
        </Line>
      ) : (
        <Line s={s} k="close" icon="endCall" label="Closing a call" action="Add" muted onAction={addClosing}>
          None<span className="apDim"> · a wait you start at a natural end point, then a goodbye</span>
        </Line>
      ),
    },
    {
      key: 'summary',
      bad: !!problem.summary,
      el: (
        <Line s={s} k="summary" icon="note" label="Summary" ids={LINES.summary} action={summary.on ? 'Change' : 'Switch on'} muted={!summary.on}>
          {summary.on ? 'Written after every call' : 'Off'}
          {summary.on && <span className="apDim"> · {summary.prompt || 'why they called, what was done, anything to follow up'}</span>}
          {summary.on && notRun.summary && notRunPill}
        </Line>
      ),
    },
    ...questions.map((q) => {
      const bad = questionProblem(q);
      return {
        key: `q${q.index}`,
        bad: !!bad,
        el: (
          <Line s={s} k={`q${q.index}`} icon="quote" label={q.name} ids={[`questions.q${q.index}`]} action={bad ? 'Fix' : 'Open'}>
            {bad || q.words}
            {!bad && q.more && <span className="apDim"> · {q.more}</span>}
            {bad ? badPill([`questions.q${q.index}`]) : notRun.questions ? notRunPill : null}
          </Line>
        ),
      };
    }),
  ];

  const recWords = (on) => (on ? `Kept ${forHowLong(keeps.days)}` : 'Not kept');
  const keepsLines = [
    {
      key: 'log',
      bad: !!problem.log,
      el: (
        <Line s={s} k="log" icon="list" label="A log of each call" ids={LINES.log} muted={!keeps.log}>
          {keeps.log ? 'On' : 'Off'}
          {keeps.log && (
            <span className="apDim">
              {' '}
              · what was said, every tool use and hand-over ·{' '}
              {keeps.logDays ? `deleted after ${plural(keeps.logDays, 'day')}` : 'kept unless the server is set to delete old ones'}
            </span>
          )}
        </Line>
      ),
    },
    {
      key: 'transcript',
      bad: !!problem.rec,
      el: (
        <Line s={s} k="transcript" icon="records" label="Transcript" ids={LINES.transcript} muted={!keeps.transcript}>
          {recWords(keeps.transcript)}
          {keeps.transcript && notRun.recording && notRunPill}
        </Line>
      ),
    },
    {
      key: 'audio',
      bad: false,
      el: (
        <Line s={s} k="audio" icon="mic" label="Audio" ids={LINES.audio} muted={!keeps.audio}>
          {recWords(keeps.audio)}
          {keeps.audio && notRun.recording && notRunPill}
        </Line>
      ),
    },
    {
      key: 'files',
      bad: !!problem.files,
      el: (
        <Line
          s={s}
          k="files"
          icon="upload"
          label="Files when it ends"
          ids={LINES.files}
          action={keeps.files.length ? 'Open' : 'Add'}
          muted={!keeps.files.length}
        >
          {keeps.files.length ? keeps.files.length : 'None'}
          <span className="apDim">
            {' '}
            ·{' '}
            {keeps.files.length
              ? keeps.files.map((f) => `${f.short}${f.on ? '' : ' (off)'}`).join(' · ')
              : 'the transcript or the call’s numbers, to a folder or one of your systems'}
          </span>
        </Line>
      ),
    },
    {
      key: 'notice',
      bad: !!problem.notice,
      el: (
        <Line s={s} k="notice" icon="quote" label="Recording notice" ids={LINES.notice} muted={!keeps.notice}>
          {keeps.notice ? `“${keeps.notice}”` : 'None'}
          {keeps.notice && <span className="apDim"> · said once, with the first greeting, on channels that speak</span>}
        </Line>
      ),
    },
  ];

  const hidesLines = hides.on
    ? [
        {
          key: 'hide',
          bad: false,
          el: (
            <Line s={s} k="hide" icon="eye" label="Hide sensitive details" ids={LINES.hide}>
              On
            </Line>
          ),
        },
        {
          key: 'entities',
          bad: !!problem.hide,
          el: (
            <Line s={s} k="entities" icon="eye" label="What it looks for" ids={LINES.entities} action={problem.hide ? 'Fix' : 'Change'}>
              {problem.hide || hiddenWords(hides).replace(/^./, (c) => c.toUpperCase())}
              {problem.hide && badPill(LINES.entities)}
            </Line>
          ),
        },
        {
          key: 'replace',
          bad: false,
          el: (
            <Line s={s} k="replace" icon="eye" label="Replaced with" ids={LINES.replace}>
              {hides.replacement}
            </Line>
          ),
        },
        {
          key: 'patterns',
          bad: false,
          el: (
            <Line s={s} k="patterns" icon="eye" label="Your own patterns" ids={LINES.patterns} muted={!hides.patterns.length}>
              {hides.patterns.length ? hides.patterns.join(' · ') : 'None'}
            </Line>
          ),
        },
      ]
    : [
        {
          key: 'hide',
          bad: false,
          el: (
            <Line s={s} k="hide" icon="eye" label="Hide sensitive details" ids={LINES.hide} action="Switch on" muted>
              Off
              <span className="apDim">{hides.secrets ? ' · only values it remembers as secret are hidden' : ' · nothing is hidden'}</span>
            </Line>
          ),
        },
      ];

  return (
    <section className="dtPart apWrap grWrap acWrap" data-part="aftercall" aria-labelledby="dt-aftercall-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-aftercall-title">After the call</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero grHero acHero" aria-label="After a call">
        <div className="apId">
          <span className="apAvatar grAvatarBig" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>After a call with {name}</h2>
            <p>{summaryLine(said, problems)}</p>
          </div>
          <div className="apActs">
            <Button type="button" variant="primary" className="apInk" onClick={() => openLine('try')}>
              <Icon name="eye" size={13} />
              Try hiding a line
            </Button>
          </div>
        </div>
        <p className="apSentence grSentence">
          {writes.length > 0 && (
            <>
              When a call ends, {name} {joined(writes)}.{' '}
            </>
          )}
          {kept.length ? (
            <>
              {start} keeps {joined(kept)}
              {hidesPart}.
            </>
          ) : (
            <>
              {start} keeps no log of it{hidesPart}.
            </>
          )}
          {closing && (
            <>
              {' '}
              After a natural end point it waits {tok('close', closing.waitWords)} for a reply, then {closing.then}.
            </>
          )}
          {blanks.length > 0 && <> Not yet: {joined(blanks, 'or')}.</>}
        </p>
        <p className="apHint">Click any part to change it.</p>
        <CallRecord name={name} said={said} onToken={openToken} onLine={openLine} />
        {open?.token && (
          <Popover
            key={open.token}
            anchor={anchors.current[open.token] || hero.current}
            box={hero}
            title={TOKENS[open.token].title}
            onClose={close}
            width={TOKENS[open.token].width}
          >
            {popover()}
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="ac-writes">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="ac-writes">How it closes, and what it writes</h2>
          <span className="apChSub">Written once the call ends: Monitoring counts the answers</span>
        </div>
        {((summary.on && notRun.summary) || (questions.length > 0 && notRun.questions)) && (
          <p className="cxNote grWarn grChNote">
            <Icon name="info" size={14} />
            {summary.on && notRun.summary && questions.length > 0 && notRun.questions
              ? 'The server keeps the summary and the questions but doesn’t write or answer them after calls yet: nothing appears on Monitoring from them.'
              : summary.on && notRun.summary
                ? 'The server keeps the summary but doesn’t write it after calls yet.'
                : 'The server keeps the questions but doesn’t answer them after calls yet: nothing appears on Monitoring from them.'}
          </p>
        )}
        <div className="apDoc lines">
          {first(writesLines)}
          <Line s={s} k="addQuestion" icon="plus" label="Add a question" ids={LINES.addQuestion} action="Add" muted>
            Yes or no, one of a list, a number, or in a few words
          </Line>
        </div>
        <More s={s} k="writesMore" ids={MORE.writes} />
      </section>

      <section className="apCh" aria-labelledby="ac-keeps">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="ac-keeps">What it keeps, and for how long</h2>
          <span className="apChSub">
            {(keeps.audio || keeps.transcript) && notRun.recording
              ? 'The log runs today; the server keeps the audio and transcript settings for later'
              : 'What is kept of each call, and when it is deleted'}
          </span>
        </div>
        <div className="apDoc lines">{first(keepsLines)}</div>
        <More s={s} k="keepsMore" ids={MORE.keeps} />
      </section>

      <section className="apCh" aria-labelledby="ac-hides">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="ac-hides">What it hides</h2>
          <span className="apChSub">Replaced in everything kept or sent: the log, transcripts, files. Never in what {name} hears during the call</span>
        </div>
        <div className="apDoc lines">
          {first(hidesLines)}
          <Line s={s} k="try" icon="play" label="Try hiding a line" ids={LINES.try} action="Try" muted>
            See what a line would look like once kept<span className="apDim"> · nothing is saved</span>
          </Line>
        </div>
        <More s={s} k="hidesMore" ids={MORE.hides} />
      </section>
    </section>
  );
}

export default function AfterCallWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the after-call settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
