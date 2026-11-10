import React from 'react';
import Icon from '../../../../ui/Icon.jsx';
import { DAY_NAMES, WAYS } from './channelsWords.js';
import { TYPE_LABELS } from '../../../form/presets.js';

// The pictures of Channels (canvas board H1), drawn from the agent's own configuration: each way in as a door (its first
// words, what the person can use, how it answers, what it can do there), with a dashed door for each working way that
// isn't on; and a week of a set of hours, with the moment it is now by that schedule's own clock.

const WHAT = {
  web_chat: 'Not on yet: a chat box on your website that visitors type into.',
  web_voice: 'Not on yet: visitors would talk to it from the browser.',
  sip_voice: 'Not on yet: people would ring a number you add when it goes live.',
};

export function Doors({ ways, onWay, onMissing }) {
  const missing = WAYS.filter((w) => !ways.some((x) => x.type === w.type));
  return (
    <ul className="chDoors" aria-label="Its ways in">
      {ways.map((w) => (
        <li key={w.key}>
          <button type="button" className={`chDoor ${w.on ? '' : 'off'} ${w.state.tone}`} onClick={() => onWay(w)}>
            <span className="chDoorHead">
              <span className="chDoorIcon" aria-hidden="true">
                <Icon name={w.icon} size={15} />
              </span>
              <b>{w.name}</b>
              <span className={`tlState ${w.state.tone}`}>{w.state.words}</span>
            </span>
            <span className={`chBubble ${w.says ? '' : 'none'}`}>
              {w.says ? `“${w.says.length > 90 ? `${w.says.slice(0, 89).trimEnd()}…` : w.says}”` : 'Waits for the person to start'}
            </span>
            <span className="chCarried">
              {w.carries.map((c) => (
                <span key={`${c.dir}${c.m}`} className={`chCarriedOne ${c.dir}`}>
                  <Icon name={c.icon} size={12} />
                  {c.words}
                </span>
              ))}
            </span>
            <span className="chCan">
              {w.can
                .filter((c) => c.allowed || c.ok)
                .map((c) => (
                  <span key={c.key} className={c.ok ? '' : 'no'}>
                    <Icon name={c.icon} size={12} />
                    {c.words}
                    {!c.ok && <span className="srOnly"> (off)</span>}
                  </span>
                ))}
            </span>
          </button>
        </li>
      ))}
      {missing.map((w) => (
        <li key={w.type}>
          <button type="button" className="chDoor off missing" onClick={() => onMissing(w.type)}>
            <span className="chDoorHead">
              <span className="chDoorIcon" aria-hidden="true">
                <Icon name={w.icon} size={15} />
              </span>
              <b>{TYPE_LABELS[w.type]}</b>
              <span className="tlState off">Off</span>
            </span>
            <span className="chBubble none">{WHAT[w.type]}</span>
            <span className="chSwitchOn">
              <Icon name="plus" size={13} />
              Switch it on
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const pct = (f) => `${(f * 100).toFixed(2)}%`;

export function WeekStrip({ schedule, more = 0, onOpen }) {
  const state = schedule.open === null ? null : schedule.open ? 'Open now' : 'Closed now';
  // on the overview it opens the hours; on their own page it is only the picture
  const Tag = onOpen ? 'button' : 'div';
  const said = `${schedule.name}: ${schedule.week}${state ? `, ${state.toLowerCase()}` : ''}`;
  return (
    <Tag
      {...(onOpen ? { type: 'button', onClick: onOpen, 'aria-label': `${said}. Open it` } : { role: 'img', 'aria-label': said })}
      className={`chWeekStrip ${onOpen ? 'press' : ''}`}
    >
      <span className="chWeekHead" aria-hidden="true">
        <Icon name="clock" size={15} />
        <b>{schedule.name}</b>
        <span className="chWeekSub">
          {schedule.week}
          {schedule.timezone ? ` · ${schedule.timezone}` : ''}
          {schedule.closedAhead ? ` · ${schedule.closedAhead} closed ${schedule.closedAhead === 1 ? 'day' : 'days'} ahead` : ''}
          {more ? ` · and ${more} more ${more === 1 ? 'set' : 'sets'} of hours` : ''}
        </span>
        {state && <span className={`chNow ${schedule.open ? '' : 'closed'}`}>{state}</span>}
      </span>
      <span className="chDaysGrid" aria-hidden="true">
        {DAYS.map((d) => (
          <span key={d} className="chDayRow">
            <span className="chDayName">{DAY_NAMES[d]}</span>
            <span className="chDayBar">
              {schedule.spans[d].map(([a, b], i) => (
                <i key={i} style={{ left: pct(a), width: pct(b - a) }} />
              ))}
              {schedule.today === d && schedule.nowAt !== null && <em style={{ left: pct(schedule.nowAt) }} />}
            </span>
          </span>
        ))}
        <span className="chDayRow scale">
          <span />
          <span className="chScale">
            <i>0:00</i>
            <i>6:00</i>
            <i>12:00</i>
            <i>18:00</i>
            <i>24:00</i>
          </span>
        </span>
      </span>
    </Tag>
  );
}
