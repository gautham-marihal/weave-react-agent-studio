import { DropdownMenu } from 'radix-ui';
import { afterMenu, keepEscape } from './layer.ts';

// A button with a short list of choices (Radix DropdownMenu): "Snooze ▸ for an hour…", "Dismiss ▸ why". Arrows move,
// a letter jumps to a choice, Escape closes it and returns focus to the button.
//   menuLabel: what the list is, for a screen reader
//   choices: [words, what it does]   align: the list's edge under the button
export default function ChoiceMenu({
  label,
  menuLabel,
  choices,
  align = 'start',
  buttonClassName = 'quietButton',
  menuClassName = 'inSnoozeMenu',
}: {
  label: string;
  menuLabel: string;
  choices: [string, () => void][];
  align?: 'start' | 'end';
  buttonClassName?: string;
  menuClassName?: string;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={buttonClassName}>
          {label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`${menuClassName} rxLayer`}
          aria-label={menuLabel}
          align={align}
          sideOffset={4}
          collisionPadding={12}
          onEscapeKeyDown={keepEscape}
        >
          {choices.map(([words, pick]) => (
            <DropdownMenu.Item key={words} asChild onSelect={afterMenu(pick)}>
              <button type="button">{words}</button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
