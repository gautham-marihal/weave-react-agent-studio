import type { Edge, Node } from '@xyflow/react';
import {
  BookOpenIcon,
  BotIcon,
  ClipboardListIcon,
  CodeXmlIcon,
  GitBranchIcon,
  GlobeIcon,
  Grid3x3Icon,
  HashIcon,
  HeadsetIcon,
  ListChecksIcon,
  MessageSquareIcon,
  MicIcon,
  PhoneIcon,
  PhoneOffIcon,
  PlugIcon,
  RadioIcon,
  SearchIcon,
  ServerIcon,
  SplitIcon,
  Undo2Icon,
  type LucideIcon,
} from 'lucide-react';
import type { EdgeKind, FlowEdge, FlowNode, NodeKind, PresetId } from '../../../../models/workflow';
import { toolLabel } from '../toolTypes';

// How blocks and arrows look on the canvas: icons, colours and words. No components here (FlowBlocks.tsx draws them).

const CHANNEL_ICON: Record<string, LucideIcon> = { web_chat: MessageSquareIcon, web_voice: MicIcon, sip_voice: PhoneIcon };
const BUILTIN_ICON: Record<string, LucideIcon> = {
  end_call: PhoneOffIcon,
  transfer_or_callback: HeadsetIcon,
  return_to_entry: Undo2Icon,
  noop: GitBranchIcon,
  collect_dtmf: Grid3x3Icon,
  send_dtmf: HashIcon,
  send_form: ClipboardListIcon,
};
const TOOL_ICON: Record<string, LucideIcon> = { http: GlobeIcon, knowledge: SearchIcon, mcp: ServerIcon, code: CodeXmlIcon, task: ListChecksIcon };

export function iconOf(node: Pick<FlowNode, 'kind' | 'type' | 'builtin'>): LucideIcon {
  if (node.kind === 'channel') return CHANNEL_ICON[node.type] ?? RadioIcon;
  if (node.kind === 'agent') return node.type === 'router' ? SplitIcon : BotIcon;
  if (node.kind === 'knowledge') return BookOpenIcon;
  return (node.builtin && BUILTIN_ICON[node.builtin]) || TOOL_ICON[node.type] || PlugIcon;
}

export const PRESET_ICON: Record<PresetId, LucideIcon> = {
  web_chat: MessageSquareIcon,
  web_voice: MicIcon,
  sip_voice: PhoneIcon,
  agent: BotIcon,
  router: SplitIcon,
  conditional_handoff: GitBranchIcon,
  return_to_entry: Undo2Icon,
  http: GlobeIcon,
  knowledge_search: SearchIcon,
  mcp: ServerIcon,
  code: CodeXmlIcon,
  transfer: HeadsetIcon,
  end_call: PhoneOffIcon,
  collect_dtmf: Grid3x3Icon,
};

export const KIND_LABEL: Record<NodeKind, string> = { channel: 'Trigger', agent: 'Agent', tool: 'Tool', knowledge: 'Knowledge' };
export const KIND_TONE: Record<NodeKind, string> = {
  channel: 'bg-info-soft text-info',
  agent: 'bg-accent-soft text-accent',
  tool: 'bg-subtle text-ink-soft',
  knowledge: 'bg-success-soft text-success',
};

/** What kind of block it is, in words ("Calls an API", "Agent"). */
export function captionOf(node: FlowNode): string {
  if (node.kind === 'tool') return toolLabel({ type: node.type as never, builtin: node.builtin });
  return KIND_LABEL[node.kind];
}

export interface BlockData extends Record<string, unknown> {
  node: FlowNode;
  errors: number;
  warnings: number;
}
export type BlockNode = Node<BlockData, 'block'>;

export interface ArrowData extends Record<string, unknown> {
  edge: FlowEdge;
  error: boolean;
  /** A block it touches is selected. */
  active?: boolean;
}
export type ArrowEdge = Edge<ArrowData, 'arrow'>;

export const STROKE: Record<EdgeKind, { color: string; dashed?: boolean }> = {
  entry: { color: 'rgb(var(--info))' },
  handoff: { color: 'rgb(var(--accent))' },
  uses: { color: 'rgb(var(--line-strong))' },
  reads: { color: 'rgb(var(--success))', dashed: true },
  searches: { color: 'rgb(var(--success))' },
  tool_handoff: { color: 'rgb(var(--accent))', dashed: true },
  returns: { color: 'rgb(var(--muted))', dashed: true },
  rule_handoff: { color: 'rgb(var(--warning))', dashed: true },
};
export const strokeOf = (kind: EdgeKind, error: boolean, selected: boolean) => (error ? 'rgb(var(--danger))' : selected ? 'rgb(var(--accent-strong))' : STROKE[kind].color);

/** What each kind of arrow means, for the legend and the settings of an arrow. */
export const EDGE_MEANING: Record<EdgeKind, string> = {
  entry: 'A call on this channel starts here',
  handoff: 'Hands the conversation to another agent',
  uses: 'The agent can use this tool',
  reads: 'Read on every turn',
  searches: 'The tool searches this base',
  tool_handoff: 'The tool hands off when it runs',
  returns: 'Goes back to the agent that answers first',
  rule_handoff: 'A safety rule hands off',
};
