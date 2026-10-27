import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { PartPanel, PartRow, Parts } from '../../ui/Parts.tsx';

// Every agent page's frame: title and lead, the main action on the right, part tabs (ui/Parts.tsx), then the page.
//   wide: use the whole width (a canvas, a table); other pages read in a column
//   partsInHead: put the part tabs on the title row so the content starts higher (the Workflow canvas)
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

// One setting as a row: what it is, its value, and a chevron that opens its panel; a problem shows without opening.
// Its accessible name is its visible text.
//   tip: extra tooltip text (the configuration id); the tooltip starts with the value, which a narrow row cuts short
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
