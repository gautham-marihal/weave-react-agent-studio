import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { ToastContextValue, ToastItemData } from './types';
import { toast, toastStore } from './toastStore';
import { ToastContainer } from './ToastContainer';

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  children: React.ReactNode;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  maxToasts?: number;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({
  children,
  position = 'top-right',
  maxToasts = 6,
}) => {
  const [toasts, setToasts] = useState<ToastItemData[]>(() => toastStore.getToasts());

  useEffect(() => {
    const unsubscribe = toastStore.subscribe((updatedToasts) => {
      setToasts(updatedToasts);
    });
    return unsubscribe;
  }, []);

  const contextValue: ToastContextValue = useMemo(
    () => ({
      toasts,
      toast,
      dismiss: (id: string) => toastStore.dismiss(id),
      dismissAll: () => toastStore.dismissAll(),
    }),
    [toasts]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => toastStore.dismiss(id)}
        position={position}
        maxToasts={maxToasts}
      />
    </ToastContext.Provider>
  );
};

/**
 * Hook to access toast methods and active toast list from any React component.
 * If used outside a ToastProvider, falls back directly to the global toast store.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    // Graceful fallback to global store if invoked outside provider
    return {
      toasts: toastStore.getToasts(),
      toast,
      dismiss: (id: string) => toastStore.dismiss(id),
      dismissAll: () => toastStore.dismissAll(),
    };
  }

  return context;
}
