import React from 'react';
import { Switch } from '../../../form/fields.jsx';
import { Scale } from '../parts/KnowledgeSearch.jsx';
import { USUAL, keptBy } from './knowledgeWords.js';
import { useLastHits } from './lastSearch.js';
import './knowledgeWorkspace.css';

// Build › Knowledge's own editors, used as rows of the part (knowledgePart.jsx), so they are the same in the workspace
// and in All settings: when it searches (two ways, each said with what it costs), and how close a match must be (a
// line on the score scale, with the passages the last try-out found placed on it). Each gets the row's context
// ({ config, id, value, onChange, … }).

// ---- when it searches ---------------------------------------------------------------------------------------------
const MODES = [
  {
    value: 'inject',
    name: 'On every caller turn',
    flow: ['caller speaks', 'search', 'answer'],
    what: `Always answers with the material in hand. The caller waits for the search each turn (up to ${USUAL.timeout} s unless set). Works with any model.`,
  },
  {
    value: 'tool',
    name: 'When it decides it needs to',
    flow: ['caller speaks', 'answer', 'or search first'],
    what: 'Quicker small talk; it may skip the search. Needs a model that can use tools: the agents that read it get a search tool on Tools.',
  },
];

export function ModeChoice({ config, id, value, onChange }) {
  const now = value || 'tool';
  // a model that can't use tools can only be given the material on every turn (agent config guide, models)
  const noTools = config?.defaults?.models?.llm?.tool_calling === false;
  return (
    <div className="kwModes" id={id} role="group" aria-label="When it searches">
      {MODES.map((m) => {
        const off = m.value === 'tool' && noTools;
        return (
          <button
            key={m.value}
            type="button"
            className={`kwMode ${now === m.value ? 'on' : ''}`}
            aria-pressed={now === m.value}
            disabled={off && now !== m.value}
            onClick={() => onChange(m.value)}
          >
            <b>{m.name}</b>
            <span className="kwFlow" aria-hidden="true">
              {m.flow.map((step, i) => (
                <React.Fragment key={step}>
                  {i > 0 && <span className="kwArrow">→</span>}
                  <span className={/search/.test(step) ? 'k' : ''}>{step}</span>
                </React.Fragment>
              ))}
            </span>
            <small>{off ? 'This agent’s model can’t use tools, so it searches on every turn.' : m.what}</small>
          </button>
        );
      })}
    </div>
  );
}

// ---- how close a match must be --------------------------------------------------------------------------------------
const two = (v) => v.toFixed(2);
export function MatchScale({ config, id, value, onChange }) {
  const baseId = (Array.isArray(config?.knowledge) ? config.knowledge : []).find((b) => b?.type === 'vector_store')?.id || '';
  const hits = (useLastHits(baseId) || []).filter((h) => typeof h?.score === 'number');
  const set = typeof value === 'number';
  const line = set ? value : 0.4;
  return (
    <div className="kwMatch" id={id}>
      <div className="kwMatchTop">
        <Switch checked={!set} label="Keep every match" onChange={(every) => onChange(every ? undefined : 0.4)} />
        <span>
          <b>Keep every match</b>
          <small>{set ? 'Off: passages under the line are left out.' : 'Every passage found is used, however loosely it matches.'}</small>
        </span>
      </div>
      {set && (
        <>
          <Scale hits={hits} line={line} />
          <div className="kxSlider">
            <label htmlFor={`${id}-line`}>The line</label>
            <input id={`${id}-line`} type="range" min="0" max="1" step="0.01" value={line} onChange={(event) => onChange(Number(event.target.value))} />
            <output htmlFor={`${id}-line`}>{two(line)}</output>
          </div>
        </>
      )}
      <p className="kwMatchNote">
        {hits.length
          ? hits.length === 1
            ? `The passage your last question found would ${keptBy(hits, set ? line : null) ? '' : 'not '}be used.`
            : `${keptBy(hits, set ? line : null)} of the ${hits.length} passages your last question found would be used.`
          : 'Ask it something under Try it to see where your passages land on this scale.'}{' '}
        With the usual search model, related text scores about 0.5 to 0.75 and unrelated text below 0.25.
      </p>
    </div>
  );
}
