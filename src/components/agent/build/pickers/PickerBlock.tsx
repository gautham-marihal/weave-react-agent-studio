import React from 'react';
import { fieldId } from '../../../../utils/path';

/** One decision inside a picker panel: a heading, a sentence about it, and its controls. `path` is the setting it writes. */
export function PickerBlock({ title, text, path, children }: { title: string; text?: string; path?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} id={path ? `${fieldId(path)}-panel` : undefined}>
      <h3 className="text-sm font-semibold text-ink" title={path}>
        {title}
      </h3>
      {text && <p className="mb-3 mt-0.5 text-[13px] leading-relaxed text-muted">{text}</p>}
      {children}
    </section>);

}
