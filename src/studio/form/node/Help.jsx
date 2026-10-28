import React, { useState } from 'react';
import { useOwner } from '../ctx.js';
import { describeSetting } from '../plainLanguage.js';
import { readXui } from '../xui.ts';

// A setting's plain-words help: the words it is drawn with, the help line and the "i" that opens its technical detail.

// The last word of a text and the rest, so the "i" can stay on the line of the last word.
const lastWord = (text) => {
  const t = String(text).trimEnd();
  const i = t.lastIndexOf(' ');
  return i < 0 ? ['', t] : [t.slice(0, i + 1), t.slice(i + 1)];
};

// The "i" that shows a setting's technical detail. Drawn with CSS, not an SVG: there is one beside nearly every
// setting, and hundreds of SVGs slow typing on a long screen.
export function InfoButton({ shown, onToggle, moreLabel = 'Technical detail' }) {
  return (
    <button
      type="button"
      className={`stFInfo ${shown ? 'on' : ''}`}
      aria-expanded={shown}
      aria-label={shown ? `Hide the ${moreLabel.toLowerCase()}` : moreLabel}
      title={shown ? 'Hide' : moreLabel}
      onClick={onToggle}
    >
      <span className="stFInfoMark" aria-hidden="true">
        i
      </span>
    </button>
  );
}
// the technical description of a setting, when it says more than the plain words
export const moreOf = (words) => (words.full && words.full.trim() && words.full.trim() !== words.lead ? words.full.trim() : '');

// What a setting is for, in plain words with an example; the schema's technical description is one click away (open
// with technical names on).
//   shown: when given, the row draws the "i" beside the name and says here whether the detail is open; else the "i"
//   ends the help line
export function Help({ lead, example, full, moreLabel = 'Technical detail', open: startOpen = false, shown: shownFromRow }) {
  const [open, setOpen] = useState(false);
  const more = moreOf({ full, lead });
  const inline = shownFromRow === undefined;
  const shown = inline ? open || (startOpen && !!more) : shownFromRow;
  if (!lead && !example && !(more && (inline || shown))) return null;
  const info = more && inline ? <InfoButton shown={shown} onToggle={() => setOpen((v) => !v)} moreLabel={moreLabel} /> : null;
  // the "i" goes with the last word, in a piece that does not wrap, so it never sits alone on a line
  const [leadHead, leadLast] = lead ? lastWord(lead) : ['', ''];
  const [exHead, exLast] = example ? lastWord(example) : ['', ''];
  return (
    <p className="stFHelp">
      {lead &&
        (info && !example ? (
          <span>
            {leadHead}
            <span className="stFTail">
              {leadLast} {info}
            </span>
          </span>
        ) : (
          <span>{lead} </span>
        ))}
      {example && (
        <span className="stFExample">
          {info && exHead ? (
            <>
              For example: <em>{exHead}</em>
              <span className="stFTail">
                <em>{exLast}</em> {info}
              </span>
            </>
          ) : info ? (
            <span className="stFTail">
              For example: <em>{exLast}</em> {info}
            </span>
          ) : (
            <>
              For example: <em>{example}</em>
            </>
          )}{' '}
        </span>
      )}
      {!lead && !example && info}
      {more && shown && <span className="stFMore">{more}</span>}
    </p>
  );
}

// The words a setting is drawn with: the server's own hint when
// it sends one, else the catalogue, else a label made by rule.
export function useSettingWords(name, shape, label) {
  const owner = useOwner();
  const hints = readXui(shape);
  const info = describeSetting(name, { owner, description: shape.description });
  return {
    title: label || hints.label || info.label,
    lead: hints.help || info.purpose,
    example: hints.example || info.example,
    level: hints.audience || info.level,
    full: shape.description,
    moreLabel: info.curated || hints.help ? 'Technical detail' : 'More',
  };
}
