import React, { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { AccordionContext } from './AccordionContext';
import { AccordionPagination } from './AccordionPagination';
import { cn } from '../../../utils/styles';
import type { AccordionProps } from './types';

export function Accordion<T = any>({
  items,
  getId,
  onReorder,
  onReorderById,
  allowMultiple = false,
  expandedIds: controlledExpandedIds,
  defaultExpandedIds = [],
  onExpandedChange,
  enableReordering = true,
  enableDragAndDrop = true,
  renderOverlay,
  pagination,
  className,
  children,
}: AccordionProps<T>) {
  const [internalExpandedIds, setInternalExpandedIds] = useState<string[]>(defaultExpandedIds);
  const [activeId, setActiveId] = useState<string | null>(null);

  const isControlled = controlledExpandedIds !== undefined;
  const expandedIds = isControlled ? controlledExpandedIds : internalExpandedIds;

  const setExpanded = useCallback(
    (newIds: string[]) => {
      if (!isControlled) {
        setInternalExpandedIds(newIds);
      }
      onExpandedChange?.(newIds);
    },
    [isControlled, onExpandedChange]
  );

  const isExpanded = useCallback(
    (id: string) => expandedIds.includes(id),
    [expandedIds]
  );

  const toggleExpand = useCallback(
    (id: string) => {
      if (allowMultiple) {
        const next = expandedIds.includes(id)
          ? expandedIds.filter((x) => x !== id)
          : [...expandedIds, id];
        setExpanded(next);
      } else {
        const next = expandedIds.includes(id) ? [] : [id];
        setExpanded(next);
      }
    },
    [allowMultiple, expandedIds, setExpanded]
  );

  const expandAll = useCallback(
    (ids: string[]) => {
      setExpanded(Array.from(new Set([...expandedIds, ...ids])));
    },
    [expandedIds, setExpanded]
  );

  const collapseAll = useCallback(() => {
    setExpanded([]);
  }, [setExpanded]);

  const defaultGetId = useCallback(
    (item: any, idx: number): string => {
      if (getId) return getId(item);
      if (item && typeof item === 'object') {
        if (item.id) return String(item.id);
        if (item.agent?.id) return String(item.agent.id);
      }
      return String(idx);
    },
    [getId]
  );

  const itemIds = useMemo(() => {
    if (!items) return [];
    return items.map((it, idx) => defaultGetId(it, idx));
  }, [items, defaultGetId]);

  const activeItem = useMemo(() => {
    if (!activeId || !items) return null;
    return items.find((it, idx) => defaultGetId(it, idx) === activeId) ?? null;
  }, [activeId, items, defaultGetId]);

  // Pointer sensor with activation constraint distance 5; Keyboard sensor for arrow navigation
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id || !items) return;

    const oldIndex = items.findIndex((it, idx) => defaultGetId(it, idx) === active.id);
    const newIndex = items.findIndex((it, idx) => defaultGetId(it, idx) === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove(items, oldIndex, newIndex);
      onReorder?.(reordered);
      onReorderById?.(
        String(active.id),
        String(over.id),
        newIndex > oldIndex ? 'bottom' : 'top'
      );
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const handleReorderById = useCallback(
    (sourceId: string, targetId: string, position: 'top' | 'bottom') => {
      if (sourceId === targetId) return;

      if (onReorderById) {
        onReorderById(sourceId, targetId, position);
        return;
      }

      if (!items || !onReorder) return;

      const sourceIdx = items.findIndex((it, i) => defaultGetId(it, i) === sourceId);
      const targetIdx = items.findIndex((it, i) => defaultGetId(it, i) === targetId);

      if (sourceIdx === -1 || targetIdx === -1) return;

      const next = [...items];
      const [moved] = next.splice(sourceIdx, 1);

      let insertIdx = next.findIndex((it, i) => defaultGetId(it, i) === targetId);
      if (position === 'bottom') {
        insertIdx += 1;
      }
      next.splice(insertIdx, 0, moved);
      onReorder(next);
    },
    [defaultGetId, items, onReorder, onReorderById]
  );

  const handleKeyboardReorder = useCallback(
    (id: string, direction: 'up' | 'down') => {
      if (!items) return;
      const currentIdx = items.findIndex((it, i) => defaultGetId(it, i) === id);
      if (currentIdx === -1) return;

      const targetIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
      if (targetIdx < 0 || targetIdx >= items.length) return;

      const targetId = defaultGetId(items[targetIdx], targetIdx);
      if (onReorderById) {
        onReorderById(id, targetId, direction === 'up' ? 'top' : 'bottom');
      }
      if (onReorder) {
        const next = arrayMove(items, currentIdx, targetIdx);
        onReorder(next);
      }
    },
    [defaultGetId, items, onReorder, onReorderById]
  );

  const isDndEnabled = Boolean(
    enableDragAndDrop && enableReordering && (onReorder || onReorderById) && items && items.length > 0
  );

  const contextValue = useMemo(
    () => ({
      expandedIds,
      toggleExpand,
      isExpanded,
      expandAll,
      collapseAll,
      enableReordering: Boolean(enableReordering && (onReorder || onReorderById)),
      enableDragAndDrop: isDndEnabled,
      activeId,
      onReorderById: handleReorderById,
      onKeyboardReorder: handleKeyboardReorder,
    }),
    [
      expandedIds,
      toggleExpand,
      isExpanded,
      expandAll,
      collapseAll,
      enableReordering,
      isDndEnabled,
      activeId,
      onReorder,
      onReorderById,
      handleReorderById,
      handleKeyboardReorder,
    ]
  );

  const listContent = (
    <div className={cn('w-full space-y-3 p-1', className)}>
      {children}

      {pagination && pagination.totalItems > 0 && (
        <AccordionPagination {...pagination} />
      )}
    </div>
  );

  return (
    <AccordionContext.Provider value={contextValue}>
      {isDndEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {listContent}
          </SortableContext>

          <DragOverlay
            modifiers={[restrictToVerticalAxis]}
            dropAnimation={{
              duration: 160,
              easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
            }}
          >
            {activeItem ? (
              <div
                style={{
                  borderRadius: '12px',
                  border: '2px solid var(--accent, rgb(114, 48, 143))',
                }}
                className="bg-surface shadow-2xl ring-4 ring-accent/20 cursor-grabbing z-[9999] opacity-100 overflow-hidden"
              >
                {renderOverlay ? (
                  renderOverlay(activeItem)
                ) : (
                  <div className="flex min-h-[64px] items-center px-5 py-3 text-ink font-semibold">
                    {defaultGetId(activeItem, 0)}
                  </div>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        listContent
      )}
    </AccordionContext.Provider>
  );
}
