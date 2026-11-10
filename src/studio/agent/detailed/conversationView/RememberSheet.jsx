import React, { Suspense, lazy, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input } from '../../../../ui/Input.tsx';
import Select from '../../../../ui/Select.tsx';
import { Switch } from '../../../form/fields.jsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { deleteWithUndo, removeEntry } from '../Detailed.jsx';
import { STARTS, addDetail, filtersOf, matchesFilter, readDetails, setDescription, setKind, setSecret, setStart, setValues } from './rememberWords.js';
import './conversation.css';

const FormEditor = lazy(() => import('../../../form/FormEditor.jsx'));

// What the agent remembers during a call, as a sheet (canvas "2 · Conversation, redesigned", board C6): every detail in
// a table (its kind, how it starts, whether it is kept secret), searchable and filtered by kind; beside it, what "kept
// secret" means and one editor card: "A new detail" until a row is chosen, then that detail. Writes `state.variables`
// with the pure writers in rememberWords.js; the rarer fields (can be empty, a participant attribute, epoch ids…) are
// under "Edit as a form", the schema's own form for that one detail.

const FIRST = 12;
// the kinds offered as chips (a whole number shows as Number: choosing Number keeps it whole)
const KIND_CHIPS = [
  { type: 'string', name: 'Text' },
  { type: 'number', name: 'Number', also: ['integer'] },
  { type: 'boolean', name: 'Yes or no' },
  { type: 'enum', name: 'One of a list' },
];
const CHANNEL_OPTIONS = [
  { value: 'id', label: 'Its id' },
  { value: 'type', label: 'Its kind (phone, web chat…)' },
  { value: 'modality', label: 'Voice or chat' },
];
const kindOn = (chip, type) => chip.type === type || (chip.also || []).includes(type);

function Pills({ label, children }) {
  return (
    <div className="cvPills" role="group" aria-label={label}>
      {children}
    </div>
  );
}
const Pill = ({ on, onClick, children, disabled = false }) => (
  <button type="button" aria-pressed={on} className={on ? 'on' : ''} disabled={disabled} onClick={onClick}>
    {children}
  </button>
);

// the value a detail starts with, typed for its kind
function StartValue({ detail, onChange }) {
  const value = detail.start.value;
  if (detail.type === 'boolean')
    return (
      <Pills label="It starts as">
        <Pill on={value === true} onClick={() => onChange(true)}>
          Yes
        </Pill>
        <Pill on={value === false} onClick={() => onChange(false)}>
          No
        </Pill>
      </Pills>
    );
  const numeric = detail.type === 'number' || detail.type === 'integer';
  return (
    <Input
      size="small"
      aria-label="The value it starts with"
      inputMode={numeric ? 'decimal' : undefined}
      defaultValue={value ?? ''}
      key={`${detail.key}-${String(value)}`}
      placeholder={numeric ? 'A number' : 'The words it starts with'}
      onBlur={(event) => {
        const raw = event.target.value.trim();
        if (numeric) {
          const n = Number(raw);
          if (raw !== '' && Number.isFinite(n)) onChange(detail.type === 'integer' ? Math.round(n) : n);
        } else if (raw !== String(value ?? '')) onChange(raw);
      }}
    />
  );
}

// the one detail chosen in the table: its kind, how it starts, kept secret, what it is for
function DetailEditor({ ctx, detail, onClose }) {
  const [form, setForm] = useState(false);
  const { config, set } = ctx;
  const remove = () =>
    deleteWithUndo(ctx, 'detail', detail.words, async (c) => {
      await removeEntry(c, 'state_vars', { key: detail.key, name: detail.words });
      onClose();
    });
  return (
    <div className="rmCard rmEdit" aria-label={`The detail ${detail.words}`} role="group">
      <div className="rmCardHead">
        <h4>{detail.words}</h4>
        <button type="button" className="rmClose" onClick={onClose} aria-label="Close this detail">
          <Icon name="close" size={14} />
        </button>
      </div>
      <code className="rmKey" title="How tools, hand-overs and the brief name it">
        {`{{state.${detail.key}}}`}
      </code>
      <span className="rmH">Kind</span>
      <Pills label="Kind">
        {KIND_CHIPS.map((chip) => (
          <Pill key={chip.type} on={kindOn(chip, detail.type)} onClick={() => !kindOn(chip, detail.type) && set(setKind(config, detail.key, chip.type))}>
            {chip.name}
          </Pill>
        ))}
        {!KIND_CHIPS.some((chip) => kindOn(chip, detail.type)) && (
          <Pill on disabled>
            {detail.kind}
          </Pill>
        )}
      </Pills>
      {detail.type === 'enum' && (
        <label className="rmField">
          <span className="rmH">The choices, with commas between</span>
          <Input
            size="small"
            key={`${detail.key}-values-${detail.values.join(',')}`}
            defaultValue={detail.values.join(', ')}
            placeholder="gold, silver, bronze"
            onBlur={(event) =>
              set(
                setValues(
                  config,
                  detail.key,
                  event.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean),
                ),
              )
            }
          />
        </label>
      )}
      <span className="rmH">Starts as</span>
      <Pills label="Starts as">
        {STARTS.map((start) => (
          <Pill
            key={start.how}
            on={detail.start.how === start.how}
            onClick={() => detail.start.how !== start.how && set(setStart(config, detail.key, start.how))}
          >
            {start.name}
          </Pill>
        ))}
      </Pills>
      {detail.start.how === 'value' && <StartValue detail={detail} onChange={(value) => set(setStart(config, detail.key, 'value', { value }))} />}
      {detail.start.how === 'channel' && (
        <Select
          aria-label="What it takes from the channel"
          value={detail.start.channel}
          onChange={(event) => set(setStart(config, detail.key, 'channel', { channel: event.target.value }))}
        >
          {CHANNEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
      {detail.start.how === 'newId' && <p className="rmNote">A fresh id for every call.</p>}
      {detail.start.how === 'other' && <p className="rmNote">{detail.start.words}. Change it under Edit as a form.</p>}
      <label className="rmSwitch">
        <Switch checked={detail.secret} label="Keep it secret" onChange={(on) => set(setSecret(config, detail.key, on))} />
        <span aria-hidden="true">Keep it secret</span>
      </label>
      <label className="rmField">
        <span className="rmH">What it is for (optional)</span>
        <Input
          size="small"
          key={`${detail.key}-about-${detail.description}`}
          defaultValue={detail.description}
          placeholder="The branch the caller prefers"
          onBlur={(event) => event.target.value.trim() !== detail.description && set(setDescription(config, detail.key, event.target.value.trim()))}
        />
      </label>
      <div className="rmFoot">
        <Button type="button" variant="quiet" size="small" aria-expanded={form} onClick={() => setForm(!form)}>
          {form ? 'Close the form' : 'Edit as a form'}
        </Button>
        <Button type="button" variant="secondary" size="small" onClick={remove}>
          Delete this detail
        </Button>
      </div>
      {form && (
        <Suspense fallback={null}>
          <div className="dtForm rmForm">
            <FormEditor editor={ctx.editor} itemPath={['state', 'variables', detail.key]} subtree embedded />
          </div>
        </Suspense>
      )}
    </div>
  );
}

// "A new detail": a name, its kind, how it starts and whether it is secret, then Add
function NewDetail({ ctx, nameRef, onAdded }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('string');
  const [start, setStartHow] = useState('empty');
  const [secret, setSecretOn] = useState(false);
  const add = () => {
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    const made = addDetail(ctx.config, name, { type, start, secret });
    ctx.set(made.config);
    setName('');
    setType('string');
    setStartHow('empty');
    setSecretOn(false);
    onAdded(made.key);
  };
  return (
    <form
      className="rmCard rmNew"
      aria-label="A new detail"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <h4>A new detail</h4>
      <Input ref={nameRef} size="small" aria-label="Its name" placeholder="preferred branch" value={name} onChange={(event) => setName(event.target.value)} />
      <Pills label="Kind of the new detail">
        {KIND_CHIPS.map((chip) => (
          <Pill key={chip.type} on={type === chip.type} onClick={() => setType(chip.type)}>
            {chip.name}
          </Pill>
        ))}
      </Pills>
      <span className="rmH">Starts as</span>
      <Pills label="The new detail starts as">
        {STARTS.map((s) => (
          <Pill key={s.how} on={start === s.how} onClick={() => setStartHow(s.how)}>
            {s.name}
          </Pill>
        ))}
      </Pills>
      <label className="rmSwitch">
        <Switch checked={secret} label="Keep the new detail secret" onChange={setSecretOn} />
        <span aria-hidden="true">Keep it secret</span>
      </label>
      <div className="rmFoot">
        <Button type="submit" variant="secondary" size="small" disabled={!name.trim()}>
          <Icon name="plus" size={14} />
          Add it
        </Button>
      </div>
    </form>
  );
}

export default function RememberSheet(ctx) {
  const { config } = ctx;
  const details = useMemo(() => readDetails(config), [config]);
  const filters = useMemo(() => filtersOf(details), [details]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(null);
  const nameRef = useRef(null);
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const q = query.trim().toLowerCase();
  const shownFilter = filters.some((f) => f.id === filter) ? filter : 'all';
  const matching = details.filter((d) => matchesFilter(d, shownFilter) && (!q || `${d.words} ${d.key} ${d.description}`.toLowerCase().includes(q)));
  const shown = all ? matching : matching.slice(0, FIRST);
  const hidden = matching.length - shown.length;
  const current = details.find((d) => d.key === open) || null;
  const count = details.length;
  const many = count > FIRST;
  return (
    <div className="rmWrap">
      <div className="rmSheet">
        <div className="rmHead">
          <div className="rmTitle">
            {/* in All settings the card already names it */}
            {!ctx.forceAdvanced && <h3>What {name} remembers</h3>}
            <span className="rmSub">
              {count
                ? `${count} ${count === 1 ? 'detail' : 'details'}, kept during each call for tools, hand-overs and the brief to use`
                : 'Nothing yet. A detail is kept during each call, for tools, hand-overs and the brief to use.'}
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => {
              setOpen(null);
              setTimeout(() => nameRef.current?.focus(), 0);
            }}
          >
            <Icon name="plus" size={14} />
            Add a detail
          </Button>
        </div>
        {count > 0 && (
          <>
            <div className="rmTools">
              {many && (
                <span className="rmFind">
                  <Icon name="search" size={15} />
                  <Input
                    size="small"
                    aria-label="Search the details"
                    placeholder={`Search ${count} details`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </span>
              )}
              {filters.length > 2 && (
                <Pills label="Show">
                  {filters.map((f) => (
                    <Pill key={f.id} on={shownFilter === f.id} onClick={() => setFilter(f.id)}>
                      {f.id === 'secret' && <Icon name="lock" size={11} />}
                      {f.name} {f.count}
                    </Pill>
                  ))}
                </Pills>
              )}
            </div>
            {matching.length ? (
              <table className="rmTable">
                <thead>
                  <tr>
                    <th scope="col">Detail</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Starts as</th>
                    <th scope="col">
                      <span className="srOnly">Kept secret</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.key} className={open === d.key ? 'on' : ''}>
                      <th scope="row">
                        <button type="button" aria-expanded={open === d.key} onClick={() => setOpen(open === d.key ? null : d.key)}>
                          {d.words}
                        </button>
                      </th>
                      <td>
                        <span className="rmKind">{d.type === 'enum' && d.values.length ? `${d.kind} (${d.values.length})` : d.kind}</span>
                      </td>
                      <td className={d.start.how === 'empty' ? 'rmDim' : ''}>{d.start.words}</td>
                      <td className="rmEnd">
                        {d.secret && (
                          <span className="cvTag">
                            <Icon name="lock" size={11} />
                            kept secret
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rmNote">No detail matches “{query.trim()}”.</p>
            )}
            <div className="rmCount" aria-live="polite">
              <span>
                {q || shownFilter !== 'all' ? `${matching.length} of ${count}.` : 'In the order they were added.'}
                {hidden > 0 ? ` ${hidden} more below.` : ''}
              </span>
              {hidden > 0 && (
                <Button type="button" variant="quiet" size="small" onClick={() => setAll(true)}>
                  Show all {matching.length}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      <aside className="rmSide" aria-label="About the details">
        <div className="rmCard">
          <h4>
            <Icon name="lock" size={14} />
            Kept secret
          </h4>
          <p>
            For a PIN, a one-time code, a card or ID number. It reads as *** in every prompt, spoken line and log, is hidden from the AI once stored, and can
            only be sent in an API request, a transfer or a notification.
          </p>
        </div>
        {current ? (
          <DetailEditor ctx={ctx} detail={current} onClose={() => setOpen(null)} />
        ) : (
          <NewDetail ctx={ctx} nameRef={nameRef} onAdded={(key) => setOpen(key)} />
        )}
      </aside>
    </div>
  );
}
