import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontalIcon, Trash2Icon } from 'lucide-react';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import { NOTE_COLORS, type NoteColor, type StickyNote } from '../../../../models/workflowExtras';
import { cn } from '../../../../utils/styles';

// Sticky notes on the Workflow: reminders for whoever edits it. The server refuses fields it doesn't know, so notes are
// kept in this browser, one list per agent, and never reach the configuration (or anyone else).

// The theme's own soft colours, so a note reads in light and dark.
const TONE: Record<NoteColor, string> = {
  yellow: 'bg-warning-soft border-warning/30',
  blue: 'bg-info-soft border-info/30',
  green: 'bg-success-soft border-success/30',
  pink: 'bg-accent-soft border-accent/30',
  grey: 'bg-subtle border-line-strong'
};
const SWATCH: Record<NoteColor, string> = { yellow: 'bg-warning', blue: 'bg-info', green: 'bg-success', pink: 'bg-accent', grey: 'bg-[rgb(var(--muted))]' };

/** The notes, drawn in the canvas's own coordinates so they pan and zoom with it. */
export function StickyNotesLayer({ notes, focusId, onChange, onRemove }: {notes: StickyNote[];focusId: string | null;onChange: (id: string, patch: Partial<StickyNote>) => void;onRemove: (id: string) => void;}) {
  return (
    <ViewportPortal>
      {notes.map((note) => <Note key={note.id} note={note} focus={note.id === focusId} onChange={(patch) => onChange(note.id, patch)} onRemove={() => onRemove(note.id)} />)}
    </ViewportPortal>);

}

function Note({ note, focus, onChange, onRemove }: {note: StickyNote;focus: boolean;onChange: (patch: Partial<StickyNote>) => void;onRemove: () => void;}) {
  const rf = useReactFlow();
  const [place, setPlace] = useState<{x: number;y: number;} | null>(null);
  const [text, setText] = useState(note.text);
  const area = useRef<HTMLTextAreaElement>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => setText(note.text), [note.text]);
  // What is typed is kept a moment after the last key.
  useEffect(() => {
    if (text === note.text) return;
    const t = window.setTimeout(() => changeRef.current({ text }), 400);
    return () => window.clearTimeout(t);
  }, [text, note.text]);
  useEffect(() => {
    if (focus) area.current?.focus();
  }, [focus]);

  // Moving by the grip: the pointer's travel divided by the zoom, saved when it is let go.
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const zoom = rf.getZoom();
    const from = { x: e.clientX, y: e.clientY };
    let at = { x: note.x, y: note.y };
    const move = (ev: PointerEvent) => {
      at = { x: Math.round(note.x + (ev.clientX - from.x) / zoom), y: Math.round(note.y + (ev.clientY - from.y) / zoom) };
      setPlace(at);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPlace(null);
      if (at.x !== note.x || at.y !== note.y) onChange(at);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const where = place ?? note;
  return (
    <div
      data-sticky-note={note.id}
      role="note"
      aria-label="Sticky note"
      className={cn('nodrag nopan nowheel pointer-events-auto absolute flex flex-col rounded-md border shadow-panel', TONE[note.color])}
      style={{ transform: `translate(${where.x}px, ${where.y}px)`, width: note.w, height: note.h }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1 px-1.5 pt-1">
        <button type="button" aria-label="Move the note" title="Drag to move" onPointerDown={startDrag} className="cursor-grab rounded p-0.5 text-ink-soft/70 hover:text-ink active:cursor-grabbing">
          <GripHorizontalIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
        <div className="ml-auto flex items-center gap-1" role="radiogroup" aria-label="Note colour">
          {NOTE_COLORS.map((c) =>
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={note.color === c}
            aria-label={c}
            onClick={() => onChange({ color: c })}
            className={cn('h-3 w-3 rounded-full ring-offset-1', SWATCH[c], note.color === c && 'ring-2 ring-ink/40')} />
          )}
          <button type="button" aria-label="Delete the note" title="Delete the note" onClick={onRemove} className="ml-1 rounded p-0.5 text-ink-soft/70 hover:text-danger">
            <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <textarea
        ref={area}
        aria-label="Note"
        value={text}
        placeholder="Write a note… (kept in this browser)"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== note.text && onChange({ text })}
        className="min-h-0 flex-1 resize-none bg-transparent px-2.5 pb-2 pt-1 text-[13px] leading-snug text-ink placeholder:text-ink-soft/60 focus:outline-none" />
    </div>);

}
