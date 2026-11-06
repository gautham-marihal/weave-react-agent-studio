import React, { useMemo, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import SimpleKey from '../../simple/SimpleKey.jsx';
import { modelLabel, modelStatus, providerLabel } from '../../models/catalog.js';
import { clearStage, readModels, setModel, setProvider, slotProblem } from '../../models/config.js';
import { modelRows, providerChips } from './pickerLogic.js';
import './pickers.css';
import Button from '../../../ui/Button.tsx';
import { Input } from '../../../ui/Input.tsx';

// The three parts of a call, in the order people think of them: what thinks (language model), listens (speech-to-text)
// and speaks (text-to-speech). Each card shows the choice; "Change" opens a searchable list, filterable by provider.
const PARTS = [
  { id: 'llm', title: 'Language model', what: 'Decides what to say and which tool to use.' },
  { id: 'stt', title: 'Speech-to-text', what: 'Turns what the caller says into text.' },
  { id: 'tts', title: 'Text-to-speech', what: 'Turns the reply into speech. The voice itself is chosen under Voice.' },
  // shown only where asked for (stages): one model in place of the three steps
  { id: 'realtime', title: 'Speech-to-speech', what: 'One model that hears, thinks and speaks, in place of the three steps.' },
];
const THREE_STEPS = ['llm', 'stt', 'tts'];
// "Language model" → "language models", "Speech-to-text" → "speech-to-text models"
const modelsWord = (part) => `${part.title.replace(/ model$/i, '')} models`;

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
          placeholder={`Search ${modelsWord(part).toLowerCase()}`}
          aria-label={`Search ${modelsWord(part)}`}
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
      <ul className="pkModelList" aria-label={modelsWord(part)}>
        {rows.map((row) => (
          <li key={`${row.provider}/${row.id}`} className={row.selected ? 'on' : ''}>
            {/* a provider not installed on the server can't run: shown but not choosable (unless already in use) */}
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
          <Input
            id={`pk-other-${part.id}`}
            mono
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
          <Button type="button" disabled={!other.trim()} onClick={chooseOther}>
            Use it
          </Button>
        </div>
        <small>The server doesn’t check model ids; a wrong one fails when a call starts.</small>
      </div>
    </div>
  );
}

// speech: the agent takes calls or talks on a website; without it, hearing and speaking are marked not needed
// (but can still be chosen)
function PartCard({ part, config, set, providers, open, onToggle, speech = true }) {
  const notNeeded = !speech && part.id !== 'llm';
  const slot = readModels(config)[part.id];
  const status = slot.provider ? modelStatus(part.id, slot.provider, slot.model) : null;
  const problem = slotProblem(part.id, slot, providers);
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
        ) : part.id === 'realtime' ? (
          <span className="pkChosenText">
            <strong>Not used</strong>
            <small>It hears, thinks and speaks in separate steps. Choose one to do all three in a single model.</small>
          </span>
        ) : (
          <span className="pkChosenText">
            <strong>{notNeeded ? 'Not needed while it only chats' : 'Nothing chosen yet'}</strong>
            <small>{notNeeded ? 'Choose one for phone calls or talking on your website.' : 'Choose a model to use for this part of the call.'}</small>
          </span>
        )}
        <span className="pkChosenActions">
          {part.id === 'realtime' && slot.provider ? (
            <Button type="button" onClick={() => set(clearStage(config, 'realtime'))}>
              Stop using it
            </Button>
          ) : null}
          <Button type="button" aria-expanded={open} aria-label={`${open ? 'Close the list of' : 'Change'} ${modelsWord(part)}`} onClick={onToggle}>
            {open ? 'Done choosing' : slot.provider ? 'Change' : 'Choose'}
          </Button>
        </span>
      </div>
      {problem && <p className="pkWarn">{problem.text}</p>}
      {status && ['custom', 'free', 'empty'].includes(status.state) ? <p className={`pkStatus ${status.state}`}>{status.text}</p> : null}
      {open && <ModelList part={part} config={config} set={set} providers={providers} />}
    </section>
  );
}

// speech: whether the agent hears and speaks (a phone or website voice channel).
// The list that opens first is the first part it needs that is still to choose.
// One part, bare: what is wrong with its choice, if anything, and its list (the choice is ticked there).
function BarePart({ part, config, set, providers }) {
  const slot = readModels(config)[part.id];
  const status = slot.provider ? modelStatus(part.id, slot.provider, slot.model) : null;
  const problem = slotProblem(part.id, slot, providers);
  return (
    <>
      {problem && <p className="pkWarn">{problem.text}</p>}
      {status && ['custom', 'free', 'empty'].includes(status.state) ? <p className={`pkStatus ${status.state}`}>{status.text}</p> : null}
      <ModelList part={part} config={config} set={set} providers={providers} />
    </>
  );
}

// stages: which parts to show (the three steps, unless asked for another, such as ['realtime']).
// bare: one part inside an editor of its own (a popover): only its list, no card around it
export default function ModelPicker({ config, set, providers, live, speech = true, stages = THREE_STEPS, bare = false }) {
  const models = readModels(config);
  const parts = PARTS.filter((p) => stages.includes(p.id));
  // one part alone opens its list at once; of several, the first still to choose
  const [open, setOpen] = useState(() =>
    parts.length === 1 ? parts[0].id : (parts.find((p) => !models[p.id].provider && (speech || p.id === 'llm')) || {}).id || '',
  );
  if (bare && parts.length === 1)
    return (
      <div className="pkPicker bare">
        {!live && <p className="pkNote">The server’s list of what it can run couldn’t be read, so these are the usual choices.</p>}
        <BarePart part={parts[0]} config={config} set={set} providers={providers} />
      </div>
    );
  return (
    <div className="pkPicker">
      {!live && <p className="pkNote">The server’s list of what it can run couldn’t be read, so these are the usual choices.</p>}
      {parts.map((part) => (
        <PartCard
          key={part.id}
          part={part}
          config={config}
          set={set}
          providers={providers}
          open={open === part.id}
          onToggle={() => setOpen(open === part.id ? '' : part.id)}
          speech={speech}
        />
      ))}
      <p className="pkNote">Models come from a catalogue kept in the studio, not a live check. Typing any other model id is fine.</p>
    </div>
  );
}
