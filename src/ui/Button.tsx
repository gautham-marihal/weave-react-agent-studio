import type { ComponentProps } from 'react';

// The studio's button: the look is chosen by name instead of class strings; every other prop goes to the <button>.
// `type` is passed through as given (a button without one submits its form, as before).

type Variant = 'primary' | 'secondary' | 'quiet';
type Size = 'compact' | 'small';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = { primary: 'primaryCta', secondary: 'secondaryCta', quiet: 'quietButton' };
const SIZES: Record<Size, string> = { compact: 'compactCta', small: 'small' };

export default function Button({ variant = 'quiet', size, className, ...rest }: ButtonProps) {
  return <button className={[VARIANTS[variant], size && SIZES[size], className].filter(Boolean).join(' ')} {...rest} />;
}
