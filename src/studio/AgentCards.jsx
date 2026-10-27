import React, { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import StatusChip from '../ui/StatusChip.tsx';
import Tip from '../ui/Tip.tsx';
import { DragHandle, SortableHandles, SortableList, useSortableItem } from '../ui/Sortable.jsx';
import Menu from './manage/Menu.tsx';
import { formatWhen } from './format.js';
import { navigate, routeHref } from './route.js';
import { envLabel } from './ui.jsx';
import { HUES, cx } from './agent/workspace/look.js';
import HueIcon from './agent/workspace/HueIcon.jsx';

// The Agents page's "Cards" view. Closed, a card shows the draft, checks and latest version; open, where it runs, the
// draft's problems and the next pages. Cards are reordered by their handle or the keyboard.
//   known: what is read about each agent beyond the list ({ health }), by id
//   pinned: ids pinned to the top
//   menuItems(bot): the card's "More" menu
//   onMove(id, toId): a card dropped where another was
const ENVIRONMENTS = ['development', 'staging', 'production'];
// the pages an open card leads to, each with its stage's icon and colour (as on the stage tabs)
const NEXT = [
  { page: 'build', icon: 'build', hue: HUES.build, label: 'Build it' },
  { page: 'tests', icon: 'play', hue: HUES.test, label: 'Try a conversation' },
  { page: 'releases', icon: 'rocket', hue: HUES.release, label: 'Publish and deploy' },
  { page: 'monitoring', icon: 'monitor', hue: HUES.monitor, label: 'How it is doing' },
];

// The checks in a word: the health read from the draft (health/health.js), else not yet known
function checksPill(health) {
  if (!health || health.state === 'unknown') return { tone: 'draft', text: 'Not checked' };
  if (health.state === 'ok') return { tone: 'good', text: 'Valid' };
  return { tone: health.state === 'bad' ? 'bad' : 'review', text: health.state === 'bad' ? 'Needs attention' : 'Worth a look' };
}

export default function AgentCards({ bots, known = {}, pinned = [], onPin, menuItems, onMove }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <SortableList
      ids={bots.map((bot) => bot.id)}
      nameOf={(id) => bots.find((bot) => bot.id === id)?.name || id}
      label="the agents"
      onMove={(from, to) => onMove(bots[from].id, bots[to].id)}
    >
      <ul className="tw-m-0 tw-grid tw-list-none tw-gap-3 tw-p-0" aria-label="Agents">
        {bots.map((bot) => (
          <AgentCard
            key={bot.id}
            bot={bot}
            health={known[bot.id]?.health}
            pinned={pinned.includes(bot.id)}
            open={open.has(bot.id)}
            onToggle={() => toggle(bot.id)}
            onPin={onPin}
            menuItems={menuItems}
          />
        ))}
      </ul>
    </SortableList>
  );
}

function AgentCard({ bot, health, pinned, open, onToggle, onPin, menuItems }) {
  const item = useSortableItem(bot.id);
  const name = bot.name || bot.id;
  const go = (page) => navigate(routeHref(bot.id, page), { guard: false });
  const checks = checksPill(health);
  const problem = health?.state === 'bad';
  const panel = `agentCard-${bot.id}`;

  return (
    <li
      ref={item.ref}
      style={item.style}
      data-agent={bot.id}
      className={cx(
        'agentCard tw-relative tw-overflow-hidden tw-rounded-card tw-border tw-border-solid tw-bg-surface',
        open ? 'tw-border-accent' : 'tw-border-line',
        item.dragging && 'tw-z-10 tw-shadow-lg',
      )}
    >
      {/* a draft with problems is marked along its edge */}
      {problem && <span className="tw-absolute tw-inset-y-0 tw-left-0 tw-w-[3px] tw-bg-danger" aria-hidden="true" />}

      <div className="tw-grid tw-grid-cols-[auto_40px_minmax(0,1fr)] tw-items-center tw-gap-x-4 tw-gap-y-3 tw-px-5 tw-py-4 lg:tw-grid-cols-[auto_40px_minmax(0,1fr)_auto]">
        <SortableHandles value={item.handle}>
          <DragHandle label={`Drag ${name}`} />
        </SortableHandles>
        <span className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-control tw-bg-subtle tw-text-accent-ink" aria-hidden="true">
          <Icon name="agent" size={18} />
        </span>
        {/* the name opens and closes the card */}
        <button
          type="button"
          className="tw-min-w-0 tw-cursor-pointer tw-border-0 tw-bg-transparent tw-p-0 tw-text-left"
          aria-expanded={open}
          aria-controls={panel}
          onClick={onToggle}
        >
          <span className="tw-block tw-truncate tw-text-[15px] tw-font-semibold tw-text-ink">{name}</span>
          <span className="tw-mt-0.5 tw-block tw-truncate tw-text-sm tw-text-muted">
            <code className="tw-text-ink-soft">{bot.id}</code> · saved {formatWhen(bot.draft_saved_at) || 'never'}
          </span>
        </button>

        <div className="tw-col-span-full tw-flex tw-flex-wrap tw-items-center tw-gap-2 lg:tw-col-span-1">
          <StatusChip tone={checks.tone}>{checks.text}</StatusChip>
          <code className="tw-rounded-control tw-bg-subtle tw-px-2 tw-py-0.5 tw-text-sm tw-text-ink-soft">{bot.latest_version || 'Not published'}</code>
          <Tip label={pinned ? 'Unpin it' : 'Pin it to the top'}>
            <button
              type="button"
              className={`agentRowPin ${pinned ? 'on' : ''}`}
              aria-pressed={pinned}
              aria-label={pinned ? `Unpin ${name}` : `Pin ${name} to the top`}
              onClick={() => onPin(bot.id)}
            >
              <Icon name="pin" size={15} />
            </button>
          </Tip>
          <button type="button" className="quietButton compactCta tw-inline-flex tw-items-center tw-gap-1.5" onClick={() => go('home')}>
            <Icon name="external" size={14} /> Open
          </button>
          <Menu label={`Actions for ${name}`} items={menuItems(bot)} />
          <button
            type="button"
            className="tw-grid tw-h-8 tw-w-8 tw-cursor-pointer tw-place-items-center tw-rounded-control tw-border-0 tw-bg-transparent tw-text-muted hover:tw-bg-subtle hover:tw-text-ink"
            aria-expanded={open}
            aria-controls={panel}
            aria-label={open ? `Close ${name}` : `Open ${name}’s details`}
            onClick={onToggle}
          >
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
        </div>
      </div>

      {open && <CardDetails id={panel} bot={bot} health={health} go={go} />}
    </li>
  );
}

// An open card: where it runs, how its draft stands (each problem with the way to fix it), and the pages to go on with.
function CardDetails({ id, bot, health, go }) {
  const deployed = bot.deployed || {};
  return (
    <div id={id} className="tw-grid tw-gap-6 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-px-5 tw-py-5 xl:tw-grid-cols-[1.4fr_1fr]">
      <div className="tw-grid tw-content-start tw-gap-5">
        <section aria-label="Where it runs">
          <h4 className="tw-m-0 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wider tw-text-muted">Where it runs</h4>
          <div className="tw-mt-2.5 tw-grid tw-gap-2.5 lg:tw-grid-cols-3">
            {ENVIRONMENTS.map((env) => (
              <div key={env} className="tw-rounded-control tw-border tw-border-solid tw-border-line tw-p-3">
                <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
                  <span className="tw-text-sm tw-font-semibold tw-text-ink">{envLabel(env)}</span>
                  {deployed[env] && <StatusChip tone="good">Live</StatusChip>}
                </div>
                {deployed[env] ? (
                  <code className="tw-mt-2 tw-block tw-text-sm tw-text-ink">v{deployed[env]}</code>
                ) : (
                  <span className="tw-mt-2 tw-block tw-text-sm tw-text-muted">Not deployed</span>
                )}
              </div>
            ))}
          </div>
        </section>
        <section aria-label="How its draft stands">
          <h4 className="tw-m-0 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wider tw-text-muted">How its draft stands</h4>
          {!health || health.state === 'unknown' ? (
            <p className="tw-m-0 tw-mt-1.5 tw-text-sm tw-text-muted">Not checked yet. Open it, or switch to the table to check every agent.</p>
          ) : health.state === 'ok' ? (
            <p className="tw-m-0 tw-mt-1.5 tw-flex tw-items-center tw-gap-1.5 tw-text-sm tw-font-medium tw-text-success">
              <Icon name="check" size={14} /> Its checks pass.
            </p>
          ) : (
            <ul className="tw-m-0 tw-mt-2 tw-grid tw-list-none tw-gap-1.5 tw-p-0">
              {health.parts.map((part) => (
                <li
                  key={part.id}
                  className={cx(
                    'tw-flex tw-items-center tw-justify-between tw-gap-3 tw-rounded-control tw-px-3 tw-py-2 tw-text-sm',
                    part.tone === 'bad' ? 'tw-text-danger' : 'tw-text-warning',
                  )}
                >
                  <span>{part.text.charAt(0).toUpperCase() + part.text.slice(1)}</span>
                  <button type="button" className="quietButton compactCta" onClick={() => go(part.tab)}>
                    Fix it
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <nav
        aria-label={`Go on with ${bot.name || bot.id}`}
        className="tw-grid tw-content-start tw-gap-2 tw-rounded-card tw-border tw-border-solid tw-border-line tw-p-4"
      >
        <h4 className="tw-m-0 tw-text-sm tw-font-semibold tw-text-ink">Go to</h4>
        {NEXT.map((next) => (
          <button
            key={next.page}
            type="button"
            className="tw-flex tw-h-10 tw-cursor-pointer tw-items-center tw-gap-2.5 tw-rounded-control tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-text-left tw-text-md tw-text-ink hover:tw-border-line-strong hover:tw-bg-subtle"
            onClick={() => go(next.page)}
          >
            <HueIcon name={next.icon} hue={next.hue} size={14} tile />
            {next.label}
            <span className="tw-ml-auto tw-flex tw-text-muted" aria-hidden="true">
              <Icon name="arrowRight" size={14} />
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
