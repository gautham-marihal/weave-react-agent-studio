import React, { useLayoutEffect, useRef, useState } from 'react';
import { STAGES, seconds } from './speedModel.js';

// The two pictures of the Speed page: the typical wait day by day against the target, and where a wait goes, part by part.
// Every value they show is also in a table (a button switches the line to one; the parts sit in their own table under the bars).

const dayLabel = (key, opts = { month: 'short', day: 'numeric' }) => new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });

// the width the chart is drawn at, followed as the window changes
function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// a round top for the y axis, in milliseconds, and its steps
function scaleOf(top) {
  const steps = [250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 30000];
  const step = steps.find((s) => top / s <= 4) || Math.ceil(top / 4 / 10000) * 10000;
  const max = Math.max(step, Math.ceil(top / step) * step);
  const ticks = [];
  for (let v = 0; v <= max + 1; v += step) ticks.push(v);
  return { max, ticks };
}

const tickText = (ms) => (ms === 0 ? '0' : ms < 1000 ? `${ms} ms` : `${ms / 1000} s`);

// The typical wait (half the answers came sooner) of each day of the period: a dot on each day with answers, a line through them (dashed across days
// without any, so it runs on from the first day with answers to the last) and the target across it. Pointing at the chart (or the arrow keys, once it has
// the keyboard) shows that day's numbers.
//   days: [{ day, n, p50, p90 }]; targetMs
export function DayChart({ days, targetMs }) {
  const box = useRef(null);
  const width = useWidth(box);
  const [active, setActive] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const withData = days.filter((d) => d.p50 !== null);
  const H = 196;
  const pad = { top: 14, right: 16, bottom: 30, left: 44 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const { max, ticks } = scaleOf(Math.max(targetMs, ...withData.map((d) => d.p50)) * 1.15);
  const x = (i) => pad.left + (i + 0.5) * (plotW / Math.max(1, days.length));
  const y = (ms) => pad.top + plotH - (Math.min(ms, max) / max) * plotH;
  // a date under every day, or every other one, …, counted back from the last day so the last day always has its own
  const every = days.length > 16 ? Math.ceil(days.length / 7) : days.length > 8 ? 2 : 1;
  const dated = (i) => (days.length - 1 - i) % every === 0;

  // the line: solid from a day with answers to the next day, dashed across days without any; the area under all of it
  const at = (px, py) => `${px.toFixed(1)},${py.toFixed(1)}`;
  const pts = days.flatMap((d, i) => (d.p50 === null ? [] : [{ i, px: x(i), py: y(d.p50) }]));
  const steps = pts.slice(1).map((to, k) => ({ from: pts[k], to, gap: to.i - pts[k].i > 1 }));
  let solid = '';
  let dashed = '';
  steps.forEach(({ from, to, gap }, k) => {
    if (gap) dashed += `M${at(from.px, from.py)}L${at(to.px, to.py)}`;
    else solid += `${k > 0 && !steps[k - 1].gap ? '' : `M${at(from.px, from.py)}`}L${at(to.px, to.py)}`;
  });
  const base = pad.top + plotH;
  const area = pts.length > 1 ? `M${pts.map((p) => at(p.px, p.py)).join('L')}L${at(pts.at(-1).px, base)}L${at(pts[0].px, base)}Z` : '';
  const hasGap = steps.some((s) => s.gap);

  const pick = (clientX) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !days.length) return;
    const i = Math.round((clientX - r.left - pad.left) / (plotW / days.length) - 0.5);
    setActive(Math.max(0, Math.min(days.length - 1, i)));
  };
  const onKey = (event) => {
    if (!days.length) return;
    const last = days.length - 1;
    if (event.key === 'ArrowLeft') setActive((i) => Math.max(0, (i ?? last + 1) - 1));
    else if (event.key === 'ArrowRight') setActive((i) => Math.min(last, (i ?? -1) + 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else if (event.key === 'Escape') setActive(null);
    else return;
    event.preventDefault();
  };
  const shown = active !== null ? days[active] : null;
  // beside the day pointed at, on the side with room, never over its point
  const TIP_W = 190;
  const tipLeft = !shown ? 0 : x(active) + 14 + TIP_W <= width ? x(active) + 14 : Math.max(0, x(active) - 14 - TIP_W);
  const best = withData.length ? withData.reduce((a, b) => (b.p50 < a.p50 ? b : a)) : null;
  const worst = withData.length ? withData.reduce((a, b) => (b.p50 > a.p50 ? b : a)) : null;
  const summary = withData.length
    ? `Typical wait each day. Quickest ${dayLabel(best.day)}: ${seconds(best.p50)}; slowest ${dayLabel(worst.day)}: ${seconds(worst.p50)}. Target ${seconds(targetMs)}.`
    : 'No answers to show day by day.';

  return (
    <div className="csDayChart">
      <div className="csChartBar">
        <span className="csChartKey">
          <i className="csKeyLine" aria-hidden="true" /> Typical wait
          <i className="csKeyTarget" aria-hidden="true" /> Your target
          {hasGap && (
            <>
              <i className="csKeyGap" aria-hidden="true" /> No answers in between
            </>
          )}
        </span>
        <button type="button" className="linkButton" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show as a chart' : 'Show as a table'}
        </button>
      </div>
      {asTable ? (
        <table className="csTable csDayTable">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Answers</th>
              <th scope="col">Typical wait</th>
              <th scope="col">9 out of 10 within</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td>{dayLabel(d.day, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                <td>{d.n}</td>
                <td className={d.p50 !== null && d.p50 > targetMs ? 'csWarnText' : ''}>{seconds(d.p50)}</td>
                <td>{seconds(d.p90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div
          ref={box}
          className="csPlot"
          role="img"
          aria-label={summary}
          tabIndex={0}
          onKeyDown={onKey}
          onPointerMove={(event) => pick(event.clientX)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          {width > 0 && (
            <svg width={width} height={H} aria-hidden="true">
              {ticks.map((t) => (
                <g key={t}>
                  <line className="csGridLine" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
                  <text className="csAxisText" x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                    {tickText(t)}
                  </text>
                </g>
              ))}
              {days.map((d, i) =>
                dated(i) ? (
                  <text key={d.day} className="csAxisText" x={x(i)} y={H - 8} textAnchor="middle">
                    {dayLabel(d.day)}
                  </text>
                ) : null,
              )}
              {area && <path className="csArea" d={area} />}
              <line className="csTargetLine" x1={pad.left} x2={width - pad.right} y1={y(targetMs)} y2={y(targetMs)} />
              {dashed && <path className="csLine csLineGap" d={dashed} />}
              {solid && <path className="csLine" d={solid} />}
              {shown && <line className="csCross" x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotH} />}
              {days.map((d, i) =>
                d.p50 === null ? null : <circle key={d.day} className={`csDot ${i === active ? 'on' : ''}`} cx={x(i)} cy={y(d.p50)} r={i === active ? 5 : 4} />,
              )}
            </svg>
          )}
          {shown && (
            <div className="csTip" style={{ left: tipLeft }} role="status">
              <span className="csTipDay">{dayLabel(shown.day, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              {shown.n ? (
                <>
                  <span>
                    <i className="csKeyLine" aria-hidden="true" />
                    <b>{seconds(shown.p50)}</b> typical wait
                  </span>
                  <span>
                    9 out of 10 within <b>{seconds(shown.p90)}</b>
                  </span>
                  <span className="csTipMuted">
                    from {shown.n} answer{shown.n === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                <span className="csTipMuted">No answers timed</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const KINDS = [
  ['voice', 'Voice calls'],
  ['chat', 'Chats'],
];

// Where a wait goes: for voice calls and for chats, a bar split into its parts (their average over the answers that recorded each), and under it the
// same numbers in a table, each part named and said in words.
//   stages: { voice?: { answers, wait, avg: { [stage]: { ms, n } } }, chat?: … }
export function StageBars({ stages }) {
  const kinds = KINDS.filter(([k]) => stages[k]);
  const used = STAGES.filter((s) => kinds.some(([k]) => stages[k].avg[s.id]));
  const shareOf = (kind, id) => {
    const avg = stages[kind].avg;
    const total = Object.values(avg).reduce((a, v) => a + v.ms, 0);
    return total ? avg[id].ms / total : 0;
  };
  return (
    <div className="csStages">
      {kinds.map(([kind, label]) => {
        const k = stages[kind];
        const parts = STAGES.filter((s) => k.avg[s.id]);
        return (
          <div key={kind} className="csStageRow">
            <div className="csStageHead">
              <strong>{label}</strong>
              <span>
                {seconds(k.wait)} on average · {k.answers} answer{k.answers === 1 ? '' : 's'}
              </span>
            </div>
            <div className="csStageBar" role="img" aria-label={`${label}: ${parts.map((s) => `${s.label} ${seconds(k.avg[s.id].ms)}`).join(', ')}`}>
              {parts.map((s) => (
                <span
                  key={s.id}
                  className={`csSeg csSeg-${s.id}`}
                  style={{ flexGrow: Math.max(0.001, shareOf(kind, s.id)) }}
                  title={`${s.label}: ${seconds(k.avg[s.id].ms)} on average (${Math.round(shareOf(kind, s.id) * 100)}%)`}
                />
              ))}
            </div>
          </div>
        );
      })}
      <table className="csTable csStageTable">
        <thead>
          <tr>
            <th scope="col">Part of the wait</th>
            {kinds.map(([kind, label]) => (
              <th key={kind} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {used.map((s) => (
            <tr key={s.id}>
              <th scope="row">
                <span className="csStageName">
                  <i className={`csSwatch csSeg-${s.id}`} aria-hidden="true" />
                  <span>
                    {s.label}
                    <small>{s.about}</small>
                  </span>
                </span>
              </th>
              {kinds.map(([kind]) => (
                <td key={kind}>
                  {stages[kind].avg[s.id] ? (
                    <>
                      <b>{seconds(stages[kind].avg[s.id].ms)}</b> <span className="stMuted">{Math.round(shareOf(kind, s.id) * 100)}%</span>
                    </>
                  ) : (
                    <span className="stMuted">–</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
