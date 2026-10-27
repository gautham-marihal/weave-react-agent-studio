import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import CallDetail from '../calls/CallDetail.jsx';
import { channelLabel } from '../calls/callModel.js';
import { formatWhen } from '../format.js';
import { humanize } from '../form/engine.js';
import Drawer from '../agent/Drawer.jsx';
import { Notice } from '../ui.jsx';
import { usePref } from '../usePref.js';
import { boardSummary, changesToAnnounce, clock, hiddenWords } from './liveModel.js';
import { useLiveBoard } from './useLiveBoard.js';
import Select from '../../ui/Select.tsx';
import '../calls/calls.css';
import '../agent/agent.css';
import './live.css';

const PRIVATE_KEY = 'weave_live_private';
const CHANNEL_ICON = { sip_voice: 'phone', web_voice: 'mic', web_chat: 'quote', whatsapp: 'quote', sms: 'quote' };
const OUTCOME = {
  ended: { label: 'Ended', tone: 'good' },
  cut_off: { label: 'Cut off', tone: 'bad' },
};

function ago(ms, nowMs) {
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return 'just now';
  return `${Math.round(s / 60)} min ago`;
}

// One call going on: who, where, how long, what needs a look, and the last few lines as they are said.
function LiveCard({ call, name, hideCaller, onWatch, onOpenCall }) {
  const lines = call.lines.slice(-3);
  const who = call.caller || (call.voice ? 'A caller' : 'A web visitor');
  return (
    <article className={`lvCard ${call.attention ? call.worst : ''}`} aria-label={`${name}: call from ${who}, ${clock(call.durationS)}`}>
      <header className="lvCardHead">
        <span className="lvDot" aria-hidden="true" />
        <strong className="lvAgent">{name}</strong>
        <span className="lvChannel">
          <Icon name={CHANNEL_ICON[call.channel.type] || 'phone'} size={14} />
          {channelLabel(call.channel) || 'Call'}
        </span>
        <span className="lvTime" title="How long it has run">
          {clock(call.durationS)}
        </span>
      </header>
      <p className="lvWho">
        {who}
        {call.agent ? (
          <>
            {' '}
            · with <b>{humanize(call.agent)}</b>
          </>
        ) : null}
      </p>
      {call.flags.length > 0 && (
        <ul className="lvFlags" aria-label="What to know">
          {call.flags.slice(0, 3).map((f) => (
            <li key={f.id} className={f.tone} title={f.detail || undefined}>
              {f.label}
            </li>
          ))}
          {call.flags.length > 3 && <li className="more">+{call.flags.length - 3}</li>}
        </ul>
      )}
      <ol className="lvLines" aria-label="The last things said">
        {call.loading && !lines.length && <li className="lvNote">Reading the call…</li>}
        {!call.loading && !lines.length && <li className="lvNote">Just started: nothing said yet.</li>}
        {lines.map((l) => (
          <li key={l.seq} className={`lvLine ${l.who}`}>
            {/* the agent's name ("Billing specialist"), not its id */}
            <span className="lvSpeaker">{l.who === 'caller' ? 'Caller' : humanize(l.agent || call.agent || 'agent')}</span>
            <span className="lvText">{l.who === 'caller' && hideCaller ? <i>{hiddenWords(l)}</i> : l.text}</span>
          </li>
        ))}
        {call.thinking && (
          <li className="lvLine agent thinking" aria-label="The agent is answering">
            <span className="lvSpeaker">{humanize(call.agent || 'agent')}</span>
            <span className="lvDots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </li>
        )}
      </ol>
      <footer className="lvCardFoot">
        <button type="button" className="quietButton" onClick={() => onWatch(call)}>
          Watch
        </button>
        <button type="button" className="linkButton" onClick={() => onOpenCall(call.bot, call.id)}>
          Open in Calls
        </button>
      </footer>
    </article>
  );
}

// The Live board: every call in progress across the workspace, what needs a look first, plus calls that ended in the
// last ten minutes. It only watches: nothing here changes a call.
export default function LiveBoardPage({ bots = [], onOpenCall }) {
  const [paused, setPaused] = useState(false);
  const [agent, setAgent] = useState('');
  const [channel, setChannel] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [privatePref, setPrivatePref] = usePref(PRIVATE_KEY, '0');
  const hideCaller = privatePref === '1';
  const [watching, setWatching] = useState(null); // a call opened in the side panel: { bot, id }
  const [allEnded, setAllEnded] = useState(false);
  const board = useLiveBoard(bots, { paused });
  const names = useMemo(() => Object.fromEntries(bots.map((b) => [b.id, b.name || b.id])), [bots]);

  const live = board.calls.filter((c) => c.status === 'live');
  const ended = board.calls.filter((c) => c.status !== 'live').sort((a, b) => (b.endedAtMs || 0) - (a.endedAtMs || 0));
  const sum = boardSummary(board.calls);
  const channels = [...new Set(board.calls.map((c) => c.channel.type).filter(Boolean))];
  const shown = live.filter((c) => (!agent || c.bot === agent) && (!channel || c.channel.type === channel) && (!onlyAttention || c.attention));
  const shownEnded = ended.filter((c) => (!agent || c.bot === agent) && (!channel || c.channel.type === channel));
  const filtered = agent || channel || onlyAttention;

  // what a screen reader hears: a new call, a call that needs a look, a call that ended (at most every few seconds)
  const [announce, setAnnounce] = useState('');
  const before = useRef(null);
  const lastSaid = useRef(0);
  useEffect(() => {
    const now = Object.fromEntries(board.calls.map((c) => [c.key, c]));
    if (!before.current) {
      before.current = now;
      return;
    }
    // spoke a moment ago: held back, then compared with what was there when it last spoke, so nothing is missed
    if (Date.now() - lastSaid.current <= 4000) return;
    const said = changesToAnnounce(before.current, now, names);
    if (said.length) {
      setAnnounce(said.join('. '));
      lastSaid.current = Date.now();
    }
    before.current = now;
  }, [board.calls, names]);

  const open = watching && board.calls.find((c) => c.bot === watching.bot && c.id === watching.id);
  // why it isn't watching: paused, no agent yet, or the tab is out of sight (it resumes when the tab is back)
  const status = paused
    ? 'Paused'
    : !bots.length
      ? 'No agents to watch yet'
      : !board.watching
        ? 'Waiting for the tab to be shown again'
        : board.checkedAt
          ? `Watching ${bots.length} agent${bots.length === 1 ? '' : 's'} · checked ${ago(Date.parse(board.checkedAt), board.nowMs)}`
          : 'Looking for calls…';

  return (
    <div className="lvPage">
      <section className="welcomeBlock">
        <div>
          <h1>Live</h1>
          <p>Calls going on right now, as they are said, with what needs a look first. It only watches: nothing here changes a call.</p>
        </div>
        <div className="lvControls">
          <small className={`lvStatus ${paused || !board.watching ? 'paused' : 'on'}`}>
            <span className="lvDot" aria-hidden="true" />
            {status}
          </small>
          <button type="button" className="quietButton" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            <Icon name={paused ? 'play' : 'pause'} size={14} /> {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </section>
      <DemoNote kind="calls">These calls are made up from the clock: they start, go on and end by themselves. No real caller is involved.</DemoNote>
      {board.errors.map((e) => (
        <Notice key={e.botId} kind="error" title={`The calls of ${names[e.botId] || e.botId} couldn’t be read`}>
          {e.message} It is tried again every few seconds.
        </Notice>
      ))}

      <div className="lvStats" role="group" aria-label="Right now">
        <div className="lvStat">
          <strong>{sum.live}</strong>
          <span>{sum.live === 1 ? 'Call now' : 'Calls now'}</span>
        </div>
        <button
          type="button"
          className={`lvStat ${sum.attention ? 'bad' : ''} ${onlyAttention ? 'on' : ''}`}
          aria-pressed={onlyAttention}
          onClick={() => setOnlyAttention((v) => !v)}
          title="Show only the calls that need a look"
        >
          <strong>{sum.attention}</strong>
          <span>{sum.attention === 1 ? 'Needs a look' : 'Need a look'}</span>
        </button>
        <a className="lvStat" href="#lvEnded">
          <strong>{sum.ended}</strong>
          <span>Ended in the last 10 min</span>
        </a>
      </div>

      <div className="lvFilters">
        <label>
          <span className="srOnly">Agent</span>
          <Select className="stFInput" value={agent} onChange={(event) => setAgent(event.target.value)} aria-label="Agent">
            <option value="">All agents</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {names[b.id]}
                {sum.byAgent[b.id] ? ` (${sum.byAgent[b.id].live})` : ''}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="srOnly">Channel</span>
          <Select className="stFInput" value={channel} onChange={(event) => setChannel(event.target.value)} aria-label="Channel">
            <option value="">All channels</option>
            {channels.map((type) => (
              <option key={type} value={type}>
                {channelLabel({ type })}
              </option>
            ))}
          </Select>
        </label>
        <label className="lvCheck">
          <input type="checkbox" checked={onlyAttention} onChange={(event) => setOnlyAttention(event.target.checked)} />
          Only what needs a look
        </label>
        <label className="lvCheck" title="For a screen others can see: callers’ words are hidden, and phone numbers always show only their last digits">
          <input type="checkbox" checked={hideCaller} onChange={(event) => setPrivatePref(event.target.checked ? '1' : '0')} />
          Hide what callers say
        </label>
      </div>

      {shown.length > 0 ? (
        <div className="lvGrid">
          {shown.map((c) => (
            <LiveCard
              key={c.key}
              call={c}
              name={names[c.bot] || c.bot}
              hideCaller={hideCaller}
              onWatch={(call) => setWatching({ bot: call.bot, id: call.id })}
              onOpenCall={onOpenCall}
            />
          ))}
        </div>
      ) : (
        <div className="lvEmpty">
          <span aria-hidden="true">
            <Icon name="live" size={22} />
          </span>
          <div>
            <strong>
              {!board.checkedAt && !paused
                ? 'Looking for calls…'
                : live.length && filtered
                  ? 'No call matches'
                  : !bots.length
                    ? 'No agents to watch'
                    : 'No calls right now'}
            </strong>
            <p>
              {live.length && filtered
                ? `${live.length} call${live.length === 1 ? ' is' : 's are'} going on; none matches what is picked above.`
                : bots.length
                  ? 'A call shows here the moment it starts, and its words as they are said. This page checks every few seconds.'
                  : 'Create an agent, and its calls show here while they happen.'}
            </p>
          </div>
        </div>
      )}

      <section className="lvEnded" id="lvEnded" aria-label="Ended in the last 10 minutes">
        <h2>Ended in the last 10 minutes</h2>
        {shownEnded.length === 0 ? (
          <p className="stMuted">None yet.</p>
        ) : (
          <ul>
            {shownEnded.slice(0, allEnded ? 60 : 8).map((c) => {
              const outcome = OUTCOME[c.status] || OUTCOME.ended;
              const extra = c.flags.find((f) => f.tone !== 'info' && f.id !== 'cut_off') || c.flags.find((f) => f.id === 'handed_over');
              return (
                <li key={c.key}>
                  <span className={`lvOutcome ${outcome.tone}`}>{outcome.label}</span>
                  <strong>{names[c.bot] || c.bot}</strong>
                  <span className="stMuted">
                    {channelLabel(c.channel)} · {clock(c.durationS)}
                    {extra ? ` · ${extra.label}` : ''}
                  </span>
                  <span className="stMuted lvAgo">{c.endedAtMs ? ago(c.endedAtMs, board.nowMs) : formatWhen(c.startedAt)}</span>
                  <button type="button" className="linkButton" onClick={() => onOpenCall(c.bot, c.id)}>
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {shownEnded.length > 8 && (
          <button type="button" className="lvMore" aria-expanded={allEnded} onClick={() => setAllEnded((v) => !v)}>
            {allEnded ? 'Show fewer' : `Show all ${shownEnded.length}`}
          </button>
        )}
      </section>

      <div className="srOnly" aria-live="polite" role="status">
        {announce}
      </div>

      {watching && (
        <Drawer
          title={`${names[watching.bot] || watching.bot}${open?.caller ? ` · ${open.caller}` : ''}`}
          icon="live"
          width="wide"
          label="Watch a call"
          onClose={() => setWatching(null)}
        >
          {open?.status && open.status !== 'live' && (
            <Notice kind={open.status === 'cut_off' ? 'warn' : 'good'} title={open.status === 'cut_off' ? 'This call was cut off' : 'This call has ended'} />
          )}
          <CallDetail botId={watching.bot} botName={names[watching.bot]} callId={watching.id} summary={null} onClose={null} />
        </Drawer>
      )}
    </div>
  );
}
