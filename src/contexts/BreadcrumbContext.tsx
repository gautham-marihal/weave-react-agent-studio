import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface BreadcrumbContextValue {
  customTitles: Record<string, string>;
  setCustomTitle: (pathOrKey: string, title: string) => void;
  clearCustomTitle: (pathOrKey: string) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | undefined>(undefined);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [customTitles, setCustomTitles] = useState<Record<string, string>>({});

  const setCustomTitle = useCallback((pathOrKey: string, title: string) => {
    setCustomTitles((prev) => {
      if (prev[pathOrKey] === title) return prev;
      return { ...prev, [pathOrKey]: title };
    });
  }, []);

  const clearCustomTitle = useCallback((pathOrKey: string) => {
    setCustomTitles((prev) => {
      if (!prev[pathOrKey]) return prev;
      const next = { ...prev };
      delete next[pathOrKey];
      return next;
    });
  }, []);

  const value = useMemo(() => ({ customTitles, setCustomTitle, clearCustomTitle }), [customTitles, setCustomTitle, clearCustomTitle]);

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbContext() {
  return useContext(BreadcrumbContext);
}

/**
 * Hook for pages to easily set a custom breadcrumb title for the current page
 */
export function useSetBreadcrumbTitle(title: string | undefined | null, key?: string) {
  const ctx = useBreadcrumbContext();
  const setCustomTitle = ctx?.setCustomTitle;
  const clearCustomTitle = ctx?.clearCustomTitle;

  useEffect(() => {
    if (!setCustomTitle || !clearCustomTitle || !title) return;
    const targetKey = key || window.location.pathname;
    setCustomTitle(targetKey, title);

    return () => {
      clearCustomTitle(targetKey);
    };
  }, [setCustomTitle, clearCustomTitle, title, key]);
}
