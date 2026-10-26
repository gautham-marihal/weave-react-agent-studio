import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { PartPanel, PartRow, Parts } from '../../ui/Parts.tsx';

// The shape every page of an agent has: a title with a line about it, the one main action on the right, parts to switch between (when the page has
// several: tabs, ui/Parts.tsx), then the page. `wide` lets a page use the whole width (a canvas, a table); the rest
// read in a column. `partsInHead` puts the parts on the title's row, on the right, so what is under them starts higher
// (the Workflow's canvas, which is as tall as the window leaves it).
export default function PageShell({ title, lead, actions, parts, part, onPart, wide = false, children, partsInHead = false }) {
  const tabs = parts && parts.length > 1 ? <PartRow className="nlParts" label={`${title} sections`} items={parts} value={part} /> : null;
  const inHead = partsInHead && tabs;
  const head = (
    <header className="nlPageHead">
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {(actions || inHead) && (
        <div className="nlPageActions">
          {inHead}
          {actions}
        </div>
      )}
    </header>
  );
  return (
    <section className={`nlPage ${wide ? 'wide' : ''}`} aria-label={title}>
      {tabs ? (
        <>
          {!inHead && head}
          <Parts value={part} onChange={onPart}>
            {inHead && head}
            {!inHead && tabs}
            <PartPanel value={part}>{children}</PartPanel>
          </Parts>
        </>
      ) : (
        <>
          {head}
          {children}
        </>
      )}
    </section>
  );
}

// One setting as a row: what it is, what it is now, and a chevron that opens its panel. A row that needs attention says so without being opened. Its
// name is what it shows (the setting, what it is now, its note), as it is seen.
//   tip: more for the tooltip (the id the configuration uses, for whoever needs it); the tooltip starts with the value, which a narrow row cuts short
export function SettingRow({ icon, title, value, hint, status, onOpen, tip, children }) {
  return (
    <button type="button" className={`nlRow ${status ? status.tone || '' : ''}`} onClick={onOpen} title={[value, tip].filter(Boolean).join('\n') || undefined}>
      {icon && (
        <span className="nlRowIcon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="nlRowText">
        <strong>{title}</strong>
        <small>{value || hint || 'Not set yet'}</small>
      </span>
      {children}
      {status && <span className={`nlPill ${status.tone || ''}`}>{status.text}</span>}
      <Icon name="chevronRight" size={16} />
    </button>
  );
}

// A titled block of a page: a bold title, one grey line, then the control.
export function Section({ title, lead, action, children }) {
  return (
    <section className="nlSection">
      <header>
        <div>
          <h2>{title}</h2>
          {lead && <p>{lead}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

// "No tools yet": an icon, one bold line, one sentence, one button.
export function EmptyState({ icon = 'records', title, text, action }) {
  return (
    <div className="nlEmpty">
      <span aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
