import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AccordionItemContext, useAccordion } from './AccordionContext';
import { cn } from '../../../utils/styles';
import type { AccordionItemProps } from './types';

export function AccordionItem({
  id,
  index = 0,
  isFirst = false,
  isLast = false,
  disabled = false,
  hasProblem = false,
  className,
  children,
}: AccordionItemProps) {
  const {
    isExpanded,
    toggleExpand,
    enableDragAndDrop,
    onKeyboardReorder,
    activeId,
  } = useAccordion();

  const expanded = isExpanded(id);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: !enableDragAndDrop,
  });

  const handleToggle = () => {
    if (disabled || isDragging || activeId) return;
    toggleExpand(id);
  };

  const handleKeyboardMove = (direction: 'up' | 'down') => {
    onKeyboardReorder?.(id, direction);
  };

  const isCurrentActive = activeId === id;

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <AccordionItemContext.Provider
      value={{
        id,
        index,
        isFirst,
        isLast,
        isExpanded: expanded,
        toggle: handleToggle,
        isDragging: isCurrentActive || isDragging,
        dragHandleProps: enableDragAndDrop
          ? {
              ref: setActivatorNodeRef,
              ...attributes,
              ...listeners,
            }
          : undefined,
        onKeyboardMove: handleKeyboardMove,
      }}
    >
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'relative rounded-xl transition-all duration-200 bg-surface',
          'border shadow-xs',
          expanded
            ? 'border-accent/40 ring-1 ring-accent/25 shadow-sm'
            : 'border-line hover:border-line-strong hover:shadow-panel',
          'focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/30',
          // Placeholder state while lifted card is in DragOverlay
          isCurrentActive && 'opacity-40 border-dashed border-accent/60 bg-subtle/30 pointer-events-none select-none',
          className
        )}
      >
        {hasProblem && (
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px] bg-danger rounded-l-xl z-10 pointer-events-none"
            aria-hidden="true"
          />
        )}
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}
