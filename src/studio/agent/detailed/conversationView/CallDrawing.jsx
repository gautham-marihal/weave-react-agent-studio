import React from 'react';
import { clockText, readInterrupt, readQuiet, timeWords } from './conversationWords.js';

// An example call drawn on two lanes, the caller's and the agent's, from the agent's own settings: whether callers can cut
// in, how many check-ins a quiet caller hears, how long apart, and whether the call ends. It has no words of its own (the
// sentence above it says it all): the moment the open setting shapes lights up, and its editor opens under it.
// active: 'wait' | 'interrupt' | 'quiet' | ''

const W = 730;
const CALLER = 14;
const AGENT = 58;
const QUIET_FROM = 460;
const QUIET_START = 42; // the example's caller goes quiet at 0:42

// a stretch of speech as thin bars, the same every time (seed)
function Speech({ from, to, y, seed, who }) {
  const bars = [];
  for (let x = from, i = 0; x + 3 <= to; x += 5, i += 1) {
    const level = Math.abs(((i * 0.53 + seed) % 2) - 1);
    const h = Math.max(4, Math.round(20 * (0.3 + 0.7 * level)));
    bars.push(<rect key={x} x={x} y={y + (20 - h) / 2} width="3" height={h} rx="1.5" />);
  }
  return <g className={who === 'caller' ? 'cdCaller' : 'cdAgent'}>{bars}</g>;
}

// a short sketch of one waiting choice (a gap between the caller and the agent), for the choices of how long it waits
export function WaitSketch({ gap }) {
  return (
    <svg className="cdSketch" viewBox="0 0 150 22" aria-hidden="true" focusable="false">
      <Speech from={0} to={50} y={1} seed={1} who="caller" />
      <rect className="cdGap" x="54" y="6" width={gap} height="10" rx="5" />
      <Speech from={58 + gap} to={146} y={1} seed={2} who="agent" />
    </svg>
  );
}

// the agent's lane is named in a few letters: its name, else its first word ("Front Desk" → "Front"), else cut short
const laneName = (name) => {
  if (name.length <= 8) return name;
  const first = name.split(/\s+/)[0];
  return first.length <= 8 ? first : `${name.slice(0, 7)}…`;
};

const MOMENTS = {
  wait: [166, 200],
  interrupt: [282, 348],
  quiet: [456, W],
};

export default function CallDrawing({ config, name, active = '' }) {
  const cut = readInterrupt(config).on;
  const q = readQuiet(config);
  const on = q.state === 'on';
  const shown = on ? Math.min(q.count, 4) : 0;
  const ends = on && (q.then.kind === 'end' || q.then.kind === 'person');
  // the check-ins, spread evenly over the quiet stretch, then the end
  const span = W - 30 - QUIET_FROM;
  const checkAt = Array.from({ length: shown }, (_, i) => QUIET_FROM + Math.round(((i + 1) / (shown + 1)) * span));
  const endAt = on && q.timeout ? QUIET_START + q.timeout * (q.count + 1) : null;
  const words = {
    wait: `${name} waits after the caller stops`,
    interrupt: cut ? `The caller cuts in, and ${name} stops to listen` : `The caller tries to cut in; ${name} finishes first`,
    quiet: on
      ? `Quiet: ${q.count ? `${q.count} check-in${q.count === 1 ? '' : 's'}` : 'no check-ins'}${q.timeout ? `, ${timeWords(q.timeout)} apart` : ''}${ends ? ', then the end' : ''}`
      : `Quiet: ${name} waits as long as it takes${q.state === 'unset' ? ' (no check-ins set up yet)' : ''}`,
  };
  const label = `An example call: the caller talks; ${name} answers after a pause; the caller ${cut ? 'cuts in' : 'tries to cut in'}; then the caller goes quiet${
    on && q.count ? ` and ${name} checks in ${q.count === 1 ? 'once' : `${q.count} times`}` : ''
  }${ends ? ', and the call ends' : ''}.`;
  const hi = MOMENTS[active];
  return (
    <figure className="cdScore">
      <svg viewBox={`0 0 ${W} ${AGENT + 54}`} role="img" aria-label={label}>
        {hi && (
          <g className="cdHi">
            <rect x={hi[0]} y="0" width={hi[1] - hi[0]} height={AGENT + 30} rx="10" />
            <rect className="cdHiBar" x={hi[0]} y={AGENT + 30} width={hi[1] - hi[0]} height="3" rx="1.5" />
          </g>
        )}
        <text className="cdLane" x="0" y={CALLER + 15}>
          Caller
        </text>
        <text className="cdLane" x="0" y={AGENT + 15}>
          {laneName(name)}
        </text>
        <line className="cdRule" x1="56" y1={CALLER + 10} x2={W} y2={CALLER + 10} />
        <line className="cdRule" x1="56" y1={AGENT + 10} x2={W} y2={AGENT + 10} />
        {/* 1 · the caller speaks; the agent waits a moment, then answers */}
        <Speech from={60} to={162} y={CALLER} seed={1} who="caller" />
        <rect className="cdGap" x="170" y={AGENT + 4} width="26" height="12" rx="6" />
        {/* 2 · the caller cuts in: the agent stops (or, when it can't be cut off, finishes) */}
        {cut ? (
          <>
            <Speech from={204} to={300} y={AGENT} seed={2} who="agent" />
            <path className="cdCut" d={`M302 ${AGENT - 2} l4 6 -4 6 4 6 -4 6`} />
            <Speech from={286} to={340} y={CALLER} seed={3} who="caller" />
            <Speech from={356} to={450} y={AGENT} seed={4} who="agent" />
          </>
        ) : (
          <>
            <Speech from={204} to={450} y={AGENT} seed={2} who="agent" />
            <Speech from={286} to={318} y={CALLER} seed={3} who="caller" />
          </>
        )}
        {/* 3 · the caller goes quiet: the check-ins, and the end */}
        <line className="cdQuiet" x1={QUIET_FROM} y1={CALLER + 10} x2={W - 10} y2={CALLER + 10} />
        {checkAt.map((x, i) => (
          <Speech key={x} from={x - 12} to={x + 14} y={AGENT} seed={5 + i} who="agent" />
        ))}
        {ends && (
          <g className="cdEnd">
            <circle cx={W - 12} cy={AGENT + 10} r="9" />
            <path d={`M${W - 17} ${AGENT + 12}c3-3 7-3 10 0`} />
          </g>
        )}
        <text className="cdTime" x="60" y={AGENT + 48}>
          0:00
        </text>
        <text className="cdTime" x={QUIET_FROM - 8} y={AGENT + 48}>
          {clockText(QUIET_START)}
        </text>
        {endAt !== null && (
          <text className="cdTime" x={W} y={AGENT + 48} textAnchor="end">
            {clockText(endAt)}
          </text>
        )}
      </svg>
      <figcaption className="cdLegend">
        <span>
          <i className="cdKey caller" aria-hidden="true" />
          the caller
        </span>
        <span>
          <i className="cdKey agent" aria-hidden="true" />
          {name}
        </span>
        <span>
          <i className="cdKey quiet" aria-hidden="true" />
          quiet
        </span>
        <span className={`cdCaption ${hi ? 'on' : ''}`} aria-live="polite">
          {hi ? words[active] : 'An example call, drawn from these settings. Open a part to see the moment it shapes.'}
        </span>
      </figcaption>
    </figure>
  );
}
