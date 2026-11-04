import { useEffect, useMemo, useRef, useState } from 'react';
import FocusBox from '../ui/FocusBox.jsx';
import Icon from '../ui/Icon.jsx';
import Button from '../ui/Button.tsx';
import { exitThen } from '../ui/motion.ts';
import { Switch } from '../studio/form/fields.jsx';

// Which agents use a connection: every agent of the open workspace with a switch. A switch changes that agent's draft
// at once (Integrations.jsx does the saving). The list is the workspace's agents as they are now, so an agent created,
// removed or moved to another workspace comes and goes here by itself.
//   bots: the workspace's agents; uses: id -> true | false (undefined while its draft is being read)
//   busy: ids being saved; problems: id -> why its last change didn't save
//   onToggle(id, on), onAll(on): every agent at once (allBusy while that runs), onClose()

const SEARCH_AFTER = 8;

export default function IntegrationAgents({ item, connection, bots, uses, busy, problems, onToggle, onAll, allBusy = false, onClose }) {
  const shade = useRef(null);
  const [query, setQuery] = useState('');
  const close = () => exitThen({ panel: shade.current?.firstElementChild, shade: shade.current, from: 'below' }, onClose);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const known = bots.filter((bot) => uses[bot.id] !== undefined);
  const on = known.filter((bot) => uses[bot.id]).length;
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return words ? bots.filter((bot) => `${bot.name || ''} ${bot.id}`.toLowerCase().includes(words)) : bots;
  }, [bots, query]);
  const name = connection.name || item.name;

  return (
    <div
      ref={shade}
      className="featureModalOverlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <FocusBox className="featureModal integrationAgents" role="dialog" aria-modal="true" aria-labelledby="integration-agents-title">
        <div className="featureModalHeader">
          <div>
            <div className="eyebrow cyan">Agents</div>
            <h2 id="integration-agents-title">Which agents use {name}</h2>
            <p>
              {bots.length
                ? `On for ${on} of ${bots.length} ${bots.length === 1 ? 'agent' : 'agents'}${known.length < bots.length ? ' (still reading some)' : ''}. A switch changes that agent’s draft at once; publish the agent to put it live.`
                : 'There are no agents in this workspace yet. New agents start with it.'}
            </p>
          </div>
          <button type="button" className="iconButton" aria-label="Close" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {bots.length > 0 && (
          <div className="iaTools">
            {bots.length > SEARCH_AFTER && (
              <label className="inlineSearch iaSearch">
                <Icon name="search" size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents" aria-label="Search agents" />
              </label>
            )}
            <Button type="button" onClick={() => onAll(true)} disabled={allBusy || on === bots.length}>
              All on
            </Button>
            <Button type="button" onClick={() => onAll(false)} disabled={allBusy || (known.length === bots.length && on === 0)}>
              All off
            </Button>
          </div>
        )}
        {bots.length > 0 && (
          // the frame holds the border; the list inside scrolls, its edges fading when there is more (ui/scrollEdges.js)
          <div className="iaFrame">
            <ul className="iaList" data-scroll-edges aria-label={`Agents and ${name}`}>
              {shown.map((bot) => {
                const state = uses[bot.id];
                const label = bot.name || bot.id;
                return (
                  <li key={bot.id} className="iaRow">
                    <span className="iaMark" aria-hidden="true">
                      {label.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="iaText">
                      <strong>{label}</strong>
                      <small>{problems[bot.id] ? <span className="iaProblem">{problems[bot.id]}</span> : bot.id}</small>
                    </span>
                    {state === undefined ? (
                      <span className="iaReading">Reading…</span>
                    ) : (
                      <Switch
                        checked={state}
                        label={`Use ${name} in ${label}`}
                        disabled={allBusy || busy.has(bot.id)}
                        onChange={(next) => onToggle(bot.id, next)}
                      />
                    )}
                  </li>
                );
              })}
              {shown.length === 0 && <li className="iaEmpty">No agent matches that.</li>}
            </ul>
          </div>
        )}
        <div className="featureModalFooter iaFoot">
          <span>New agents start with it switched on.</span>
          <Button type="button" onClick={close}>
            Done
          </Button>
        </div>
      </FocusBox>
    </div>
  );
}
