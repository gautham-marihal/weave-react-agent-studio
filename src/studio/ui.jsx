import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { sentenceCase } from '../ui/text.js';
import Icon from '../ui/Icon.jsx';
import { trapTab, useDialogFocus } from '../ui/useDialogFocus.js';

// The agents area's small shared parts: Notice (a note in a colour), Modal (a dialog), Spinner, ErrorState (what went
// wrong, with Try again), and where an agent runs (envLabel, EnvSlots).

const NOTICE_ICON = { error: 'alert', warn: 'alert', good: 'check', info: 'info' };

export function Notice({ kind = 'info', title, children, actions }) {
  return (
    <div className={`stNotice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="stNoticeIcon" aria-hidden="true">
        <Icon name={NOTICE_ICON[kind] || 'info'} size={16} />
      </span>
      <div className="stNoticeBody">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {actions && <div className="stNoticeActions">{actions}</div>}
    </div>
  );
}

export function Modal({ eyebrow, title, subtitle, onClose, children, footer, wide = false, busy = false }) {
  const box = useRef(null);
  // the keyboard goes into the dialog when it opens (unless a field in it took it), and back where it was when it closes
  useDialogFocus(box);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Escape while the keyboard is outside the dialog (one pressed in it is taken below); an open list closes first (it marks its Escape as handled)
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy && !event.defaultPrevented) {
        event.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, busy]);
  // the keys pressed in the dialog stay in it: Escape closes it, and not the side panel or sheet it was opened from
  // too; Tab goes round its own buttons
  const keys = (event) => {
    if (event.key === 'Escape') {
      if (!busy && !event.defaultPrevented) {
        event.preventDefault();
        onClose?.();
      }
      event.stopPropagation();
    } else if (event.key === 'Tab') {
      trapTab(event, box.current);
      event.stopPropagation();
    }
  };
  return createPortal(
    <div
      className="createOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
      onKeyDown={keys}
    >
      <section ref={box} tabIndex={-1} className={`createModal stModal ${wide ? 'wide' : ''}`}>
        <div className="createModalHeader">
          <div>
            {eyebrow && <span className="createEyebrow">{sentenceCase(eyebrow)}</span>}
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="modalClose" aria-label="Close" disabled={busy} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {/* the title and the buttons stay put; what is between them scrolls when it is taller than the window */}
        <div className="stModalBody">{children}</div>
        {footer && <div className="createModalFooter">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}

const ENV_LABELS = { development: 'Development', staging: 'Staging', production: 'Production' };
export const envLabel = (env) => ENV_LABELS[env] || env;

const SHORT_ENV = { development: 'Dev', staging: 'Staging', production: 'Prod' };

// What runs where, one slot per environment, so nothing is hidden in a tooltip. `onPick(env)` makes slots clickable.
// `compact` (a list of agents) shows only the environments something runs in, or "Not deployed" when there are none.
export function EnvSlots({ deployed = {}, compact = false, onPick }) {
  const all = ['development', 'staging', 'production'];
  const running = all.filter((env) => deployed?.[env]);
  if (compact && !running.length) {
    return (
      <span className="stEnvSlots compact" aria-label="Deployments">
        <span className="stEnvNone">Not deployed</span>
      </span>
    );
  }
  const envs = compact ? running : all;
  return (
    <span className={`stEnvSlots ${compact ? 'compact' : ''}`} role="list" aria-label="Deployments">
      {envs.map((env) => {
        const version = deployed?.[env];
        const text = version ? `v${version}` : 'Not deployed';
        const content = (
          <>
            <b>{compact ? SHORT_ENV[env] : envLabel(env)}</b>
            <span>{text}</span>
          </>
        );
        const title = version ? `${envLabel(env)}: version ${version}` : `${envLabel(env)}: not deployed`;
        return onPick ? (
          <button
            key={env}
            type="button"
            role="listitem"
            className={`stEnvSlot ${env} ${version ? 'on' : ''}`}
            title={`${title}. Open Deploy.`}
            onClick={() => onPick(env)}
          >
            {content}
          </button>
        ) : (
          <span key={env} role="listitem" className={`stEnvSlot ${env} ${version ? 'on' : ''}`} title={title}>
            {content}
          </span>
        );
      })}
    </span>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="stSpinner" role="status" aria-label={label}>
      <i />
      <span>{label}…</span>
    </div>
  );
}

// Why something couldn't be loaded, in words for the person using the studio; what the person who runs the server needs (the server's own
// message, the setting to check) is one click further down.
export function ErrorState({ error, onRetry, what = 'this' }) {
  const kind = error?.kind;
  // a server that does not answer is said once, by the strip across the top of every page; here, what that leaves missing
  const title =
    kind === 'network'
      ? `Couldn’t load ${what}`
      : kind === 'auth'
        ? 'The server didn’t accept the studio’s access key'
        : kind === 'not_found'
          ? `Couldn’t find ${what}`
          : `Couldn’t load ${what}`;
  const lead =
    kind === 'network'
      ? 'The server isn’t answering: it may be down or restarting. Try again in a moment.'
      : kind === 'auth'
        ? 'Ask the person who runs Weave to check the studio’s settings.'
        : kind === 'not_found'
          ? 'It may have been deleted.'
          : kind === 'client_bug'
            ? 'This looks like a problem in the studio, not something you did.'
            : kind === 'unexpected'
              ? 'The server sent an answer this version of the studio can’t read. It isn’t something you did.'
              : 'Try again in a moment.';
  const forOperator = [error?.message, kind === 'auth' ? 'Check AGENT_BUILDER_API_KEY in the studio’s environment, then restart it.' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <Notice
      kind="error"
      title={title}
      actions={
        onRetry && (
          <button type="button" className="quietButton" onClick={onRetry}>
            Try again
          </button>
        )
      }
    >
      {lead}
      {forOperator && (
        <details className="stErrDetail">
          <summary>Details for the person who runs the server</summary>
          <p>{forOperator}</p>
        </details>
      )}
    </Notice>
  );
}
