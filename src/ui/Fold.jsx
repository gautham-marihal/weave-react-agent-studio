import React, { useState } from 'react';

// A <details> that opens itself when `open` turns true (a problem inside) and is otherwise left as the person set it.
// A plain <details open={condition}> is shut by React when the condition turns false, even while someone types in it.
export default function Fold({ open = false, onToggle, children, ...rest }) {
  const [shown, setShown] = useState(!!open);
  const [asked, setAsked] = useState(!!open);
  if (!!open !== asked) {
    setAsked(!!open);
    if (open) setShown(true);
  }
  return (
    <details
      {...rest}
      open={shown}
      onToggle={(event) => {
        setShown(event.currentTarget.open);
        onToggle?.(event);
      }}
    >
      {children}
    </details>
  );
}
