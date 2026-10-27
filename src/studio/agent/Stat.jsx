import React, { useState } from 'react';
import { Skeleton } from '../../ui/Skeleton.jsx';

const dayName = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const callsText = (n) => `${n} call${n === 1 ? '' : 's'}`;

// One number, its meaning and comparison; it opens the page that explains it (Overview and Home).
//   series: [{ day: 'YYYY-MM-DD', calls }] as small bars; hover shows a bar's day and count; screen readers hear words
//   loading: placeholder shapes where the number and its line will be
export default function Stat({ label, value, sub, series, onOpen, title, loading = false }) {
  const [at, setAt] = useState(null);
  const days = series || [];
  const max = Math.max(1, ...days.map((d) => d.calls));
  const pointed = at !== null ? days[at] : null;
  return (
    <button type="button" className="ovStat" onClick={onOpen} title={title} aria-busy={loading || undefined}>
      <span className="ovStatLabel">{label}</span>
      {loading ? (
        <>
          <Skeleton width={56} height={26} className="ovStatSkeleton" />
          <Skeleton width="62%" height={10} />
          <span className="srOnly">Loading</span>
        </>
      ) : (
        <>
          <strong>{value}</strong>
          {(pointed || sub) && <small aria-live="polite">{pointed ? `${dayName(pointed.day)}: ${callsText(pointed.calls)}` : sub}</small>}
        </>
      )}
      {!loading && days.length > 0 && (
        <>
          <span className="ovSpark" aria-hidden="true" onMouseLeave={() => setAt(null)}>
            {days.map((d, i) => (
              <i
                key={d.day}
                className={i === days.length - 1 ? 'today' : ''}
                style={{ height: `${Math.max(6, (d.calls / max) * 100)}%` }}
                onMouseEnter={() => setAt(i)}
              />
            ))}
          </span>
          <span className="srOnly">{`By day: ${days.map((d) => `${dayName(d.day)} ${d.calls}`).join(', ')}.`}</span>
        </>
      )}
    </button>
  );
}
