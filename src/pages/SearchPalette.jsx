import { useCallback, useRef, useState } from 'react';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { Command } from 'cmdk';
import Icon from '../ui/Icon.jsx';
import { backTo, keepEscape } from '../ui/layer.ts';
import { Glyph, searchKey } from './shared.jsx';

// The search (Ctrl K): grouped results, best match first (the opening page decides matches, see ui/match.ts).
// cmdk gives palette keys and screen-reader roles; a Radix Dialog traps focus, closes on Escape or an outside click
// (and nothing under it), and gives focus back. cmdk loads on first open.
//   groups: [{ group, items: [{ type, id, title, description, icon }] }]
export default function SearchOverlay({ query, onQueryChange, groups, onSelect, onClose }) {
  const inputRef = useRef(null);
  // what had focus when the search opened, to give it back to
  const [opener] = useState(() => document.activeElement);
  // cmdk tells a screen reader which result the keyboard is on (aria-activedescendant) only once the arrows have moved:
  // the box says it from the start, following the result marked as selected
  const watchList = useCallback((list) => {
    if (!list) return undefined;
    const say = () => {
      const on = list.querySelector('[cmdk-item][aria-selected="true"]');
      if (on?.id) inputRef.current?.setAttribute('aria-activedescendant', on.id);
      else inputRef.current?.removeAttribute('aria-activedescendant');
    };
    say();
    const watch = new MutationObserver(say);
    watch.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
    return () => watch.disconnect();
  }, []);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className="searchOverlay">
          <Dialog.Content
            className="searchPanel"
            aria-describedby={undefined}
            onEscapeKeyDown={keepEscape}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
            onCloseAutoFocus={backTo(opener)}
          >
            <VisuallyHidden.Root asChild>
              <Dialog.Title>Search Weave</Dialog.Title>
            </VisuallyHidden.Root>
            <Command label="Search Weave" shouldFilter={false} loop vimBindings={false}>
              <div className="searchHeader">
                <div className="searchFieldWrap">
                  <Icon name="search" size={18} />
                  <Command.Input
                    ref={inputRef}
                    value={query}
                    onValueChange={(value) => onQueryChange?.(value)}
                    placeholder="Search workspaces, agents, or pages…"
                    aria-label="Search workspaces, agents, or pages"
                  />
                  <button type="button" className="searchEsc" onClick={onClose}>
                    Esc
                  </button>
                </div>
              </div>
              <Command.List ref={watchList} className="searchResults" label="Results">
                <Command.Empty className="searchNoResults">
                  <div className="searchNoIcon" aria-hidden="true">
                    <Icon name="search" size={22} />
                  </div>
                  <strong>No matches for “{query.trim()}”</strong>
                  <p>Search by agent name, workspace name, or a page such as Calls.</p>
                </Command.Empty>
                {groups.map((group) => (
                  <Command.Group key={group.group} heading={group.group} className="searchGroup">
                    {group.items.map((item) => (
                      <Command.Item
                        key={`${group.key || ''}${searchKey(item)}`}
                        value={`${group.key || ''}${searchKey(item)}`}
                        className="searchResult"
                        onSelect={() => onSelect?.(item)}
                      >
                        <span className="searchResultIcon" aria-hidden="true">
                          <Glyph icon={item.icon} size={16} />
                        </span>
                        <span className="searchResultText">
                          <strong>{item.title}</strong>
                          <small>{item.description}</small>
                        </span>
                        <span className="searchResultArrow" aria-hidden="true">
                          <Icon name="enter" size={14} />
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
            <div className="searchFooter">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> Navigate
              </span>
              <span>
                <kbd>Enter</kbd> Open
              </span>
              <span>
                <kbd>Esc</kbd> Close
              </span>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
