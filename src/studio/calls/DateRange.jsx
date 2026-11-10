import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { dayKey, dayOf, datesWords, monthWeeks } from './callModel.js';

// Any two days for the Calls list (FRONTEND_GUIDE 10.3: `since` and `until`): a month at a time, Monday first. The
// first press picks the first day, the second the last; the days between are shaded. One tab stop: the arrow keys move
// a day or a week (into the next month too), Enter or Space picks, Page Up and Page Down change the month.
//   from, to: "YYYY-MM-DD" ('' while not chosen); onChange({ from, to })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const shift = (key, days) => {
  const d = dayOf(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
};

export default function DateRange({ from, to, onChange }) {
  const today = dayKey(new Date());
  const [focus, setFocus] = useState(to || from || today);
  const [month, setMonth] = useState(() => {
    const d = dayOf(to || from || today);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const grid = useRef(null);
  const moved = useRef(false);
  const weeks = monthWeeks(month.y, month.m);
  // the focused day moved by a key: it gets the focus (its month is shown first)
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector(`[data-day="${focus}"]`)?.focus();
  }, [focus, month]);

  const go = (key) => {
    const d = dayOf(key);
    moved.current = true;
    setFocus(key);
    if (d.getFullYear() !== month.y || d.getMonth() !== month.m) setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const pick = (key) => {
    if (key > today) return;
    // a new range starts when both ends are set, or a day before the first is picked
    if (!from || to || key < from) onChange({ from: key, to: '' });
    else onChange({ from, to: key });
  };
  const step = (by) => setMonth(({ y, m }) => ({ y: m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, m: (m + by + 12) % 12 }));
  const keys = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  };
  const onKey = (event, key) => {
    if (keys[event.key]) {
      event.preventDefault();
      go(shift(key, keys[event.key]));
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const d = dayOf(key);
      const by = event.key === 'PageUp' ? -1 : 1;
      const next = new Date(d.getFullYear(), d.getMonth() + by, 1);
      go(dayKey(new Date(next.getFullYear(), next.getMonth(), Math.min(d.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()))));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const d = dayOf(key);
      const back = (d.getDay() + 6) % 7;
      go(shift(key, event.key === 'Home' ? -back : 6 - back));
    }
  };
  // the focused day is in the shown month, else its first day takes the tab stop
  const inShown = weeks.some((w) => w.some((x) => x.key === focus && x.inMonth));
  const tabStop = inShown ? focus : weeks.flat().find((x) => x.inMonth)?.key;
  const end = to || from;
  const words = from ? datesWords(from, to) : '';

  return (
    <div className="clRange" role="group" aria-label="Choose the days">
      <div className="clRangeHead">
        <button type="button" className="stIconBtn" aria-label="The month before" onClick={() => step(-1)}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <strong aria-live="polite">
          {MONTHS[month.m]} {month.y}
        </strong>
        <button
          type="button"
          className="stIconBtn"
          aria-label="The month after"
          onClick={() => step(1)}
          disabled={`${month.y}-${String(month.m + 1).padStart(2, '0')}` >= today.slice(0, 7)}
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
      <div className="clCal" role="grid" aria-label={`${MONTHS[month.m]} ${month.y}`} ref={grid}>
        <div role="row" className="clCalRow">
          {DAYS.map((d) => (
            <span key={d} role="columnheader" className="clCalDay">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" className="clCalRow" key={week[0].key}>
            {week.map((x) => {
              const inRange = from && end && x.key >= (from < end ? from : end) && x.key <= (from < end ? end : from);
              const edge = x.key === from || x.key === to;
              const future = x.key > today;
              const date = dayOf(x.key);
              return (
                <span role="gridcell" key={x.key} aria-selected={!!inRange}>
                  <button
                    type="button"
                    data-day={x.key}
                    tabIndex={x.key === tabStop ? 0 : -1}
                    disabled={future}
                    className={[
                      'clCalBtn',
                      x.inMonth ? '' : 'out',
                      inRange ? 'in' : '',
                      edge ? 'edge' : '',
                      x.key === (from < end ? from : end) ? 'first' : '',
                      x.key === (from < end ? end : from) ? 'last' : '',
                      x.key === today ? 'today' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-label={date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    aria-pressed={edge}
                    onClick={() => {
                      setFocus(x.key);
                      pick(x.key);
                    }}
                    onKeyDown={(event) => onKey(event, x.key)}
                  >
                    {x.day}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="clRangeLine" role="status">
        {words ? (
          <>
            <b>{words}</b>
            {from && !to ? <span> · press the last day, or keep this one day</span> : null}
          </>
        ) : (
          'Press the first day, then the last.'
        )}
      </p>
    </div>
  );
}
