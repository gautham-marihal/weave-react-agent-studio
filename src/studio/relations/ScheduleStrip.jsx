import React from 'react';
import { DAYS, DAY_NAMES, describeWeek, exceptions, weekWindows } from './scheduleStrip.js';

// A schedule as a week you can see: a bar for each day, filled where the line is open, with the same thing in words and the days that are different
// on purpose. It is drawn from the schedule being edited, so the picture changes as the hours do.
const percent = (minutes) => `${(minutes / 1440) * 100}%`;

export default function ScheduleStrip({ value }) {
  if (!value || typeof value !== 'object') return null;
  const week = weekWindows(value);
  const special = exceptions(value);
  return (
    <figure className="rlStrip" aria-label="The week at a glance">
      <figcaption>{describeWeek(value)}</figcaption>
      <div className="rlStripRows" role="img" aria-label={describeWeek(value)}>
        {DAYS.map((day) => (
          <div className="rlStripRow" key={day}>
            <span>{DAY_NAMES[day].slice(0, 3)}</span>
            <div className="rlStripTrack">
              {week[day].map(([from, to]) => <i key={from} style={{ left: percent(from), width: percent(to - from) }} />)}
            </div>
          </div>
        ))}
        <div className="rlStripScale" aria-hidden="true"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      </div>
      {special.length > 0 && <ul className="rlStripSpecial">{special.map((item) => <li key={item.date}><b>{item.date}</b> {item.text}</li>)}</ul>}
    </figure>
  );
}
