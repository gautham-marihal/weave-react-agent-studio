import React from 'react';
import Icon from '../../ui/Icon.jsx';

// The shape every page of an agent has: a title with a line about it, the one main action on the right, parts to switch between (when the page has
// several), then the page. `wide` lets a page use the whole width (a canvas, a table); the rest read in a column. `partsSide` goes on the row of the parts,
// on the right (the Workflow's toolbar, so its picture gets the height).
export default function PageShell({ title, lead, actions, parts, part, onPart, wide = false, children, className = '', partsSide = null }) {
  const tabs =
    parts && parts.length > 1 ? (
      <div className="nlParts" role="tablist" aria-label={`${title} sections`}>
        {parts.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={part === p.id} className={part === p.id ? 'on' : ''} onClick={() => onPart(p.id)}>
            {p.label}
            {p.badge ? <b>{p.badge}</b> : null}
          </button>
        ))}
      </div>
    ) : null;
  return (
    <section className={`nlPage ${wide ? 'wide' : ''} ${className}`} aria-label={title}>
      <header className="nlPageHead">
        <div>
          <h1>{title}</h1>
          {lead && <p>{lead}</p>}
        </div>
        {actions && <div className="nlPageActions">{actions}</div>}
      </header>
      {tabs && partsSide ? (
        <div className="nlPartsRow">
          {tabs}
          {partsSide}
        </div>
      ) : (
        tabs
      )}
      {children}
    </section>
  );
}

// One setting as a row: what it is, what it is now, and a chevron that opens its panel. A row that needs attention says so without being opened.
//   tip: more for the tooltip (the id the configuration uses, for whoever needs it); the tooltip starts with the value, which a narrow row cuts short
export function SettingRow({ icon, title, value, hint, status, onOpen, tip, children }) {
  return (
    <button
      type="button"
      className={`nlRow ${status ? status.tone || '' : ''}`}
      onClick={onOpen}
      aria-label={`${title}: ${value || 'not set'}`}
      title={[value, tip].filter(Boolean).join('\n') || undefined}
    >
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
