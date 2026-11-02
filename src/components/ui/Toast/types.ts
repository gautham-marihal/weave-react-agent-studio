import React from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  altText?: string;
  variant?: 'primary' | 'secondary' | 'subtle';
}

export interface ToastOptions {
  id?: string;
  title?: React.ReactNode;
  message?: React.ReactNode;
  /**
   * For backwards compatibility with standard toast libraries like sonner
   */
  description?: React.ReactNode;
  variant?: ToastVariant;
  /**
   * Duration in milliseconds before auto-dismissal.
   * Default: 4000ms (4 seconds).
   * Set to 0 or Infinity for persistent toasts.
   */
  duration?: number;
  /**
   * Whether the toast should not auto-dismiss
   */
  persistent?: boolean;
  /**
   * Optional manual override icon
   */
  icon?: React.ReactNode;
  /**
   * Primary action button (e.g., "Undo", "Retry", "View")
   */
  action?: ToastAction;
  /**
   * Secondary dismiss/cancel action
   */
  cancelAction?: ToastAction;
  /**
   * Called when the toast is dismissed (either manually or automatically)
   */
  onDismiss?: (id: string) => void;
  /**
   * Accessibility role override
   */
  role?: 'status' | 'alert';
  /**
   * Accessibility aria-live setting
   */
  ariaLive?: 'polite' | 'assertive';
  /**
   * If true, renders with snackbar badge pill style
   */
  isSnackbar?: boolean;
}

export interface ToastItemData extends ToastOptions {
  id: string;
  variant: ToastVariant;
  duration: number;
  createdAt: number;
}

export interface ToastContextValue {
  toasts: ToastItemData[];
  toast: {
    (message: React.ReactNode, options?: ToastOptions): string;
    success: (message: React.ReactNode, options?: ToastOptions) => string;
    error: (message: React.ReactNode, options?: ToastOptions) => string;
    warning: (message: React.ReactNode, options?: ToastOptions) => string;
    info: (message: React.ReactNode, options?: ToastOptions) => string;
    snackbar: (message: React.ReactNode, options?: ToastOptions) => string;
    promise: <T>(
      promise: Promise<T>,
      messages: {
        loading: React.ReactNode;
        success: React.ReactNode | ((data: T) => React.ReactNode);
        error: React.ReactNode | ((err: any) => React.ReactNode);
      },
      options?: ToastOptions
    ) => Promise<T>;
    dismiss: (id?: string) => void;
    dismissAll: () => void;
  };
  dismiss: (id: string) => void;
  dismissAll: () => void;
}
