import React, { useMemo, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import SimpleKey from '../../simple/SimpleKey.jsx';
import { modelLabel, modelStatus, providerLabel } from '../../models/catalog.js';
import { readModels, setModel, setProvider } from '../../models/config.js';
import { modelRows, providerChips } from './pickerLogic.js';
import './pickers.css';

// The three parts of a call, in the order a person thinks of them: what thinks (the language model), what listens (speech-to-text) and what speaks
// (text-to-speech). Each is a card that says what is chosen; "Change" opens the list of models, which can be searched and narrowed to one provider.
const PARTS = [
  { id: 'llm', title: 'Language model', what: 'Decides what to say and which tool to use.' },
  { id: 'stt', title: 'Speech-to-text', what: 'Turns what the caller says into text.' },
  { id: 'tts', title: 'Text-to-speech', what: 'Turns the reply into speech. The voice itself is chosen under Voice.' },
];

function ModelList({ part, config, set, providers }) {
  const slot = readModels(config)[part.id];
  const [query, setQuery] = useState('');
  const [provider, setFilter] = useState('');
  const [other, setOther] = useState('');
  const chips = useMemo(() => providerChips({ stage: part.id, providers }), [part.id, providers]);
  const { provider: nowProvider, model: nowModel } = slot;
  const rows = useMemo(
    () => modelRows({ stage: part.id, providers, query, provider, current: { provider: nowProvider, model: nowModel } }),
    [part.id, providers, query, provider, nowProvider, nowModel],
  );
  const choose = (row) => {
    let next = config;
    if (row.provider !== slot.provider) next = setProvider(next, part.id, row.provider, providers);
    set(setModel(next, part.id, row.id));
  };
  const chooseOther = () => {
    const id = other.trim();
    if (!id) return;
    const base = slot.provider || provider || chips.find((c) => c.installed)?.value;
    if (!base) return;
    let next = config;
    if (base !== slot.provider) next = setProvider(next, part.id, base, providers);
    set(setModel(next, part.id, id));
    setOther('');
  };
  return (
    <div className="pkModels">
      <div className="pkTools">
        <input
          className="pkSearch big"
          type="search"
          value={query}
          placeholder={`Search ${part.title.toLowerCase()} models`}
          aria-label={`Search ${part.title} models`}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="pkPills" role="group" aria-label="Provider">
          <button type="button" className={provider === '' ? 'on' : ''} aria-pressed={provider === ''} onClick={() => setFilter('')}>
            All
          </button>
          {chips.map((c) => (
            <button
              key={c.value}
              type="button"
              className={provider === c.value ? 'on' : ''}
              aria-pressed={provider === c.value}
              onClick={() => setFilter(provider === c.value ? '' : c.value)}
            >
              {c.label}
              {!c.installed ? ' (not installed)' : ''}
            </button>
          ))}
        </div>
      </div>
      <ul className="pkModelList" aria-label={`${part.title} models`}>
        {rows.map((row) => (
          <li key={`${row.provider}/${row.id}`} className={row.selected ? 'on' : ''}>
            {/* a provider whose plugin isn't installed on the server can't run: shown, not chosen (the one in use stays visible) */}
            <button
              type="button"
              aria-pressed={row.selected}
              aria-label={`${row.selected ? 'Using' : 'Use'} ${row.label} from ${row.providerName}`}
              disabled={!row.installed && !row.selected}
              title={!row.installed ? `${row.providerName} isn’t installed on this server, so its models can’t run here.` : undefined}
              onClick={() => choose(row)}
            >
              <span className="pkModelText">
                <strong>
                  {row.label}
                  {row.recommended ? <em className="pkTag good">Recommended</em> : null}
                  {row.tags
                    .filter((t) => t !== 'recommended')
                    .slice(0, 2)
                    .map((t) => (
                      <em key={t} className="pkTag">
                        {t}
                      </em>
                    ))}
                </strong>
                <small>{row.note || row.id}</small>
              </span>
              <span className="pkEngine">
                {row.providerName}
                {!row.installed ? <em> · not installed</em> : row.keyMissing ? <em title={`${row.keyMissing} is not set on the server`}> · no key</em> : null}
              </span>
              {row.selected && (
                <span className="pkTick" aria-hidden="true">
                  <Icon name="check" size={16} />
                </span>
              )}
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="pkNone">No model matches.</li>}
      </ul>
      <div className="pkOther">
        <label htmlFor={`pk-other-${part.id}`}>Another model id</label>
        <div>
          <input
            id={`pk-other-${part.id}`}
            className="stFInput mono"
            type="text"
            spellCheck={false}
            value={other}
            placeholder={slot.provider ? `Any model of ${providerLabel(slot.provider)}` : 'Any model id'}
            onChange={(event) => setOther(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                chooseOther();
              }
            }}
          />
          <button type="button" className="quietButton" disabled={!other.trim()} onClick={chooseOther}>
            Use it
          </button>
        </div>
        <small>The server doesn’t check model ids; a wrong one fails when a call starts.</small>
      </div>
    </div>
  );
}

function PartCard({ part, config, set, providers, open, onToggle }) {
  const slot = readModels(config)[part.id];
  const current = providers.find((p) => p.name === slot.provider);
  const status = slot.provider ? modelStatus(part.id, slot.provider, slot.model) : null;
  const runnable = !slot.provider || (current && current.installed !== false && (current.stages || []).includes(part.id));
  const keyMissing = current && current.default_secret && current.key_available === false;
  return (
    <section className={`pkPart ${open ? 'open' : ''}`} data-stage={part.id}>
      <header>
        <span className="pkPartText">
          <strong>{part.title}</strong>
          <small>{part.what}</small>
        </span>
        <SimpleKey path={['defaults', 'models', part.id]} />
      </header>
      <div className="pkChosen">
        {slot.provider ? (
          <span className="pkChosenText">
            <strong>{slot.model ? modelLabel(part.id, slot.provider, slot.model) : 'No model chosen'}</strong>
            <small>
              {providerLabel(slot.provider)}
              {slot.model && modelLabel(part.id, slot.provider, slot.model) !== slot.model ? ` · ${slot.model}` : ''}
            </small>
          </span>
        ) : (
          <span className="pkChosenText">
            <strong>Nothing chosen yet</strong>
            <small>Choose a model to use for this part of the call.</small>
          </span>
        )}
        <button
          type="button"
          className="quietButton"
          aria-expanded={open}
          aria-label={`${open ? 'Close the list of' : 'Change'} ${part.title} models`}
          onClick={onToggle}
        >
          {open ? 'Done choosing' : slot.provider ? 'Change' : 'Choose'}
        </button>
      </div>
      {!runnable && <p className="pkWarn">The runtime can’t run “{slot.provider}” for this. Choose one from the list.</p>}
      {runnable && keyMissing && <p className="pkWarn">The server doesn’t have {current.default_secret} set, so a call would fail to start until it does.</p>}
      {status && ['custom', 'free', 'empty'].includes(status.state) ? <p className={`pkStatus ${status.state}`}>{status.text}</p> : null}
      {open && <ModelList part={part} config={config} set={set} providers={providers} />}
    </section>
  );
}

export default function ModelPicker({ config, set, providers, live }) {
  const models = readModels(config);
  const [open, setOpen] = useState(() => (PARTS.find((p) => !models[p.id].provider) || {}).id || '');
  return (
    <div className="pkPicker">
      {!live && <p className="pkNote">The server’s list of what it can run couldn’t be read, so these are the usual choices.</p>}
      {PARTS.map((part) => (
        <PartCard
          key={part.id}
          part={part}
          config={config}
          set={set}
          providers={providers}
          open={open === part.id}
          onToggle={() => setOpen(open === part.id ? '' : part.id)}
        />
      ))}
      <p className="pkNote">Models come from a catalogue kept in the studio, not a live check. Typing any other model id is fine.</p>
    </div>
  );
}
