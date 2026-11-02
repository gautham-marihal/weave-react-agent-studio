import React from 'react';
import { ToastItemData, ToastOptions, ToastVariant } from './types';

type Listener = (toasts: ToastItemData[]) => void;

class ToastStore {
  private toasts: ToastItemData[] = [];
  private listeners = new Set<Listener>();

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener([...this.toasts]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const copy = [...this.toasts];
    this.listeners.forEach((listener) => listener(copy));
  }

  public getToasts(): ToastItemData[] {
    return [...this.toasts];
  }

  public addToast(
    messageOrOptions: React.ReactNode | ToastOptions,
    explicitOptions?: ToastOptions,
    defaultVariant: ToastVariant = 'info'
  ): string {
    let options: ToastOptions = {};

    if (
      messageOrOptions !== null &&
      typeof messageOrOptions === 'object' &&
      !React.isValidElement(messageOrOptions) &&
      ('message' in (messageOrOptions as any) ||
        'title' in (messageOrOptions as any) ||
        'description' in (messageOrOptions as any) ||
        'variant' in (messageOrOptions as any))
    ) {
      options = { ...(messageOrOptions as ToastOptions) };
      if (explicitOptions) {
        options = { ...options, ...explicitOptions };
      }
    } else {
      options = {
        message: messageOrOptions as React.ReactNode,
        ...(explicitOptions || {}),
      };
    }

    const id = options.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const variant: ToastVariant = options.variant || defaultVariant;
    const duration = options.persistent ? Infinity : options.duration ?? 4000;

    const newToast: ToastItemData = {
      ...options,
      id,
      variant,
      duration,
      createdAt: Date.now(),
    };

    // If toast with same ID already exists, update it in place
    const existingIndex = this.toasts.findIndex((t) => t.id === id);
    if (existingIndex >= 0) {
      this.toasts[existingIndex] = newToast;
    } else {
      // Add new toast to list (newest first for clean top-right stack, capped at 6 active)
      this.toasts = [newToast, ...this.toasts.slice(0, 5)];
    }

    this.notify();
    return id;
  }

  public dismiss(id?: string): void {
    if (!id) {
      // Dismiss the oldest or first
      if (this.toasts.length > 0) {
        const target = this.toasts[this.toasts.length - 1];
        this.dismiss(target.id);
      }
      return;
    }

    const toastToRemove = this.toasts.find((t) => t.id === id);
    if (toastToRemove) {
      toastToRemove.onDismiss?.(id);
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.notify();
    }
  }

  public dismissAll(): void {
    this.toasts.forEach((t) => t.onDismiss?.(t.id));
    this.toasts = [];
    this.notify();
  }
}

export const toastStore = new ToastStore();

// Top-level toast callable function & semantic variants
function createToastFn() {
  const toastFn = (message: React.ReactNode, options?: ToastOptions) =>
    toastStore.addToast(message, options, 'info');

  toastFn.success = (message: React.ReactNode, options?: ToastOptions) =>
    toastStore.addToast(message, options, 'success');

  toastFn.error = (message: React.ReactNode, options?: ToastOptions) =>
    toastStore.addToast(
      message,
      {
        role: 'alert',
        ariaLive: 'assertive' as const,
        ...options,
      },
      'error'
    );

  toastFn.warning = (message: React.ReactNode, options?: ToastOptions) =>
    toastStore.addToast(message, options, 'warning');

  toastFn.info = (message: React.ReactNode, options?: ToastOptions) =>
    toastStore.addToast(message, options, 'info');

  toastFn.snackbar = (message: React.ReactNode, options?: ToastOptions) =>
    toastStore.addToast(message, { isSnackbar: true, ...options }, options?.variant || 'info');

  toastFn.dismiss = (id?: string) => toastStore.dismiss(id);
  toastFn.dismissAll = () => toastStore.dismissAll();

  toastFn.promise = async <T,>(
    promise: Promise<T>,
    messages: {
      loading: React.ReactNode;
      success: React.ReactNode | ((data: T) => React.ReactNode);
      error: React.ReactNode | ((err: any) => React.ReactNode);
    },
    options?: ToastOptions
  ): Promise<T> => {
    const id = toastStore.addToast(messages.loading, {
      ...options,
      variant: 'info',
      duration: Infinity,
    });

    try {
      const data = await promise;
      const successMsg =
        typeof messages.success === 'function' ? messages.success(data) : messages.success;
      toastStore.addToast(successMsg, {
        ...options,
        id,
        variant: 'success',
        duration: options?.duration ?? 4000,
      });
      return data;
    } catch (err) {
      const errorMsg =
        typeof messages.error === 'function' ? messages.error(err) : messages.error;
      toastStore.addToast(errorMsg, {
        ...options,
        id,
        variant: 'error',
        role: 'alert',
        ariaLive: 'assertive',
        duration: options?.duration ?? 5000,
      });
      throw err;
    }
  };

  return toastFn;
}

export const toast = createToastFn();
