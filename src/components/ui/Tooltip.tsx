import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../utils/styles';

export interface TooltipProps {
  content: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Tooltip({
  content,
  position = 'top',
  delay = 180,
  disabled = false,
  className,
  children,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const calculatePosition = () => {
    if (!triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipEl = tooltipRef.current;
    const tooltipWidth = tooltipEl ? tooltipEl.offsetWidth : 120;
    const tooltipHeight = tooltipEl ? tooltipEl.offsetHeight : 28;

    let targetTop = 0;
    let targetLeft = 0;
    const offset = 8;

    let activePos = position;

    // Flip if near top bar or viewport edge
    if (activePos === 'top' && triggerRect.top - tooltipHeight - offset < 64) {
      activePos = 'bottom';
    } else if (activePos === 'bottom' && triggerRect.bottom + tooltipHeight + offset > window.innerHeight - 8) {
      activePos = 'top';
    }

    switch (activePos) {
      case 'bottom':
        targetTop = triggerRect.bottom + offset;
        targetLeft = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        targetTop = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2;
        targetLeft = triggerRect.left - tooltipWidth - offset;
        break;
      case 'right':
        targetTop = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2;
        targetLeft = triggerRect.right + offset;
        break;
      case 'top':
      default:
        targetTop = triggerRect.top - tooltipHeight - offset;
        targetLeft = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
        break;
    }

    // Viewport clamp
    const padding = 8;
    const maxLeft = window.innerWidth - tooltipWidth - padding;
    targetLeft = Math.max(padding, Math.min(targetLeft, maxLeft));

    const maxTop = window.innerHeight - tooltipHeight - padding;
    targetTop = Math.max(padding, Math.min(targetTop, maxTop));

    setCoords({ top: targetTop, left: targetLeft });
  };

  useEffect(() => {
    if (disabled && isVisible) {
      setIsVisible(false);
    }
  }, [disabled, isVisible]);

  const showTooltip = () => {
    if (disabled || !content) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsVisible(false);
  };

  useLayoutEffect(() => {
    if (isVisible) {
      calculatePosition();
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    const handleScrollOrResize = () => {
      calculatePosition();
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isVisible]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      ref={triggerRef}
      className="inline-flex items-center"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onPointerDown={hideTooltip}
    >
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isVisible && content && coords && (
              <motion.div
                ref={tooltipRef}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                role="tooltip"
                style={{
                  position: 'fixed',
                  top: coords.top,
                  left: coords.left,
                }}
                className={cn(
                  'pointer-events-none z-[9999] whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium',
                  'bg-ink text-surface shadow-xl dark:bg-surface dark:text-ink border border-line-strong/40',
                  className
                )}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
