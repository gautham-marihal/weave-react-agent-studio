import React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon } from 'lucide-react';
import { cn } from '../../../../utils/styles';

// A list whose items can be put in another order: by mouse (drag the handle), or from the keyboard (Space on the handle,
// the arrows, Space or Enter to drop; Escape puts it back). Each item says its own name on its handle.

interface SortableListProps {
  /** One stable key per item, in order. */
  ids: string[];
  /** The name read on an item's handle: "Drag {name}". */
  nameOf: (index: number) => string;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  children: (index: number, handle: React.ReactNode) => React.ReactNode;
  className?: string;
}

export function SortableList({ ids, nameOf, onMove, disabled, children, className }: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: 'To move it, press Space, then the arrow keys, then Space again. Escape puts it back.' },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${nameOf(ids.indexOf(String(active.id)))}.`,
          onDragOver: ({ over }) => (over ? `Over place ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.` : ''),
          onDragEnd: ({ over }) => (over ? `Dropped at place ${ids.indexOf(String(over.id)) + 1}.` : 'Dropped.'),
          onDragCancel: () => 'Put back where it was.'
        }
      }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className={cn('space-y-3', className)}>
          {ids.map((id, index) =>
          <SortableItem key={id} id={id} name={nameOf(index)} disabled={disabled}>
              {(handle) => children(index, handle)}
            </SortableItem>
          )}
        </ol>
      </SortableContext>
    </DndContext>);

}

function SortableItem({ id, name, disabled, children }: { id: string; name: string; disabled?: boolean; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const handle =
  <button
    type="button"
    ref={setActivatorNodeRef}
    {...attributes}
    {...listeners}
    aria-label={`Drag ${name}`}
    disabled={disabled}
    data-drag-handle
    className="-ml-1 inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:cursor-grabbing disabled:cursor-default disabled:opacity-40">
      <GripVerticalIcon className="h-4 w-4" aria-hidden />
    </button>;

  return (
    <li
      ref={setNodeRef}
      data-sort-id={id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10 opacity-90 shadow-overlay')}>
      {children(handle)}
    </li>);

}
