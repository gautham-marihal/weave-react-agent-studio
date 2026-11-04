import { useEffect, useRef, type RefObject } from 'react';
import { animate, stagger } from 'motion';

// The studio's movement, in one place (Motion's animate on the elements that are already there, so nothing is added to
// the page and no state is lost). Opening keeps the CSS entrances each panel already has; Motion adds what CSS can't do:
// a matching exit before a panel goes, pages whose blocks settle in one after another, a fade when a part changes, and
// cards that settle in on first load.
// Nothing moves for people who ask for less motion, in a tab that is hidden, or where the browser can't say (the tests).

export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];

/** Whether to move at all: not for reduced motion, a hidden tab, or a page without matchMedia (jsdom). */
export function canAnimate(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// inline styles Motion leaves behind are taken off, so the element is styled by its CSS alone again
const clear = (els: HTMLElement[], props: string[]) => {
  for (const el of els) for (const prop of props) el.style.removeProperty(prop);
};
// after an animation: Motion writes its end values just after it says it has finished, so they come off a frame later
const clearAfter = (els: HTMLElement[], props: string[]) => () => {
  requestAnimationFrame(() => clear(els, props));
};

/** A page or a part that has just changed fades in. Opacity only: moving it would shift anything fixed inside it. */
export function fadeIn(el: HTMLElement | null | undefined): void {
  if (!el || !canAnimate()) return;
  const done = clearAfter([el], ['opacity']);
  animate(el, { opacity: [0, 1] }, { duration: 0.18, ease: EASE_OUT }).then(done, done);
}

/** Fades `ref`'s element in whenever `key` changes (a new page, stage or part), never on its first showing. */
export function useFadeOnChange(ref: RefObject<HTMLElement | null>, key: string): void {
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    fadeIn(ref.current);
  }, [ref, key]);
}

/**
 * A page that has just opened settles in: its blocks (title, notices, tiles, sections) fade in one after another. The
 * blocks are the first level with more than one child, so a page wrapped in a single element is looked into. Opacity
 * only, like fadeIn: moving a block shifts anything fixed or sticky inside it, and a click meanwhile can scroll the
 * page by the wrong amount (e2e/a11y.mjs caught Build's "Checks pass" chip ending up under the sticky bar).
 */
export function settleIn(el: HTMLElement | null | undefined): void {
  if (!el || !canAnimate()) return;
  let blocks = [...el.children];
  for (let depth = 0; blocks.length === 1 && depth < 3; depth += 1) blocks = [...blocks[0].children];
  const list = blocks.filter((block): block is HTMLElement => block instanceof HTMLElement && block.offsetHeight > 0).slice(0, 10);
  list.forEach((block, i) => {
    const done = clearAfter([block], ['opacity']);
    block.style.opacity = '0'; // hidden while it waits for its turn
    animate(block, { opacity: [0, 1] }, { duration: 0.32, ease: EASE_OUT, delay: i * 0.045 }).then(done, done);
  });
}

/** `ref`'s page settles in (settleIn) whenever `key` changes (a new page or stage), never on its first showing. */
export function useSettleOnChange(ref: RefObject<HTMLElement | null>, key: string): void {
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    settleIn(ref.current);
  }, [ref, key]);
}

// <details> the person opened themselves (by its summary): only those fade, not ones open from the start or opened by code
const openedByHand = new WeakSet<Element>();
let watchingDetails = false;

/**
 * Whatever a <details> holds fades in when someone opens it, anywhere in the studio (one listener for all of them, so no
 * section has to ask). Its summary, already in view, stays as it is.
 */
export function useDetailsMotion(): void {
  useEffect(() => {
    if (watchingDetails || typeof document === 'undefined') return undefined;
    watchingDetails = true;
    const pressed = (event: Event) => {
      const summary = (event.target as Element | null)?.closest?.('summary');
      const box = summary?.parentElement;
      if (box?.tagName === 'DETAILS' && !(box as HTMLDetailsElement).open) openedByHand.add(box);
    };
    // toggle doesn't bubble: it is heard on its way down
    const toggled = (event: Event) => {
      const box = event.target as HTMLDetailsElement;
      if (box?.tagName !== 'DETAILS' || !openedByHand.has(box)) return;
      openedByHand.delete(box);
      if (!box.open) return;
      // a section may only render what it holds once open (React, just after this event): wait for that, before the paint
      requestAnimationFrame(() => [...box.children].forEach((child) => child.tagName !== 'SUMMARY' && fadeIn(child as HTMLElement)));
    };
    document.addEventListener('click', pressed, true);
    document.addEventListener('toggle', toggled, true);
    return () => {
      watchingDetails = false;
      document.removeEventListener('click', pressed, true);
      document.removeEventListener('toggle', toggled, true);
    };
  }, []);
}

/** Cards that settle into place one after another, the first time a list is shown. */
export function riseIn(els: Iterable<Element> | null | undefined): void {
  const list = [...(els || [])].filter((el): el is HTMLElement => el instanceof HTMLElement);
  if (!list.length || !canAnimate()) return;
  // at most the first dozen take part: further down the list nobody is watching yet, and a long wait looks broken
  const moving = list.slice(0, 12);
  const done = clearAfter(moving, ['opacity', 'transform']);
  animate(moving, { opacity: [0, 1], y: [8, 0] }, { duration: 0.28, ease: EASE_OUT, delay: stagger(0.035) }).then(done, done);
}

/** `ref`'s children settle in (riseIn), once: the first time `ready` is true, as a list first shows its items. */
export function useRiseInOnce(ref: RefObject<HTMLElement | null>, ready: boolean): void {
  const played = useRef(false);
  useEffect(() => {
    if (played.current || !ready || !ref.current) return;
    played.current = true;
    riseIn(ref.current.children);
  }, [ref, ready]);
}

type Exit = { panel?: Element | null; shade?: Element | null; from?: 'right' | 'below' };

// panels already on their way out, so a second Escape or click while one is leaving does nothing more
const leaving = new WeakSet<Element>();

/**
 * Plays a panel's exit, then runs `then` (which takes it off the page). The panel slides back the way it came in
 * (`right` for side panels, `below` for dialogs) and its shade fades. Without animation `then` runs at once.
 */
export function exitThen({ panel, shade, from = 'right' }: Exit, then: () => void): void {
  const target = panel || shade;
  if (target && leaving.has(target)) return;
  const parts = [panel, shade].filter((el): el is HTMLElement => el instanceof HTMLElement);
  if (!parts.length || !canAnimate()) {
    then();
    return;
  }
  leaving.add(target as Element);
  // nothing in a leaving panel takes a click
  for (const el of parts) el.style.pointerEvents = 'none';
  const moves: Promise<void>[] = [];
  // a Motion animation's end, as a promise (it ends either way: finished, or stopped)
  const ended = (controls: { then: (done: () => void, failed?: () => void) => unknown }) =>
    new Promise<void>((resolve) => {
      controls.then(resolve, resolve);
    });
  if (panel instanceof HTMLElement) {
    const away = from === 'right' ? { x: [0, 24] } : { y: [0, 6], scale: [1, 0.98] };
    moves.push(ended(animate(panel, { opacity: [1, 0], ...away }, { duration: 0.14, ease: EASE_IN })));
  }
  if (shade instanceof HTMLElement && shade !== panel) moves.push(ended(animate(shade, { opacity: [1, 0] }, { duration: 0.14, ease: EASE_IN })));
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    leaving.delete(target as Element);
    // a panel its screen has already taken away (the person moved on to another page meanwhile) is closed: closing it
    // again now would undo what they did since, such as the page they went to
    if (!parts.some((el) => el.isConnected)) return;
    then();
    // a screen that keeps its panel after all (it asks first, or refuses) gets it back as it was; the wait is long
    // enough for a slow page to finish taking it off, so a closing panel never flashes back
    setTimeout(() => {
      if (parts.some((el) => el.isConnected)) clear(parts, ['opacity', 'transform', 'pointer-events']);
    }, 250);
  };
  Promise.all(moves).then(finish, finish);
  // whatever happens to the animation, the panel still closes
  setTimeout(finish, 400);
}
