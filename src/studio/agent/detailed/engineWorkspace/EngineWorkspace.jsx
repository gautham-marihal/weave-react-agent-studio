import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { AllSettings, Line, More, Popover, Rows, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import Nameplate from './Nameplate.jsx';
import { LINES, MORE, TOKENS } from './engineLayout.js';
import { STATUSES, dayOf, detailsOf, lintWords, logsWords, plural, summaryLine } from './engineWords.js';
import './engineWorkspace.css';

// Build › Engine and details as what runs it underneath (design: canvas page "10 · Engine and details, redesigned"),
// for any agent. A sentence says who it is (its id, version, status, the environment it is meant for), how it runs (the
// engine, where models come from, its time zone, where secrets are found), its fixed values and the studio's own
// checks; what is not set is a grey blank after "Not yet:". Under it, a nameplate: each detail with who sets it, then
// its fixed values with where each is used. Three chapters: who it is, how it runs, fixed values, checks and logging.
// Its name, description and tags stay on Build › Agent (one place each). Every view edits with the part's own rows
// (engineForm); the whole configuration as JSON stays one button away (the page's own "Edit as JSON").

const VIEWS = makeViewStore('weave_engine_view', 'overview');
const FIRST = ['overview', 'Its details'];
const LABEL = 'How to see its details';

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

// copies the id, and says so for a moment
function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return { copied, copy };
}

function Overview({ ctx, form, view }) {
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const rows = useMemo(() => rowsOf(form), [form]);
  const { copied, copy } = useCopy();
  const config = ctx.config;
  const d = detailsOf(config);
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';

  const openToken = (k) => {
    setOpen({ token: k });
    reveal(hero.current);
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
  const s = { open, setOpen, openToken, close, rows, ctx, filled: {}, anchors, tokens: TOKENS, partId: 'settings' };

  // ---- the sentence
  const who = [d.version ? <React.Fragment key="v">version {tok('version', d.version)}</React.Fragment> : 'not published yet'];
  if (d.version && d.status !== 'draft') who.push(STATUSES[d.status] || d.status);
  if (d.env) who.push(<React.Fragment key="e">meant for {tok('env', d.env)}</React.Fragment>);
  const runs = [
    <React.Fragment key="r">
      runs on {tok('engine', d.engineWords || 'no engine yet')} with {tok('mode', d.modeWords || 'no model source yet')}
    </React.Fragment>,
  ];
  if (d.tz) runs.push(<React.Fragment key="tz">tells the time in {tok('tz', d.tz)}</React.Fragment>);
  if (d.vault) runs.push(<React.Fragment key="v">finds its secrets in {tok('vault', d.vault)}</React.Fragment>);
  const lint = lintWords(d.lint);
  // "It has 3 fixed values, and the studio warns over 450 words or 8 tools an agent."
  const warns = lint ? <>warns over {tok('lint', lint)} an agent</> : d.lint.mono ? <>warns {tok('lint', 'when one agent does everything')}</> : null;
  const third = d.consts.length ? (
    <>
      It has {tok('consts', plural(d.consts.length, 'fixed value'))}
      {warns && <>, and the studio {warns}</>}.
    </>
  ) : warns ? (
    <>The studio {warns}.</>
  ) : null;
  const blanks = [!d.env && tok('env', '', true), !d.tz && tok('tz', '', true), !d.consts.length && tok('consts', '', true)].filter(Boolean);

  // ---- what a part of the sentence opens
  const popover = () => {
    const k = open.token;
    const note =
      k === 'mode'
        ? 'One agent targets one: model names differ between them. Switching changes nothing else, so check the models on Build › Agent after it. LiveKit’s hosted models need LiveKit Cloud; your own keys work on a self-hosted server too.'
        : k === 'version'
          ? 'Set when a version is published (Release › Publish); the status is the server’s.'
          : k === 'tz'
            ? 'For spoken times and dates, such as opening hours. An IANA name, such as Asia/Singapore or Europe/London.'
            : k === 'lint'
              ? 'Warnings while you build, never at a call. Each is off until it has a number; the agent config guide suggests 450 words and 8 tools.'
              : '';
    return (
      <>
        <Rows ids={TOKENS[k].ids} rows={rows} ctx={ctx} partId="settings" />
        {k === 'id' && d.id && (
          <Button type="button" variant="secondary" size="small" onClick={() => copy(d.id)}>
            <Icon name="copy" size={14} />
            {copied ? 'Copied' : 'Copy its id'}
          </Button>
        )}
        {note && (
          <p className="cxNote">
            <Icon name="info" size={14} />
            {note}
          </p>
        )}
      </>
    );
  };

  const dates = d.created || d.changed ? [dayOf(d.created), dayOf(d.changed)].filter(Boolean).join(' · ') : '';

  return (
    <section className="dtPart apWrap grWrap enWrap" data-part="settings" aria-labelledby="dt-settings-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-settings-title">Engine and details</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <div className="enTopActs">
          <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
          {ctx.actions && <div className="nlPageActions dtActions">{ctx.actions}</div>}
        </div>
      </header>

      <section ref={hero} className="apHero grHero enHero" aria-label="Its details">
        <div className="apId">
          <span className="apAvatar grAvatarBig enAvatarBig" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>{name}’s details</h2>
            <p>{summaryLine(d)}</p>
          </div>
          {d.id && (
            <div className="apActs">
              <Button type="button" variant="secondary" onClick={() => copy(d.id)}>
                <Icon name={copied ? 'check' : 'copy'} size={14} />
                {copied ? 'Copied' : 'Copy its id'}
              </Button>
            </div>
          )}
        </div>
        <p className="apSentence grSentence">
          {name} is {tok('id', d.id || 'not named yet')}, {joined(who)}. It {joined(runs)}.{third && <> {third}</>}
          {blanks.length > 0 && <> Not yet: {joined(blanks, 'or')}.</>}
        </p>
        <p className="apHint">Click any part to change it. Its name, description and tags are on Build › Agent.</p>
        <Nameplate name={name} initials={initialsOf(name)} d={d} onToken={openToken} />
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

      <section className="apCh" aria-labelledby="en-who">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="en-who">Who it is</h2>
          <span className="apChSub">Shown here, set elsewhere: the id once, the version by Release, the status by the server</span>
        </div>
        <div className="apDoc lines">
          <Line s={s} k="id" icon="key" label="Id" action={copied ? 'Copied' : 'Copy'} locked={!d.id} onAction={() => copy(d.id)}>
            <span className="enMono">{d.id || 'Not set'}</span>
            <span className="apDim"> · fixed once created</span>
          </Line>
          <Line s={s} k="version" icon="flag" label="Version" action="Release" onAction={() => ctx.goPart?.('releases')} muted={!d.version}>
            {d.version || 'Not published yet'}
            <span className="apDim"> · set when a version is published</span>
          </Line>
          <Line s={s} k="status" icon="flag" label="Status" locked>
            {(STATUSES[d.status] || d.status).replace(/^a /, '').replace(/^./, (c) => c.toUpperCase())}
            <span className="apDim"> · set by the server</span>
          </Line>
          <Line s={s} k="env" icon="pin" label="Meant for" ids={LINES.env} muted={!d.env}>
            {d.env ? d.env.replace(/^./, (c) => c.toUpperCase()) : 'Not set'}
            <span className="apDim"> · a label for people: where it goes live is chosen on Release</span>
          </Line>
          <Line s={s} k="when" icon="clock" label="Created · last changed" locked muted={!dates}>
            {dates || 'Not recorded yet'}
            <span className="apDim"> · {dates ? 'set by the server' : 'the server adds them when a version is saved'}</span>
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="en-runs">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="en-runs">How it runs</h2>
          <span className="apChSub">One worker runs every agent: what is set here is what it reads for this one</span>
        </div>
        <div className="apDoc lines">
          <Line s={s} k="engine" icon="bolt" label="Engine" ids={LINES.engine} muted={!d.engine}>
            {d.engineWords || 'Not chosen'}
            <span className="apDim"> · the only one for now</span>
          </Line>
          <Line s={s} k="mode" icon="key" label="Where models come from" ids={LINES.mode} muted={!d.mode}>
            {d.modeWords ? d.modeWords.replace(/^./, (c) => c.toUpperCase()) : 'Not chosen'}
            <span className="apDim">
              {d.mode === 'inference' ? ' · LiveKit Cloud only' : ' · works self-hosted; model names differ from LiveKit’s hosted ones'}
            </span>
          </Line>
          <Line s={s} k="tz" icon="globe" label="Time zone" ids={LINES.tz} muted={!d.tz}>
            {d.tz || 'Not set'}
            <span className="apDim">
              {d.tz
                ? d.tzNow
                  ? ` · ${d.tzNow} there now · for spoken times and dates`
                  : ' · not a time zone this browser knows'
                : ' · spoken times are in UTC'}
            </span>
          </Line>
          <Line s={s} k="vault" icon="lock" label="Where secrets are kept" ids={LINES.vault} muted={!d.vault}>
            {d.vault || 'The usual vault'}
            <span className="apDim"> · where {'{secret}'} names are found</span>
          </Line>
          <Line s={s} k="hangup" icon="endCall" label="Hanging up" ids={LINES.hangup}>
            {d.drain ? 'Finishes its closing words' : 'Stops at once'}, then {d.closeRoom ? 'ends the room' : 'leaves the room open'}
          </Line>
        </div>
        <More s={s} k="runsMore" ids={MORE.runs} />
      </section>

      <section className="apCh" aria-labelledby="en-values">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="en-values">Fixed values, checks and logging</h2>
          <span className="apChSub">Values every text can use; the studio’s own warnings; logs for your team</span>
        </div>
        <div className="apDoc lines">
          <Line s={s} k="consts" icon="pin" label="Fixed values" ids={LINES.consts} action={d.consts.length ? 'Open' : 'Add'} muted={!d.consts.length}>
            {d.consts.length ? d.consts.length : 'None'}
            <span className="apDim">
              {' '}
              · {d.consts.length ? d.consts.map((c) => `{{const.${c.name}}}`).join(', ') : 'a value used in many places, such as a payment link, set once'}
            </span>
          </Line>
          <Line s={s} k="lint" icon="check" label="Studio checks" ids={LINES.lint} muted={!lint && !d.lint.mono}>
            {lint || d.lint.mono
              ? [lint && `Warns over ${lint} an agent`, d.lint.mono && (lint ? 'and when one agent does everything' : 'Warns when one agent does everything')]
                  .filter(Boolean)
                  .join(', ')
              : 'Off'}
            <span className="apDim"> · in the studio only, never at a call</span>
          </Line>
          <Line s={s} k="logs" icon="list" label="Logs and monitoring" ids={LINES.logs}>
            {logsWords(d.logs)}
            <span className="apDim"> · the log of each call is on After the call</span>
          </Line>
        </div>
        <More s={s} k="valuesMore" ids={MORE.values} />
      </section>
    </section>
  );
}

export default function EngineWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the engine’s settings"
        switcher={
          <span className="enTopActs">
            <ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />
            {ctx.actions}
          </span>
        }
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
