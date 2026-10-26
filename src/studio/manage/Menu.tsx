import { DropdownMenu } from 'radix-ui';
import Icon from '../../ui/Icon.jsx';
import { afterMenu, keepEscape } from '../../ui/layer.ts';
import Tip from '../../ui/Tip.tsx';

// A small "⋯" menu (Radix DropdownMenu). Drawn above everything and placed beside its button on the side with room, so a card with overflow:hidden
// never clips it. Keyboard: Enter, Space or ArrowDown opens it, the arrows move, a letter jumps to the item it starts, Escape closes it and gives the
// keyboard back to the button. An item that opens something (a dialog) does so once the menu has given the keyboard back.
//   icon: what the button shows ("more", the "⋯"; "chevronDown" for the second half of a split button, as "Open ▾" on the Agents list)

export type MenuItem =
  { divider: true; label?: never } | { label: string; onClick?: () => void; disabled?: boolean; hint?: string; danger?: boolean; divider?: false };

export default function Menu({
  label = 'More actions',
  items,
  className = '',
  icon = 'more',
}: {
  label?: string;
  items: MenuItem[];
  className?: string;
  icon?: string;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <Tip label={label} hoverOnly>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={`stMenuBtn ${className}`} aria-label={label} onClick={(event) => event.stopPropagation()}>
            <Icon name={icon} size={icon === 'more' ? 18 : 16} />
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="stMenu rxLayer" aria-label={label} align="end" sideOffset={6} collisionPadding={12} onEscapeKeyDown={keepEscape}>
          {items.map((item, index) =>
            item.divider ? (
              <DropdownMenu.Separator key={`d${index}`} asChild>
                <hr />
              </DropdownMenu.Separator>
            ) : (
              <DropdownMenu.Item
                key={item.label}
                asChild
                disabled={item.disabled}
                className={item.danger ? 'danger' : ''}
                onSelect={afterMenu(item.onClick)}
                title={item.disabled ? item.hint : undefined}
              >
                <button type="button">
                  <span>{item.label}</span>
                  {item.hint && !item.disabled && <small>{item.hint}</small>}
                </button>
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
