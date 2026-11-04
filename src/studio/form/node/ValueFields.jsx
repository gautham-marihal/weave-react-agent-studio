import React, { useId, useMemo, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { humanize, isObj } from '../engine.js';
import { keyOf, useConfigSelect, useForm } from '../ctx.js';
import { Select } from '../fields.jsx';
import TemplateField from '../TemplateField.jsx';
import InlineCreate from '../InlineCreate.jsx';
import { CREATABLE } from '../inlineCreate.js';
import { scopeAt, scopeSignature } from '../templates.ts';
import { looksLikePhone, looksLikeUrl } from '../xui.ts';
import { Input } from '../../../ui/Input.tsx';
import { REF_TARGET, REF_WORD } from './refWords.js';

// The editors for a single value that Node draws directly (template text, a reference, a phone number or web address, a
// secret's name), and the note under a field.

// A template box whose scope (the names a template may use here) comes from the config in the form's store, so it only
// re-renders when those names change, not on every keystroke elsewhere.
export function ScopedTemplateField({ path, ...props }) {
  const { store } = useForm();
  const signature = useConfigSelect((c) => scopeSignature(c, path), Object.is);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the scope changes exactly when its signature does
  const scope = useMemo(() => scopeAt(store.get(), path), [signature, keyOf(path), store]);
  // text written to the agent about a channel (its extra instructions)
  // gets the plain menu, as the Agent page's instructions do
  const plain = path[0] === 'channels' && path[path.length - 1] === 'instructions_append';
  return <TemplateField {...props} scope={scope} plain={plain} />;
}

// What a field points at, by name: an agent by its name, anything else by its id in words ("escalate_to_human" →
// "Escalate to human"). Two that read the same keep their ids beside them; technical names show the ids.
function refLabels(name, options, config) {
  const agents = Array.isArray(config?.agents?.items) ? config.agents.items.filter(isObj) : [];
  const words = (id) => {
    if (name === 'agents') {
      const agent = agents.find((a) => a.id === id);
      if (typeof agent?.name === 'string' && agent.name.trim()) return agent.name.trim();
      if (agent && agents.length === 1 && typeof config?.meta?.name === 'string' && config.meta.name.trim()) return config.meta.name.trim();
    }
    return humanize(String(id));
  };
  const first = options.map(words);
  return Object.fromEntries(options.map((id, i) => [id, first.indexOf(first[i]) !== first.lastIndexOf(first[i]) ? `${first[i]} (${id})` : first[i]]));
}

export function RefSelect({ shape, value, onChange, disabled, id, invalid, path }) {
  const { refOptions, goTo, technical, store } = useForm();
  const [creating, setCreating] = useState(false);
  const name = shape['x-ref'];
  const options = refOptions[name] || [];
  const labels = technical ? undefined : refLabels(name, options, store.get());
  const [target, label] = REF_TARGET[name] || [];
  // Some of what a field points at can be made right here: the new thing is added and the field points at it.
  const spec = !disabled ? CREATABLE[name] : null;
  const newButton = spec && (
    <button type="button" className="stLink stNewBtn" onClick={() => setCreating((v) => !v)}>
      <Icon name="plus" size={14} /> New {spec.word}
    </button>
  );
  const form = creating && (
    <InlineCreate
      collection={name}
      target={path}
      defaultKind={path && path[path.length - 1] === 'count_attempts_in' ? 'integer' : undefined}
      onClose={() => setCreating(false)}
    />
  );
  if (!options.length && !value) {
    return (
      <div className="stFRefRow">
        <p className="stFEmpty">
          There are no {REF_WORD[name] || name} yet.
          {newButton ? (
            <> {newButton}</>
          ) : (
            target && (
              <>
                {' '}
                Add one in{' '}
                <button type="button" className="stLink" onClick={() => goTo(target)}>
                  {label}
                </button>{' '}
                first.
              </>
            )
          )}
        </p>
        {form}
      </div>
    );
  }
  return (
    <div className="stFRefRow">
      <Select
        id={id}
        value={value}
        options={options}
        labels={labels}
        onChange={onChange}
        disabled={disabled}
        invalid={invalid}
        placeholder={`Choose from ${REF_WORD[name] || name}…`}
      />
      {newButton}
      {form}
    </div>
  );
}

// A phone number or a web address: an ordinary box that says so
// when what is typed doesn't look like one (it isn't refused).
export function ContactInput({ kind, id, value, onChange, placeholder, disabled, invalid }) {
  const text = typeof value === 'string' ? value : '';
  const ok = !text || (kind === 'phone' ? looksLikePhone(text) : looksLikeUrl(text));
  return (
    <>
      <Input
        id={id}
        mono
        type={kind === 'phone' ? 'tel' : 'url'}
        inputMode={kind === 'phone' ? 'tel' : 'url'}
        spellCheck={false}
        value={text}
        disabled={disabled}
        placeholder={placeholder || (kind === 'phone' ? '+14155550100' : 'https://…')}
        aria-invalid={invalid || !ok || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {!ok && (
        <small className="stFWarn">
          {kind === 'phone'
            ? 'This doesn’t look like a phone number. Use digits, with a + and the country code.'
            : 'This doesn’t look like a web address. Start it with https://'}
        </small>
      )}
    </>
  );
}

export function ShieldIcon() {
  return <Icon name="sensitive" size={14} className="stShieldIcon" />;
}

// A note under a field that needs more than the schema's description says.
export function FieldNote({ path, value }) {
  const ctx = useForm();
  if (path[0] === 'state' && path[path.length - 1] === 'sensitive') {
    return (
      <p className={`stFNote ${value ? 'shield' : ''}`}>
        <ShieldIcon />{' '}
        {value
          ? 'Kept out of prompts, spoken lines and logs, and meant to be entered by keypad. The runtime doesn’t enforce this yet, so don’t rely on it for real PINs or card numbers.'
          : 'Turn this on for a PIN, one-time code or card number. It is then meant to be kept out of prompts and logs and entered by keypad (the runtime doesn’t enforce that yet).'}
        {value === true && ctx.raiseVersion && (
          <>
            {' '}
            Sensitive variables need schema version 1.2.{' '}
            <button type="button" className="stLink" onClick={ctx.raiseVersion}>
              Use 1.2
            </button>
          </>
        )}
      </p>
    );
  }
  return null;
}

export function SecretInput({ value, onChange, disabled, id }) {
  const { secretNames } = useForm();
  const listId = useId();
  const name = isObj(value) && typeof value.secret === 'string' ? value.secret : '';
  return (
    <div className="stFSecret">
      <Icon name="key" size={15} className="stFSecretIcon" />
      <Input
        id={id}
        mono
        type="text"
        spellCheck={false}
        list={listId}
        value={name}
        disabled={disabled}
        placeholder="SECRET_NAME"
        onChange={(event) => onChange({ secret: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
      />
      <datalist id={listId}>
        {secretNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}
