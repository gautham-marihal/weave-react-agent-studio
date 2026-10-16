import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// The Builder's own form pieces (help bubble, field, switch, card), shared by the Studio's screens. They are styled
// by the `builder*` rules in styles.css.

// Shared help tooltip. A click opens it and never closes it: a mouse has already opened it by hovering, so a toggle would shut it on the click that was meant to read it; it closes on Escape, on scroll, on leaving or on moving focus away. The bubble renders in a portal with fixed positioning, so scrolling
// panels and card edges can never clip it; it is clamped inside the viewport on both sides,
// flips below the icon when there is no room above, and its arrow keeps pointing at the icon.
export function HelpTooltip({ text: value, className = 'builderHelp', label = '?' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const bubbleRef = useRef(null);
  const tooltipId = useId();

  const place = () => {
    const button = buttonRef.current;
    const bubble = bubbleRef.current;
    if (!button || !bubble) return;
    const margin = 12;
    const gap = 8;
    const rect = button.getBoundingClientRect();
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(margin, center - width / 2), window.innerWidth - width - margin);
    const above = rect.top - gap - height >= margin;
    const top = above ? rect.top - gap - height : Math.min(rect.bottom + gap, window.innerHeight - height - margin);
    setPos({ left, top, placement: above ? 'top' : 'bottom', arrow: Math.min(Math.max(center - left, 12), width - 12) });
  };

  // Position before the browser paints, so the bubble never appears in its parked spot.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    place();
    const close = () => setOpen(false);
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="builderHelpWrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-label={`Help: ${value}`}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}
      >{label}</button>
      {open && createPortal(
        <span
          ref={bubbleRef}
          id={tooltipId}
          role="tooltip"
          className={`helpTooltip ${pos ? `is-${pos.placement}` : ''}`}
          style={pos ? { left: pos.left, top: pos.top, '--arrow-x': `${pos.arrow}px` } : { left: -9999, top: 0 }}
        >{value}</span>,
        document.body
      )}
    </span>
  );
}

function Help({ text: value }) {
  return <HelpTooltip text={value} />;
}

export function Field({ label, help, example, value, onChange, multiline = false, type = 'text', children, hint, invalid = false, rows = 4, min, requirement }) {
  const inputId = useId();
  const need = requirement || 'required';
  return (
    <div className={`builderField ${invalid ? 'invalid' : ''}`}>
      <span className="builderFieldLabel"><label htmlFor={inputId}>{label}</label>{need !== 'required' && <span className={`fieldNeed ${need}`} title={need === 'optional' ? 'You can leave this empty.' : 'Not required, but the agent works better with it.'}>{need === 'optional' ? 'Optional' : 'Recommended'}</span>}{help && <Help text={help} />}</span>
      {children || (multiline ? (
        <textarea id={inputId} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={example} rows={rows} aria-invalid={invalid || undefined} />
      ) : (
        <input id={inputId} type={type} min={min} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={example} aria-invalid={invalid || undefined} />
      ))}
      {hint && <small className="builderFieldHint">{hint}</small>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, help, compact = false }) {
  const flip = () => onChange(!checked);
  return (
    <div
      role="switch"
      tabIndex={0}
      aria-checked={checked}
      aria-label={label}
      className={`builderToggle ${checked ? 'on' : 'off'} ${compact ? 'compact' : ''}`}
      onClick={flip}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); flip(); }
      }}
    >
      <span className="builderToggleCopy"><strong>{label}</strong>{help && <Help text={help} />}</span>
      {!compact && <span className="builderToggleState">{checked ? 'Enabled' : 'Disabled'}</span>}
      <span className="builderSwitch" aria-hidden="true"><i /></span>
    </div>
  );
}

export function Card({ title, subtitle, children, action, help }) {
  return (
    <section className="builderCard">
      <div className="builderCardHead">
        <div><h3>{title} {help && <Help text={help} />}</h3>{subtitle && <p>{subtitle}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}
