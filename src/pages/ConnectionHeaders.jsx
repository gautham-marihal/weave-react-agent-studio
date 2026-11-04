import { useEffect, useRef } from 'react';
import Icon from '../ui/Icon.jsx';
import Button from '../ui/Button.tsx';
import { Switch } from '../studio/form/fields.jsx';

// The connection dialog's headers: a name and a value per row, sent with every call, and a switch for the one that is a
// key, whose value is then the name of a secret kept on the Agent Builder server (studio/connectionParts.js). Adding a
// row puts the cursor in its name; removing one moves it to the row that takes its place, or to "Add header" after the last.
//   rows: [{ name, value, secret }]; onChange(rows); problems: { [index]: words } (headerProblems)

export default function ConnectionHeaders({ rows, onChange, problems }) {
  const list = useRef(null);
  const addButton = useRef(null);
  // where the cursor goes after the rows change: a row's name box (by index), or the add button (-1)
  const focusNext = useRef(null);
  useEffect(() => {
    const at = focusNext.current;
    if (at === null) return;
    focusNext.current = null;
    const target = at < 0 ? addButton.current : list.current?.querySelectorAll('.chName')[at];
    target?.focus();
  }, [rows.length]);
  const secretAt = rows.findIndex((row) => row.secret);
  const change = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const add = () => {
    focusNext.current = rows.length;
    onChange([...rows, { name: '', value: '', secret: false }]);
  };
  const remove = (index) => {
    focusNext.current = index < rows.length - 1 ? index : -1;
    onChange(rows.filter((_, i) => i !== index));
  };
  return (
    <fieldset className="modalField connHeaders">
      <legend>Request headers</legend>
      <small className="chLead">
        Sent with every call. For a token or key, switch on Secret and give the secret’s name on the Agent Builder server; the key itself never sits in the
        agents.
      </small>
      {rows.length > 0 && (
        <ul className="chRows" ref={list}>
          <li className="chHead" aria-hidden="true">
            <span>Header</span>
            <span>Value</span>
            <span>Secret</span>
          </li>
          {rows.map((row, index) => {
            const label = row.name.trim() || `header ${index + 1}`;
            const otherSecret = secretAt >= 0 && secretAt !== index;
            return (
              <li key={index} className="chRow">
                <input
                  className="chName"
                  value={row.name}
                  onChange={(event) => change(index, { name: event.target.value })}
                  placeholder="e.g. X-Api-Version"
                  aria-label={`Name of ${label}`}
                  aria-invalid={problems[index] ? true : undefined}
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  className="chValue"
                  value={row.value}
                  onChange={(event) => change(index, { value: event.target.value })}
                  placeholder={row.secret ? 'Secret’s name, e.g. ORDERS_API_TOKEN' : 'Value'}
                  aria-label={row.secret ? `Secret’s name for ${label}` : `Value of ${label}`}
                  aria-invalid={problems[index] ? true : undefined}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="chSecret" title={otherSecret ? 'One header can be secret: an agent’s connection signs in with one.' : undefined}>
                  <Switch checked={row.secret} disabled={otherSecret} label={`${label} is a secret`} onChange={(secret) => change(index, { secret })} />
                </span>
                <button type="button" className="iconButton chRemove" aria-label={`Remove ${label}`} onClick={() => remove(index)}>
                  <Icon name="close" size={13} />
                </button>
                {problems[index] && <small className="chProblem">{problems[index]}</small>}
              </li>
            );
          })}
        </ul>
      )}
      <Button ref={addButton} type="button" size="compact" onClick={add}>
        <Icon name="plus" size={14} /> Add header
      </Button>
    </fieldset>
  );
}
