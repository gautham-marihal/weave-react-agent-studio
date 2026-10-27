import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import { cx } from './look.js';

// An icon in its own colour (look.js HUES), alone or on a soft tile (`tile`). Decorative only: the words beside it
// name it.
export default function HueIcon({ name, hue, size = 15, tile = false }) {
  return (
    <span className={cx('hueIcon', tile && 'tile')} data-hue={hue} aria-hidden="true">
      <Icon name={name} size={size} />
    </span>
  );
}
