import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { XIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { Button } from '../../../ui/Button';
import { cn, easeOut } from '../../../../utils/styles';
import { holdStagedPanel } from './stagedPanel';

interface SidePanelProps {
  title: string;
  description?: string;
  /** The draft as it is now; the panel edits a copy of it. */
  config: AgentConfig;
  canEdit: boolean;
  /** Puts the copy into the draft (one undoable edit). */
  onApply: (next: AgentConfig) => void;
  onClose: () => void;
  wide?: boolean;
  /** The panel's body: the copy, and how to change it. */
  children: (copy: AgentConfig, set: (next: AgentConfig) => void) => React.ReactNode;
}

/**
 * A panel on one topic that slides in from the right and edits a copy of the draft: only Done puts the changes in
 * (Cancel, Escape and a click outside leave the draft as it was). Focus moves into it, Tab stays inside, and closing
 * gives focus back to whatever opened it. While changes wait, anything about to replace it asks first (stagedPanel).
 */
export function SidePanel({ title, description, config, canEdit, onApply, onClose, wide, children }: SidePanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [copy, setCopy] = useState<AgentConfig>(config);
  const latest = useRef(copy);
  latest.current = copy;
  const changed = JSON.stringify(copy) !== JSON.stringify(config);

  const done = useCallback(() => {
    if (canEdit && JSON.stringify(latest.current) !== JSON.stringify(config)) onApply(latest.current);
    onClose();
  }, [canEdit, config, onApply, onClose]);

  useEffect(() => {
    if (!changed) return undefined;
    return holdStagedPanel({
      title,
      done,
      refocus: () => panelRef.current?.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true }),
    });
  }, [changed, title, done]);

  // focus in on opening, back to the opener on closing
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true }), 30);
    return () => {
      window.clearTimeout(t);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // an open list inside the panel takes its own Escape first
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-picker-open="true"]')) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const keepFocusInside = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50">
      <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, ease: 'easeOut' }} onClick={onClose} aria-hidden />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={keepFocusInside}
        initial={{ x: 32, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: easeOut }}
        className={cn('absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-overlay', wide ? 'max-w-2xl' : 'max-w-lg')}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
          </div>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="-mr-2 rounded-md p-1.5 text-muted transition-colors duration-150 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children(copy, (next) => canEdit && setCopy(next))}</div>
        <div className="flex items-center justify-between gap-3 border-t border-line bg-canvas/60 px-6 py-3">
          <p className="text-xs text-muted" aria-live="polite">
            {!canEdit ? 'You can look, but not change this agent.' : changed ? 'Changes go into the draft when you press Done.' : ''}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={done}>
              {changed ? 'Done' : 'Close'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
