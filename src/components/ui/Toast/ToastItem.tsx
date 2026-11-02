import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
} from 'lucide-react';
import { ToastItemData, ToastVariant } from './types';

interface ToastItemProps {
  toast: ToastItemData;
  onDismiss: (id: string) => void;
}

interface VariantConfig {
  name: string;
  badgeLabel: string;
  icon: React.ReactNode;
  containerBorder: string;
  accentBar: string;
  iconBg: string;
  iconText: string;
  progressColor: string;
  badgeBg: string;
  badgeText: string;
  glowShadow: string;
}

const VARIANT_CONFIGS: Record<ToastVariant, VariantConfig> = {
  success: {
    name: 'Success',
    badgeLabel: 'SUCCESS',
    icon: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
    containerBorder: 'border-emerald-500/30 dark:border-emerald-500/40',
    accentBar: 'bg-emerald-500',
    iconBg: 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200/70 dark:border-emerald-800/80',
    iconText: 'text-emerald-700 dark:text-emerald-300',
    progressColor: 'bg-emerald-500 dark:bg-emerald-400',
    badgeBg: 'bg-emerald-100/80 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
    badgeText: 'text-emerald-800 dark:text-emerald-200',
    glowShadow: 'shadow-lg shadow-emerald-500/10 dark:shadow-emerald-950/40',
  },
  error: {
    name: 'Error',
    badgeLabel: 'ERROR',
    icon: <AlertCircle className="h-5 w-5" aria-hidden="true" />,
    containerBorder: 'border-rose-500/30 dark:border-rose-500/40',
    accentBar: 'bg-rose-500',
    iconBg: 'bg-rose-50 dark:bg-rose-950/80 border-rose-200/70 dark:border-rose-800/80',
    iconText: 'text-rose-700 dark:text-rose-300',
    progressColor: 'bg-rose-500 dark:bg-rose-400',
    badgeBg: 'bg-rose-100/80 dark:bg-rose-950/80 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800',
    badgeText: 'text-rose-800 dark:text-rose-200',
    glowShadow: 'shadow-lg shadow-rose-500/10 dark:shadow-rose-950/40',
  },
  warning: {
    name: 'Warning',
    badgeLabel: 'WARNING',
    icon: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
    containerBorder: 'border-amber-500/30 dark:border-amber-500/40',
    accentBar: 'bg-amber-500',
    iconBg: 'bg-amber-50 dark:bg-amber-950/80 border-amber-200/70 dark:border-amber-800/80',
    iconText: 'text-amber-700 dark:text-amber-300',
    progressColor: 'bg-amber-500 dark:bg-amber-400',
    badgeBg: 'bg-amber-100/80 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800',
    badgeText: 'text-amber-800 dark:text-amber-200',
    glowShadow: 'shadow-lg shadow-amber-500/10 dark:shadow-amber-950/40',
  },
  info: {
    name: 'Information',
    badgeLabel: 'INFO',
    icon: <Info className="h-5 w-5" aria-hidden="true" />,
    containerBorder: 'border-sky-500/30 dark:border-sky-500/40',
    accentBar: 'bg-sky-500',
    iconBg: 'bg-sky-50 dark:bg-sky-950/80 border-sky-200/70 dark:border-sky-800/80',
    iconText: 'text-sky-700 dark:text-sky-300',
    progressColor: 'bg-sky-500 dark:bg-sky-400',
    badgeBg: 'bg-sky-100/80 dark:bg-sky-950/80 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800',
    badgeText: 'text-sky-800 dark:text-sky-200',
    glowShadow: 'shadow-lg shadow-sky-500/10 dark:shadow-sky-950/40',
  },
};

// AnimatePresence (popLayout) measures each toast through a ref, so the item forwards it to its outer element.
export const ToastItem = React.forwardRef<HTMLDivElement, ToastItemProps>(function ToastItem({ toast, onDismiss }, ref) {
  const {
    id,
    variant = 'info',
    title,
    message,
    description,
    duration,
    icon,
    action,
    cancelAction,
    role: explicitRole,
    ariaLive: explicitAriaLive,
  } = toast;

  const config = VARIANT_CONFIGS[variant] || VARIANT_CONFIGS.info;
  const isAutoDismiss = Number.isFinite(duration) && duration > 0;

  // Remaining time in milliseconds
  const [remainingTime, setRemainingTime] = useState<number>(duration);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const lastTickRef = useRef<number>(Date.now());
  const timerRef = useRef<number | null>(null);

  // Accessible role and live attributes
  const role = explicitRole || (variant === 'error' ? 'alert' : 'status');
  const ariaLive = explicitAriaLive || (variant === 'error' ? 'assertive' : 'polite');

  const handleDismiss = useCallback(() => {
    onDismiss(id);
  }, [id, onDismiss]);

  // Smooth timer tick tracking precise remaining milliseconds
  useEffect(() => {
    if (!isAutoDismiss || isPaused) return;

    lastTickRef.current = Date.now();

    const interval = window.setInterval(() => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;

      setRemainingTime((prev) => {
        const next = prev - delta;
        if (next <= 0) {
          clearInterval(interval);
          return 0;
        }
        return next;
      });
    }, 25);

    timerRef.current = interval;

    return () => {
      clearInterval(interval);
    };
  }, [isAutoDismiss, isPaused, handleDismiss]);

  // Time is up: dismiss after the render that showed it (never from inside a state update, which would update the
  // toast list while React is rendering this toast).
  useEffect(() => {
    if (isAutoDismiss && remainingTime <= 0) handleDismiss();
  }, [isAutoDismiss, remainingTime, handleDismiss]);

  // Keyboard shortcut: Escape to dismiss if focused
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleDismiss();
    }
  };

  // Progress percentage (100% -> 0%)
  const progressPercent = isAutoDismiss ? Math.max(0, Math.min(100, (remainingTime / duration) * 100)) : 100;

  // Main text vs secondary text resolution
  const displayTitle = title ?? (message && description ? message : undefined);
  const displayBody = description ?? (title ? message : message);

  return (
    <motion.div
      ref={ref}
      layout="position"
      initial={{ opacity: 0, x: 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{
        opacity: 0,
        x: 60,
        scale: 0.9,
        transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
      }}
      transition={{ type: 'spring', damping: 25, stiffness: 350 }}
      drag="x"
      dragConstraints={{ left: 0, right: 140 }}
      dragElastic={0.4}
      onDragEnd={(_, info) => {
        if (info.offset.x > 80 || info.velocity.x > 300) {
          handleDismiss();
        }
      }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      className={`group relative pointer-events-auto flex w-full max-w-[390px] overflow-hidden rounded-xl border bg-surface/95 backdrop-blur-md shadow-xl transition-shadow ${config.containerBorder} ${config.glowShadow} focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent/70 dark:focus-visible:ring-offset-slate-950`}
    >
      {/* Semantic Left Accent Indicator Bar */}
      <div
        className={`w-1.5 shrink-0 transition-colors ${config.accentBar}`}
        aria-hidden="true"
      />

      {/* Main Toast Content Container */}
      <div className="flex flex-1 flex-col p-3.5 sm:p-4 min-w-0">
        <div className="flex items-start gap-3">
          {/* Variant Icon Container with High-Contrast Accessible Palette */}
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-105 ${config.iconBg} ${config.iconText}`}
            aria-hidden="true"
          >
            {icon || config.icon}
          </div>

          {/* Text and Actions */}
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2 mb-1">
              {/* Semantic Variant Pill */}
              <span
                className={`inline-flex items-center rounded-full border px-1.5 py-0.2 text-[10px] font-bold tracking-wider uppercase ${config.badgeBg}`}
              >
                {config.badgeLabel}
              </span>

              {/* Pause Indicator on Hover */}
              {isAutoDismiss && isPaused && (
                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 animate-pulse">
                  Paused
                </span>
              )}
            </div>

            {/* Title (High-contrast, bold, readable) */}
            {displayTitle && (
              <h4 className="text-sm font-semibold tracking-tight text-ink break-words leading-tight">
                {displayTitle}
              </h4>
            )}

            {/* Description / Message */}
            {displayBody && (
              <div
                className={`text-xs leading-relaxed text-ink-soft break-words ${
                  displayTitle ? 'mt-1' : 'text-sm font-medium text-ink'
                }`}
              >
                {displayBody}
              </div>
            )}

            {/* Interactive Actions (Action button, Cancel, etc.) */}
            {(action || cancelAction) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {action && (
                  <button
                    type="button"
                    onClick={(e) => {
                      action.onClick(e);
                      handleDismiss();
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold shadow-sm transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      action.variant === 'secondary'
                        ? 'bg-subtle text-ink hover:bg-line'
                        : 'bg-primary text-primary-ink hover:bg-primary-strong'
                    }`}
                  >
                    <span>{action.label}</span>
                    {action.altText && <span className="sr-only">({action.altText})</span>}
                  </button>
                )}

                {cancelAction && (
                  <button
                    type="button"
                    onClick={(e) => {
                      cancelAction.onClick(e);
                      handleDismiss();
                    }}
                    className="inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium text-muted hover:text-ink hover:bg-subtle transition"
                  >
                    {cancelAction.label}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Manual 'X' Close Button */}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss notification"
            className="rounded-lg p-1 text-muted hover:text-ink hover:bg-subtle transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Smooth CSS Countdown Progress Bar */}
      {isAutoDismiss && (
        <div
          className="absolute bottom-0 left-0 right-0 h-1 bg-subtle overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
          aria-label="Time remaining until dismissal"
        >
          <div
            className={`h-full transition-all duration-75 ease-linear ${config.progressColor}`}
            style={{
              width: `${progressPercent}%`,
            }}
          />
        </div>
      )}
    </motion.div>
  );
});
