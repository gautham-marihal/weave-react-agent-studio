import React from 'react';
import { ChevronDownIcon, GripVerticalIcon } from 'lucide-react';
import { useAccordion, useAccordionItem } from './AccordionContext';
import { Tooltip } from '../Tooltip';
import { cn } from '../../../utils/styles';
import type { AccordionHeaderProps } from './types';

export function AccordionHeader({
  id: explicitId,
  title,
  subtitle,
  badge,
  status,
  icon,
  actions,
  showDragHandle = true,
  hasProblem = false,
  className,
  children,
}: AccordionHeaderProps) {
  const { enableReordering, enableDragAndDrop } = useAccordion();
  const item = useAccordionItem();

  const id = explicitId ?? item.id;
  const isExpanded = item.isExpanded;
  const statusContent = status ?? badge;
  // A list that can't be reordered has no grip column, so its rows start at the icon
  const grip = enableReordering && enableDragAndDrop && showDragHandle;
  const col = grip
    ? {
        grid: 'grid-cols-[24px_36px_minmax(0,1fr)_auto] min-[900px]:grid-cols-[24px_36px_minmax(0,1fr)_auto_auto]',
        icon: 'col-start-2',
        name: 'col-start-3',
        status: 'col-start-3 min-[900px]:col-start-4',
        actions: 'col-start-4 min-[900px]:col-start-5',
      }
    : {
        grid: 'grid-cols-[36px_minmax(0,1fr)_auto] min-[900px]:grid-cols-[36px_minmax(0,1fr)_auto_auto]',
        icon: 'col-start-1',
        name: 'col-start-2',
        status: 'col-start-2 min-[900px]:col-start-3',
        actions: 'col-start-3 min-[900px]:col-start-4',
      };

  return (
    <div
      className={cn(
        'group relative w-full select-none transition-colors cursor-pointer',
        'rounded-t-xl',
        !isExpanded && 'rounded-xl',
        'hover:bg-canvas/50',
        isExpanded ? 'bg-surface' : 'bg-surface',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        // 5-column layout at >= 900px, 4-column 2-row layout below 900px
        'grid',
        col.grid,
        'gap-x-3.5 gap-y-2 items-center px-4 sm:px-5 py-3 min-h-[64px]',
        className
      )}
      onClick={item.toggle}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-controls={`accordion-content-${id}`}
      id={`accordion-header-${id}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.toggle();
        }
      }}
    >
      {/* 3px Red Left Accent Bar for rows with problems */}
      {hasProblem && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-danger rounded-l-xl z-10 pointer-events-none"
          aria-hidden="true"
        />
      )}

      {/* 1. [grip] (24px) */}
      {grip && (
        <div
          className="col-start-1 row-start-1 row-span-2 min-[900px]:row-span-1 flex items-center justify-center w-6 shrink-0 self-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Tooltip content="Drag to reorder section (Arrow Up/Down)" position="top" disabled={item.isDragging}>
            <div
              ref={item.dragHandleProps?.ref}
              {...item.dragHandleProps}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                item.dragHandleProps?.onKeyDown?.(e);
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  item.onKeyboardMove?.('up');
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  item.onKeyboardMove?.('down');
                }
              }}
              style={{ touchAction: 'none' }}
              role="button"
              tabIndex={0}
              className="cursor-grab active:cursor-grabbing p-1 text-muted/60 hover:text-ink hover:bg-subtle rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Drag handle to reorder section. Press arrow up or down to move."
            >
              <GripVerticalIcon className="h-4 w-4" />
            </div>
          </Tooltip>
        </div>
      )}

      {/* 2. [icon] (36px) */}
      <div className={cn(col.icon, 'row-start-1 row-span-2 min-[900px]:row-span-1 flex items-center justify-center w-9 shrink-0 self-center')}>
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft/30 text-accent">
            {icon}
          </div>
        )}
      </div>

      {/* 3. [MAIN] (minmax(0, 1fr)) */}
      <div className={cn(col.name, 'row-start-1 min-w-0 flex flex-col justify-center')}>
        {/* Line 1: Agent name only (14px/600, ellipsis) */}
        <div className="min-w-0 text-sm font-semibold text-ink leading-snug truncate">
          {title}
        </div>
        {/* Line 2: Slug / meta (12px, muted, ellipsis) */}
        {subtitle && (
          <div className="min-w-0 text-xs text-muted leading-snug mt-0.5 truncate">
            {subtitle}
          </div>
        )}
      </div>

      {/* 4. [STATUS] (flex, gap 8px, right-aligned, no shrink; below 900px: under name as 2nd row) */}
      {statusContent && (
        <div
          className={cn(
            col.status,
            'row-start-2 min-[900px]:row-start-1',
            'flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap',
            'justify-start min-[900px]:justify-end',
            'self-center'
          )}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {statusContent}
        </div>
      )}

      {/* 5. [ACTIONS] (flex, gap 8px, 32px hit targets, no wrapping) */}
      <div
        className={cn(
          col.actions,
          'row-start-1 row-span-2 min-[900px]:row-start-1 min-[900px]:row-span-1',
          'flex items-center justify-end gap-1.5 sm:gap-2 shrink-0 flex-nowrap self-center'
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
        {actions}

        <Tooltip
          content={isExpanded ? 'Collapse section' : 'Expand section'}
          position="top"
          disabled={item.isDragging}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              item.toggle();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
            aria-expanded={isExpanded}
          >
            <ChevronDownIcon
              className={cn(
                'h-4 w-4 transition-transform duration-200 text-muted group-hover:text-ink',
                isExpanded && 'rotate-180 text-accent'
              )}
            />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
