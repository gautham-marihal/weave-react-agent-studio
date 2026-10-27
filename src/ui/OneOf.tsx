import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { ToggleGroup } from 'radix-ui';

// A row of buttons with one chosen (Radix ToggleGroup): one Tab stop on the chosen one, arrows move (and wrap), Enter,
// Space or a click chooses, and pressing the chosen one keeps it. A screen reader hears a group and which is on.
//   <OneOf label value onChange className> around <Choice value>s; the chosen one also gets the class `on`
const Chosen = createContext<string>('');

export function OneOf({
  label,
  value,
  onChange,
  className = '',
  disabled = false,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className={className}
      aria-label={label}
      value={value}
      onValueChange={(next) => next && next !== value && onChange(next)}
      disabled={disabled}
      loop
    >
      <Chosen.Provider value={value}>{children}</Chosen.Provider>
    </ToggleGroup.Root>
  );
}

export function Choice({
  value,
  disabled,
  className = '',
  label,
  title,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  label?: string;
  title?: string;
  children: ReactNode;
}) {
  const chosen = useContext(Chosen) === value;
  return (
    <ToggleGroup.Item value={value} disabled={disabled} aria-label={label} title={title} className={`${className} ${chosen ? 'on' : ''}`.trim() || undefined}>
      {children}
    </ToggleGroup.Item>
  );
}
