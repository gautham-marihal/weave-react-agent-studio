import React, { useRef } from 'react';
import { useDialogFocus } from './useDialogFocus.js';

// A dialog box that keeps the keyboard (useDialogFocus): focus moves in, Tab cycles its controls, close returns focus.
//   as: the element ('section' unless given)   initial: what gets focus first (the box itself unless given)
export default function FocusBox({ as: Tag = 'section', initial, ...props }) {
  const ref = useRef(null);
  useDialogFocus(ref, initial);
  // tabIndex: the box itself can hold the focus when nothing in it is chosen first (it shows no ring for it, saas.css)
  return <Tag ref={ref} tabIndex={-1} data-focus-box="" {...props} />;
}
