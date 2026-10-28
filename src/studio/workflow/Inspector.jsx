import React from 'react';
import { getAt, setAt } from '../form/inlineCreate.js';
import { parseNodeId } from './workflowModel.js';
import { list, WhereCtx } from './inspector/panelParts.jsx';
import { NoteView, ChannelView, ModelView, KnowledgePlugView } from './inspector/BlockViews.jsx';
import { Overview } from './inspector/Overview.jsx';
import { EdgeView } from './inspector/EdgeView.jsx';
import { AgentView } from './inspector/AgentView.jsx';
import { EnterView } from './inspector/EnterView.jsx';
import { AgentTransferView } from './inspector/AgentTransferView.jsx';
import { ToolView } from './inspector/ToolView.jsx';

// The side panel: the selected block or arrow in plain words, with the few configuration fields that belong to it
// ("All settings" has the rest). With nothing selected, it walks through the call step by step.

function placesFor(selected, config) {
  if (!selected) return [];
  const agents = list(config?.agents?.items);
  const ai = (id) => agents.findIndex((a) => a?.id === id);
  const tools = list(config?.tools);
  const out = [];
  const add = (label, path) => {
    if (path.every((p) => p !== -1) && getAt(config, path) !== undefined) out.push({ label, path });
  };
  if (selected.type === 'node') {
    const at = parseNodeId(selected.id);
    if (at.kind === 'start') add('Who answers first', ['agents', 'entry']);
    else if (at.kind === 'trigger') {
      add('This channel', ['channels', list(config?.channels).findIndex((c) => c?.id === at.channel)]);
      add('Who answers first', ['agents', 'entry']);
    } else if (at.kind === 'model') {
      add('Its own model', ['agents', 'items', ai(at.agent), 'overrides', 'models']);
      add('The default model', ['defaults', 'models', 'llm']);
    } else if (at.kind === 'knowledge') add('This knowledge', ['knowledge', list(config?.knowledge).findIndex((b) => b?.id === at.base)]);
    else if (at.kind === 'agent') add('This agent', ['agents', 'items', ai(at.agent)]);
    else if (at.kind === 'enter') add('This step', ['agents', 'items', ai(at.agent), 'on_enter', at.index]);
    else {
      const ti = tools.findIndex((t) => t?.id === at.tool);
      add('This tool', ['tools', ti]);
      const transfer = tools[ti]?.params?.transfer;
      if (transfer) add('Its transfer', ['telephony', 'transfers', list(config?.telephony?.transfers).findIndex((t) => t?.id === transfer)]);
    }
    if (getAt(config, ['builder', 'ui', 'graph_positions', selected.id]))
      out.push({ label: 'Where it is drawn', path: ['builder', 'ui', 'graph_positions', selected.id], quiet: true });
  }
  return out;
}
function derivedPlaces(ref, config) {
  if (ref.derived === 'tool')
    return (ref.ids || [])
      .map((id) => ({ label: `Tool ${id}`, path: ['tools', list(config?.tools).findIndex((t) => t?.id === id)] }))
      .filter((p) => p.path[1] >= 0);
  if (ref.derived === 'rule')
    return (ref.ids || [])
      .map((id) => ({ label: `Safety rule ${id}`, path: ['guardrails', 'escalation', list(config?.guardrails?.escalation).findIndex((r) => r?.id === id)] }))
      .filter((p) => p.path[2] >= 0);
  return [];
}

function edgePlaces(edge, config) {
  const ref = edge?.ref || {};
  const agents = list(config?.agents?.items);
  const ai = agents.findIndex((a) => a?.id === ref.agent);
  if (ref.derived) return derivedPlaces(ref, config);
  if (ai < 0) return edge?.kind === 'start' ? [{ label: 'Who answers first', path: ['agents', 'entry'] }] : [];
  if (ref.handoff !== undefined) return [{ label: 'This hand-over', path: ['agents', 'items', ai, 'handoffs', ref.handoff] }];
  if (ref.enter !== undefined) return [{ label: 'This step', path: ['agents', 'items', ai, 'on_enter', ref.enter] }];
  if (ref.tool) {
    const ti = list(config?.tools).findIndex((t) => t?.id === ref.tool);
    return ti >= 0 ? [{ label: 'The tool', path: ['tools', ti] }] : [];
  }
  return [];
}

export default function Inspector(props) {
  const places =
    props.selected?.type === 'edge'
      ? edgePlaces(
          props.flow.edges.find((e) => e.id === props.selected.id),
          props.config,
        )
      : placesFor(props.selected, props.config);
  return (
    <WhereCtx.Provider value={{ places, config: props.config, onOpenSettings: props.onOpenSettings, onOpenJson: props.onOpenJson, onHide: props.onHide }}>
      {/* a new selection remounts the panel, so a half-asked question about one block isn't carried to the next */}
      <InspectorBody key={props.selected ? `${props.selected.type}:${props.selected.id}:${props.selected.tab || ''}` : 'none'} {...props} />
    </WhereCtx.Provider>
  );
}

function InspectorBody({
  flow,
  config,
  selected,
  apply,
  onSelect,
  onOpenSettings,
  onRemove,
  onAddHandoff,
  onMoveStep,
  onDeleted,
  workspace,
  botId,
  notes = [],
  onNoteChange,
  onNoteDelete,
}) {
  const agents = list(config?.agents?.items);
  const agentOf = (id) => agents.find((a) => a?.id === id);
  const indexOf = (id) => agents.findIndex((a) => a?.id === id);
  const set = (path, value, group) => apply(setAt(config, path, value), { group: group ?? `edit:${path.join('.')}` });
  const node = selected?.type === 'node' ? flow.nodes.find((n) => n.id === selected.id) : null;
  const edge = selected?.type === 'edge' ? flow.edges.find((e) => e.id === selected.id) : null;

  if (selected?.type === 'note') {
    const note = notes.find((n) => n.id === selected.id);
    if (note) return <NoteView note={note} edit={!!selected.edit} onChange={onNoteChange} onDelete={onNoteDelete} onClose={() => onSelect(null)} />;
  }
  if (!node && !edge) return <Overview flow={flow} config={config} apply={apply} onSelect={onSelect} />;
  if (edge)
    return (
      <EdgeView
        edge={edge}
        flow={flow}
        config={config}
        agents={agents}
        set={set}
        apply={apply}
        onSelect={onSelect}
        onRemove={onRemove}
        onDeleted={onDeleted}
        indexOf={indexOf}
      />
    );

  const at = parseNodeId(node.id);
  // a "Back to …" block shows its arrow's panel
  if (node.type === 'back') {
    const back = flow.edges.find((e) => e.id === node.edge);
    if (back)
      return (
        <EdgeView
          edge={back}
          flow={flow}
          config={config}
          agents={agents}
          set={set}
          apply={apply}
          onSelect={onSelect}
          onRemove={onRemove}
          onDeleted={onDeleted}
          indexOf={indexOf}
        />
      );
  }
  if (node.type === 'trigger')
    return <ChannelView node={node} flow={flow} config={config} apply={apply} onClose={() => onSelect(null)} onOpenSettings={onOpenSettings} />;
  if (node.type === 'model' || node.type === 'knowledge') {
    const ai = indexOf(at.agent);
    const Plugged = node.type === 'model' ? ModelView : KnowledgePlugView;
    return <Plugged node={node} agent={agents[ai]} i={ai} config={config} apply={apply} onSelect={onSelect} onOpenSettings={onOpenSettings} />;
  }
  if (node.type === 'agent') {
    const i = indexOf(node.id);
    return (
      <AgentView
        node={node}
        agent={agents[i]}
        i={i}
        flow={flow}
        config={config}
        agents={agents}
        set={set}
        apply={apply}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
        onRemove={onRemove}
        onAddHandoff={onAddHandoff}
        workspace={workspace}
        initialTab={selected.tab}
      />
    );
  }

  const agent = agentOf(at.agent);
  const ai = indexOf(at.agent);
  const owner = agent?.name || at.agent;
  if (at.kind === 'enter')
    return (
      <EnterView
        node={node}
        agent={agent}
        ai={ai}
        owner={owner}
        config={config}
        set={set}
        apply={apply}
        onSelect={onSelect}
        onRemove={onRemove}
        onMoveStep={onMoveStep}
        onOpenSettings={onOpenSettings}
      />
    );
  if (node.type === 'agentTransfer')
    return (
      <AgentTransferView
        node={node}
        owner={owner}
        config={config}
        flow={flow}
        workspace={workspace}
        botId={botId}
        apply={apply}
        onSelect={onSelect}
        onRemove={onRemove}
        onOpenSettings={onOpenSettings}
      />
    );
  return <ToolView node={node} owner={owner} config={config} set={set} apply={apply} onSelect={onSelect} onRemove={onRemove} onOpenSettings={onOpenSettings} />;
}
