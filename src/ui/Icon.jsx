import React from 'react';

// One set of icons for the whole studio (Lucide's, chosen by name in icons.js), drawn with a round 1.75 px stroke in
// the text colour. Text symbols (⌂ ✦ ◫ ⌘) look different on every machine and mean nothing to a screen reader; these
// look the same everywhere, take the colour of what they sit in, and are hidden from assistive technology unless given
// a `label` (the button or link around an icon should carry the words).
import { ICONS } from './icons.js';

export { ICON_NAMES } from './icons.js';

// label: what the icon says to a screen reader when nothing beside it does (otherwise it is hidden from one)
/** @param {{ name: string, size?: number, label?: string, className?: string }} props */
export default function Icon({ name, size = 18, label, className = '' }) {
  const Shape = ICONS[name] || ICONS.info;
  return (
    <Shape
      className={`wIcon ${className}`}
      size={size}
      strokeWidth={1.75}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    />
  );
}
