import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LayoutGridIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  MapIcon,
  MaximizeIcon,
  PanelLeftIcon,
  PlayIcon,
  PlusIcon,
  Redo2Icon,
  SlidersHorizontalIcon,
  StickyNoteIcon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import type { AgentConfig, Issue, Path } from '../../../types/studio';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import { useProviders } from '../../../hooks/useProviders';
import { targetPath, type BuildSection } from '../../../models/agentPages';
import {
  NODE_SIZE,
  addPreset,
  buildGraph,
  canConnect,
  clearPositions,
  connect,
  duplicateNode,
  parseNodeId,
  pathOfNode,
  removeEdge,
  removeNodes,
  targetOfPath,
  withPositions,
  type EdgeKind,
  type EditResult,
  type FlowGraph,
  type NodeKind,
  type Point,
  type PresetId,
} from '../../../models/workflow';
import { Arrow, Block, LegendSwatch } from './workflow/FlowBlocks';
import { EDGE_MEANING, captionOf, strokeOf, type ArrowEdge, type BlockNode } from './workflow/look';
import { DRAG_TYPE, NodeLibrary } from './workflow/NodeLibrary';
import { Inspector } from './workflow/Inspector';
import { ChecksPanel } from './workflow/ChecksPanel';
import { TemplatesMenu } from './workflow/TemplatesMenu';
import { StickyNotesLayer } from './workflow/StickyNotes';
import { useStickyNotes } from '../../../hooks/useStickyNotes';
import { AdvancedPanel, type AdvancedTab } from './workflow/AdvancedPanel';
import { useStudio } from '../../../contexts/StudioContext';
import { NOTE_SIZE, freePlace, type Box, type Template } from '../../../models/workflowExtras';
import { toast } from '../../ui/Toast';
import { flash, highlight } from '../../../utils/focusField';
import { fieldId } from '../../../utils/path';
import { cn } from '../../../utils/styles';

// The Workflow view of Build: the agent's configuration as an editable graph (models/workflow.ts says what each block
// and arrow stands for). The config in the draft editor is the only source of truth: every move, connection and field
// is an ordinary edit of the draft (Save keeps it, Ctrl+Z takes it back, the server checks it). Where blocks are drawn
// is saved with the draft in builder.ui.graph_positions, which the runtime ignores.

interface WorkflowCanvasProps {
  editor: DraftEditor;
  /** Open a setting that isn't on the canvas (a problem about the models, say) where it is edited. */
  onGoTo: (path: Path) => void;
  onOpenSection: (section: BuildSection) => void;
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  if (!props.editor.config) return null;
  return (
    <ReactFlowProvider>
      <WorkflowEditor {...props} />
    </ReactFlowProvider>);

}

// Which panels are open and how wide the settings are: a convenience kept in this browser only.
const PREFS_KEY = 'weave.workflow.layout';
interface Prefs {
  library: boolean;
  minimap: boolean;
  inspectorWidth: number;
}
function readPrefs(): Prefs {
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1024;
  const fallback: Prefs = { library: wide, minimap: true, inspectorWidth: 340 };
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return { ...fallback, ...(saved ?? {}), library: wide ? saved?.library ?? true : false };
  } catch {
    return fallback;
  }
}
function writePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // private window or storage switched off: the panels just open as they do by default next time
  }
}

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

const sizeOf = (n: BlockNode) => ({ w: n.measured?.width ?? NODE_SIZE[n.data.node.kind].w, h: n.measured?.height ?? NODE_SIZE[n.data.node.kind].h });

const nodeTypes = { block: Block };
const edgeTypes = { arrow: Arrow };

const MINIMAP_COLOR: Record<string, string> = {
  channel: 'rgb(var(--info) / 0.55)',
  agent: 'rgb(var(--accent) / 0.6)',
  tool: 'rgb(var(--line-strong))',
  knowledge: 'rgb(var(--success) / 0.55)',
};

function WorkflowEditor({ editor, onGoTo, onOpenSection }: WorkflowCanvasProps) {
  const config = editor.config as AgentConfig;
  const rf = useReactFlow<BlockNode, ArrowEdge>();
  const navigate = useNavigate();
  const { answer: providers } = useProviders();
  const agentId = editor.agent?.id ?? '';
  const canEdit = editor.canEdit;

  const graph = useMemo(() => buildGraph(config), [config]);
  const report = editor.validation;
  // Which blocks and hand-offs the server's problems are about, to mark them on the canvas.
  const marks = useMemo(() => {
    const nodes = new Map<string, { errors: number; warnings: number }>();
    const edges = new Set<string>();
    const mark = (issue: Issue, key: 'errors' | 'warnings') => {
      const t = targetOfPath(issue.path, config);
      if (!t) return;
      const c = nodes.get(t.node) ?? { errors: 0, warnings: 0 };
      c[key] += 1;
      nodes.set(t.node, c);
      if (t.edge && key === 'errors') edges.add(t.edge);
    };
    report?.errors.forEach((i) => mark(i, 'errors'));
    report?.warnings.forEach((i) => mark(i, 'warnings'));
    return { nodes, edges };
  }, [report, config]);

  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const updatePrefs = useCallback((patch: Partial<Prefs>) => setPrefs((p) => {
    const next = { ...p, ...patch };
    writePrefs(next);
    return next;
  }), []);
  const [checksOpen, setChecksOpen] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedTab | null>(null);
  const notes = useStickyNotes(agentId);
  const [noteFocus, setNoteFocus] = useState<string | null>(null);
  const { agents: workspace } = useStudio();
  const [legendOpen, setLegendOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const [nodes, setNodes] = useState<BlockNode[]>([]);
  const [edges, setEdges] = useState<ArrowEdge[]>([]);
  const configRef = useRef(config);
  configRef.current = config;
  // The editor as it is now, for an Undo pressed on a toast after later renders.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  // What to select once the edit that is being applied shows on the canvas.
  const pending = useRef<{ nodes: string[]; edge?: string } | null>(null);

  // The canvas follows the config: blocks keep their selection, and a block being dragged keeps its place.
  useEffect(() => {
    const want = pending.current;
    pending.current = null;
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n) => {
        const was = byId.get(n.id);
        const counts = marks.nodes.get(n.id);
        return {
          id: n.id,
          type: 'block',
          position: was?.dragging ? was.position : n.position,
          data: { node: n, errors: counts?.errors ?? 0, warnings: counts?.warnings ?? 0 },
          selected: want ? want.nodes.includes(n.id) : !!was?.selected,
          draggable: canEdit,
          connectable: canEdit,
          deletable: false,
          ariaLabel: `${captionOf(n)}: ${n.label}${n.loose ? ', not connected' : ''}${counts?.errors ? `, ${counts.errors} problems` : ''}`,
        } satisfies BlockNode;
      });
    });
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return graph.edges.map((e) => {
        const error = marks.edges.has(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'arrow',
          data: { edge: e, error },
          selected: want ? want.edge === e.id : selected.has(e.id),
          deletable: false,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: strokeOf(e.kind, error, false) },
          ariaLabel: `${EDGE_MEANING[e.kind]}: ${graph.nodes.find((n) => n.id === e.source)?.label ?? e.source} to ${graph.nodes.find((n) => n.id === e.target)?.label ?? e.target}`,
        } satisfies ArrowEdge;
      });
    });
  }, [graph, marks, canEdit]);

  const onNodesChange = useCallback((changes: NodeChange<BlockNode>[]) => setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), nds)), []);
  const onEdgesChange = useCallback((changes: EdgeChange<ArrowEdge>[]) => setEdges((eds) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), eds)), []);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const selectedCount = selectedNodes.length + selectedEdges.length;
  const oneNode = selectedNodes.length === 1 && selectedEdges.length === 0 ? graph.nodes.find((n) => n.id === selectedNodes[0].id) ?? null : null;
  const oneEdge = selectedEdges.length === 1 && selectedNodes.length === 0 ? graph.edges.find((e) => e.id === selectedEdges[0].id) ?? null : null;
  // The settings open for every new selection; closing them keeps the selection.
  const selectedIds = new Set(selectedNodes.map((n) => n.id));
  const shownEdges = useMemo(
    () => edges.map((e) => (selectedIds.has(e.source) || selectedIds.has(e.target) ? { ...e, data: e.data && { ...e.data, active: true }, zIndex: 1 } : e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edges, [...selectedIds].join('|')]
  );
  // A large graph opens on the conversation flow (channels and agents); Fit shows everything.
  const firstView = useMemo(
    () => ({ padding: 0.2, maxZoom: 1, nodes: graph.nodes.length > 20 ? graph.nodes.filter((n) => n.kind === 'channel' || n.kind === 'agent').map((n) => ({ id: n.id })) : undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const selectionKey = [...selectedNodes.map((n) => n.id), ...selectedEdges.map((e) => e.id)].sort().join('|');
  const [closedFor, setClosedFor] = useState('');
  const inspectorOpen = selectedCount > 0 && closedFor !== selectionKey;

  const positions = useCallback((): Record<string, Point> => Object.fromEntries(nodesRef.current.map((n) => [n.id, n.position])), []);

  const reveal = useCallback(
    (nodeIds: string[], edgeId?: string) => {
      const ids = edgeId ? (() => {
        const e = edgesRef.current.find((x) => x.id === edgeId);
        return e ? [e.source, e.target] : [];
      })() : nodeIds;
      const shown = ids.map((id) => rf.getNode(id)).filter((n): n is BlockNode => !!n);
      if (!shown.length) return;
      const xs = shown.map((n) => n.position.x + sizeOf(n).w / 2);
      const ys = shown.map((n) => n.position.y + sizeOf(n).h / 2);
      // after the settings panel has opened and the canvas has its new width
      window.setTimeout(() => void rf.setCenter((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, { zoom: Math.max(rf.getZoom(), 0.85), duration: 250 }), 60);
    },
    [rf]
  );

  const select = useCallback((nodeIds: string[], edgeId?: string) => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: nodeIds.includes(n.id) })));
    setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === edgeId })));
    setClosedFor('');
  }, []);

  /** Places for blocks an edit adds without saying where: beside a block they connect to, covering no other block. */
  const placeNew = useCallback((next: FlowGraph, where: Record<string, Point>): Record<string, Point> => {
    const taken: Box[] = nodesRef.current.map((n) => ({ x: n.position.x, y: n.position.y, ...sizeOf(n) }));
    const out: Record<string, Point> = {};
    const at = (id: string) => where[id] ?? out[id];
    next.nodes.filter((n) => !where[n.id]).forEach((n) => {
      const link = next.edges.find((e) => e.target === n.id && at(e.source)) ?? next.edges.find((e) => e.source === n.id && at(e.target));
      const anchor = link ? at(link.target === n.id ? link.source : link.target) : undefined;
      const size = NODE_SIZE[n.kind];
      const middle = viewCenter();
      const spot = freePlace(anchor ? { x: anchor.x + 340, y: anchor.y } : { x: middle.x - size.w / 2, y: middle.y - size.h / 2 }, size, taken);
      taken.push({ ...spot, ...size });
      out[n.id] = spot;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Applies an edit: the draft changes (one step to undo), every block keeps its place, and what it is about is selected. */
  const apply = useCallback(
    (r: EditResult, place: Record<string, Point> = {}) => {
      if (r.refused) toast.warning(r.refused);
      if (r.config !== configRef.current) {
        const next = buildGraph(r.config);
        const keep = new Set(next.nodes.map((n) => n.id));
        const where = Object.fromEntries(Object.entries({ ...positions(), ...place }).filter(([id]) => keep.has(id)));
        Object.assign(where, placeNew(next, where));
        pending.current = r.select || r.selectEdge ? { nodes: r.select ?? [], edge: r.selectEdge } : null;
        if (pending.current) setClosedFor('');
        editor.replaceConfig(withPositions(r.config, where));
      } else if (r.select?.length) {
        select(r.select);
        reveal(r.select);
      }
      if (r.note) toast.info(r.note);
    },
    [editor, positions, select, reveal, placeNew]
  );

  const viewCenter = useCallback((): Point => {
    const box = document.getElementById('workflow-canvas')?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }, [rf]);

  const agentUnder = (p: Point) =>
  nodesRef.current.find((n) => {
    if (n.data.node.kind !== 'agent') return false;
    const { w, h } = sizeOf(n);
    return p.x >= n.position.x && p.x <= n.position.x + w && p.y >= n.position.y && p.y <= n.position.y + h;
  })?.id;
  /** The nearest place at or below `want` where a block of this kind covers no other block. */
  const freeSpot = useCallback((want: Point, kind: NodeKind): Point => {
    const size = NODE_SIZE[kind];
    const gap = 24;
    const hit = (x: number, y: number) =>
    nodesRef.current.some((n) => {
      const { w, h } = sizeOf(n);
      return x < n.position.x + w + gap && x + size.w + gap > n.position.x && y < n.position.y + h + gap && y + size.h + gap > n.position.y;
    });
    for (let k = 0; k < 40; k++) {
      const y = want.y + k * (size.h + gap);
      if (!hit(want.x, y)) return { x: want.x, y };
    }
    return want;
  }, []);

  const addBlock = useCallback(
    (preset: PresetId, at?: Point, onto?: string) => {
      if (!canEdit) return;
      const r = addPreset(configRef.current, preset, { providers, botId: agentId });
      if (r.refused) {
        apply(r);
        return;
      }
      const id = r.select?.[0];
      const kind = id ? parseNodeId(id).kind : 'tool';
      const size = NODE_SIZE[kind];
      const point = at ?? viewCenter();
      let want = { x: point.x - size.w / 2, y: point.y - size.h / 2 };
      let result: EditResult = r;
      const agent = onto ? nodesRef.current.find((n) => n.id === onto) : undefined;
      if (onto && id && !canConnect(r.config, onto, id)) {
        const c = connect(r.config, onto, id);
        if (!c.refused) {
          result = { ...c, select: r.select, selectEdge: undefined, note: [r.note, c.note].filter(Boolean).join(' ') || undefined };
          // beside the agent it was dropped on, not on top of it
          if (agent) want = { x: agent.position.x + sizeOf(agent).w + 96, y: agent.position.y };
        }
      }
      apply(result, id ? { [id]: freeSpot(want, kind) } : {});
    },
    [canEdit, providers, agentId, apply, viewCenter, freeSpot]
  );

  const deleteSelection = useCallback(() => {
    if (!canEdit) return;
    const ids = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
    const arrows = edgesRef.current.filter((e) => e.selected && !ids.includes(e.source) && !ids.includes(e.target)).map((e) => e.data?.edge).filter((e): e is NonNullable<typeof e> => !!e);
    if (!ids.length && !arrows.length) return;
    const before = configRef.current;
    let next = before;
    const refused: string[] = [];
    const notes: string[] = [];
    // later hand-offs of an agent first, so the earlier ones keep their places in its list
    arrows.sort((a, b) => (b.handoffIndex ?? 0) - (a.handoffIndex ?? 0)).forEach((e) => {
      const r = removeEdge(next, e);
      if (r.refused) refused.push(r.refused);else next = r.config;
    });
    if (ids.length) {
      const r = removeNodes(next, ids);
      if (r.refused) refused.push(r.refused);
      if (r.note) notes.push(r.note);
      next = r.config;
    }
    if (next === before) {
      toast.warning([...new Set(refused)].join(' '));
      return;
    }
    apply({ config: next, refused: [...new Set(refused)].join(' '), select: [] });
    toast.success(notes.length ? `Deleted. ${notes.join(' ')}` : 'Deleted.', { action: { label: 'Undo', onClick: () => editorRef.current.undo() } });
  }, [canEdit, apply]);

  const duplicateSelection = useCallback(() => {
    if (!canEdit) return;
    const ids = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
    let next = configRef.current;
    const made: string[] = [];
    const place: Record<string, Point> = {};
    const refused: string[] = [];
    ids.forEach((id) => {
      const r = duplicateNode(next, id);
      if (r.refused) return refused.push(r.refused);
      next = r.config;
      const copy = r.select?.[0];
      const from = nodesRef.current.find((n) => n.id === id)?.position;
      if (copy) {
        made.push(copy);
        if (from) place[copy] = freeSpot({ x: from.x + 40, y: from.y + 40 }, parseNodeId(copy).kind);
      }
    });
    if (!made.length) {
      if (refused.length) toast.warning([...new Set(refused)].join(' '));
      return;
    }
    apply({ config: next, refused: [...new Set(refused)].join(' '), select: made, note: made.some((id) => parseNodeId(id).kind === 'tool') ? 'Copied tools aren’t used by any agent until you connect one.' : undefined }, place);
  }, [canEdit, apply, freeSpot]);

  const onConnect = useCallback((c: Connection) => apply(connect(configRef.current, c.source, c.target)), [apply]);
  const isValidConnection = useCallback((c: Connection | ArrowEdge) => !canConnect(configRef.current, c.source, c.target), []);
  // A connection let go anywhere on a block (not only on its dot) connects to it, or says why it can't.
  const onConnectEnd = useCallback(
    (e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid === true || !state.fromNode) return;
      let toId = state.toNode?.id;
      if (!toId) {
        const p = 'changedTouches' in e ? e.changedTouches[0] : e;
        toId = (document.elementFromPoint(p.clientX, p.clientY)?.closest('.react-flow__node') as HTMLElement | null)?.dataset.id;
      }
      if (!toId || toId === state.fromNode.id) return;
      const [from, to] = state.fromHandle?.type === 'target' ? [toId, state.fromNode.id] : [state.fromNode.id, toId];
      const why = canConnect(configRef.current, from, to);
      if (why) toast.warning(why);else apply(connect(configRef.current, from, to));
    },
    [apply]
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, __: BlockNode, dragged: BlockNode[]) => {
      if (!canEdit) return;
      const moved = dragged.some((n) => {
        const was = graph.nodes.find((g) => g.id === n.id)?.position;
        return !was || Math.round(n.position.x) !== Math.round(was.x) || Math.round(n.position.y) !== Math.round(was.y);
      });
      if (moved) editor.replaceConfig(withPositions(configRef.current, positions()));
    },
    [canEdit, graph, editor, positions]
  );

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canEdit ? 'copy' : 'none';
  };
  const onDrop = (e: React.DragEvent) => {
    const preset = e.dataTransfer.getData(DRAG_TYPE) as PresetId;
    if (!preset) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addBlock(preset, p, agentUnder(p));
  };

  /** A problem in the checks: select what it is about and open its field, or go to where the setting is edited. */
  const showIssue = useCallback(
    (issue: Issue) => {
      const t = targetOfPath(issue.path, configRef.current);
      if (!t || !issue.path) {
        if (issue.path) onGoTo(issue.path);
        return;
      }
      select(t.edge ? [] : [t.node], t.edge);
      reveal(t.edge ? [] : [t.node], t.edge);
      const node = graph.nodes.find((n) => n.id === t.node);
      window.setTimeout(() => {
        const base = node ? pathOfNode(node) : [];
        if (highlight(issue.path as Path, t.edge ? 5 : base.length + 1, 'nearest')) return;
        const whole = document.getElementById(fieldId(base));
        if (whole instanceof HTMLDetailsElement) whole.open = true;
        if (whole) flash(whole, 'nearest');
      }, 180);
    },
    [graph, onGoTo, select, reveal]
  );

  /** A “used by” button or the Advanced panel: the block it is about, or where it is edited. */
  const showPath = useCallback((path: Path) => showIssue({ path, message: '' }), [showIssue]);

  const applyTemplate = useCallback(
    (t: Template) => {
      if (!canEdit) return;
      const r = t.apply(configRef.current);
      apply({ config: r.config, refused: '', select: r.select ? [r.select] : undefined, note: r.note });
    },
    [canEdit, apply]
  );

  // A new note goes in the middle of the view, beside the blocks and notes there rather than over them.
  const addNote = () => {
    const middle = viewCenter();
    const taken: Box[] = [...nodesRef.current.map((n) => ({ x: n.position.x, y: n.position.y, ...sizeOf(n) })), ...notes.notes];
    const spot = freePlace({ x: middle.x - NOTE_SIZE.w / 2, y: middle.y - NOTE_SIZE.h / 2 }, NOTE_SIZE, taken);
    const id = notes.add({ x: spot.x + NOTE_SIZE.w / 2, y: spot.y + NOTE_SIZE.h / 2 });
    setNoteFocus(id);
    if (notes.notes.length === 0) toast.info('Sticky notes are kept in this browser only: they are not part of the agent and no one else sees them.');
  };

  // Shortcuts while the canvas (or something on it) was the last thing used; never while typing in a field.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      active.current = !!wrapperRef.current?.contains(e.target as Node);
    };
    const key = (e: KeyboardEvent) => {
      if (!active.current && !wrapperRef.current?.contains(document.activeElement)) return;
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        e.preventDefault();
        deleteSelection();
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && k === 'a') {
        e.preventDefault();
        select(nodesRef.current.map((n) => n.id));
      } else if (e.key === 'Escape') select([]);
      else if (!mod && (e.key === '+' || e.key === '=')) void rf.zoomIn({ duration: 150 });
      else if (!mod && e.key === '-') void rf.zoomOut({ duration: 150 });
      else if (!mod && e.shiftKey && e.key === '!') void rf.fitView({ padding: 0.2, duration: 250 });
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [deleteSelection, duplicateSelection, select, rf]);

  // Resizing the settings panel by its edge.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = prefs.inspectorWidth;
    const move = (ev: PointerEvent) => updatePrefs({ inspectorWidth: Math.min(560, Math.max(280, startW + (startX - ev.clientX))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const errors = report?.errors.length ?? 0;
  const checking = editor.validationView.status === 'checking' || editor.validationView.status === 'unknown';
  const empty = graph.nodes.length === 0;

  return (
    <div ref={wrapperRef} className="flex h-[calc(100dvh-15rem)] min-h-[540px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-panel">
      {/* toolbar */}
      <div role="toolbar" aria-label="Workflow" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <ToolButton label={prefs.library ? 'Hide blocks' : 'Show blocks'} pressed={prefs.library} onClick={() => updatePrefs({ library: !prefs.library })}>
          <PanelLeftIcon className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Blocks</span>
        </ToolButton>
        <Divider />
        <ToolButton label="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!editor.canUndo || !canEdit}><Undo2Icon className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="Redo (Ctrl+Shift+Z)" onClick={editor.redo} disabled={!editor.canRedo || !canEdit}><Redo2Icon className="h-4 w-4" aria-hidden /></ToolButton>
        <Divider />
        <ToolButton label="Zoom out (−)" onClick={() => void rf.zoomOut({ duration: 150 })}><ZoomOutIcon className="h-4 w-4" aria-hidden /></ToolButton>
        <span className="w-11 text-center font-mono text-xs tabular-nums text-muted" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <ToolButton label="Zoom in (+)" onClick={() => void rf.zoomIn({ duration: 150 })}><ZoomInIcon className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="Fit to screen (Shift+1)" onClick={() => void rf.fitView({ padding: 0.2, duration: 250 })}><MaximizeIcon className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="Reset view (100%)" onClick={() => void rf.setViewport({ x: 40, y: 40, zoom: 1 }, { duration: 250 })}><LocateFixedIcon className="h-4 w-4" aria-hidden /></ToolButton>
        <Divider />
        <ToolButton
          label="Tidy up: lay every block out again"
          disabled={!canEdit || graph.autoLayout}
          onClick={() => {
            editor.replaceConfig(clearPositions(configRef.current));
            window.setTimeout(() => void rf.fitView({ padding: 0.2, duration: 250 }), 60);
          }}>
          <LayoutGridIcon className="h-4 w-4" aria-hidden />
          <span className="hidden md:inline">Tidy up</span>
        </ToolButton>
        <ToolButton label={prefs.minimap ? 'Hide the minimap' : 'Show the minimap'} pressed={prefs.minimap} onClick={() => updatePrefs({ minimap: !prefs.minimap })}><MapIcon className="h-4 w-4" aria-hidden /></ToolButton>
        <ToolButton label="What the arrows mean" pressed={legendOpen} onClick={() => setLegendOpen((v) => !v)}><InfoIcon className="h-4 w-4" aria-hidden /></ToolButton>
        <Divider />
        <TemplatesMenu config={config} disabled={!canEdit} onPick={applyTemplate} />
        <ToolButton label="Add a sticky note (kept in this browser)" onClick={addNote}>
          <StickyNoteIcon className="h-4 w-4" aria-hidden />
          <span className="hidden 2xl:inline">Note</span>
        </ToolButton>
        <ToolButton label="Advanced: every agent, the values a call remembers, events" pressed={!!advanced} onClick={() => setAdvanced('agents')}>
          <SlidersHorizontalIcon className="h-4 w-4" aria-hidden />
          <span className="hidden xl:inline">Advanced</span>
        </ToolButton>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {!canEdit && <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-muted">View only</span>}
          <span
            className={cn('rounded-full px-2 py-0.5 text-xs font-medium', editor.saveState === 'error' || editor.saveState === 'conflict' ? 'bg-danger-soft text-danger' : editor.dirty ? 'bg-warning-soft text-warning' : 'bg-subtle text-muted')}
            title={editor.saveError ?? undefined}
            aria-live="polite">
            {editor.saveLabel}
          </span>
          <button
            type="button"
            onClick={() => setChecksOpen((v) => !v)}
            aria-expanded={checksOpen}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              !report ? 'bg-subtle text-muted' : errors ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
            )}>
            {checking ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden /> : errors ? <CircleAlertIcon className="h-3.5 w-3.5" aria-hidden /> : report ? <CircleCheckIcon className="h-3.5 w-3.5" aria-hidden /> : null}
            {!report ? 'Checking…' : errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'Checks passed'}
          </button>
          {workspace.length > 1 &&
          <>
              <label htmlFor="workflow-agent" className="sr-only">Open another agent’s workflow</label>
              <select
              id="workflow-agent"
              title="Open another agent’s workflow"
              value={agentId}
              onChange={(e) => e.target.value !== agentId && navigate(`${targetPath(e.target.value, { stage: 'build' })}?view=canvas`)}
              className="h-7 max-w-[11rem] truncate rounded-md border border-line bg-surface px-2 text-xs text-ink-soft focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30">
                {workspace.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
              </select>
            </>
          }
          <button
            type="button"
            onClick={() => navigate(targetPath(agentId, { stage: 'test' }))}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink shadow-sm hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            title="Try it in a test conversation. It runs the saved draft; you’re asked to save first.">
            <PlayIcon className="h-3.5 w-3.5 text-accent" aria-hidden />
            Test
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {prefs.library &&
        <NodeLibrary
          disabled={!canEdit}
          onAdd={(p) => addBlock(p)}
          onClose={() => updatePrefs({ library: false })}
          onOpenKnowledge={() => onOpenSection('knowledge')}
          className="absolute inset-y-0 left-0 z-20 w-64 border-r border-line shadow-overlay lg:static lg:z-auto lg:shadow-none" />
        }

        <div id="workflow-canvas" className="relative min-w-0 flex-1 bg-surface" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow<BlockNode, ArrowEdge>
            nodes={nodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onNodeDragStop={onNodeDragStop}
            onMove={(_: unknown, v: Viewport) => setZoom(v.zoom)}
            onInit={(inst) => setZoom(inst.getZoom())}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            elementsSelectable
            deleteKeyCode={null}
            selectionOnDrag
            panOnDrag={[1, 2]}
            panOnScroll
            selectionKeyCode={null}
            multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
            minZoom={0.2}
            maxZoom={2}
            fitView
            fitViewOptions={firstView}
            snapToGrid
            snapGrid={[8, 8]}
            connectionRadius={28}
            defaultEdgeOptions={{ type: 'arrow' }}
            className="[&_.react-flow__selection]:!border-accent/50 [&_.react-flow__selection]:!bg-accent/5">
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="rgb(var(--line-strong))" />
            <StickyNotesLayer notes={notes.notes} focusId={noteFocus} onChange={notes.change} onRemove={notes.remove} />
            {prefs.minimap &&
            <MiniMap
              pannable
              zoomable
              ariaLabel="Minimap"
              style={{ width: 168, height: 112 }}
              nodeColor={(n) => MINIMAP_COLOR[(n as BlockNode).data.node.kind]}
              nodeStrokeColor={(n) => (n as BlockNode).data.errors ? 'rgb(var(--danger))' : 'transparent'}
              nodeStrokeWidth={3}
              maskColor="rgb(var(--subtle) / 0.6)"
              className="!rounded-md !border !border-line !bg-surface" />
            }
            {legendOpen &&
            <Panel position="top-right" className="w-64 rounded-lg border border-line bg-surface p-3 text-xs shadow-overlay">
                <p className="mb-2 font-semibold text-ink">What the arrows mean</p>
                <ul className="space-y-1.5">
                  {(Object.keys(EDGE_MEANING) as EdgeKind[]).map((k) =>
                <li key={k} className="flex items-center gap-2 text-ink-soft"><LegendSwatch kind={k} />{EDGE_MEANING[k]}</li>
                )}
                </ul>
                <p className="mt-3 text-muted">The agent decides during the conversation which tool to use and when to hand off; the arrows show what it can do, not a fixed order. A dashed block isn’t connected, so it never runs.</p>
              </Panel>
            }
            {!empty && graph.nodes.every((n) => n.kind !== 'channel') &&
            <Panel position="top-center" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-1.5 text-xs text-warning">
                No channel yet: nothing can start a conversation. Add a trigger from the blocks panel.
              </Panel>
            }
          </ReactFlow>

          {empty &&
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="max-w-sm rounded-xl border border-line bg-surface p-6 text-center shadow-overlay">
                <h3 className="text-sm font-semibold text-ink">Start building</h3>
                <p className="mt-1 text-[13px] text-muted">A conversation starts on a channel and is answered by an agent. Add both to begin, or pick a first block.</p>
                <button
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  const chat = addPreset(configRef.current, 'web_chat', { providers, botId: agentId });
                  const agent = addPreset(chat.config, 'agent');
                  const c = viewCenter();
                  const chatId = chat.select?.[0];
                  const agentNode = agent.select?.[0];
                  const place: Record<string, Point> = {};
                  if (chatId) place[chatId] = { x: c.x - 300, y: c.y - 40 };
                  if (agentNode) place[agentNode] = { x: c.x + 40, y: c.y - 48 };
                  apply(agent, place);
                }}
                className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-ink shadow-sm hover:bg-primary-strong disabled:opacity-50">
                  <PlusIcon className="h-4 w-4" aria-hidden />
                  Start building
                </button>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {(['web_chat', 'sip_voice', 'agent'] as PresetId[]).map((p) =>
                <button key={p} type="button" disabled={!canEdit} onClick={() => addBlock(p)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft hover:border-accent/40 hover:text-accent disabled:opacity-50">
                      {p === 'web_chat' ? 'Web chat' : p === 'sip_voice' ? 'Phone' : 'AI agent'}
                    </button>
                )}
                </div>
              </div>
            </div>
          }
        </div>

        {inspectorOpen &&
        <div
          style={{ width: prefs.inspectorWidth }}
          className="absolute inset-y-0 right-0 z-20 max-w-full border-l border-line bg-surface shadow-overlay lg:relative lg:z-auto lg:shrink-0 lg:shadow-none">
            <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the settings panel"
            onPointerDown={startResize}
            className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent/20 lg:block" />
            <Inspector
            editor={editor}
            graph={graph}
            node={oneNode}
            edge={oneEdge}
            selectedCount={selectedCount}
            onApply={apply}
            onSelect={(id) => {
              select([id]);
              reveal([id]);
            }}
            onDuplicate={duplicateSelection}
            onDelete={deleteSelection}
            onClose={() => setClosedFor(selectionKey)}
            onOpenSection={onOpenSection}
            onShowPath={showPath} />
          </div>
        }
      </div>

      <AdvancedPanel
        editor={editor}
        open={!!advanced}
        tab={advanced ?? 'agents'}
        onTab={setAdvanced}
        onClose={() => setAdvanced(null)}
        onShowAgent={(id) => {
          select([id]);
          reveal([id]);
        }}
        onShowPath={showPath} />
      <ChecksPanel view={editor.validationView} config={config} graph={graph} open={checksOpen} onToggle={() => setChecksOpen((v) => !v)} onShow={showIssue} />
    </div>);

}

function ToolButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40',
        pressed ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-subtle hover:text-ink'
      )}>
      {children}
    </button>);

}

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />;
