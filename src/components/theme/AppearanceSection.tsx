import React from 'react';
import { StyleCards } from './StyleCards';
import { AccentPicker } from './AccentPicker';

// Settings › Appearance: the design style as cards, then the colours of the style in use.
export function AppearanceSection() {
  return (
    <section aria-labelledby="appearance" className="mt-8 border-b border-line pb-8">
      <h2 id="appearance" className="text-sm font-semibold text-ink">Appearance</h2>
      <p className="mt-1 text-[13px] text-muted">
        Choose a design style and its colour. Each style has a light and a dark look and keeps its own colour. Kept in this browser.
      </p>
      <div className="mt-4 space-y-5">
        <StyleCards />
        <AccentPicker />
      </div>
    </section>
  );
}
