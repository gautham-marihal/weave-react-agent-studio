import { useEffect, useState } from 'react';

// How much of the top of the window the studio's pinned bars cover: the workspace top bar (.dashTopbar) and the agent's
// header with its stage tabs (.nlHead), both `position: sticky`. A panel that must fit the window (the banking
// conversation) sizes itself to what is left below them, instead of a fixed height that the bars partly cover.
// Measured, not assumed: the bars' heights change with the look (56 or 72 px), the window width and wrapping tabs.

const PINNED = '.dashTopbar, .nlHead';

function measure(): number {
  let bottom = 0;
  document.querySelectorAll<HTMLElement>(PINNED).forEach((el) => {
    const style = getComputedStyle(el);
    if (style.position !== 'sticky' && style.position !== 'fixed') return;
    // where it sits once pinned: its `top` plus its height
    const top = Number.parseFloat(style.top) || 0;
    bottom = Math.max(bottom, top + el.getBoundingClientRect().height);
  });
  return Math.round(bottom);
}

export function useStickyTop(): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const update = () => setTop(measure());
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    document.querySelectorAll<HTMLElement>(PINNED).forEach((el) => observer?.observe(el));
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return top;
}
