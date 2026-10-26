import { Children, isValidElement, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Select as RadixSelect } from 'radix-ui';
import Icon from './Icon.jsx';
import { keepEscape } from './layer.ts';

// A drop-in for the browser's <select> (Radix Select): the same <option> and <optgroup> children, the same `value` and
// `onChange(event)` (event.target.value is the chosen value), so a page swaps <select> for <Select> and nothing else
// changes. What changes is the list: it looks like the rest of the studio in every style and mode (the browser's own
// list looks like the operating system), opens under the box on the side with room, shows a choice's description on a
// second line, and takes the keyboard: arrows, a letter to jump, Enter to pick, Escape to close.
//   An option whose value is '' (an "Any …" choice) is kept: Radix needs a value for each, so '' stands in as EMPTY between here and Radix.

const EMPTY = '\u0000empty';
const toRadix = (value: string) => (value === '' ? EMPTY : value);
const fromRadix = (value: string) => (value === EMPTY ? '' : value);

type Choice = { value: string; label: ReactNode; text: string; description?: string; disabled: boolean };
type Group = { label: string; choices: Choice[] };

const textOf = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : isValidElement(node)
        ? textOf((node.props as { children?: ReactNode }).children)
        : '';

function choicesOf(children: ReactNode): Group[] {
  const groups: Group[] = [{ label: '', choices: [] }];
  const add = (option: ReactElement, into: Group) => {
    const props = option.props as { value?: unknown; children?: ReactNode; disabled?: boolean; 'data-description'?: string };
    const text = textOf(props.children);
    into.choices.push({
      value: props.value === undefined ? text : String(props.value),
      label: props.children,
      text,
      description: props['data-description'],
      disabled: !!props.disabled,
    });
  };
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'optgroup') {
      const props = child.props as { label?: string; children?: ReactNode };
      const group: Group = { label: props.label || '', choices: [] };
      Children.forEach(props.children, (option) => {
        if (isValidElement(option) && option.type === 'option') add(option, group);
      });
      groups.push(group);
    } else if (child.type === 'option') add(child, groups[0]);
  });
  return groups.filter((g) => g.choices.length);
}

type Props = {
  value?: string | number | null;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
  children: ReactNode;
  id?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  name?: string;
  required?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-describedby'?: string;
};

export default function Select({ value, defaultValue, onChange, children, id, className = '', disabled, title, name, required, ...aria }: Props) {
  const groups = useMemo(() => choicesOf(children), [children]);
  const all = groups.flatMap((g) => g.choices);
  const controlled = value !== undefined && value !== null;
  const current = controlled ? String(value) : undefined;
  // a value no option has (an old one, or none chosen and no "" option): the box shows the first option's words, as the browser's <select> does
  const shown = current !== undefined && all.some((c) => c.value === current) ? current : current !== undefined ? (all[0]?.value ?? '') : undefined;
  return (
    <RadixSelect.Root
      value={shown !== undefined ? toRadix(shown) : undefined}
      defaultValue={defaultValue !== undefined ? toRadix(String(defaultValue)) : undefined}
      onValueChange={(next) => {
        const chosen = fromRadix(next);
        onChange?.({ target: { value: chosen }, currentTarget: { value: chosen } });
      }}
      disabled={disabled}
      name={name}
      required={required}
    >
      {/* the button carries the chosen value too (button.value), as the browser's <select> does: a test, or a script, reads it the same way */}
      <RadixSelect.Trigger id={id} className={`rxSelect ${className}`} title={title} value={shown ?? ''} {...aria}>
        <RadixSelect.Value />
        <RadixSelect.Icon className="rxSelectIcon">
          <Icon name="chevronDown" size={14} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="rxSelectList rxLayer" position="popper" sideOffset={4} collisionPadding={12} onEscapeKeyDown={keepEscape}>
          <RadixSelect.Viewport className="rxSelectViewport">
            {groups.map((group, index) => {
              const items = group.choices.map((choice) => (
                <RadixSelect.Item
                  key={choice.value}
                  value={toRadix(choice.value)}
                  disabled={choice.disabled}
                  textValue={choice.text}
                  className="rxSelectItem"
                  data-value={choice.value}
                >
                  <RadixSelect.ItemText>{choice.label}</RadixSelect.ItemText>
                  {choice.description && <small>{choice.description}</small>}
                  <RadixSelect.ItemIndicator className="rxSelectCheck">
                    <Icon name="check" size={14} />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ));
              return group.label ? (
                <RadixSelect.Group key={group.label}>
                  <RadixSelect.Label className="rxSelectGroup">{group.label}</RadixSelect.Label>
                  {items}
                </RadixSelect.Group>
              ) : (
                <RadixSelect.Group key={`g${index}`}>{items}</RadixSelect.Group>
              );
            })}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
