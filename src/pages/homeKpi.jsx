import React from 'react';
import { Skeleton } from '../ui/Skeleton.jsx';

// The number tiles of Home and of an agent's Overview: one look for both (canvasLook.css, inside .cvLook).

// How a number moved since the period before, in words, and whether that is good: { text, tone } or null.
//   better: 'up' | 'down' | null (neither is better: calls)
export function moved(now, before, show, better) {
  if (typeof now !== 'number' || typeof before !== 'number') return null;
  if (show(now) === show(before)) return { text: 'Same as before', tone: 'same' };
  const up = now > before;
  const tone = !better ? 'same' : (up && better === 'up') || (!up && better === 'down') ? 'good' : 'bad';
  return { text: `${up ? 'Up' : 'Down'} from ${show(before)}`, tone };
}

// a line through the values, in an 88 × 26 box
export const sparkPoints = (values) => {
  const xs = values.map((v) => (typeof v === 'number' ? v : 0));
  if (xs.length < 2) return '';
  const max = Math.max(...xs);
  const min = Math.min(...xs);
  return xs.map((v, i) => `${((i * 88) / (xs.length - 1)).toFixed(1)},${(23 - ((v - min) / (max - min || 1)) * 20).toFixed(1)}`).join(' ');
};

// One of the four numbers: a button that opens the page explaining it. The change sits top right; in the page's text
// it comes last, so the number and its sentence are read together.
export function Kpi({ label, value, note, change, spark, loading, onOpen, title }) {
  return (
    <button type="button" className="cvKpi" onClick={onOpen} title={title} aria-busy={loading || undefined}>
      <span className="cvKpiLabel">{label}</span>
      {/* while it is read: placeholders where the number and its sentence go, never a false dash */}
      {loading ? <Skeleton width={64} height={28} className="cvKpiWait cvKpiWaitValue" /> : <strong>{value}</strong>}
      {!loading && spark && (
        <svg className="cvSpark" width="88" height="26" viewBox="0 0 88 26" aria-hidden="true">
          <polyline points={spark} />
        </svg>
      )}
      {loading ? <Skeleton width="70%" height={10} className="cvKpiWait cvKpiWaitNote" /> : <small>{note}</small>}
      {loading && <span className="srOnly">Reading the calls…</span>}
      {!loading && change && <span className={`cvChange ${change.tone}`}>{change.text}</span>}
    </button>
  );
}
