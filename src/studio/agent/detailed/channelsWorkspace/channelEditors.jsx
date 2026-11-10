import React, { useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { navigate, routeHref, useRoute } from '../../../route.js';
import { infoOf } from '../../../form/channelTypes.js';
import { DAY_NAMES, IN_ICONS, OUT_ICONS, allowedFor, asTime } from './channelsWords.js';
import './channelsWorkspace.css';

// Channels' own editors, used as rows of the part (channelsPart.jsx), so they are the same in the workspace and in All
// settings: what a way in carries (the kinds its channel may carry, never none), a set of hours' week (days and times),
// and its closed days.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- what a way in carries: what the person can use, and how it answers. Photos and the camera are asked on Images &
// Videos (one place each, with their picture details): here they are said, and kept as they are when the rest changes.
const IN = [
  ['audio', 'talk'],
  ['text', 'type'],
];
const PICTURE_WORDS = { image: 'photos', video: 'the camera' };
const OUT = [
  ['audio', 'speaking'],
  ['text', 'writing'],
];
export function CarriesEditor({ id, value, onChange, types, type }) {
  const given = isObj(value) ? value : {};
  const usual = infoOf(types, type)?.defaultModalities || {};
  const now = { input: list(given.input).length ? given.input : list(usual.input), output: list(given.output).length ? given.output : list(usual.output) };
  const allowed = allowedFor(types, type);
  const group = (dir, choices, icons, label) => {
    const have = list(now[dir]);
    const ok = allowed[dir];
    const shown = choices.filter(([m]) => !ok || ok.includes(m) || have.includes(m));
    return (
      <div className="chCarry" role="group" aria-label={label}>
        <span className="chCarryLabel">{label}</span>
        <div className="cvPills">
          {shown.map(([m, words]) => {
            const on = have.includes(m);
            // the last of these it carries can't go (photos alone are not a way to talk)
            const last = on && have.filter((x) => choices.some(([c]) => c === x)).length === 1;
            const refused = ok && !ok.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                className={on ? 'on' : ''}
                disabled={last || (refused && !on)}
                title={last ? 'It needs at least one' : refused ? 'This kind of channel can’t carry it' : undefined}
                onClick={() => onChange({ ...given, input: list(now.input), output: list(now.output), [dir]: on ? have.filter((x) => x !== m) : [...have, m] })}
              >
                <Icon name={icons[m]} size={13} />
                {words}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  const pictures = list(now.input).filter((m) => PICTURE_WORDS[m]);
  return (
    <div className="chCarries" id={id}>
      {group('input', IN, IN_ICONS, 'The person can')}
      {group('output', OUT, OUT_ICONS, 'It answers by')}
      {web(type) && <PicturesLink words={pictures.map((m) => PICTURE_WORDS[m])} />}
    </div>
  );
}
const web = (type) => type === 'web_chat' || type === 'web_voice';
// photos and the camera, said here and set on Images & Videos
function PicturesLink({ words }) {
  const route = useRoute();
  return (
    <p className="chPictures">
      <Icon name="image" size={14} />
      <span>
        {words.length ? `It also takes ${words.join(' and ')}.` : 'Photos and the camera:'} Set on{' '}
        <button type="button" className="stLink" onClick={() => navigate(routeHref(route.botId, 'media'), { guard: false })}>
          Images &amp; Videos
        </button>
        .
      </span>
    </p>
  );
}

// ---- a set of hours' week: each rule is some days, from a time to a time
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
function TimeBox({ label, value, onChange, end = false }) {
  const [typed, setTyped] = useState(null);
  const shown = typed ?? value ?? '';
  const ok = (end ? END : TIME).test(asTime(shown));
  return (
    <span className="chTime">
      <Input
        size="small"
        mono
        aria-label={label}
        value={shown}
        placeholder={end ? '17:00' : '09:00'}
        aria-invalid={!ok || undefined}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={() => {
          if (typed === null) return;
          const next = asTime(typed);
          setTyped(null);
          if ((end ? END : TIME).test(next)) onChange(next);
        }}
      />
    </span>
  );
}
export function WeekEditor({ id, value, onChange }) {
  const rules = list(value).filter(isObj);
  const put = (i, patch) => onChange(rules.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="chWeek" id={id}>
      {rules.map((r, i) => (
        <div className="chRule" key={i} role="group" aria-label={`Hours ${i + 1}`}>
          <div className="chDays" role="group" aria-label="Days">
            {DAYS.map((d) => {
              const on = list(r.days).includes(d);
              const last = on && list(r.days).length === 1;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'on' : ''}
                  disabled={last}
                  title={last ? 'At least one day' : undefined}
                  onClick={() => put(i, { days: on ? list(r.days).filter((x) => x !== d) : DAYS.filter((x) => x === d || list(r.days).includes(x)) })}
                >
                  {DAY_NAMES[d]}
                </button>
              );
            })}
          </div>
          <span className="chFromTo">
            <TimeBox label={`Opens, hours ${i + 1}`} value={r.start} onChange={(t) => put(i, { start: t })} />
            <span>to</span>
            <TimeBox label={`Closes, hours ${i + 1}`} value={r.end} end onChange={(t) => put(i, { end: t })} />
          </span>
          {rules.length > 1 && (
            <button type="button" className="rmClose" aria-label={`Remove hours ${i + 1}`} onClick={() => onChange(rules.filter((_, n) => n !== i))}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      ))}
      <div className="chWeekFoot">
        <Button type="button" variant="secondary" size="small" onClick={() => onChange([...rules, { days: ['sat'], start: '10:00', end: '14:00' }])}>
          <Icon name="plus" size={14} />
          Add more hours
        </Button>
        <small className="dtNote">A close of 24:00 runs to midnight; 00:00 to 24:00 every day is always open.</small>
      </div>
    </div>
  );
}

// ---- closed days: dates, closed all day
const dateWords = (d) => {
  const t = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
export function ClosedDays({ id, value, onChange }) {
  const days = list(value).filter((d) => typeof d === 'string');
  const [typed, setTyped] = useState('');
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typed) || days.includes(typed)) return;
    onChange([...days, typed].sort());
    setTyped('');
  };
  return (
    <div className="chClosed" id={id}>
      {days.length > 0 && (
        <ul className="chChips" aria-label="Closed days">
          {days.map((d) => (
            <li key={d}>
              {dateWords(d)}
              <button
                type="button"
                aria-label={`Open again on ${dateWords(d)}`}
                onClick={() => onChange(days.filter((x) => x !== d).length ? days.filter((x) => x !== d) : undefined)}
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="chAddDay">
        <Input size="small" type="date" aria-label="A day it is closed" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <Button type="button" variant="secondary" size="small" onClick={add} disabled={!typed}>
          Add the day
        </Button>
      </span>
    </div>
  );
}
