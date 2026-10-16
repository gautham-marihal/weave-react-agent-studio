import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A small "⋯" menu. Rendered in a portal and positioned from the button, so a card with overflow:hidden
// never clips it. Keyboard: Enter/Space/ArrowDown opens, arrows move, Escape closes and returns focus.
export default function Menu({ label = 'More actions', items, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    const width = menuRef.current?.offsetWidth || 220;
    const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
    const below = rect.bottom + 6;
    const height = menuRef.current?.offsetHeight || 0;
    const top = below + height > window.innerHeight - 12 ? Math.max(12, rect.top - 6 - height) : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };
    const onMove = () => close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close]);

  useEffect(() => {
    if (pos) menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  }, [pos]);

  const onMenuKey = (event) => {
    const enabled = [...menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = enabled.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      enabled[(index + 1) % enabled.length]?.focus();
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      enabled[(index - 1 + enabled.length) % enabled.length]?.focus();
    }
    if (event.key === 'Home') {
      event.preventDefault();
      enabled[0]?.focus();
    }
    if (event.key === 'End') {
      event.preventDefault();
      enabled[enabled.length - 1]?.focus();
    }
    if (event.key === 'Tab') close();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`stMenuBtn ${className}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className="stMenu"
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
            onKeyDown={onMenuKey}
          >
            {items.map((item, index) =>
              item.divider ? (
                <hr key={`d${index}`} />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={item.danger ? 'danger' : ''}
                  disabled={item.disabled}
                  title={item.disabled ? item.hint : undefined}
                  onClick={() => {
                    close();
                    item.onClick?.();
                  }}
                >
                  <span>{item.label}</span>
                  {item.hint && !item.disabled && <small>{item.hint}</small>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
