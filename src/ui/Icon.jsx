import React from 'react';

// The studio's icons (Lucide, chosen by name in icons.js) in a round 1.75 px stroke of the text colour. Unlike text
// symbols they look the same everywhere; they are hidden from screen readers unless given a `label`.
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
