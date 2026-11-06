import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { navigate, routeHref, useRoute } from '../../../route.js';
import { notRunAt } from '../../../preflight.ts';
import { speaks } from '../agentProfile/speaks.js';
import { AllSettings, Line, More, Popover, Rows, Tok, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import CallDrawing from './CallDrawing.jsx';
import { LINES, MORE, TOKENS } from './conversationLayout.js';
import {
  C,
  countWords,
  failWords,
  interruptWords,
  quietWords,
  reactWords,
  reachWords,
  readQuiet,
  rememberWords,
  soundWords,
  timeWords,
  waitWords,
} from './conversationWords.js';
import './conversation.css';

// Build › Conversation as a call you can see, not a list of timers (design: canvas page "2 · Conversation, redesigned").
// The call: one sentence says how a call goes, each part opening its editor in place (a part not set yet is a blank);
// under it, an example call drawn from these settings, where the moment an open setting shapes lights up; then three
// chapters: the rhythm, how it sounds, behind the scenes. One format for every agent; one that only chats is told which
// parts take effect once a voice channel is on. All settings: every setting, searchable.
// Both views edit with the part's own rows (conversationForm), so each setting is the same control everywhere.

const VIEWS = makeViewStore('weave_conversation_view', 'overview');
// the first view is named for what it shows (the stage tabs already have an "Overview")
const FIRST = ['overview', 'The call'];
const LABEL = 'How to see the conversation settings';
const ACTIVE = { wait: 'wait', interrupt: 'interrupt', quiet: 'quiet', count: 'quiet', gap: 'quiet', then: 'quiet' };

const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

function Overview({ ctx, form, view }) {
  const rows = useMemo(() => rowsOf(form), [form]);
  const route = useRoute();
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const openToken = (key) => {
    setOpen({ token: key });
    reveal(hero.current);
  };
  const config = ctx.config;
  const call = speaks(config);
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const wait = waitWords(config);
  const cut = interruptWords(config);
  const quiet = quietWords(config, call);
  const q = readQuiet(config);
  const sound = soundWords(config);
  const remember = rememberWords(config);
  const react = reactWords(config);
  const fails = failWords(config);
  const soundsNotRun = !!notRunAt(ctx.editor?.report?.unsupported, [...C, 'sounds']);

  // the parts of the sentence
  const quietToken =
    quiet.state === 'off'
      ? 'waits as long as it takes'
      : quiet.state === 'unset'
        ? '' // a blank to fill: "doesn't check in yet"
        : q.count
          ? `checks in ${quiet.checks}`
          : q.timeout
            ? `waits ${timeWords(q.timeout)}`
            : 'waits';
  const filled = {
    wait: { usual: 'the usual pause', quick: 'a quick beat', patient: 'a patient pause', own: 'a pause of its own' }[wait.choice],
    interrupt: cut.name === 'Callers can cut in' ? 'can cut in' : 'can’t cut in',
    quiet: quietToken,
    // each part of a quiet caller's script, or a blank to fill
    count: quiet.state === 'on' && q.count ? countWords(q.count) : '',
    gap:
      quiet.state === 'on' && q.timeout
        ? q.count === 1
          ? `after ${timeWords(q.timeout)}`
          : q.count
            ? `${timeWords(q.timeout)} apart`
            : timeWords(q.timeout)
        : '',
    then: quiet.state === 'on' && q.then.kind !== 'unset' ? quiet.then : '',
  };
  const s = { open, setOpen, openToken, close, rows, ctx, filled, anchors, tokens: TOKENS, partId: 'conversation' };
  // "checks in [how often], [how far apart], then [what happens]"; "waits [2 minutes], then …" with no check-ins;
  // "[waits as long as it takes]" when switched off
  const quietPart =
    quiet.state === 'off' ? (
      <Tok s={s} k="quiet" />
    ) : quiet.state === 'on' && !q.count && q.timeout ? (
      <>
        waits <Tok s={s} k="gap" />, then <Tok s={s} k="then" />
      </>
    ) : (
      <>
        checks in <Tok s={s} k="count" />, <Tok s={s} k="gap" />, then <Tok s={s} k="then" />
      </>
    );
  const active = open?.token ? ACTIVE[open.token] : '';
  // on a call, an editor hangs from the moment it shapes, lit in the drawing, so both stay in view
  const litMoment = useCallback(() => hero.current?.querySelector('.cdHi'), []);
  const channelsHref = routeHref(route.botId, 'channels');

  return (
    <section className="dtPart apWrap cvWrap" data-part="conversation" aria-labelledby="dt-conversation-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-conversation-title">Conversation</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero cvHero" aria-label="A call">
        <div className="apId">
          <span className="apAvatar cvAvatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>A call with {name}</h2>
            <p>{reachWords(simple.channels)}</p>
          </div>
          {ctx.onTest && (
            <div className="apActs">
              <Button type="button" variant="primary" className="apInk" onClick={ctx.onTest}>
                <Icon name="phone" size={15} />
                Try a call
              </Button>
            </div>
          )}
        </div>
        <p className="apSentence cvSentence">
          {name} waits <Tok s={s} k="wait" /> after a caller stops, and callers <Tok s={s} k="interrupt" />. If someone goes quiet, it {quietPart}.
        </p>
        {/* as on Agent: a part not set up yet is a blank, and every part opens its editor */}
        <p className="apHint">
          Click any part to change it.
          {/* an agent that only chats: the same page, and which parts wait for a voice channel */}
          {!call && (
            <>
              {' '}
              Waiting, cutting in and how it sounds take effect once a{' '}
              <a
                href={channelsHref}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(channelsHref);
                }}
              >
                voice channel
              </a>{' '}
              is on.
            </>
          )}
        </p>
        <CallDrawing config={config} name={name} active={active} />
        {open?.token && (
          <Popover
            key={open.token}
            anchor={anchors.current[open.token]}
            box={hero}
            title={TOKENS[open.token].title}
            onClose={close}
            width={TOKENS[open.token].width}
            under={litMoment}
          >
            <Rows ids={TOKENS[open.token].ids} rows={rows} ctx={ctx} partId="conversation" />
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="cv-rhythm">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="cv-rhythm">The rhythm</h2>
          <span className="apChSub">Taking turns, and quiet callers</span>
        </div>
        <div className="apDoc lines">
          <Line s={s} k="wait" icon="clock" label="Waiting" token="wait">
            {wait.name}
            <span className="apDim">
              {' '}
              · {wait.span}
              {wait.adapt ? ' · adapts to each caller' : ''}
            </span>
          </Line>
          <Line s={s} k="interrupt" icon="swap" label="Cutting in" token="interrupt">
            {cut.name}
            <span className="apDim"> · {cut.detail}</span>
          </Line>
          <Line
            s={s}
            k="quiet"
            icon="mic"
            label="Quiet callers"
            token="quiet"
            action={quiet.state === 'unset' ? 'Set it up' : 'Open the script'}
            muted={quiet.state !== 'on'}
          >
            {quiet.line.split(' · ')[0]}
            {quiet.line.includes(' · ') && <span className="apDim"> · {quiet.line.split(' · ').slice(1).join(' · ')}</span>}
          </Line>
        </div>
        <More s={s} k="rhythmMore" ids={MORE.rhythm} />
      </section>

      <section className="apCh" aria-labelledby="cv-sound">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="cv-sound">How it sounds</h2>
          <span className="apChSub">Reading things aloud, and the sound of the line</span>
        </div>
        <div className="apDoc lines">
          <Line s={s} k="says" icon="voice" label="Says it like" ids={LINES.says} action={sound.rules ? 'Change' : 'Add a rule'} muted={!sound.rules}>
            {sound.rules ? `${sound.rules} ${sound.rules === 1 ? 'rule' : 'rules'}: ${sound.ruleNames}` : 'As written'}
            <span className="apDim">{sound.rules ? ` · for ${sound.forAll ? 'everything it says' : 'what the AI writes'}` : ' · no rules yet'}</span>
          </Line>
          <Line s={s} k="thinking" icon="sound" label="While it thinks" ids={LINES.thinking} muted={!sound.thinking}>
            {sound.thinking ? 'A sound' : 'Silence'}
            {soundsNotRun && <span className="cvTag warn">the server doesn’t play sounds yet</span>}
          </Line>
          <Line s={s} k="line" icon="phone" label="On the line" ids={LINES.line}>
            {sound.noise ? 'Noise reduction on' : 'No noise reduction'}
            <span className="apDim"> · {sound.menus ? 'listens' : 'doesn’t listen'} for phone menus</span>
          </Line>
        </div>
        <More s={s} k="soundMore" ids={MORE.sound} />
      </section>

      <section className="apCh" aria-labelledby="cv-scenes">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="cv-scenes">Behind the scenes</h2>
          <span className="apChSub">What it keeps, what it reacts to, and when things fail</span>
        </div>
        <div className="apDoc lines">
          <Line
            s={s}
            k="remembers"
            icon="note"
            label="Remembers"
            ids={LINES.remembers}
            action={remember.count ? 'See all' : 'Add a detail'}
            muted={!remember.count}
          >
            {remember.count ? `${remember.count} ${remember.count === 1 ? 'detail' : 'details'}` : 'Nothing yet'}
            {remember.count > 0 && (
              <span className="apDim">
                {' '}
                · {remember.first.join(', ')}
                {remember.count > remember.first.length ? '…' : ''}
              </span>
            )}
            {remember.secret > 0 && (
              <span className="cvTag">
                <Icon name="lock" size={11} />
                {remember.secret} kept secret
              </span>
            )}
          </Line>
          <Line s={s} k="reacts" icon="bolt" label="Reacts to" ids={LINES.reacts} action={react.count ? 'Change' : 'Add a reaction'} muted={!react.count}>
            {react.count ? `${react.count} ${react.count === 1 ? 'reaction' : 'reactions'}` : 'Nothing extra'}
            <span className="apDim">
              {react.count
                ? ` · when ${react.names.slice(0, 2).join(', ').toLowerCase()}${react.names.length > 2 ? '…' : ''}`
                : ' · it follows its brief and workflow'}
            </span>
          </Line>
          <Line s={s} k="fails" icon="alert" label="If a service fails" ids={LINES.fails}>
            {fails.name}
            <span className="apDim">
              {fails.usual ? ' (the usual)' : ''} · {fails.detail}
            </span>
          </Line>
        </div>
        <More s={s} k="scenesMore" ids={MORE.scenes} />
      </section>
    </section>
  );
}

export default function ConversationWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the conversation settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
