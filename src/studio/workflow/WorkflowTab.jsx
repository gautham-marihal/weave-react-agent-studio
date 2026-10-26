import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import Icon from '../../ui/Icon.jsx';
import Tip from '../../ui/Tip.tsx';
import { afterMenu, keepEscape } from '../../ui/layer.ts';
import { groupIssues } from '../../api/client.ts';
import { isObj } from '../form/engine.js';

import { Notice, Spinner } from '../ui.jsx';
import { usePref } from '../usePref.js';
import AddMenu from './AddMenu.jsx';
import Inspector from './Inspector.jsx';
import WorkflowCanvas, { clampZoom } from './WorkflowCanvas.jsx';
import { buildWorkflow, parseNodeId, SIZE } from './workflowModel.js';
import {
  addAgentTransfer,
  addBackToStart,
  addTransferToAgent,
  moveEnterStep,
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
import { TEMPLATES } from './workflowTemplates.js';
import { useWorkspaceAgents } from './useWorkspaceAgents.js';
import { NOTE_SIZE, newNote, readNotes, writeNotes } from './notes.js';
import { resetMeasure } from './textMeasure.js';
import { navigate, routeHref } from '../route.js';
import Select from '../../ui/Select.tsx';
import './workflow.css';

// The Workflow of an agent: how a call moves from where it starts, through the agents, to wherever it ends, as a
// picture that can be edited. Blocks are moved by dragging them and the layout is kept in the draft; agents, lines to
// say, transfers, tools and the end of the call are added with the ＋ under a block and taken away again; each change is
// an ordinary edit of the draft, with undo and redo here and Save draft like every other tab.
const BLANK = { past: [], future: [] };
// Undo history is kept per agent for as long as the page is open, so it survives a visit to another tab; it is dropped
// when the draft was changed some other way in between (then the steps no longer lead anywhere sensible).
const HISTORY = new Map();

// onShowSetting(path), onShowJson(path): how the agent's workspace shows a setting (it opens its page and panel) and the JSON
// (saving, Ctrl+S and a failed save are the workspace's, in its top bar, as on every page)
// workspace: the workspace's agents and their numbers, when the page around already has them (else they are asked for here)
export default function WorkflowTab({ editor, botId, onShowSetting = null, onShowJson = null, onTest = null, workspace: given = null }) {
  const config = editor.parsed?.value;
  const ok = editor.status === 'ready' && !editor.parsed?.error && isObj(config);
  // how many hand-overs an agent has (a null or half-typed item in the list is skipped, not read)
  const handoffCount = (agentId) => {
    const agent = (Array.isArray(config?.agents?.items) ? config.agents.items : []).find((a) => isObj(a) && a.id === agentId);
    return Array.isArray(agent?.handoffs) ? agent.handoffs.length : 0;
  };
  // the zoom is the person's, kept from one visit to the next; the first time, the picture is fitted to the window
  // (never smaller than is comfortable)
  const [zoomPref, setZoomPref] = usePref('weave_workflow_zoom', 'auto');
  const [autoFit] = useState(() => zoomPref === 'auto');
  const [zoom, setZoomShown] = useState(() => (zoomPref === 'auto' ? 1 : clampZoom(Number(zoomPref) || 1)));
  const [toolsPref, setToolsPref] = usePref('weave_workflow_tools', 'auto');
  // the panel beside the picture: hidden to give the picture the whole width, kept so from one visit to the next
  const [panel, setPanel] = usePref('weave_workflow_panel', 'open');
  const panelOpen = panel !== 'closed';
  // the canvas filling the window, over the page (Esc or the same button goes back), kept so from one visit to the next
  const [fullPref, setFullPref] = usePref('weave_workflow_full', 'off');
  const full = fullPref === 'on';
  const tabRef = useRef(null);
  const escapeRef = useRef(null);
  const setZoom = useCallback(
    (z) => {
      setZoomShown(clampZoom(z));
      setZoomPref(String(clampZoom(z)));
    },
    [setZoomPref],
  );
  // the picture says where its zoom ended up: kept when the person zoomed it (a pinch, Ctrl and the wheel, the overview)
  const onZoom = useCallback(
    (z, byPerson) => {
      setZoomShown(z);
      if (byPerson) setZoomPref(String(z));
    },
    [setZoomPref],
  );
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
  // the picture's height: what is left of the window below its top edge (never less than is comfortable), measured when
  // it is drawn and when the window changes size
  const workRef = useRef(null);
  // A button that goes as it is pressed (the panel's own Hide, its Close) would leave the keyboard on nothing: it goes
  // to what is still there instead, the toolbar's panel button, or the block that was selected (else the toolbar).
  const keepKeyboard = (find) =>
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      find()?.focus({ preventScroll: true });
    });
  const hidePanel = () => {
    setPanel('closed');
    keepKeyboard(() => workRef.current?.querySelector('.wfCanvasTools [data-tool="panel"]'));
  };
  const unscroll = (event) => {
    const el = event.target;
    if (!(el instanceof Element) || el.closest('.wfMenu')) return;
    if (el.scrollTop || el.scrollLeft) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  };
  // The controls come first in the page; Tab on the selected block brings the keyboard to them, and from there, Tab
  // from the last goes on to the block after it (or the panel) and Shift+Tab from the first back to the block. Reached
  // any other way, Tab and Shift+Tab go on in the page's order.
  const overlayKeys = (event) => {
    if (event.key !== 'Tab') return;
    const layer = event.currentTarget.closest('.wfOverlayLayer');
    if (!layer || layer.dataset.from !== selected?.id) return;
    const items = [...document.querySelectorAll('.wfOverlayLayer .wfNodeTools button, .wfOverlayLayer .wfPlus')];
    const at = items.indexOf(event.target);
    if (at < 0) return;
    if ((event.shiftKey && at === 0) || (!event.shiftKey && at === items.length - 1)) delete layer.dataset.from;
    const blocks = [...document.querySelectorAll('.wfScroll .wfNode')];
    const self = blocks.find((b) => b.dataset.node === selected?.id);
    if (event.shiftKey && at === 0 && self) {
      event.preventDefault();
      self.focus({ preventScroll: true });
    } else if (!event.shiftKey && at === items.length - 1) {
      const after = blocks[blocks.indexOf(self) + 1] || document.querySelector('.wfInspector button, .wfInspector input');
      if (!after) return;
      event.preventDefault();
      after.focus({ preventScroll: true });
    }
  };
  const closeConfirm = () => {
    setConfirmFor('');
    window.requestAnimationFrame(() => document.querySelector('.wfNodeTools button[aria-label^="Delete "]')?.focus({ preventScroll: true }));
  };
  // "Add a step after <subagent>": shown in the side panel (opened if it was hidden), the ⊕ keeps its place on the picture
  const openAdd = (agentId) => {
    setConfirmFor('');
    setMenuFor(agentId);
    if (agentId) setPanel('open');
  };
  const closeAdd = () => {
    setMenuFor('');
    window.requestAnimationFrame(() => plusRef.current?.focus({ preventScroll: true }));
  };
  // a port under a subagent: its model, the knowledge it reads, its tools (the part of its panel that holds them)
  const openPort = (agentId, port) => {
    setMenuFor('');
    setConfirmFor('');
    setPanel('open');
    if (port === 'model' && flow.nodes.some((n) => n.id === `${agentId}::model`)) setSelected({ type: 'node', id: `${agentId}::model` });
    else setSelected({ type: 'node', id: agentId, tab: port === 'knowledge' ? 'knowledge' : port === 'tool' ? 'tools' : 'general' });
  };
  // A block opened to change it (a double click, or Enter on the selected block): selected, its panel shown, and, once the panel is drawn (a frame,
  // then another; a block already selected draws nothing new), the cursor in the panel's first field, after what it says
  const openToEdit = (id) => {
    setMenuFor('');
    setConfirmFor('');
    setSelected((was) => (was?.type === 'node' && was.id === id && !was.tab ? was : { type: 'node', id }));
    setPanel('open');
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const field = workRef.current?.querySelector(
          '.wfInspector :is(input:not([type=checkbox]):not([type=radio]), textarea, button.rxSelect):not(:disabled)',
        );
        if (!field) return;
        field.focus({ preventScroll: true });
        try {
          field.setSelectionRange?.(field.value.length, field.value.length);
        } catch {
          // a field with no caret (a number)
        }
      }),
    );
  };
  // sticky notes, kept in this browser for this agent
  const [notes, setNotesState] = useState(() => readNotes(botId));
  useEffect(() => setNotesState(readNotes(botId)), [botId]);
  const setNotes = (next) => {
    setNotesState(next);
    writeNotes(botId, next);
  };
  const changeNote = (id, patch) => setNotes(notes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const addNote = () => {
    // in the middle of what is in sight, moved to the nearest place that covers no block (a note on a block would be dragged with it by mistake)
    const middle = viewport.current?.center?.() || { x: 300, y: 200 };
    const spot = freeSpot(flow, { x: middle.x - NOTE_SIZE.w / 2, y: middle.y - NOTE_SIZE.h / 2 }, { w: NOTE_SIZE.w, h: NOTE_SIZE.h });
    const made = newNote(notes, { x: spot.x + NOTE_SIZE.w / 2, y: spot.y + NOTE_SIZE.h / 2 });
    setNotes([...notes, made]);
    setMenuFor('');
    setPanel('open');
    setSelected({ type: 'note', id: made.id, edit: true });
    // brought into sight, if the free place was out of it
    window.requestAnimationFrame(() => viewport.current?.reveal?.(made.id));
    note('Added a note. Write it in the panel.');
  };
  const deleteNote = (id) => {
    setNotes(notes.filter((n) => n.id !== id));
    setSelected(null);
    note('Deleted the note.');
  };
  const lastSelected = useRef(null);
  useEffect(() => {
    const before = lastSelected.current;
    lastSelected.current = selected;
    if (selected || !before) return;
    keepKeyboard(
      () =>
        (before.type === 'node' && [...(workRef.current?.querySelectorAll('.wfNode') || [])].find((el) => el.dataset.node === before.id)) ||
        workRef.current?.querySelector('.wfCanvasTools button:not(:disabled)'),
    );
  }, [selected]);
  const [workH, setWorkH] = useState(0);
  const measure = useCallback(() => {
    const el = workRef.current;
    if (!el) return;
    // filling the window, the picture's height is the window's (CSS)
    if (el.closest('.wfTab.full')) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    // what the window leaves below the picture's top, so its foot (the zoom, Test the agent) is in sight; the same height again changes nothing
    setWorkH(Math.round(Math.max(360, Math.min(1400, window.innerHeight - top - 16))));
  }, []);
  // after every render: what is above the picture (a note, the toolbar moving beside the tabs) may have changed where it starts
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Filling the window, the page under it is out of reach (inert) for the keyboard and a screen reader, as under a
  // dialog; what opens over it later (a drawer, a menu) is not. Put back as it was when the canvas goes back to the
  // page. Also when it opens full straight away: the canvas is there only once the draft is read (`ok`), so that is
  // waited for.
  useEffect(() => {
    if (!full || !ok || !tabRef.current) return undefined;
    const made = [];
    for (let el = tabRef.current; el.parentElement && el !== document.body; el = el.parentElement) {
      [...el.parentElement.children].forEach((other) => {
        if (other === el || other.inert || other.matches('script, style, link')) return;
        other.inert = true;
        made.push(other);
      });
    }
    return () => made.forEach((other) => (other.inert = false));
  }, [full, ok]);
  // filling the window, Esc that reached the page (nothing focused) is the canvas's too; one meant for a layer open over it (a drawer, a menu) is not
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || tabRef.current?.contains(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], .nlDrawer')) return;
      escapeRef.current?.(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);
  // back on the page, the picture's height is measured again
  useEffect(() => {
    if (!full) measure();
  }, [full, measure]);

  // what each subagent uses is shown under it (small, round), unless the person hides it
  const showTools = toolsPref !== '0';
  // the other agents of the workspace and their numbers: a transfer to one of them is drawn as an Agent transfer
  const asked = useWorkspaceAgents();
  const workspace = given || asked;
  const workspaceAgents = workspace.agents;
  // blocks are sized to their words, measured in the page's font: measured again once the fonts have loaded, and when the style changes the font
  const [fontsAt, setFontsAt] = useState(0);
  useEffect(() => {
    const again = () => {
      resetMeasure();
      setFontsAt(Date.now());
    };
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    fonts?.ready?.then(again);
    fonts?.addEventListener?.('loadingdone', again);
    const watch = typeof MutationObserver !== 'undefined' ? new MutationObserver(again) : null;
    watch?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-style'] });
    return () => {
      fonts?.removeEventListener?.('loadingdone', again);
      watch?.disconnect();
    };
  }, []);
  const flow = useMemo(
    () => (ok ? buildWorkflow(config, { tools: showTools, workspace: { agents: workspaceAgents } }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, ok, showTools, workspaceAgents, fontsAt],
  );

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
      // the view moves to it only if it is out of sight
      if (want.type === 'node') viewport.current?.reveal?.(want.id);
      const el = [...document.querySelectorAll('[data-node]')].find((x) => x.dataset.node === want.id);
      el?.focus?.({ preventScroll: true });
    });
  }, [flow]);
  // asking "delete this agent?" puts the keyboard on the answer
  useEffect(() => {
    if (!confirmFor) return;
    window.requestAnimationFrame(() => {
      const pop = document.querySelector('.wfConfirmPop');
      pop?.querySelector('button')?.focus({ preventScroll: true });
      if (pop) viewport.current?.keepInSight?.(pop);
    });
  }, [confirmFor]);
  // a selection whose block, arrow or note is gone (deleted, undone) is let go
  useEffect(() => {
    if (!selected || !flow) return;
    const there =
      selected.type === 'note'
        ? notes.some((n) => n.id === selected.id)
        : selected.type === 'node'
          ? flow.nodes.some((n) => n.id === selected.id)
          : flow.edges.some((e) => e.id === selected.id);
    if (!there) setSelected(null);
  }, [flow, selected, notes]);

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
  const note = (text) => setAnnounce((said) => (said === text ? `${text}\u00a0` : text));

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
      const before = handoffCount(agentId);
      result = { config: addAgentTransfer(config, agentId, payload.to) };
      select = { type: 'edge', id: `${agentId}->${payload.to}::h${before}` };
      note('Added a way to pass the caller to another subagent.');
    } else if (type === 'agentTransfer') {
      result = addTransferToAgent(config, agentId, payload.agent);
      select = { type: 'node', id: result.id };
      note(`Added a transfer to ${payload.agent.name}.`);
    } else if (type === 'back') {
      result = addBackToStart(config, agentId);
      note('It can now pass the caller back to the first subagent.');
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
      note('The agent can now end the conversation.');
    }
    if (result.config === config) {
      if (type === 'phone' && result.id) {
        setMenuFor('');
        setSelected({ type: 'node', id: result.id });
        note('It can already pass the caller to this number.');
      }
      return;
    }
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
    note('Made a copy of the subagent.');
    apply(result.config);
  };
  const move = (positions, opts) => apply(setPositions(config, positions), opts || {});
  // a step run earlier or later as its agent takes over: it stays selected
  const moveStep = (agentId, index, delta) => {
    const done = moveEnterStep(config, agentId, index, delta);
    if (done.config === config) return;
    pendingSelect.current = { type: 'node', id: done.id };
    note(delta < 0 ? 'The step now runs earlier.' : 'The step now runs later.');
    apply(done.config);
  };
  // a template: added in one go (one step of Undo), what it adds selected and said
  const addTemplate = (template) => {
    const done = template.apply(config);
    if (done.config === config) return;
    pendingSelect.current = done.select ? { type: 'node', id: done.select } : null;
    note(done.note);
    apply(done.config);
  };
  // every block back where the layout puts it (in columns, no line through a block, nothing on anything), then all of it in sight
  const tidy = () => {
    if (hasSavedPositions(config)) {
      apply(clearPositions(config));
      note('Tidied up: every block is back in its place.');
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => fit()));
  };
  // everything in sight, and that zoom kept
  const fit = async () => {
    const z = await viewport.current?.fit?.();
    if (z) setZoom(z);
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
    if (event.key === 'Escape') escape(!!field);
  };
  // Esc: the question asked, then the Add panel, then the selection, then the canvas filling the window
  const escape = (inField) => {
    if (confirmFor) closeConfirm();
    else if (menuFor) setMenuFor('');
    else if (selected && !inField) setSelected(null);
    else if (full && !inField) setFullPref('off');
  };
  escapeRef.current = escape;
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

  // "Let <the first agent> pass callers to <one no call reaches>": a hand-over from the agent that answers first,
  // selected so its words can be written
  const entryName = flow.nodes.find((n) => n.id === flow.entry)?.label || 'the first subagent';
  const reach = (agentId) => {
    const before = handoffCount(flow.entry);
    pendingSelect.current = { type: 'edge', id: `${flow.entry}->${agentId}::h${before}` };
    note('Added a way to pass the caller on. Say when, in the panel.');
    apply(addAgentTransfer(config, flow.entry, agentId));
  };
  const overlay = ({ nodes, zoom: z }) => {
    const n = selected?.type === 'node' ? nodes.get(selected.id) : null;
    if (!n) return null;
    const isAgent = n.type === 'agent';
    const keepReason = isAgent && confirmFor === n.id ? whyKeepAgent(config, parseNodeId(n.id).agent) : '';
    // Its actions sit above it, unless that covers another block (two stacked close together): then under it (not under
    // a subagent, where what it uses hangs), or beside it on the right (clear of its ⊕). Sizes are the toolbar's on the
    // screen, in the picture's units.
    const tw = (isAgent ? 76 : 42) / z;
    const th = 42 / z;
    const gap = 8 / z;
    const taken = [...nodes.values()].filter((m) => m.id !== n.id);
    if (isAgent) taken.push({ x: n.x + n.w + 26 / z, y: n.y + n.h - 14 / z, w: 28 / z, h: 28 / z });
    const clear = (r) => !taken.some((m) => r.x < m.x + m.w && r.x + r.w > m.x && r.y < m.y + m.h && r.y + r.h > m.y);
    const spots = [
      { at: 'above', box: { x: n.x + n.w / 2 - tw / 2, y: n.y - gap - th, w: tw, h: th }, left: (n.x + n.w / 2) * z, top: n.y * z - 8 },
      ...(isAgent
        ? []
        : [{ at: 'below', box: { x: n.x + n.w / 2 - tw / 2, y: n.y + n.h + gap, w: tw, h: th }, left: (n.x + n.w / 2) * z, top: (n.y + n.h) * z + 8 }]),
      { at: 'right', box: { x: n.x + n.w + gap, y: n.y, w: tw, h: th }, left: (n.x + n.w) * z + 8, top: n.y * z },
    ];
    const spot = spots.find((s) => clear(s.box)) || spots[0];
    return (
      <>
        {n.type !== 'start' && n.type !== 'trigger' && n.type !== 'model' && (
          <div
            className={`wfOverlayItem wfNodeTools ${spot.at}`}
            style={{ left: spot.left, top: spot.top }}
            role="toolbar"
            aria-label={`Actions for ${n.label}`}
            onKeyDown={overlayKeys}
          >
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
            onKeyDown={overlayKeys}
            aria-label={`Add a step after ${n.label}`}
            aria-expanded={menuFor === n.id}
            style={{ left: (n.x + n.w) * z + 26, top: (n.y + n.h) * z - 14 }}
            onClick={() => openAdd(menuFor === n.id ? '' : n.id)}
          >
            <Icon name="plus" size={16} />
          </button>
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
                <button type="button" className="quietButton" onClick={closeConfirm}>
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
                <button type="button" className="quietButton" onClick={closeConfirm}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
      </>
    );
  };

  // a button of the toolbar: an icon with its name in a tip, or (text) with its name beside it too
  const tool = (label, icon, onClick, { disabled = false, pressed, tip, id, text = false } = {}) => (
    <Tip label={disabled ? '' : tip || label}>
      <button
        type="button"
        className={`wfTool ${text ? 'wfWithText' : ''}`}
        data-tool={id}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon name={icon} size={18} />
        {text && label}
      </button>
    </Tip>
  );
  const selectedAgent = selected?.type === 'node' && flow.nodes.find((n) => n.id === selected.id)?.type === 'agent' ? selected.id : '';
  // the zoom, in the lower left of the picture; testing the agent, at the foot of it
  const zoomBar = (
    <div className="wfZoomBar" role="toolbar" aria-label="Zoom">
      {tool('Fit to the window', 'fit', fit, { tip: 'Fit everything in the window (1)' })}
      {tool('Zoom out', 'zoomOut', () => setZoom(zoom - 0.1), { disabled: zoom <= 0.3 })}
      <Tip label="Reset to 100%">
        <button type="button" className="wfTool wfZoom" onClick={() => setZoom(1)} aria-label={`Zoom ${Math.round(zoom * 100)}%. Reset to 100%`}>
          {Math.round(zoom * 100)}%
        </button>
      </Tip>
      {tool('Zoom in', 'zoomIn', () => setZoom(zoom + 0.1), { disabled: zoom >= 1.6 })}
    </div>
  );
  const toolbar = (
    // over the top-left of the picture, so the picture gets the height; its keys still reach the picture's handler
    <div className="wfCanvasTools" role="toolbar" aria-label="Workflow tools">
      <AgentChooser botId={botId} agents={workspace.agents} />
      <span className="wfToolGap" aria-hidden="true" />
      {tool('Undo', 'undo', undo, { disabled: !hist.past.length, tip: 'Undo (Ctrl+Z)' })}
      {tool('Redo', 'redo', redo, { disabled: !hist.future.length, tip: 'Redo (Ctrl+Shift+Z)' })}
      <span className="wfToolGap" aria-hidden="true" />
      {tool('Add a step', 'plus', () => openAdd(selectedAgent || flow.entry), {
        disabled: !flow.entry,
        tip: selectedAgent ? 'Add a step after the selected subagent' : 'Add a step after the subagent that answers first',
      })}
      {tool('Add a note', 'note', addNote, { tip: 'Add a sticky note (kept in this browser)' })}
      {tool('Tidy up', 'tidy', tidy, { tip: 'Put every block in order, with no line through a block, and fit it all in sight', text: true })}
      {tool(showTools ? 'Hide what each subagent uses' : 'Show what each subagent uses', 'plug', () => setToolsPref(showTools ? '0' : '1'), {
        pressed: showTools,
        tip: showTools
          ? 'Hide the models, knowledge and tools plugged in under each subagent'
          : 'Show the models, knowledge and tools plugged in under each subagent',
      })}
      {tool('Make a copy of the selected subagent', 'copy', () => duplicate(selectedAgent), {
        disabled: !selectedAgent,
        tip: 'Make a copy of the selected subagent',
      })}
      <span className="wfToolGap" aria-hidden="true" />
      <Templates config={config} onPick={addTemplate} />
      <span className="wfToolGap" aria-hidden="true" />
      {tool(panelOpen ? 'Hide the panel' : 'Show the panel', 'panelRight', () => setPanel(panelOpen ? 'closed' : 'open'), { pressed: panelOpen, id: 'panel' })}
      {tool(full ? 'Back to the page' : 'Expand the canvas', full ? 'collapse' : 'expand', () => setFullPref(full ? 'off' : 'on'), {
        pressed: full,
        id: 'full',
        tip: full ? 'Back to the page (Esc)' : 'Fill the window with the canvas',
      })}
    </div>
  );

  return (
    <div className={`wfTab ${full ? 'full' : ''}`} ref={tabRef} onKeyDown={onKeyDown}>
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

      <div className={`wfWork ${panelOpen ? '' : 'wide'}`} ref={workRef} style={workH ? { '--wfH': `${workH}px` } : undefined}>
        <div className="wfCanvasBox" onScrollCapture={unscroll}>
          {!flow.empty && toolbar}
          {!flow.empty && zoomBar}
          {!flow.empty && onTest && (
            <button
              type="button"
              className="wfTestButton"
              title={full ? 'Back to the page, with the test beside it' : undefined}
              onClick={() => {
                if (full) setFullPref('off');
                onTest();
              }}
            >
              <Icon name="play" size={15} /> Test the agent
            </button>
          )}
          {flow.empty ? (
            <div className="wfEmpty">
              <Icon name="subagent" size={28} />
              <h3>No subagents yet</h3>
              <p>A subagent answers the caller. Add the first one and build the flow from there.</p>
              <button
                type="button"
                className="primaryCta compactCta"
                onClick={() => {
                  const r = addSubagent(config, '', { name: 'Front desk' });
                  pendingSelect.current = { type: 'node', id: r.id };
                  apply(r.config);
                }}
              >
                <Icon name="plus" size={14} /> Add the first subagent
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
                if (sel) setPanel('open');
              }}
              onOpen={openToEdit}
              onMove={move}
              zoom={zoom}
              autoFit={autoFit}
              onZoom={onZoom}
              onConnectAgents={(from, to) => add('agent', { to }, from)}
              onPort={openPort}
              showPlugs={showTools}
              notes={notes}
              onNoteChange={changeNote}
              badges={problems.map}
              overlay={overlay}
              onDeleteKey={(id) =>
                flow.nodes.find((n) => n.id === id)?.type === 'agent' ? (setSelected({ type: 'node', id }), setConfirmFor(id)) : remove(id)
              }
              viewportRef={viewport}
            />
          )}
        </div>
        {panelOpen && menuFor && flow.nodes.some((n) => n.id === menuFor) && (
          <AddMenu
            agentId={menuFor}
            flow={flow}
            config={config}
            onPick={(type, payload) => add(type, payload, menuFor)}
            workspace={workspace}
            botId={botId}
            onClose={closeAdd}
          />
        )}
        {panelOpen && !(menuFor && flow.nodes.some((n) => n.id === menuFor)) && (
          <Inspector
            flow={flow}
            config={config}
            selected={selected}
            apply={apply}
            onSelect={(sel) => setSelected(sel)}
            onOpenSettings={openSettings}
            onOpenJson={openJson}
            onRemove={remove}
            onHide={hidePanel}
            notes={notes}
            onNoteChange={changeNote}
            onNoteDelete={deleteNote}
            workspace={workspace}
            botId={botId}
            onMoveStep={moveStep}
            onDeleted={(label, next) => {
              note(`Deleted ${label}.`);
              setDeleted({ label, after: JSON.stringify(next) });
            }}
            onAddHandoff={(from, to) => add('agent', { to }, from)}
          />
        )}
      </div>

      <p className="srOnly" role="status">
        {announce}
      </p>
    </div>
  );
}

// "Templates": ready-made pieces of a workflow (workflowTemplates.js), each with what it adds, or why it can't be used here
function Templates({ config, onPick }) {
  return (
    <DropdownMenu.Root modal={false}>
      <Tip label="Add a ready-made piece of a workflow" hoverOnly>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="wfTool wfTemplates">
            <Icon name="template" size={18} /> Templates
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="wfTemplateMenu rxLayer" align="start" sideOffset={6} collisionPadding={12} onEscapeKeyDown={keepEscape}>
          {TEMPLATES.map((template) => {
            const why = template.unavailable(config);
            return (
              <DropdownMenu.Item key={template.id} disabled={!!why} onSelect={afterMenu(() => onPick(template))} asChild>
                <button type="button">
                  <strong>{template.title}</strong>
                  <small>{why || template.description}</small>
                </button>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Which agent's workflow this is, and the way to another's (asked first when there are unsaved edits, as everywhere)
function AgentChooser({ botId, agents }) {
  const list = agents?.length ? agents : [{ id: botId, name: botId }];
  return (
    <Select
      className="wfAgentChooser"
      aria-label="Agent"
      title="Open another agent’s workflow"
      value={botId}
      onChange={(event) => event.target.value !== botId && navigate(routeHref(event.target.value, 'workflow'))}
    >
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </Select>
  );
}
