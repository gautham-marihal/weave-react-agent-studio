import React, { useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';

// The path of one line through a call (canvas board G1), drawn from the agent's own guardrails: a caller says
// something, it is checked before the agent hears it, the agent answers, the answer is checked before it is said, and
// the caller hears it. Under it, what watches the whole call: the moments it hands over or ends, its own rules, its
// limits. Each check, moment and limit says what really happens to it: checked every time, told to the agent, or kept
// but not acted on by the server yet. The lines are measured from the boxes as laid out, so they fit any width.

const MOST = 5;
const HOW = { run: 'checked every time', told: 'told to the agent, not checked', kept: 'kept, not run yet', bad: 'needs a look' };

function Dot({ how }) {
  return (
    <>
      <i className={`grDot ${how}`} aria-hidden="true" />
      <span className="srOnly">({HOW[how]}) </span>
    </>
  );
}

function Gate({ node, title, checks, bad, onCheck, onMore, onAdd }) {
  const shown = checks.slice(0, MOST);
  return (
    <div className={`grGate ${checks.length ? '' : 'empty'}`} data-node={node}>
      <h4>
        <Icon name="shield" size={13} />
        {title}
        <em>{checks.length ? `${checks.length} ${checks.length === 1 ? 'check' : 'checks'}` : 'nothing yet'}</em>
      </h4>
      <div className="grChips">
        {shown.map((c) => (
          <button key={c.key} type="button" className={`grChip ${bad(c) ? 'bad' : ''}`} onClick={() => onCheck(c)}>
            <Dot how={bad(c) ? 'bad' : c.how} />
            {c.name}
            <small>· {c.short}</small>
          </button>
        ))}
        {checks.length > shown.length && (
          <button type="button" className="grChip" onClick={onMore}>
            + {checks.length - shown.length} more
          </button>
        )}
        {!checks.length && (
          <button type="button" className="grChip add" onClick={onAdd}>
            <Icon name="plus" size={12} />
            Add a check
          </button>
        )}
      </div>
    </div>
  );
}

export default function CallPath({ name, said, notRun, bad, onCheck, onToken, onAdd, onRule }) {
  const box = useRef(null);
  const [paths, setPaths] = useState([]);
  const key = JSON.stringify([said.input.length, said.output.length, said.allowed.length + said.blocked.length]);
  useLayoutEffect(() => {
    const draw = () => {
      const root = box.current;
      if (!root) return;
      const b = root.getBoundingClientRect();
      const at = (id) => root.querySelector(`[data-node="${id}"]`)?.getBoundingClientRect();
      const [says, hears, gin, gout, agent] = ['says', 'hears', 'in', 'out', 'agent'].map(at);
      if (!says || !hears || !gin || !gout || !agent) return;
      const x = (v) => v - b.left;
      const y = (v) => v - b.top;
      const ys = y(says.top + says.height / 2);
      const yh = y(hears.top + hears.height / 2);
      const ax = x(agent.left + agent.width / 2);
      setPaths([
        `M${x(says.right)} ${ys} L${x(gin.left)} ${ys}`,
        `M${x(gin.right)} ${ys} C${ax} ${ys} ${ax} ${ys} ${ax} ${y(agent.top)}`,
        `M${ax} ${y(agent.bottom)} C${ax} ${yh} ${ax} ${yh} ${x(gout.right)} ${yh}`,
        `M${x(gout.left)} ${yh} L${x(hears.right)} ${yh}`,
      ]);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [key]);

  const topics = said.allowed.length + said.blocked.length;
  const kept = (on) => (on ? 'kept' : 'run');
  const watching = [
    ...said.person.map((m) => ({
      k: m.id,
      words: m.id === 'frustrated_to_person' ? 'A frustrated caller' : 'Asks for a manager',
      sub: 'to a person',
      how: kept(notRun.escalation),
      go: () => onToken('moments'),
    })),
    ...(said.abusive ? [{ k: 'abusive', words: 'Someone abusive', sub: 'ends the call', how: kept(notRun.escalation), go: () => onToken('moments') }] : []),
    ...said.rules.map((r) => ({ k: `rule:${r.key}`, words: r.name, sub: r.then || 'does nothing yet', how: kept(notRun.escalation), go: () => onRule(r) })),
    ...said.limits.map((l) => ({ k: l.key, words: l.label, sub: l.words, how: 'run', go: () => onToken('limits') })),
  ];
  const hows = new Set([...said.input, ...said.output].map((c) => (bad(c) ? 'bad' : c.how)).concat(watching.map((w) => w.how)));
  if (topics) hows.add(kept(notRun.topics));

  return (
    <figure className="grFigure">
      <div className="grLoop" ref={box}>
        <svg className="grLines" aria-hidden="true">
          <defs>
            <marker id="gr-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L8 4L0 8z" />
            </marker>
          </defs>
          {paths.map((d) => (
            <path key={d} d={d} markerEnd="url(#gr-arrow)" />
          ))}
        </svg>
        <div className="grEnd says" data-node="says">
          <span className="cxIcon" aria-hidden="true">
            <Icon name="user" size={14} />
          </span>
          <span className="cxText">
            <b>A caller</b>
            <small>says something</small>
          </span>
        </div>
        <Gate
          node="in"
          title={`Checked before ${name} hears it`}
          checks={said.input}
          bad={bad}
          onCheck={onCheck}
          onMore={() => onToken('input')}
          onAdd={() => onAdd('input')}
        />
        <div className="grAgent" data-node="agent">
          <span className="grWho">
            <span className="saAvatar grAvatar" aria-hidden="true">
              <Icon name="agent" size={14} />
            </span>
            <b>{name}</b>
          </span>
          {said.allowed.length > 0 && (
            <button type="button" className="grChip" onClick={() => onToken('topics')}>
              <Dot how={kept(notRun.topics)} />
              keeps to {said.allowed.length} {said.allowed.length === 1 ? 'topic' : 'topics'}
            </button>
          )}
          {said.blocked.length > 0 && (
            <button type="button" className="grChip" onClick={() => onToken('topics')}>
              <Dot how={kept(notRun.topics)} />
              {said.blocked.length} off limits
            </button>
          )}
          {!topics && <small>only its instructions</small>}
        </div>
        <div className="grEnd hears" data-node="hears">
          <span className="cxIcon" aria-hidden="true">
            <Icon name="user" size={14} />
          </span>
          <span className="cxText">
            <b>They hear</b>
            <small>its answer</small>
          </span>
        </div>
        <Gate
          node="out"
          title="Checked before it is said"
          checks={said.output}
          bad={bad}
          onCheck={onCheck}
          onMore={() => onToken('output')}
          onAdd={() => onAdd('output')}
        />
      </div>
      <div className="grWatch">
        <h4>Watching the whole call</h4>
        <div className="grChips">
          {watching.map((w) => (
            <button key={w.k} type="button" className="grChip" onClick={w.go}>
              <Dot how={w.how} />
              {w.words}
              <small>· {w.sub}</small>
            </button>
          ))}
          {!watching.length && (
            <>
              <span className="grChip quiet">Nothing watches the whole call yet</span>
              <button type="button" className="grChip add" onClick={() => onToken('limits')}>
                <Icon name="plus" size={12} />
                Add a limit
              </button>
            </>
          )}
        </div>
      </div>
      <figcaption className="cxLegend grLegend">
        {['run', 'told', 'kept', 'bad']
          .filter((h) => hows.has(h))
          .map((h) => (
            <span key={h}>
              <i className={`grDot ${h}`} aria-hidden="true" />
              {h === 'told' ? `told to ${name}, not checked` : h === 'kept' ? 'kept, but the server doesn’t act on it yet' : HOW[h]}
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
