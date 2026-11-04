import { useLayoutEffect, useState } from 'react';

// Where a dropdown list fits (under its field, else on the side with more room) and how tall it may be there,
// so it never runs off the window or out of its panel and nothing needs scrolling to be seen.

// -> { up, room }: room, the height the list may take on its side (px)
//   field: the field's box   bounds: the area the list must stay in ({ top, bottom })
//   natural: the list's full height   gap: between field and list
export function placeDrop(field, bounds, natural, gap = 6, margin = 8) {
  const below = Math.floor(bounds.bottom - field.bottom - gap - margin);
  const above = Math.floor(field.top - bounds.top - gap - margin);
  if (natural <= below || below >= above) return { up: false, room: Math.max(0, below) };
  return { up: true, room: Math.max(0, above) };
}

// The area a list opened inside `el` must stay in: the window, less whatever clips el (a panel, a dialog, the top bar).
function dropBounds(el) {
  let top = 0;
  let bottom = window.innerHeight;
  for (let box = el?.parentElement; box && box !== document.body; box = box.parentElement) {
    if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(box).overflowY)) continue;
    const r = box.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  return { top, bottom };
}

// { up, room } for the list `pop` under `field` while `open`: measured on opening, on resize and when the page under it
// scrolls (not the list's own scroll). full(pop): the list's full content height.
export function useDropPlace(field, pop, open, full = (el) => el.scrollHeight) {
  const [place, setPlace] = useState({ up: false, room: null });
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      if (!field.current || !pop.current) return;
      const next = placeDrop(field.current.getBoundingClientRect(), dropBounds(field.current), full(pop.current));
      setPlace((old) => (old.up === next.up && old.room === next.room ? old : next));
    };
    const scrolled = (event) => {
      if (!pop.current?.contains(event.target)) measure();
    };
    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', scrolled, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', scrolled, { capture: true });
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- measured once per opening (and on resize)
  return open ? place : { up: false, room: null };
}
