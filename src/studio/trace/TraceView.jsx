import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GROUPS, describeRecords, filterRows, groupCounts, traceAsText, traceSummary } from './records.js';
import './trace.css';
import { maskTraceRows } from '../privacy/maskConfidential.js';
import Button from '../../ui/Button.tsx';

// What happened in a conversation, for a real call, the Test tab and a failed scenario (all the same records): rows in
// order, filters by kind, what went wrong marked, raw fields on request. `live` follows a call in progress.

// A picture's sharpness or brightness as a bar, with the request's standard marked on it (a floor, or a band), so an
// author sees at once why a photo was turned down and what to set. Sharpness spans 0 to thousands, so it is drawn on a
// log scale.
function PictureMeter({ meter }) {
  const at = (v) => {
    const x = Math.max(0, Math.min(v, meter.max));
    return meter.log ? (Math.log10(1 + x) / Math.log10(1 + meter.max)) * 100 : (x / meter.max) * 100;
  };
  const value = Math.round(meter.value * 10) / 10;
  const short = (meter.need !== undefined && meter.value < meter.need) || (meter.band && (meter.value < meter.band[0] || meter.value > meter.band[1]));
  const standard = meter.need !== undefined ? `needs ${meter.need}` : meter.band ? `between ${meter.band[0]} and ${meter.band[1]}` : '';
  return (
    <div className={`trMeter ${short ? 'short' : ''}`}>
      <span className="trMeterTop">
        <span>{meter.label}</span>
        <span>
          <b>{value}</b>
          {standard && <small> · {standard}</small>}
        </span>
      </span>
      <span className="trMeterBar" aria-hidden="true">
        <span className="trMeterFill" style={{ width: `${at(meter.value).toFixed(1)}%` }} />
        {meter.band && (
          <span className="trMeterBand" style={{ left: `${at(meter.band[0]).toFixed(1)}%`, width: `${(at(meter.band[1]) - at(meter.band[0])).toFixed(1)}%` }} />
        )}
        {meter.need !== undefined && <span className="trMeterNeed" style={{ left: `${at(meter.need).toFixed(1)}%` }} />}
      </span>
    </div>
  );
}
export default function TraceView({ records, live = false, compact = false, title = 'What happened', emptyText = 'Nothing has been recorded yet.', note }) {
  const [active, setActive] = useState([]);
  const [copied, setCopied] = useState(false);
  const endRef = useRef(null);
  // what was said is shown with PINs, codes and ID numbers masked
  const rows = useMemo(() => maskTraceRows(describeRecords(records)), [records]);
  const counts = useMemo(() => groupCounts(rows), [rows]);
  const summary = useMemo(() => traceSummary(records), [records]);
  const shown = useMemo(() => filterRows(rows, active), [rows, active]);
  useEffect(() => {
    const el = endRef.current?.parentElement;
    if (live && el) el.scrollTop = el.scrollHeight;
  }, [live, rows.length]);

  const toggle = (id) => setActive((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(traceAsText(records));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };

  return (
    <section className={`trView ${compact ? 'compact' : ''}`} aria-label={title}>
      <header className="trHead">
        <div>
          <strong>{title}</strong>
          <small className="trSummary">
            {summary.said} message{summary.said === 1 ? '' : 's'} · {summary.tools} tool call{summary.tools === 1 ? '' : 's'} · {summary.requests} API request
            {summary.requests === 1 ? '' : 's'}
            {summary.errors > 0 && (
              <>
                {' '}
                ·{' '}
                <b className="trBad">
                  {summary.errors} problem{summary.errors === 1 ? '' : 's'}
                </b>
              </>
            )}
            {summary.seconds > 0 && <> · {Math.round(summary.seconds)} s</>}
          </small>
        </div>
        <div className="trActions">
          {live && (
            <span className="trLive" role="status">
              <i aria-hidden="true" />
              Following live
            </span>
          )}
          <Button type="button" onClick={copy} disabled={!rows.length}>
            {copied ? 'Copied' : 'Copy as text'}
          </Button>
        </div>
      </header>

      {note && (
        <p className="trNote" role="note">
          {note}
        </p>
      )}

      {rows.length > 0 && (
        <div className="trChips" role="group" aria-label="Show only">
          {GROUPS.filter((g) => counts[g.id] > 0).map((g) => (
            <button
              type="button"
              key={g.id}
              className={`trChip ${active.includes(g.id) ? 'on' : ''} ${g.id === 'errors' ? 'bad' : ''}`}
              aria-pressed={active.includes(g.id)}
              onClick={() => toggle(g.id)}
            >
              {g.label} <small>{counts[g.id]}</small>
            </button>
          ))}
          {active.length > 0 && (
            <button type="button" className="stLink" onClick={() => setActive([])}>
              Show all
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="trEmpty">{emptyText}</p>
      ) : (
        <div className="trListBox">
          <ol className="trList" aria-live={live ? 'polite' : undefined}>
            {shown.map((row) => (
              <li key={`${row.id}-${row.kind}`} className={`trRow ${row.tone} ${row.problem ? 'problem' : ''}`} data-kind={row.kind}>
                <span className="trAt">{row.at}</span>
                <span className={`trLabel ${row.tone}`}>{row.label}</span>
                <div className="trBody">
                  {row.text && <p className="trText">{row.text}</p>}
                  {(row.facts.length > 0 || row.ms !== undefined) && (
                    <p className="trFacts">
                      {row.facts.map(([k, v]) => (
                        <span key={k + v}>
                          <em>{k}</em> {v}
                        </span>
                      ))}
                      {row.ms !== undefined && (
                        <span>
                          <em>took</em> {row.ms} ms
                        </span>
                      )}
                    </p>
                  )}
                  {row.meters?.length > 0 && (
                    <div className="trMeters">
                      {row.meters.map((meter) => (
                        <PictureMeter key={meter.id} meter={meter} />
                      ))}
                    </div>
                  )}
                  {row.pairs?.length > 0 && (
                    <p className="trPairs">
                      {row.pairs.map((pair, i) => (
                        <span key={`${pair.label}-${i}`} className={pair.matched ? 'same' : 'differs'}>
                          {pair.label} {pair.matched ? 'matched' : 'differs'}
                        </span>
                      ))}
                    </p>
                  )}
                  {row.note && <p className="trNote2">{row.note}</p>}
                  <details className="trRaw">
                    <summary>Raw record</summary>
                    <pre>{JSON.stringify(row.raw, null, 2)}</pre>
                  </details>
                </div>
              </li>
            ))}
            <li ref={endRef} aria-hidden="true" className="trEnd" />
          </ol>
        </div>
      )}
      {rows.length > 0 && shown.length === 0 && <p className="trEmpty">Nothing of that kind happened.</p>}
    </section>
  );
}
