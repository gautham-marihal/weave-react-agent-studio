import type { ComponentProps } from 'react';

// The studio's text boxes: one line (Input) or several (TextArea). Every other prop goes to the element.
// (form/fields.jsx has TextInput, a form field built on these that hands back the text instead of the event.)

interface FieldLook {
  size?: 'small';
  /** monospaced, for ids, numbers and code */
  mono?: boolean;
}

const look = ({ size, mono }: FieldLook, className?: string) => ['stFInput', size, mono && 'mono', className].filter(Boolean).join(' ');

export function Input({ size, mono, className, ...rest }: FieldLook & Omit<ComponentProps<'input'>, 'size'>) {
  return <input className={look({ size, mono }, className)} {...rest} />;
}

export function TextArea({ size, mono, className, ...rest }: FieldLook & ComponentProps<'textarea'>) {
  return <textarea className={look({ size, mono }, className)} {...rest} />;
}
