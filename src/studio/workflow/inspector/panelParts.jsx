import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { isObj } from '../../form/engine.js';
import { getAt } from '../../form/inlineCreate.js';
import { formatPath } from '../../format.js';
import { speechText } from '../../../demo/simulatedAgent.js';
import { PartPanel, PartRow, Parts } from '../../../ui/Parts.tsx';
import Tip from '../../../ui/Tip.tsx';
import Button from '../../../ui/Button.tsx';
import { Input, TextArea } from '../../../ui/Input.tsx';

// The side panel's shared pieces: its frame (Shell), labelled fields and text boxes, the "In the configuration" box,
// and the Delete and Hide buttons every view uses.

export const list = (v) => (Array.isArray(v) ? v : []);

export function Field({ label, hint, children, id }) {
  return (
    <div className="wfField">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export const Text = ({ id, value, onChange, placeholder, multiline, rows = 4, mono }) =>
  multiline ? (
    <TextArea id={id} mono={mono} rows={rows} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  ) : (
    <Input id={id} mono={mono} type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  );

// Where the selection lives in the configuration: its path, its current JSON, and links to its settings or the JSON.
// Changes here are written there at once, and changes there show here.
export const WhereCtx = createContext(null);

export function Where() {
  const ctx = useContext(WhereCtx);
  if (!ctx || !ctx.places.length) return null;
  const main = ctx.places[0];
  return (
    <section className="wfSection wfWhere">
      <h4>In the configuration</h4>
      <p className="wfMuted">
        What you change here is written to <code>{formatPath(main.path)}</code> at once, and what you change there shows here.
      </p>
      <div className="wfRow">
        <Button type="button" onClick={() => ctx.onOpenSettings(main.path)}>
          Open its settings
        </Button>
        <Button type="button" onClick={() => ctx.onOpenJson(main.path)}>
          Open in JSON
        </Button>
      </div>
      {ctx.places.map((place) => (
        <details key={formatPath(place.path)} className="wfCode">
          <summary>
            {place.label} <code>{formatPath(place.path)}</code>
          </summary>
          <pre>{JSON.stringify(getAt(ctx.config, place.path), null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}

// A line it says, which may be one of the agent's fixed lines: typing here makes it its own words (the fixed line stays
// as it is wherever else it is said).
//   required: the warning shown while the box is empty, since the settings need at least one letter there
export function LineField({ id, label, value, config, onChange, hint, placeholder, rows = 3, required = '' }) {
  const fixed = isObj(value);
  const words = typeof value === 'string' ? value : fixed ? speechText(value, config) : '';
  return (
    <Field label={label} id={id} hint={fixed ? 'One of its fixed lines. Typing here makes it its own words; the fixed line stays as it is.' : hint}>
      <Text id={id} multiline rows={rows} value={words} placeholder={placeholder} onChange={onChange} />
      {required && !words.trim() && <p className="wfWarnText">{required}</p>}
    </Field>
  );
}

// The panel's frame: icon, kind and name, Hide (the picture gets the whole width) and Close; parts as tabs when there
// are several (the configuration's place is then shown on the first part, which says so itself).
export function Shell({ icon, title, kicker, children, onClose, tabs = null }) {
  const head = (
    <header>
      <span className="wfIcon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span>
        <small>{kicker}</small>
        <strong>{title}</strong>
      </span>
      <HideButton />
      <Tip label="Close">
        <button type="button" className="smClose" aria-label="Close this panel" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </Tip>
    </header>
  );
  if (tabs)
    return (
      <aside className="wfInspector" aria-label={`${kicker}: ${title}`}>
        <Parts value={tabs.value} onChange={tabs.onChange}>
          {head}
          <PartRow className="wfTabs" label={`${title}: parts`} items={tabs.items} value={tabs.value} />
          <div className="wfInspectorBody">
            <PartPanel value={tabs.value}>{children}</PartPanel>
          </div>
        </Parts>
      </aside>
    );
  return (
    <aside className="wfInspector" aria-label={`${kicker}: ${title}`}>
      {head}
      <div className="wfInspectorBody">
        {children}
        <Where />
      </div>
    </aside>
  );
}

// A delete that asks once, in the panel, and says what it takes with it.
export function DeleteButton({ label, why, onConfirm, disabled }) {
  const [asking, setAsking] = useState(false);
  const button = useRef(null);
  const question = useRef(null);
  const was = useRef(false);
  useEffect(() => {
    if (asking) question.current?.querySelector('button')?.focus({ preventScroll: true });
    else if (was.current) button.current?.focus({ preventScroll: true });
    was.current = asking;
  }, [asking]);
  if (asking) {
    return (
      <div className="wfConfirm" role="group" aria-label={label} ref={question}>
        <p>{why}</p>
        <div className="wfRow">
          <button
            type="button"
            className="dangerButton"
            onClick={() => {
              setAsking(false);
              onConfirm();
            }}
          >
            {label}
          </button>
          <Button type="button" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <Button ref={button} type="button" className="wfDanger" disabled={disabled} onClick={() => setAsking(true)}>
        <Icon name="trash" size={15} /> {label}
      </Button>
      {disabled && why && <p className="wfMuted">{why}</p>}
    </>
  );
}

// the Hide button (the picture gets the whole width), in every panel's frame and on the overview
export function HideButton() {
  const ctx = useContext(WhereCtx);
  if (!ctx?.onHide) return null;
  return (
    <Tip label="Hide the panel">
      <button type="button" className="smClose" aria-label="Hide the panel" onClick={ctx.onHide}>
        <Icon name="panelRight" size={16} />
      </button>
    </Tip>
  );
}
