import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { sentenceCase } from '../ui/text.js';
import Icon from '../ui/Icon.jsx';

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
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, busy]);
  return createPortal(
    <div
      className="createOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <section className={`createModal stModal ${wide ? 'wide' : ''}`}>
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
        {children}
        {footer && <div className="createModalFooter">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}

const ENV_LABELS = { development: 'Development', staging: 'Staging', production: 'Production' };
export const envLabel = (env) => ENV_LABELS[env] || env;

export function EnvChip({ env, version }) {
  return (
    <span className={`envTag ${env} sm`} title={`${envLabel(env)}: version ${version}`}>
      <span className="envTagPrefix" aria-hidden="true">
        {env === 'production' ? 'PROD' : env === 'staging' ? 'STG' : 'DEV'}
      </span>
      v{version}
    </span>
  );
}

// One chip with the stage an agent is in: the furthest environment it runs in, otherwise Published or Draft.
export function StageChip({ stage }) {
  if (stage.kind === 'env') {
    const also = stage.also.length ? ` Also deployed to ${stage.also.map(envLabel).join(' and ')}.` : '';
    return (
      <span className={`envTag ${stage.env} sm`} title={`${envLabel(stage.env)}: version ${stage.version}.${also}`}>
        <span className="envTagPrefix" aria-hidden="true">
          {stage.env === 'production' ? 'PROD' : stage.env === 'staging' ? 'STG' : 'DEV'}
        </span>
        v{stage.version}
      </span>
    );
  }
  if (stage.kind === 'published')
    return (
      <span className="stTag solid" title="Published, not deployed anywhere yet">
        Published v{stage.version}
      </span>
    );
  return (
    <span className="stTag" title="Not published yet">
      Draft
    </span>
  );
}

const SHORT_ENV = { development: 'Dev', staging: 'Staging', production: 'Prod' };

// What runs where, one slot per environment, so nothing is hidden in a tooltip. `onPick(env)` makes slots clickable. `compact` (a list of agents) shows
// only the environments something runs in, or "Not deployed" when there are none.
export function EnvSlots({ deployed = {}, compact = false, onPick }) {
  const all = ['development', 'staging', 'production'];
  const running = all.filter((env) => deployed?.[env]);
  if (compact && !running.length) {
    const none = <span className="stEnvNone">Not deployed</span>;
    return (
      <span className="stEnvSlots compact" aria-label="Deployments">
        {onPick ? (
          <button type="button" className="stEnvSlot none" title="Not deployed anywhere. Open Deploy." onClick={() => onPick('development')}>
            {none}
          </button>
        ) : (
          none
        )}
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
  const title =
    kind === 'network'
      ? 'Can’t reach the server'
      : kind === 'auth'
        ? 'The server didn’t accept the studio’s access key'
        : kind === 'not_found'
          ? `Couldn’t find ${what}`
          : `Couldn’t load ${what}`;
  const lead =
    kind === 'network'
      ? 'It may be down or restarting. Try again in a moment.'
      : kind === 'auth'
        ? 'Ask the person who runs Weave to check the studio’s settings.'
        : kind === 'not_found'
          ? 'It may have been deleted.'
          : kind === 'client_bug'
            ? 'This looks like a problem in the studio, not something you did.'
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
