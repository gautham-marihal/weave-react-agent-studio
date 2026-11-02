import { useCallback, useEffect, useRef, useState } from 'react';
import { newNote, readNotes, writeNotes, type StickyNote } from '../models/workflowExtras';

/** The Workflow's sticky notes for one agent, kept in this browser (models/workflowExtras.ts), and what changes them. */
export function useStickyNotes(botId: string) {
  const [notes, setNotesState] = useState<StickyNote[]>(() => readNotes(botId));
  useEffect(() => setNotesState(readNotes(botId)), [botId]);
  const latest = useRef(notes);
  latest.current = notes;
  const setNotes = useCallback((edit: (prev: StickyNote[]) => StickyNote[]) => {
    const next = edit(latest.current);
    latest.current = next;
    setNotesState(next);
    writeNotes(botId, next);
  }, [botId]);
  const add = useCallback((at: {x: number;y: number;}) => {
    const made = newNote(latest.current, at);
    setNotes((prev) => [...prev, made]);
    return made.id;
  }, [setNotes]);
  const change = useCallback((id: string, patch: Partial<StickyNote>) => setNotes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n)), [setNotes]);
  const remove = useCallback((id: string) => setNotes((prev) => prev.filter((n) => n.id !== id)), [setNotes]);
  return { notes, add, change, remove };
}
