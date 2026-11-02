import React, { useLayoutEffect, useRef, useState } from 'react';
import { STAGES, seconds, type DayPoint, type StageId, type StagesByKind } from '../../models/speed';
import { cn } from '../../utils/styles';
import { STAGE_COLOUR } from './stageColours';

// The Speed page's two charts: the typical wait per day against the target, and where a wait goes, part by part.
// Every value is also in a table (a button switches the line to one; the parts' table sits under the bars).

const dayLabel = (key: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });

// the width the chart is drawn at, followed as the window changes
function useWidth(ref: React.RefObject<HTMLDivElement>) {
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
function scaleOf(top: number) {
  const steps = [250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 30000];
  const step = steps.find((s) => top / s <= 4) || Math.ceil(top / 4 / 10000) * 10000;
  const max = Math.max(step, Math.ceil(top / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1; v += step) ticks.push(v);
  return { max, ticks };
}
const tickText = (ms: number) => (ms === 0 ? '0' : ms < 1000 ? `${ms} ms` : `${ms / 1000} s`);

/**
 * The typical wait (median) per day: a dot on each day with answers, a line through them (dashed across empty days) and
 * the target. Pointing (or the arrow keys, once focused) shows that day's numbers.
 */
export function DayChart({ days, targetMs }: { days: DayPoint[]; targetMs: number }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const withData = days.filter((d): d is DayPoint & { p50: number } => d.p50 !== null);
  const H = 196;
  const pad = { top: 14, right: 16, bottom: 30, left: 44 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const { max, ticks } = scaleOf(Math.max(targetMs, ...withData.map((d) => d.p50)) * 1.15);
  const x = (i: number) => pad.left + (i + 0.5) * (plotW / Math.max(1, days.length));
  const y = (ms: number) => pad.top + plotH - (Math.min(ms, max) / max) * plotH;
  // a date under every day, or every other one, counted back from the last day so the last day always has its own
  const every = days.length > 16 ? Math.ceil(days.length / 7) : days.length > 8 ? 2 : 1;
  const dated = (i: number) => (days.length - 1 - i) % every === 0;

  // the line: solid from a day with answers to the next day, dashed across days without any; the area under all of it
  const at = (px: number, py: number) => `${px.toFixed(1)},${py.toFixed(1)}`;
  const pts = days.flatMap((d, i) => (d.p50 === null ? [] : [{ i, px: x(i), py: y(d.p50) }]));
  const steps = pts.slice(1).map((to, k) => ({ from: pts[k], to, gap: to.i - pts[k].i > 1 }));
  let solid = '';
  let dashed = '';
  steps.forEach(({ from, to, gap }, k) => {
    if (gap) dashed += `M${at(from.px, from.py)}L${at(to.px, to.py)}`;
    else solid += `${k > 0 && !steps[k - 1].gap ? '' : `M${at(from.px, from.py)}`}L${at(to.px, to.py)}`;
  });
  const base = pad.top + plotH;
  const last = pts[pts.length - 1];
  const area = pts.length > 1 ? `M${pts.map((p) => at(p.px, p.py)).join('L')}L${at(last.px, base)}L${at(pts[0].px, base)}Z` : '';
  const hasGap = steps.some((s) => s.gap);

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !days.length) return;
    const i = Math.round((clientX - r.left - pad.left) / (plotW / days.length) - 0.5);
    setActive(Math.max(0, Math.min(days.length - 1, i)));
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (!days.length) return;
    const lastDay = days.length - 1;
    if (event.key === 'ArrowLeft') setActive((i) => Math.max(0, (i ?? lastDay + 1) - 1));
    else if (event.key === 'ArrowRight') setActive((i) => Math.min(lastDay, (i ?? -1) + 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(lastDay);
    else if (event.key === 'Escape') setActive(null);
    else return;
    event.preventDefault();
  };
  const shown = active !== null ? days[active] : null;
  // beside the day pointed at, on the side with room, never over its point
  const TIP_W = 190;
  const tipLeft = active === null ? 0 : x(active) + 14 + TIP_W <= width ? x(active) + 14 : Math.max(0, x(active) - 14 - TIP_W);
  const best = withData.length ? withData.reduce((a, b) => (b.p50 < a.p50 ? b : a)) : null;
  const worst = withData.length ? withData.reduce((a, b) => (b.p50 > a.p50 ? b : a)) : null;
  const summary =
    best && worst
      ? `Typical wait each day. Quickest ${dayLabel(best.day)}: ${seconds(best.p50)}; slowest ${dayLabel(worst.day)}: ${seconds(worst.p50)}. Target ${seconds(targetMs)}.`
      : 'No answers to show day by day.';

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-hidden>
          <span className="flex items-center gap-1.5">
            <i className="h-0.5 w-4 bg-accent" /> Typical wait
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-4 border-t-2 border-dashed border-warning" /> Your target
          </span>
          {hasGap && (
            <span className="flex items-center gap-1.5">
              <i className="w-4 border-t border-dashed border-accent" /> No answers in between
            </span>
          )}
        </span>
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show as a chart' : 'Show as a table'}
        </button>
      </div>
      {asTable ? (
        <table className="w-full text-sm" data-testid="speed-day-table">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-3 py-2 font-medium">Day</th>
              <th scope="col" className="px-3 py-2 font-medium">Answers</th>
              <th scope="col" className="px-3 py-2 font-medium">Typical wait</th>
              <th scope="col" className="px-3 py-2 font-medium">9 out of 10 within</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5">{dayLabel(d.day, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                <td className="px-3 py-1.5 tabular-nums">{d.n}</td>
                <td className={cn('px-3 py-1.5 tabular-nums', d.p50 !== null && d.p50 > targetMs && 'font-medium text-warning')}>{seconds(d.p50)}</td>
                <td className="px-3 py-1.5 tabular-nums">{seconds(d.p90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div
          ref={box}
          className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          style={{ height: H }}
          role="img"
          aria-label={summary}
          tabIndex={0}
          data-testid="speed-day-chart"
          onKeyDown={onKey}
          onPointerMove={(event) => pick(event.clientX)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          {width > 0 && (
            <svg width={width} height={H} aria-hidden className="overflow-visible">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
                  <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">
                    {tickText(t)}
                  </text>
                </g>
              ))}
              {days.map((d, i) =>
                dated(i) ? (
                  <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">
                    {dayLabel(d.day)}
                  </text>
                ) : null
              )}
              {area && <path d={area} className="fill-accent/10" />}
              <line x1={pad.left} x2={width - pad.right} y1={y(targetMs)} y2={y(targetMs)} className="stroke-warning" strokeWidth={1.5} strokeDasharray="5 4" />
              {dashed && <path d={dashed} className="fill-none stroke-accent" strokeWidth={1.5} strokeDasharray="3 4" />}
              {solid && <path d={solid} className="fill-none stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {active !== null && <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotH} className="stroke-line-strong" strokeWidth={1} />}
              {days.map((d, i) =>
                d.p50 === null ? null : (
                  <circle key={d.day} cx={x(i)} cy={y(d.p50)} r={i === active ? 5 : 3.5} className="fill-surface stroke-accent" strokeWidth={2} />
                )
              )}
            </svg>
          )}
          {shown && (
            <div
              className="pointer-events-none absolute top-2 z-10 flex w-[190px] flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-soft shadow-overlay"
              style={{ left: tipLeft }}
              role="status"
              data-testid="speed-day-tip"
            >
              <span className="font-medium text-ink">{dayLabel(shown.day, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              {shown.n ? (
                <>
                  <span>
                    <b className="tabular-nums text-ink">{seconds(shown.p50)}</b> typical wait
                  </span>
                  <span>
                    9 out of 10 within <b className="tabular-nums text-ink">{seconds(shown.p90)}</b>
                  </span>
                  <span className="text-muted">
                    from {shown.n} answer{shown.n === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                <span className="text-muted">No answers timed</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const KINDS: ['voice' | 'chat', string][] = [
  ['voice', 'Voice calls'],
  ['chat', 'Chats'],
];

/**
 * Where a wait goes: for voice calls and chats, a bar split into parts (averaged over the answers that recorded each),
 * with the same numbers in a table below, each part named and said in words.
 */
export function StageBars({ stages }: { stages: StagesByKind }) {
  const kinds = KINDS.filter(([k]) => stages[k]);
  const used = STAGES.filter((s) => kinds.some(([k]) => stages[k]?.avg[s.id]));
  const shareOf = (kind: 'voice' | 'chat', id: StageId) => {
    const avg = stages[kind]?.avg ?? {};
    const total = Object.values(avg).reduce((a, v) => a + (v?.ms ?? 0), 0);
    return total ? (avg[id]?.ms ?? 0) / total : 0;
  };
  return (
    <div className="space-y-4">
      {kinds.map(([kind, label]) => {
        const k = stages[kind];
        if (!k) return null;
        const parts = STAGES.filter((s) => k.avg[s.id]);
        return (
          <div key={kind} data-testid="speed-stage-row">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <strong className="font-medium text-ink">{label}</strong>
              <span className="text-xs text-muted">
                {seconds(k.wait)} on average · {k.answers} answer{k.answers === 1 ? '' : 's'}
              </span>
            </div>
            <div
              className="mt-1.5 flex h-3.5 gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={`${label}: ${parts.map((s) => `${s.label} ${seconds(k.avg[s.id]?.ms)}`).join(', ')}`}
            >
              {parts.map((s) => (
                <span
                  key={s.id}
                  className={cn('block h-full', STAGE_COLOUR[s.id])}
                  style={{ flexGrow: Math.max(0.001, shareOf(kind, s.id)) }}
                  title={`${s.label}: ${seconds(k.avg[s.id]?.ms)} on average (${Math.round(shareOf(kind, s.id) * 100)}%)`}
                />
              ))}
            </div>
          </div>
        );
      })}
      <table className="w-full text-sm" data-testid="speed-stage-table">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="px-3 py-2 font-medium">Part of the wait</th>
            {kinds.map(([kind, label]) => (
              <th key={kind} scope="col" className="px-3 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {used.map((s) => (
            <tr key={s.id} className="border-b border-line last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <span className="flex items-start gap-2">
                  <i aria-hidden className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-sm', STAGE_COLOUR[s.id])} />
                  <span>
                    <span className="block text-ink">{s.label}</span>
                    <span className="block text-xs text-muted">{s.about}</span>
                  </span>
                </span>
              </th>
              {kinds.map(([kind]) => {
                const v = stages[kind]?.avg[s.id];
                return (
                  <td key={kind} className="px-3 py-2 align-top tabular-nums">
                    {v ? (
                      <>
                        <b className="font-medium text-ink">{seconds(v.ms)}</b> <span className="text-muted">{Math.round(shareOf(kind, s.id) * 100)}%</span>
                      </>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
