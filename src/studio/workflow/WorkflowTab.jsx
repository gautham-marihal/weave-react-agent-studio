import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../ui/Icon.jsx';
import { groupIssues } from '../../api/client.js';
import { isObj } from '../form/engine.js';

import { Notice, Spinner } from '../ui.jsx';
import { usePref } from '../usePref.js';
import AddMenu from './AddMenu.jsx';
import Inspector from './Inspector.jsx';
import WorkflowCanvas, { clampZoom } from './WorkflowCanvas.jsx';
import { buildWorkflow, parseNodeId, SIZE, toolBlockCount } from './workflowModel.js';
import {
  addAgentTransfer,
  addEnd,
  addPhoneTransfer,
  addSay,
  addSubagent,
  addTool,
  addUpdateState,
  clearPositions,
  duplicateAgent,
  freeSpot,
  hasSavedPositions,
  removeNode,
  setPositions,
  whyKeepAgent,
} from './workflowOps.js';
import './workflow.css';

// The Workflow of an agent: how a call moves from where it starts, through the agents, to wherever it ends, as a picture that can be edited. Blocks are
// moved by dragging them and the layout is kept in the draft; agents, lines to say, transfers, tools and the end of the call are added with the ＋ under
// a block and taken away again; each change is an ordinary edit of the draft, with undo and redo here and Save draft like every other tab.
const BLANK = { past: [], future: [] };
// Undo history is kept per agent for as long as the page is open, so it survives a visit to another tab; it is dropped when the draft was changed some other
// way in between (then the steps no longer lead anywhere sensible).
const HISTORY = new Map();

// onShowSetting(path), onShowJson(path): how the agent's workspace shows a setting (it opens its page and panel) and the JSON
// onShowRole(), onShowGreeting(): where the instructions of the agent that answers first, and what it says first, are written (the Agent page); given,
// they are shown here, not asked
// toolbarSlot: an element of the page around (beside its tabs) to draw the toolbar in, so the picture gets the height
// (saving, Ctrl+S and a failed save are the workspace's, in its top bar, as on every page)
export default function WorkflowTab({ editor, botId, onShowSetting = null, onShowJson = null, onShowRole = null, onShowGreeting = null, toolbarSlot = null }) {
  const config = editor.parsed?.value;
  const ok = editor.status === 'ready' && !editor.parsed?.error && isObj(config);
  const [zoomPref, setZoomPref] = usePref('weave_workflow_zoom', 'auto');
  const [autoZoom, setAutoZoom] = useState(1);
  const autoDone = useRef(false);
  const [toolsPref, setToolsPref] = usePref('weave_workflow_tools', 'auto');
  const zoom = zoomPref === 'auto' ? autoZoom : clampZoom(Number(zoomPref) || 1);
  const setZoom = useCallback((z) => setZoomPref(String(clampZoom(z))), [setZoomPref]);
  const [selected, setSelected] = useState(null);
  const [menuFor, setMenuFor] = useState('');
  const [confirmFor, setConfirmFor] = useState('');
  const [announce, setAnnounce] = useState('');
  const [hist, setHist] = useState(() => {
    const kept = HISTORY.get(botId);
    return kept && kept.last === JSON.stringify(editor.parsed?.value) ? { past: kept.past, future: kept.future } : BLANK;
  });
  const viewport = useRef(null);
  const plusRef = useRef(null);
  const lastApplied = useRef(
    (() => {
      const kept = HISTORY.get(botId);
      return kept && kept.last === JSON.stringify(editor.parsed?.value) ? kept.last : '';
    })(),
  );
  const lastGroup = useRef({ group: '', at: 0 });
  const pendingSelect = useRef(null);
  // what was just deleted, said above the picture with Undo until the next change
  const [deleted, setDeleted] = useState(null); // { label, after: the draft the deletion left, as JSON }
  // the picture's height: what is left of the window below its top edge (never less than is comfortable), measured when it is drawn and when the window
  // changes size
  const workRef = useRef(null);
  const [workH, setWorkH] = useState(0);
  const measure = useCallback(() => {
    const el = workRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    // the same height again changes nothing (no new render)
    setWorkH(Math.round(Math.max(440, Math.min(980, window.innerHeight - top - 24))));
  }, []);
  // after every render: what is above the picture (a note, the toolbar moving beside the tabs) may have changed where it starts
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // tools are shown unless there are so many that they would bury the agents; the person can choose either way
  const toolBlocks = useMemo(() => (ok ? toolBlockCount(config) : 0), [config, ok]);
  const showTools = toolsPref === 'auto' ? toolBlocks <= 8 : toolsPref === '1';
  const flow = useMemo(() => (ok ? buildWorkflow(config, { tools: showTools }) : null), [config, ok, showTools]);

  // the first time it is opened it is sized to fit the window (never smaller than is comfortable to read), once the picture has its height; after that the
  // zoom is the person's
  useLayoutEffect(() => {
    const el = viewport.current;
    if (autoDone.current || !flow || !el || !workH) return;
    autoDone.current = true;
    setAutoZoom(clampZoom(Math.max(0.75, Math.min(1, (el.clientWidth - 16) / flow.bounds.w, (el.clientHeight - 16) / flow.bounds.h))));
  }, [flow, workH]);

  // the undo history belongs to the edits made here: when the draft changes some other way (reloaded, edited elsewhere) it starts again
  useEffect(() => {
    if (!ok) return;
    const now = JSON.stringify(config);
    if (lastApplied.current && now !== lastApplied.current) setHist(BLANK);
    lastApplied.current = now;
  }, [config, ok]);
  // "Deleted …, Undo" goes with the next change of the draft
  useEffect(() => {
    // by content: the editor hands the draft back as a new copy
    if (deleted && JSON.stringify(config) !== deleted.after) setDeleted(null);
  }, [config, deleted]);

  useEffect(() => {
    if (ok) HISTORY.set(botId, { past: hist.past, future: hist.future, last: lastApplied.current });
  }, [hist, config, ok, botId]);

  const apply = useCallback(
    (next, { group = '' } = {}) => {
      if (!next || next === config) return;
      const now = Date.now();
      const merge = group && lastGroup.current.group === group && now - lastGroup.current.at < 1500;
      lastGroup.current = { group, at: now };
      setHist((h) => ({ past: merge ? h.past : [...h.past, config].slice(-80), future: [] }));
      lastApplied.current = JSON.stringify(next);
      editor.setValue(next);
    },
    [config, editor],
  );
  const undo = () => {
    const prev = hist.past[hist.past.length - 1];
    if (!prev) return;
    setHist({ past: hist.past.slice(0, -1), future: [config, ...hist.future] });
    lastApplied.current = JSON.stringify(prev);
    lastGroup.current = { group: '', at: 0 };
    editor.setValue(prev);
  };
  const redo = () => {
    const [next, ...rest] = hist.future;
    if (!next) return;
    setHist({ past: [...hist.past, config], future: rest });
    lastApplied.current = JSON.stringify(next);
    lastGroup.current = { group: '', at: 0 };
    editor.setValue(next);
  };

  // a block that was just added is selected, scrolled to and announced once it is on the page
  useEffect(() => {
    const want = pendingSelect.current;
    if (!want || !flow) return;
    const found = want.type === 'edge' ? flow.edges.some((e) => e.id === want.id) : flow.nodes.some((n) => n.id === want.id);
    if (!found) return;
    pendingSelect.current = null;
    setSelected({ type: want.type, id: want.id });
    window.requestAnimationFrame(() => {
      const el = [...document.querySelectorAll('[data-node]')].find((x) => x.dataset.node === want.id);
      el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      el?.focus?.({ preventScroll: true });
    });
  }, [flow]);
  // asking "delete this agent?" puts the keyboard on the answer
  useEffect(() => {
    if (confirmFor) window.requestAnimationFrame(() => document.querySelector('.wfConfirmPop button')?.focus());
  }, [confirmFor]);
  useEffect(() => {
    if (selected && flow && (selected.type === 'node' ? !flow.nodes.some((n) => n.id === selected.id) : !flow.edges.some((e) => e.id === selected.id)))
      setSelected(null);
  }, [flow, selected]);

  const problems = useMemo(() => {
    const map = new Map();
    if (!ok) return { map, total: 0 };
    const items = Array.isArray(config.agents?.items) ? config.agents.items : [];
    const issues = groupIssues(editor.report).filter((i) => i.severity === 'error' && i.path);
    issues.forEach((i) => {
      if (i.path[0] === 'agents' && i.path[1] === 'items' && typeof i.path[2] === 'number') {
        const id = items[i.path[2]]?.id;
        if (id) map.set(id, (map.get(id) || 0) + 1);
      }
    });
    return { map, total: issues.length };
  }, [config, editor.report, ok]);

  const openSettings = (path) => onShowSetting?.(path);
  const openJson = (path) => onShowJson?.(path);
  const note = (text) => setAnnounce(text);

  const place = (nodeId) => {
    const n = flow.nodes.find((x) => x.id === nodeId);
    return n ? { x: n.x, y: n.y + n.h + 90 } : { x: 40, y: 40 };
  };
  const add = (type, payload, agentId) => {
    let result = { config, id: '' };
    let select = null;
    if (type === 'subagent') {
      const spot = hasSavedPositions(config) ? freeSpot(flow, place(agentId), SIZE.agent) : undefined;
      result = addSubagent(config, agentId, { at: spot, ...(payload?.name ? { name: payload.name, when: payload.when } : {}) });
      select = { type: 'node', id: result.id };
      note(payload?.name ? `Added ${payload.name}. Write what it should do in the panel.` : 'Added a subagent. Name it and say what it does in the panel.');
    } else if (type === 'say') {
      result = addSay(config, agentId);
      select = { type: 'node', id: result.id };
      note('Added a line to say as the agent takes over.');
    } else if (type === 'state') {
      result = addUpdateState(config, agentId);
      select = { type: 'node', id: result.id };
      note('Added a step that updates the call’s state.');
    } else if (type === 'agent') {
      const before = (config.agents.items.find((a) => a.id === agentId)?.handoffs || []).length;
      result = { config: addAgentTransfer(config, agentId, payload.to) };
      select = { type: 'edge', id: `${agentId}->${payload.to}::h${before}` };
      note('Added a way to pass the caller to another agent.');
    } else if (type === 'phone') {
      result = addPhoneTransfer(config, agentId, payload.number);
      select = { type: 'node', id: result.id };
      note('Added a transfer to a phone number.');
    } else if (type === 'tool') {
      result = addTool(config, agentId, payload.tool);
      select = { type: 'node', id: result.id };
      if (!showTools) setToolsPref('1');
      note('The agent can now use the tool.');
    } else if (type === 'end') {
      result = addEnd(config, agentId);
      select = { type: 'node', id: result.id };
      note('The agent can now end the call.');
    }
    if (result.config === config) return;
    pendingSelect.current = select;
    setMenuFor('');
    apply(result.config);
  };
  const remove = (nodeId) => {
    const n = flow.nodes.find((x) => x.id === nodeId);
    const next = removeNode(config, nodeId);
    if (next === config) return;
    note(`Deleted ${n?.label || 'the block'}.`);
    setConfirmFor('');
    setMenuFor('');
    setSelected(null);
    apply(next);
    setDeleted({ label: n?.label || 'the block', after: JSON.stringify(next) });
    // the keyboard goes to the agent the block belonged to (or, for an agent, the one that answers first), not to the page
    const owner = parseNodeId(nodeId).agent;
    const to = n?.type === 'agent' ? next.agents?.entry : owner;
    window.requestAnimationFrame(() => {
      const nodes = [...document.querySelectorAll('.wfNode')];
      (nodes.find((el) => el.dataset.node === to) || nodes[0])?.focus({ preventScroll: true });
    });
  };
  const duplicate = (nodeId) => {
    const n = flow.nodes.find((x) => x.id === nodeId);
    const spot = hasSavedPositions(config) && n ? freeSpot(flow, { x: n.x + n.w + 40, y: n.y }, SIZE.agent) : undefined;
    const result = duplicateAgent(config, nodeId, spot);
    if (result.config === config) return;
    pendingSelect.current = { type: 'node', id: result.id };
    note('Made a copy of the agent.');
    apply(result.config);
  };
  const move = (positions, opts) => apply(setPositions(config, positions), opts || {});
  const tidy = () => {
    if (hasSavedPositions(config)) {
      apply(clearPositions(config));
      note('Tidied up: every block is back in its place.');
    }
  };
  const fit = () => {
    const el = viewport.current;
    if (!el || !flow) return;
    setZoom(Math.min(1, (el.clientWidth - 16) / flow.bounds.w, (el.clientHeight - 16) / flow.bounds.h));
    el.scrollTo?.({ left: 0, top: 0 });
  };

  const onKeyDown = (event) => {
    const field = event.target.closest?.('input, textarea, select, [contenteditable]');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !field) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y' && !field) {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === 'Escape') {
      if (menuFor || confirmFor) {
        setMenuFor('');
        setConfirmFor('');
      } else if (selected && !field) setSelected(null);
    }
  };
  if (editor.status === 'loading') return <Spinner label="Loading the draft" />;
  if (!ok) {
    return (
      <Notice
        kind="warn"
        title="The draft can’t be drawn yet"
        actions={
          <button type="button" className="quietButton" onClick={() => onShowJson?.()}>
            Open the JSON
          </button>
        }
      >
        {editor.parsed?.error ? 'The JSON has a syntax error. Fix it in Settings › Edit as JSON and the workflow comes back.' : 'The draft could not be read.'}
      </Notice>
    );
  }

  // "Let <the first agent> pass callers to <one no call reaches>": a hand-over from the agent that answers first, selected so its words can be written
  const entryName = flow.nodes.find((n) => n.id === flow.entry)?.label || 'the first agent';
  const reach = (agentId) => {
    const before = (config.agents.items.find((a) => a.id === flow.entry)?.handoffs || []).length;
    pendingSelect.current = { type: 'edge', id: `${flow.entry}->${agentId}::h${before}` };
    note('Added a way to pass the caller on. Say when, in the panel.');
    apply(addAgentTransfer(config, flow.entry, agentId));
  };
  const overlay = ({ nodes }) => {
    const n = selected?.type === 'node' ? nodes.get(selected.id) : null;
    if (!n) return null;
    const z = zoom;
    const isAgent = n.type === 'agent';
    const keepReason = isAgent && confirmFor === n.id ? whyKeepAgent(config, parseNodeId(n.id).agent) : '';
    return (
      <>
        {n.type !== 'start' && (
          <div className="wfOverlayItem wfNodeTools" style={{ left: (n.x + n.w) * z + 10, top: n.y * z }} role="toolbar" aria-label={`Actions for ${n.label}`}>
            {isAgent && (
              <button type="button" aria-label={`Copy ${n.label}`} title="Make a copy" onClick={() => duplicate(n.id)}>
                <Icon name="copy" size={16} />
              </button>
            )}
            <button type="button" aria-label={`Delete ${n.label}`} title="Delete" onClick={() => (isAgent ? setConfirmFor(n.id) : remove(n.id))}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        )}
        {isAgent && (
          <button
            type="button"
            ref={plusRef}
            className="wfOverlayItem wfPlus"
            aria-label={`Add something after ${n.label}`}
            aria-expanded={menuFor === n.id}
            aria-haspopup="dialog"
            style={{ left: (n.x + n.w / 2) * z, top: (n.y + n.h) * z }}
            onClick={() => {
              setConfirmFor('');
              setMenuFor(menuFor === n.id ? '' : n.id);
            }}
          >
            <Icon name="plus" size={16} />
          </button>
        )}
        {isAgent && menuFor === n.id && (
          <div className="wfOverlayItem wfMenuAnchor" style={{ left: (n.x + n.w / 2) * z, top: (n.y + n.h) * z + 26 }}>
            <AddMenu
              agentId={n.id}
              flow={flow}
              config={config}
              onPick={(type, payload) => add(type, payload, n.id)}
              onClose={() => {
                setMenuFor('');
                window.requestAnimationFrame(() => plusRef.current?.focus());
              }}
            />
          </div>
        )}
        {confirmFor === n.id &&
          (keepReason ? (
            // an agent that can't go (the only one, or one something else can't do without): why, rather than a Delete that does nothing
            <div
              className="wfOverlayItem wfConfirmPop"
              role="alertdialog"
              aria-label={`${n.label} can’t be deleted`}
              style={{ left: (n.x + n.w) * z + 56, top: n.y * z }}
            >
              <strong>“{n.label}” can’t be deleted</strong>
              <p>{keepReason}</p>
              <div className="wfRow">
                <button type="button" className="quietButton" onClick={() => setConfirmFor('')}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div
              className="wfOverlayItem wfConfirmPop"
              role="alertdialog"
              aria-label={`Delete ${n.label}?`}
              style={{ left: (n.x + n.w) * z + 56, top: n.y * z }}
            >
              <strong>Delete “{n.label}”?</strong>
              <p>Callers can no longer be passed to it, and the hand-overs to it are removed.</p>
              <div className="wfRow">
                <button type="button" className="dangerButton" onClick={() => remove(n.id)}>
                  Delete
                </button>
                <button type="button" className="quietButton" onClick={() => setConfirmFor('')}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
      </>
    );
  };

  const toolbar = (
    // drawn in the page's own row when it gives one; its keys still reach the picture's handler (a portal passes them on)
    <div className="wfToolbar" role="toolbar" aria-label="Workflow tools">
      <div className="wfGroup">
        <button type="button" onClick={undo} disabled={!hist.past.length} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Icon name="undo" size={16} /> Undo
        </button>
        <button type="button" onClick={redo} disabled={!hist.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <Icon name="redo" size={16} /> Redo
        </button>
      </div>
      <div className="wfGroup" role="group" aria-label="Zoom">
        <button type="button" onClick={() => setZoom(zoom - 0.1)} disabled={zoom <= 0.4} aria-label="Zoom out" title="Zoom out">
          <Icon name="minus" size={16} />
        </button>
        <button type="button" className="wfZoom" onClick={() => setZoom(1)} aria-label={`Zoom ${Math.round(zoom * 100)}%. Reset to 100%`} title="Reset to 100%">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => setZoom(zoom + 0.1)} disabled={zoom >= 1.6} aria-label="Zoom in" title="Zoom in">
          <Icon name="plus" size={16} />
        </button>
        <button type="button" onClick={fit} aria-label="Fit to the window" title="Fit everything in the window">
          <Icon name="fit" size={16} /> Fit
        </button>
      </div>
      <div className="wfGroup">
        <button type="button" onClick={tidy} disabled={!hasSavedPositions(config)} title="Put every block back where it is placed automatically">
          Tidy up
        </button>
        <button
          type="button"
          aria-pressed={showTools}
          onClick={() => setToolsPref(showTools ? '0' : '1')}
          title={showTools ? 'Hide the tools to see the agents more clearly' : 'Show the tools each agent can use'}
        >
          {showTools ? 'Tools shown' : 'Tools hidden'}
          {!showTools && toolBlocks ? ` (${toolBlocks})` : ''}
        </button>
      </div>
    </div>
  );

  return (
    <div className="wfTab" onKeyDown={onKeyDown}>
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}

      {/* what needs saying about the picture, above it (never over a block) */}
      {deleted && (
        <div className="wfHint" role="status">
          <span>Deleted “{deleted.label}”.</span>
          <button type="button" className="quietButton" onClick={undo} disabled={!hist.past.length}>
            Undo
          </button>
        </div>
      )}
      {!flow.empty &&
        flow.strandedIds.map((id, i) => (
          <div key={id} className="wfHint warn" role="note">
            <span>
              “{flow.stranded[i]}” can’t be reached: nothing passes the caller to it from Start. Let an agent pass callers to it, or make it answer first.
            </span>
            {flow.entry && (
              <button type="button" className="quietButton" onClick={() => reach(id)}>
                Let {entryName} pass callers to it
              </button>
            )}
          </div>
        ))}
      {!flow.empty && !flow.stranded.length && flow.crowded && hasSavedPositions(config) && (
        <div className="wfHint" role="note">
          <span>Some blocks sit close together because the saved layout has no room for them.</span>
          <button type="button" className="quietButton" onClick={tidy}>
            Tidy up
          </button>
        </div>
      )}

      <div className="wfWork" ref={workRef} style={workH ? { '--wfH': `${workH}px` } : undefined}>
        <div className="wfCanvasBox">
          {flow.empty ? (
            <div className="wfEmpty">
              <Icon name="subagent" size={28} />
              <h3>No agents yet</h3>
              <p>An agent answers the caller. Add the first one and build the flow from there.</p>
              <button
                type="button"
                className="primaryCta compactCta"
                onClick={() => {
                  const r = addSubagent(config, '', { name: 'Front desk' });
                  pendingSelect.current = { type: 'node', id: r.id };
                  apply(r.config);
                }}
              >
                <Icon name="plus" size={14} /> Add the first agent
              </button>
            </div>
          ) : (
            <WorkflowCanvas
              flow={flow}
              selected={selected}
              onSelect={(sel) => {
                setSelected(sel);
                setMenuFor('');
                setConfirmFor('');
              }}
              onMove={move}
              zoom={zoom}
              onZoom={setZoom}
              badges={problems.map}
              overlay={overlay}
              onDeleteKey={(id) =>
                flow.nodes.find((n) => n.id === id)?.type === 'agent' ? (setSelected({ type: 'node', id }), setConfirmFor(id)) : remove(id)
              }
              viewportRef={viewport}
            />
          )}
        </div>
        <Inspector
          flow={flow}
          config={config}
          selected={selected}
          apply={apply}
          onSelect={(sel) => setSelected(sel)}
          onOpenSettings={openSettings}
          onOpenJson={openJson}
          onRemove={remove}
          onShowRole={onShowRole}
          onShowGreeting={onShowGreeting}
        />
      </div>

      <p className="srOnly" role="status">
        {announce}
      </p>
    </div>
  );
}
