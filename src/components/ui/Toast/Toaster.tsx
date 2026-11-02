import React, { useEffect, useState } from 'react';
import { ToastItemData } from './types';
import { toastStore } from './toastStore';
import { ToastContainer, ToastContainerProps } from './ToastContainer';

export interface ToasterProps {
  position?: ToastContainerProps['position'];
  maxToasts?: number;
  className?: string;
  /**
   * For backwards compatibility with Sonner props
   */
  toastOptions?: any;
}

export const Toaster: React.FC<ToasterProps> = ({
  position = 'top-right',
  maxToasts = 6,
  className = '',
}) => {
  const [toasts, setToasts] = useState<ToastItemData[]>(() => toastStore.getToasts());

  useEffect(() => {
    const unsubscribe = toastStore.subscribe((updatedToasts) => {
      setToasts(updatedToasts);
    });
    return unsubscribe;
  }, []);

  return (
    <ToastContainer
      toasts={toasts}
      onDismiss={(id) => toastStore.dismiss(id)}
      position={position}
      maxToasts={maxToasts}
      className={className}
    />
  );
};
