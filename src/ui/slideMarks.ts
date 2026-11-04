import { useEffect } from 'react';
import type { RefObject } from 'react';
import { canAnimate } from './motion';

// The chosen item's highlight slides to the newly chosen one, in every row of tabs, switch and side list, instead of
// jumping. Nothing in those components changes: this watches them from outside.
//
// How: when a group's chosen item changes, the group draws a copy of the chosen look (its background, shadow,
// border and corners, read from the page as the style draws it) on its ::after, first over the old item, then moves it
// over the new one. Meanwhile the new item's own look is held back; once the copy arrives the item shows its own look
// again and the copy hides. So at rest every style looks exactly as it did, and only the move is new.
// The copy sits behind the group's contents (isolation + z-index -1), so it never covers a label.

// the rows that slide; a group's chosen item is the nearest one inside it marked chosen in any of the usual ways
const GROUPS = [
  '.segmented',
  '.nlParts',
  '.pvModes',
  '.clViews',
  '.settingsSeg',
  '.stTChannels',
  '.wfTabs',
  '.inTabs',
  '.stFSeg',
  '.filterPills',
  'nav[aria-label="Agent stages"]',
  'nav[aria-label="Build"] > ul',
  '.sideNav',
].join(', ');
const CHOSEN = '[aria-pressed="true"], [aria-current="page"], [aria-selected="true"], [data-state="on"], .on, .selected';
// what an item's look is made of, copied onto the moving highlight
const LOOK: [string, string][] = [
  ['--sl-bg', 'backgroundColor'],
  ['--sl-img', 'backgroundImage'],
  ['--sl-shadow', 'boxShadow'],
  ['--sl-radius', 'borderRadius'],
  ['--sl-border', 'borderTop'],
  ['--sl-border-b', 'borderBottom'],
];
const MOVE_MS = 260;

const chosenIn = (group: Element): HTMLElement | null => {
  for (const item of group.querySelectorAll<HTMLElement>(CHOSEN)) {
    if (item.closest(GROUPS) === group && item.offsetWidth) return item;
  }
  return null;
};

// where an item sits inside its group, in the group's own coordinates (scrolling included)
const placeOf = (group: HTMLElement, item: HTMLElement) => {
  const g = group.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  return { x: r.left - g.left + group.scrollLeft - group.clientLeft, y: r.top - g.top + group.scrollTop - group.clientTop, w: r.width, h: r.height };
};

const place = (group: HTMLElement, at: { x: number; y: number; w: number; h: number }) => {
  group.style.setProperty('--sl-x', `${at.x}px`);
  group.style.setProperty('--sl-y', `${at.y}px`);
  group.style.setProperty('--sl-w', `${at.w}px`);
  group.style.setProperty('--sl-h', `${at.h}px`);
};

const chosenBefore = new WeakMap<Element, HTMLElement>();
// each group's chosen look, read while it rests and isn't under the pointer (hovering a chosen item can change it)
const chosenLook = new WeakMap<Element, string[]>();
const readLook = (item: HTMLElement) => {
  const look = getComputedStyle(item);
  return LOOK.map(([, prop]) => look[prop as keyof CSSStyleDeclaration] as string);
};
const settling = new WeakMap<Element, { timer: number; item: HTMLElement; transition: string }>();

function settle(group: HTMLElement) {
  const moving = settling.get(group);
  if (!moving) return;
  window.clearTimeout(moving.timer);
  const { item, transition } = moving;
  delete item.dataset.slideHold;
  group.dataset.slide = 'rest';
  settling.delete(group);
  // the item shows its own look at once (no fade, so it meets the copy exactly), then gets its transitions back
  requestAnimationFrame(() => {
    if (!item.dataset.slideHold) item.style.transition = transition;
  });
}

function slide(group: HTMLElement, from: HTMLElement, to: HTMLElement) {
  settle(group);
  // the new item's own transitions wait until the copy has arrived, so it doesn't fade in under it
  const transition = to.style.transition;
  to.style.transition = 'none';
  const look = chosenLook.get(group) || readLook(to);
  LOOK.forEach(([name], i) => group.style.setProperty(name, look[i]));
  place(group, placeOf(group, from));
  group.dataset.slide = 'start';
  to.dataset.slideHold = '';
  group.getBoundingClientRect(); // the copy is drawn over the old item before it starts to move
  group.dataset.slide = 'move';
  place(group, placeOf(group, to));
  settling.set(group, { item: to, transition, timer: window.setTimeout(() => settle(group), MOVE_MS) });
}

function check(root: HTMLElement) {
  for (const group of root.querySelectorAll<HTMLElement>(GROUPS)) {
    const now = chosenIn(group);
    const before = chosenBefore.get(group);
    if (!now) continue;
    chosenBefore.set(group, now);
    if ((!before || now === before) && !settling.has(group) && !now.matches(':hover')) chosenLook.set(group, readLook(now));
    if (!group.dataset.slide) {
      group.dataset.slide = 'rest';
      // the copy is placed inside the group; a group already placed (sticky, say) keeps its own position
      if (getComputedStyle(group).position === 'static') group.dataset.slidePos = '';
    }
    if (before && before !== now && before.isConnected && canAnimate()) slide(group, before, now);
  }
}

/** Slides the chosen item's highlight in every tab row, switch and side list under `root` (the studio's shell). */
export function useSlidingMarks(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof MutationObserver === 'undefined') return undefined;
    let frame = 0;
    const later = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), check(el)));
    };
    // only changes inside a group matter: typing elsewhere costs nothing beyond this test
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest(GROUPS) || (record.type === 'childList' && record.addedNodes.length)) return later();
      }
      return undefined;
    });
    observer.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-current', 'aria-selected', 'data-state', 'class'],
    });
    check(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root]);
}
