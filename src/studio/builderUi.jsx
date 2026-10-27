import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// The "?" help bubble that explains a setting, shared through pages/shared.jsx; styled by `builder*` in styles.css.

// A click only opens it: hovering already did, so a toggle would shut it on the click meant to read it. Escape, scroll,
// leave or blur close it. A fixed portal keeps panels from clipping it; it stays in the viewport and flips when needed.
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
    if (!open) {
      setPos(null);
      return undefined;
    }
    place();
    const close = () => setOpen(false);
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
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
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            id={tooltipId}
            role="tooltip"
            className={`helpTooltip ${pos ? `is-${pos.placement}` : ''}`}
            style={pos ? { left: pos.left, top: pos.top, '--arrow-x': `${pos.arrow}px` } : { left: -9999, top: 0 }}
          >
            {value}
          </span>,
          document.body,
        )}
    </span>
  );
}
