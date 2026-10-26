import React, { createContext, useContext, useMemo, useRef } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from './Icon.jsx';
import './sortable.css';

// Dragging the items of a list into another order (dnd-kit), beside the Move up and Move down buttons that stay: by
// mouse or touch from the handle, or from the keyboard (Space or Enter on the handle, the arrows to move, Space or
// Enter to drop it, Escape to put it back). A screen reader is told what is happening, with the item's name and place.
// Only up and down: a list moves in one direction.
//
//   <SortableList ids={keys} nameOf={(id) => title} onMove={(from, to) => …} label="the messages">
//     {keys.map((id) => <SortableItem key={id} id={id}> … <DragHandle label="Drag Billing" /> … </SortableItem>)}
//   </SortableList>
//
// The ids are the keys the list is drawn with (useItemKeys), so what belongs to an item goes with it when it moves.

// While a drag is going on, the keys are the drag's: taken first, at the window, and stopped there. dnd-kit listens on
// the document, after the sheets, panels and dialogs the list is in, so without this Escape would also close the panel,
// and Tab would be taken by its focus trap.
class ListKeyboardSensor extends KeyboardSensor {
  attach() {
    this.handleStart();
    this.windowListeners.add('resize', this.handleCancel);
    this.windowListeners.add('visibilitychange', this.handleCancel);
    this.takeKey = (event) => {
      event.stopPropagation();
      this.handleKeyDown(event);
    };
    // from the next key on: the one that picked the item up has finished its own trip
    this.keyTimer = setTimeout(() => window.addEventListener('keydown', this.takeKey, true));
  }
  detach() {
    super.detach();
    clearTimeout(this.keyTimer);
    window.removeEventListener('keydown', this.takeKey, true);
  }
}
// The same for Escape during a drag with the mouse or a finger: it puts the item back, and closes nothing else.
class ListPointerSensor extends PointerSensor {
  attach() {
    this.escape = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      this.handleCancel();
    };
    window.addEventListener('keydown', this.escape, true);
    super.attach();
  }
  detach() {
    window.removeEventListener('keydown', this.escape, true);
    super.detach();
  }
}

// up and down only
const upAndDown = ({ transform }) => ({ ...transform, x: 0 });
const MODIFIERS = [upAndDown];

const HandleCtx = createContext(null);
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

//   ids: the items' keys, in order; onMove(from, to): the item at `from` goes to `to` (indexes into `ids`); nameOf(id): what a person calls the item
//   ("the step Say a line"); label: what the list is ("the steps of rule 1"), for the instructions a screen reader hears
export function SortableList({ ids, onMove, nameOf = (id) => String(id), label = 'the list', children }) {
  const sensors = useSensors(
    useSensor(ListPointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(ListKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // the place last said: the item is "over" its own place as soon as it is picked up, which must not talk over "Picked up"
  const lastSaid = useRef(null);
  const accessibility = useMemo(() => {
    const place = (id) => `${ids.indexOf(id) + 1} of ${ids.length}`;
    return {
      // the hidden instructions and the live region go at the end of the page, not into the list (an <ol> holds only its items)
      container: typeof document === 'undefined' ? undefined : document.body,
      screenReaderInstructions: {
        draggable: `To move it in ${label}, press Space or Enter, then the up and down arrows. Press Space or Enter again to put it there, or Escape to leave it where it was.`,
      },
      announcements: {
        onDragStart: ({ active }) => {
          lastSaid.current = active.id;
          return `Picked up ${nameOf(active.id)}, at place ${place(active.id)}.`;
        },
        onDragOver: ({ active, over }) => {
          const at = over ? over.id : null;
          if (at === lastSaid.current) return undefined;
          lastSaid.current = at;
          return over ? `${nameOf(active.id)} would go to place ${place(over.id)}.` : `${nameOf(active.id)} is not over the list.`;
        },
        onDragEnd: ({ active, over }) =>
          over ? `${nameOf(active.id)} put at place ${place(over.id)}.` : `${nameOf(active.id)} left where it was, at place ${place(active.id)}.`,
        onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled. It is back at place ${place(active.id)}.`,
      },
    };
  }, [ids, nameOf, label]);
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from >= 0 && to >= 0) onMove(from, to);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={MODIFIERS} accessibility={accessibility} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

// The item's own handlers, for a handle inside it, and what puts it where it is dragged: for an item that draws its own outer element (a card).
//   -> { ref, style, dragging, handle }
export function useSortableItem(id) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition: reducedMotion() ? undefined : transition,
  };
  return { ref: setNodeRef, style, dragging: isDragging, handle: { attributes, listeners, setActivatorNodeRef, dragging: isDragging } };
}

// An item of a SortableList whose element is drawn here (a step, a rule): `as` is the element.
export function SortableItem({ id, as: Tag = 'div', className = '', children, ...rest }) {
  const item = useSortableItem(id);
  return (
    <Tag ref={item.ref} style={item.style} className={`${className} sortItem${item.dragging ? ' isDragging' : ''}`} {...rest}>
      <SortableHandles value={item.handle}>{children}</SortableHandles>
    </Tag>
  );
}

// Gives a DragHandle somewhere inside the item what it needs (for an item drawn by another component, a card's header).
export const SortableHandles = ({ value, children }) => <HandleCtx.Provider value={value}>{children}</HandleCtx.Provider>;

// The handle the item is dragged by: a button named for what it moves ("Drag Billing"). `handle`: the item's, from
// useSortableItem, where the item draws its own element; else the SortableItem it is in. Outside a sortable item it
// draws nothing.
export function DragHandle({ label, disabled = false, handle: given = null }) {
  const fromItem = useContext(HandleCtx);
  const handle = given || fromItem;
  if (!handle || disabled) return null;
  return (
    <button
      type="button"
      ref={handle.setActivatorNodeRef}
      className={`dragHandle${handle.dragging ? ' isDragging' : ''}`}
      {...handle.attributes}
      {...handle.listeners}
      aria-label={label}
      title="Drag to move it, or press Space, then the arrow keys"
    >
      <Icon name="drag" size={15} />
    </button>
  );
}
