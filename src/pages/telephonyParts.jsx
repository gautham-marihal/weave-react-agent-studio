import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sentenceCase } from '../ui/text.js';
import { Glyph } from './shared.jsx';
import Icon from '../ui/Icon.jsx';
import { askConfirm } from '../ui/dialogs.js';
import Button from '../ui/Button.tsx';

// What the Telephony pages share: a table with search, column choice and row actions, and a dialog frame with fields.

// Table with working search, a choice of visible columns, row deletion and an empty state.
export function TelephonyTablePanel({
  title,
  columns,
  rows = [],
  compact = false,
  emptyIcon = 'records',
  emptyTitle = 'Nothing here yet',
  emptyText = '',
  emptyAction = null,
  onDelete,
  onEdit,
  onRowClick,
  itemLabel = 'item',
  deleteLabel = 'Delete',
  confirmDelete = null,
  defaultHidden = [],
  monoFirst = true,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Columns listed in defaultHidden start hidden; they stay one click away in the columns menu.
  const [hidden, setHidden] = useState(() => defaultHidden.map((name) => columns.indexOf(name)).filter((index) => index >= 0));
  const toolsRef = useRef(null);

  useEffect(() => {
    if (!columnsOpen) return undefined;
    const onDown = (event) => {
      if (!toolsRef.current?.contains(event.target)) setColumnsOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setColumnsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [columnsOpen]);

  const visibleIndexes = columns.map((_, index) => index).filter((index) => !hidden.includes(index));
  const needle = query.trim().toLowerCase();
  const filtered = needle ? rows.filter((row) => (row.searchText ?? row.cells.join(' ')).toLowerCase().includes(needle)) : rows;
  const hasActions = !!(onDelete || onEdit);
  const colSpan = visibleIndexes.length + (hasActions ? 1 : 0);

  const toggleColumn = (index) =>
    setHidden((current) => {
      if (current.includes(index)) return current.filter((value) => value !== index);
      if (columns.length - current.length <= 1) return current; // always keep one column visible
      return [...current, index];
    });

  return (
    <section className={`telephonyTablePanel ${compact ? 'compactTablePanel' : ''}`}>
      <div className="telephonyTableHeader">
        <div className="telephonyTableTitle">
          <h2>{title}</h2>
          <span className="tableCount">{needle ? `${filtered.length} of ${rows.length}` : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`}</span>
        </div>
        <div className="tableTools" ref={toolsRef}>
          {searchOpen && (
            <input
              className="tableSearchInput"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  setSearchOpen(false);
                }
              }}
              placeholder={`Search ${title.toLowerCase()}`}
              aria-label={`Search ${title.toLowerCase()}`}
            />
          )}
          <Button
            type="button"
            className={`iconOnly ${searchOpen ? 'isActive' : ''}`}
            aria-label={searchOpen ? 'Close search' : `Search ${title.toLowerCase()}`}
            aria-pressed={searchOpen}
            title="Search"
            onClick={() => {
              setSearchOpen((value) => !value);
              if (searchOpen) setQuery('');
              setColumnsOpen(false);
            }}
          >
            <Icon name="search" size={15} />
          </Button>
          <Button
            type="button"
            className={`iconOnly ${columnsOpen ? 'isActive' : ''}`}
            aria-label="Choose columns"
            aria-expanded={columnsOpen}
            title="Columns"
            onClick={() => setColumnsOpen((value) => !value)}
          >
            <Icon name="sliders" size={15} />
          </Button>
          {columnsOpen && (
            <div className="tableColumnsMenu" role="dialog" aria-label="Visible columns">
              <div className="tableColumnsTitle">Visible columns</div>
              {columns.map((column, index) => (
                <label key={column}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(index)}
                    disabled={!hidden.includes(index) && columns.length - hidden.length <= 1}
                    onChange={() => toggleColumn(index)}
                  />
                  <span>{column.charAt(0) + column.slice(1).toLowerCase()}</span>
                </label>
              ))}
              {hidden.length > 0 && (
                <button type="button" className="tableColumnsReset" onClick={() => setHidden([])}>
                  Show all columns
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="telephonyTableWrap">
        <table className="telephonyTable">
          <thead>
            <tr>
              {visibleIndexes.map((index) => (
                <th key={columns[index]}>{sentenceCase(columns[index])}</th>
              ))}
              {hasActions && (
                <th className="actionsCol">
                  <span className="srOnly">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className={onRowClick ? 'isClickable' : ''}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row.id) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter') onRowClick(row.id);
                      }
                    : undefined
                }
              >
                {visibleIndexes.map((index) => (
                  <td key={columns[index]} className={index === 0 && monoFirst ? 'monoCell' : index === 0 ? 'primaryCell' : ''}>
                    {row.cells[index]}
                  </td>
                ))}
                {hasActions && (
                  <td className="actionsCol" onClick={(event) => event.stopPropagation()}>
                    {row.readOnly && <span className="telephonyReadOnly">Read-only</span>}
                    {onEdit && !row.readOnly && (
                      <button type="button" className="tableRowEdit" onClick={() => onEdit(row.id)}>
                        Edit
                      </button>
                    )}
                    {onDelete && !row.readOnly && (
                      <button
                        type="button"
                        className="tableRowDelete"
                        onClick={async () => {
                          const words = confirmDelete ? confirmDelete(row) : 'This can’t be undone.';
                          const ok = await askConfirm({
                            title: `${deleteLabel} this ${itemLabel}?`,
                            ...(typeof words === 'string' ? { body: words } : words),
                            confirmLabel: deleteLabel,
                            tone: 'danger',
                          });
                          if (ok) onDelete(row.id);
                        }}
                      >
                        {deleteLabel}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={colSpan}>
                  <div className="telephonyNoResults">
                    <span className="telephonyNoResultsIcon" aria-hidden="true">
                      <Glyph icon={needle ? 'search' : emptyIcon} size={20} />
                    </span>
                    <strong>{needle ? `No matches for “${query.trim()}”` : emptyTitle}</strong>
                    {needle ? <span>Try a different search, or clear it to see everything.</span> : emptyText && <span>{emptyText}</span>}
                    {!needle && emptyAction && (
                      <Button type="button" variant="secondary" className="compactSecondary" onClick={emptyAction.onClick}>
                        {emptyAction.label}
                      </Button>
                    )}
                    {needle && (
                      <Button type="button" variant="secondary" className="compactSecondary" onClick={() => setQuery('')}>
                        Clear search
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Shared shell for the telephony create dialogs (Escape closes, click outside closes).
export function TelephonyDialog({ eyebrow, title, subtitle, onClose, children, footer, onSubmit, live = false }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="createOverlay telephonyDialogOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="telephony-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="createModal telephonyDialog"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="createModalHeader">
          <div>
            <span className="createEyebrow">{sentenceCase(eyebrow)}</span>
            <h2 id="telephony-dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="modalClose" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {!live && (
          <p className="telephonyPreview inDialog" role="note">
            <b>Preview</b>
            <span>Saved in this browser only. Nothing real is created or routed.</span>
          </p>
        )}
        <div className="telephonyDialogBody">{children}</div>
        <div className="createModalFooter">{footer}</div>
      </form>
    </div>,
    document.body,
  );
}

export function DialogField({ label, hint, error, children }) {
  return (
    <label className={`telephonyField ${error ? 'hasError' : ''}`}>
      <span className="telephonyFieldLabel">{label}</span>
      {children}
      {error ? <em className="telephonyFieldError">{error}</em> : hint && <small className="telephonyFieldHint">{hint}</small>}
    </label>
  );
}
