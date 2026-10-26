import React, { useRef } from 'react';
import { useDialogFocus } from './useDialogFocus.js';

// A dialog's box that keeps the keyboard (useDialogFocus): the focus moves in when it opens, Tab goes round its controls, and closing it puts the
// focus back on what opened it. as: the element it is ('section' unless said); initial: what gets the focus first (the box itself unless said).
export default function FocusBox({ as: Tag = 'section', initial, ...props }) {
  const ref = useRef(null);
  useDialogFocus(ref, initial);
  // tabIndex: the box itself can hold the focus when nothing in it is chosen first (it shows no ring for it, saas.css)
  return <Tag ref={ref} tabIndex={-1} data-focus-box="" {...props} />;
}
