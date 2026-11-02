import { createContext, useContext } from 'react';

export interface AccordionContextType {
  expandedIds: string[];
  toggleExpand: (id: string) => void;
  isExpanded: (id: string) => boolean;
  expandAll: (ids: string[]) => void;
  collapseAll: () => void;
  enableReordering: boolean;
  enableDragAndDrop: boolean;
  activeId: string | null;
  onReorderById?: (sourceId: string, targetId: string, position: 'top' | 'bottom') => void;
  onKeyboardReorder?: (id: string, direction: 'up' | 'down') => void;
}

const AccordionContext = createContext<AccordionContextType | null>(null);

export function useAccordion() {
  const ctx = useContext(AccordionContext);
  if (!ctx) {
    throw new Error('useAccordion must be used within an Accordion');
  }
  return ctx;
}

export interface AccordionItemContextType {
  id: string;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isExpanded: boolean;
  toggle: () => void;
  isDragging: boolean;
  dragHandleProps?: {
    ref?: (element: HTMLElement | null) => void;
    [key: string]: any;
  };
  onKeyboardMove: (direction: 'up' | 'down') => void;
}

const AccordionItemContext = createContext<AccordionItemContextType | null>(null);

export function useAccordionItem() {
  const ctx = useContext(AccordionItemContext);
  if (!ctx) {
    throw new Error('useAccordionItem must be used within an AccordionItem');
  }
  return ctx;
}

export { AccordionContext, AccordionItemContext };
