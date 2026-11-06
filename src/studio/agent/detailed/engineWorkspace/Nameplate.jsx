import React from 'react';
import Icon from '../../../../ui/Icon.jsx';
import { STATUSES, dayOf, usedWords } from './engineWords.js';

// The picture at the top of Engine and details (canvas board E1): a nameplate, each detail with who sets it (fixed once
// created, set by Release, set by the server, or here), then its fixed values with where each is used. Each part opens
// where it is changed; what is set elsewhere is marked with a lock.

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

export default function Nameplate({ name, initials, d, onToken }) {
  const cells = [
    { k: 'id', label: 'Id', value: d.id || 'Not set', sub: 'fixed once created', locked: true, mono: true },
    { k: 'version', label: 'Version', value: d.version || 'Not published', sub: 'set by Release › Publish', locked: true },
    { k: 'version', label: 'Status', value: cap((STATUSES[d.status] || d.status).replace(/^a /, '')), sub: 'set by the server', locked: true, key: 'status' },
    { k: 'env', label: 'Meant for', value: cap(d.env) || 'Not set', sub: 'development, staging or production', empty: !d.env },
    { k: 'engine', label: 'Engine', value: d.engineWords || 'Not chosen', sub: 'the only one for now', empty: !d.engine },
    {
      k: 'mode',
      label: 'Models from',
      value: cap(d.modeWords) || 'Not chosen',
      sub: d.mode === 'inference' ? 'LiveKit Cloud only' : 'works self-hosted too',
      empty: !d.mode,
    },
    {
      k: 'tz',
      label: 'Time zone',
      value: d.tz || 'Not set',
      sub: d.tz ? (d.tzNow ? `${d.tzNow} there now` : 'not a time zone this browser knows') : 'for spoken times and dates',
      empty: !d.tz,
      bad: !!d.tz && !d.tzNow,
    },
    { k: 'vault', label: 'Secrets', value: d.vault || 'The usual vault', sub: 'where {secret} names are found', empty: !d.vault },
  ];
  const dates =
    d.created || d.changed
      ? [d.created && `Created ${dayOf(d.created)}`, d.changed && `last changed ${dayOf(d.changed)}`].filter(Boolean).join(' · ')
      : 'Created and changed: the server adds these when a version is saved';
  return (
    <figure className="enFigure" aria-label="Its details">
      <div className="enPlate">
        <div className="enPlateHead">
          <span className="apAvatar enAvatar" aria-hidden="true">
            {initials}
          </span>
          <span className="enPlateName">
            <b>{name}</b>
            <small>{dates}</small>
          </span>
          <span className="enScrews" aria-hidden="true">
            <i />
            <i />
          </span>
        </div>
        <div className="enCells">
          {cells.map((c) => (
            <button
              key={c.key || c.k}
              type="button"
              className={['enCell', c.locked && 'locked', c.empty && 'empty', c.bad && 'bad'].filter(Boolean).join(' ')}
              onClick={() => onToken(c.k)}
            >
              <span className="enCellLabel">
                {c.label}
                {c.locked && <Icon name="lock" size={11} />}
              </span>
              <b className={c.mono ? 'enMono' : ''}>{c.value}</b>
              <small>{c.sub}</small>
            </button>
          ))}
        </div>
        <div className="enFacts">
          <span>
            <Icon name="endCall" size={14} />
            {d.drain ? 'Hangs up once its closing words finish' : 'Hangs up at once, even mid-sentence'}
          </span>
          <span>
            <Icon name="endCall" size={14} />
            {d.closeRoom ? 'Ends the room, so the phone line or chat closes' : 'Leaves the room open when it ends'}
          </span>
        </div>
      </div>
      <button type="button" className="enValues" onClick={() => onToken('consts')}>
        {d.consts.length ? (
          d.consts.slice(0, 5).map((c) => (
            <span key={c.name} className="enValue">
              <code className="enMono">{`{{const.${c.name}}}`}</code>
              <span className="enValueText">{c.shown || '(empty)'}</span>
              <small className={c.uses ? '' : 'none'}>{usedWords(c.uses)}</small>
            </span>
          ))
        ) : (
          <span className="apHint">No fixed values yet. A value used in many places, such as a payment link, is set once here.</span>
        )}
        {d.consts.length > 5 && <span className="apHint">and {d.consts.length - 5} more</span>}
      </button>
    </figure>
  );
}
