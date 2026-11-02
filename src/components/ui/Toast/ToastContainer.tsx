import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { ToastItemData } from './types';
import { ToastItem } from './ToastItem';

export interface ToastContainerProps {
  toasts: ToastItemData[];
  onDismiss: (id: string) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  className?: string;
  maxToasts?: number;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss,
  position = 'top-right',
  className = '',
  maxToasts = 6,
}) => {
  // Positioning classes carefully tuned to avoid covering main navigation headers (h-14 TopBar)
  const positionClasses = {
    // Placed at top-16 (4rem / 64px) on mobile and top-18 (4.5rem / 72px) on desktop to cleanly clear the h-14 (56px) TopBar!
    'top-right': 'top-16 sm:top-18 right-4 sm:right-6 md:right-8 items-end',
    'top-left': 'top-16 sm:top-18 left-4 sm:left-6 md:left-8 items-start',
    'top-center': 'top-16 sm:top-18 left-1/2 -translate-x-1/2 items-center',
    'bottom-right': 'bottom-6 right-4 sm:right-6 md:right-8 items-end',
    'bottom-left': 'bottom-6 left-4 sm:left-6 md:left-8 items-start',
    'bottom-center': 'bottom-6 left-1/2 -translate-x-1/2 items-center',
  }[position];

  const visibleToasts = toasts.slice(0, maxToasts);

  return (
    <aside
      aria-label="Notifications"
      className={`fixed ${positionClasses} z-[70] pointer-events-none flex w-full max-w-[calc(100vw-2rem)] sm:max-w-md flex-col gap-2.5 max-h-[calc(100vh-6rem)] overflow-y-auto no-scrollbar py-1 ${className}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {visibleToasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </aside>
  );
};
