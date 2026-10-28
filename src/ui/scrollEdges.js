// Scroll areas that show there is more: an area with content past an edge gets data-edges="top bottom" (and --edgeBar,
// its scrollbar width), and saas.css fades that edge so no line looks sliced. One app-wide watcher; pure DOM, no React.

// Areas that scroll inside a page, panel, dialog or menu: each an inner area with no frame (a fade would fade it too);
// a dialog or menu that scrolls as a whole scrolls an inner area instead. data-scroll-edges marks any other.
const SCROLL_AREAS = [
  '[data-scroll-edges]',
  '.dashboard > .sidebar > .sideNav',
  '.searchResults',
  '.stPickBody',
  '.stModalBody',
  '.infoDialogBody',
  '.styleMenuScroll',
  '[data-radix-menu-content]',
  '.stFSheetBody',
  '.nlDrawerBody',
  '.nlTestDockBody',
  '.wfInspectorBody',
  '.trList',
  '.pkList',
  '.stComboList',
  '.pkModelList',
].join(', ');

// "top", "bottom", "top bottom" or "": which edges of an area have content past them (a pixel of rounding is nothing)
export function edgesOf({ scrollTop, scrollHeight, clientHeight }) {
  const above = scrollTop > 1;
  const below = scrollHeight - clientHeight - scrollTop > 1;
  return [above && 'top', below && 'bottom'].filter(Boolean).join(' ');
}

function mark(el) {
  const edges = edgesOf(el);
  if (!edges) {
    if (el.hasAttribute('data-edges')) el.removeAttribute('data-edges');
    return;
  }
  if (el.getAttribute('data-edges') !== edges) el.setAttribute('data-edges', edges);
  // left out of the fade: the area's own top and bottom lines, and its scrollbar's strip (with the line beside it)
  const style = getComputedStyle(el);
  const px = (name) => parseFloat(style[name]) || 0;
  const keep = {
    '--edgeT': px('borderTopWidth'),
    '--edgeB': px('borderBottomWidth'),
    '--edgeBar': Math.max(0, el.offsetWidth - el.clientWidth - px('borderLeftWidth')),
  };
  for (const [name, value] of Object.entries(keep)) if (el.style.getPropertyValue(name) !== `${value}px`) el.style.setProperty(name, `${value}px`);
}

// Scrolls the item `selector` names (the open page, in a menu) into view inside the area, clear of a faded edge.
const EDGE_FADE = 28; // px, as the fade in saas.css
export function revealIn(area, selector) {
  const item = area?.querySelector(selector);
  if (!item) return;
  const box = area.getBoundingClientRect();
  const at = item.getBoundingClientRect();
  const clear = EDGE_FADE + 4;
  if (at.bottom > box.bottom - clear) area.scrollTop += at.bottom - (box.bottom - clear);
  else if (at.top < box.top + clear && area.scrollTop > 0) area.scrollTop -= box.top + clear - at.top;
}

// Starts watching the document's scroll areas; returns a function that stops it.
export function watchScrollEdges(doc = document) {
  const win = doc.defaultView;
  if (!win || !doc.body || typeof win.ResizeObserver !== 'function' || typeof win.MutationObserver !== 'function') return () => {};
  const known = new Set();
  const sizes = new win.ResizeObserver((entries) => entries.forEach((entry) => mark(entry.target)));
  let queued = false;
  const scan = () => {
    queued = false;
    for (const el of known) {
      if (el.isConnected) continue;
      sizes.unobserve(el);
      known.delete(el);
    }
    doc.querySelectorAll(SCROLL_AREAS).forEach((el) => {
      if (!known.has(el)) {
        known.add(el);
        sizes.observe(el);
      }
      mark(el);
    });
  };
  // content that comes, goes or changes look alters what an area holds without resizing it: checked again once a frame
  const later = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(scan);
  };
  const onScroll = (event) => {
    if (known.has(event.target)) mark(event.target);
  };
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  const changes = new win.MutationObserver(later);
  changes.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open', 'class', 'hidden'] });
  win.addEventListener('resize', later);
  scan();
  return () => {
    doc.removeEventListener('scroll', onScroll, { capture: true });
    changes.disconnect();
    sizes.disconnect();
    win.removeEventListener('resize', later);
    known.clear();
  };
}
