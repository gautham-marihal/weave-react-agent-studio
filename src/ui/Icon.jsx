import React from 'react';

// One set of icons for the whole studio, drawn on a 24 by 24 grid with a round 1.75 px stroke in the text colour. Text symbols (⌂ ✦ ◫ ⌘) look different on
// every machine and mean nothing to a screen reader; these look the same everywhere, take the colour of what they sit in, and are hidden from assistive
// technology unless given a `label` (the button or link around an icon should carry the words).
import { PATHS } from './iconPaths.js';

export { ICON_NAMES } from './iconPaths.js';

export default function Icon({ name, size = 18, label, className = '' }) {
  const parts = PATHS[name] || PATHS.info;
  return (
    <svg className={`wIcon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} focusable="false">
      {parts.map((part) => {
        if (part.startsWith('circle:')) { const [cx, cy, r] = part.slice(7).split(' '); return <circle key={part} cx={cx} cy={cy} r={r} />; }
        return <path key={part} d={part} />;
      })}
    </svg>
  );
}
