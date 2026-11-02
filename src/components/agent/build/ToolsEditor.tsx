import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import type { AgentConfig, Issue, Path } from '../../../types/studio';
import { StatusChip } from '../../ui/StatusChip';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Toggle';
import { fieldId } from '../../../utils/path';
import { cn, inputClass } from '../../../utils/styles';
import { BankingToolsSection } from './BankingToolsSection';
import { GATEWAY_CONNECTION } from '../../../models/bankingTools';
import {
  addTool,
  agentName,
  agentsUsingTool,
  deleteTool,
  existingFor,
  firstSentence,
  makeTool,
  notAvailable,
  plainToolKind,
  switchOf,
  toolMatches,
  undeclaredTools,
  unusedTools,
  usedByText,
  type ToolCard,
} from '../../../models/tools';
import { ToolPanel } from './tools/ToolPanel';
import { AddToolDialog } from './tools/AddToolDialog';

interface ToolsEditorProps {
  readonly config: AgentConfig;
  readonly disabled: boolean;
  readonly update: (path: Path, value: unknown) => void;
  /** Whole-config edits (one undo step); omitted when the draft is read-only. */
  readonly replaceConfig?: (next: AgentConfig) => void;
  readonly onOpenJson: () => void;
  /** The server's problems with the draft, counted on each tool's row and shown in its panel. */
  readonly errors?: Issue[];
}

/** A tool just deleted, offered back with Undo until the draft changes again. */
interface Removed {
  label: string;
  previous: AgentConfig;
  after: AgentConfig;
}

/**
 * Every tool the agent has, one row each: what it does in words, which agent uses it, and what needs fixing. A row
 * opens the tool's panel; "Add a tool" offers cards by the job they do. Each change is an ordinary edit of the draft.
 */
export function ToolsEditor({ config, disabled, update, replaceConfig, onOpenJson, errors = [] }: ToolsEditorProps) {
  const [panel, setPanel] = useState<{ index: number; isNew: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [query, setQuery] = useState('');
  const tools = config.tools ?? [];
  const items = config.agents?.items ?? [];
  const entryIndex = Math.max(0, items.findIndex((a) => a.id === config.agents?.entry));
  const entry = items[entryIndex];
  const unused = useMemo(() => new Set(unusedTools(config)), [config]);
  const undeclared = undeclaredTools(config);
  const canChange = !disabled && !!replaceConfig;

  // The Undo offer goes once the draft changes again.
  useEffect(() => {
    if (removed && config !== removed.after) setRemoved(null);
  }, [config, removed]);
  // A panel whose tool has gone (undo, the JSON view) closes.
  useEffect(() => {
    if (panel && !config.tools?.[panel.index]) setPanel(null);
  }, [panel, config.tools]);

  const problemsIn = (i: number) => errors.filter((e) => e.path && e.path[0] === 'tools' && e.path[1] === i).length;

  const pick = (card: ToolCard) => {
    setAdding(false);
    const existing = existingFor(config, card);
    if (existing >= 0) {
      setPanel({ index: existing, isNew: false });
      return;
    }
    if (!replaceConfig) return;
    const made = addTool(config, makeTool(card, tools.map((t) => t.id)));
    replaceConfig(made.config);
    setPanel({ index: made.index, isNew: true });
  };

  const remove = (index: number) => {
    if (!replaceConfig) return;
    const tool = tools[index];
    const after = deleteTool(config, index);
    setPanel(null);
    replaceConfig(after);
    setRemoved({ label: `Tool “${tool?.id ?? index + 1}” deleted.`, previous: config, after });
  };

  const shown = tools.map((tool, index) => ({ tool, index })).filter(({ tool }) => toolMatches(tool, { query }));

  return (
    <div className="space-y-3">
      <BankingToolsSection config={config} disabled={disabled} replaceConfig={replaceConfig} />

      {removed &&
      <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-subtle px-4 py-2.5 text-[13px] text-ink">
          <span>{removed.label}</span>
          <span className="flex items-center gap-1">
            <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              replaceConfig?.(removed.previous);
              setRemoved(null);
            }}>
              Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoved(null)}>Dismiss</Button>
          </span>
        </div>
      }

      <div className="flex flex-wrap items-center justify-between gap-2">
        {tools.length > 6 ?
        <label className="relative min-w-[200px] max-w-xs flex-1">
            <span className="sr-only">Find a tool</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input className={cn(inputClass, 'h-8 py-1 pl-9 text-[13px]')} placeholder="Find a tool" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label> :

        <span className="text-[13px] text-muted">{tools.length ? `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}` : 'No tools yet. Tools let the agent do things: end the call, hand over to a person, look something up.'}</span>
        }
        {canChange &&
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add a tool
          </Button>
        }
      </div>

      {(shown.length > 0 || undeclared.length > 0) &&
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface" aria-label="All its tools">
          {shown.map(({ tool, index }) => {
          const problems = problemsIn(index);
          const users = agentsUsingTool(config, tool.id);
          const toggle = switchOf(config, tool.id);
          const when = firstSentence(tool.description);
          const sub = [toggle?.on ? 'switched on above' : when, items.length > 1 ? usedByText(users.map((u) => agentName(config, u))) : ''].filter(Boolean).join(' · ');
          const on = (entry?.tools ?? []).includes(tool.id);
          return (
            <li key={`${tool.id}-${index}`} id={fieldId(['tools', index])} data-tool={tool.id} className="flex scroll-mt-28 items-center gap-3 px-2 py-1.5">
                <button
                type="button"
                onClick={() => setPanel({ index, isNew: false })}
                aria-label={`Open the tool ${tool.id}`}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-[13px] font-medium text-ink">{tool.id}</code>
                      <StatusChip>{plainToolKind(tool) || String(tool.type)}</StatusChip>
                      {problems > 0 && <StatusChip tone="danger" dot>{problems} to fix</StatusChip>}
                      {!problems && unused.has(tool.id) && <StatusChip tone="warning">Not used</StatusChip>}
                      {notAvailable(tool) && <StatusChip tone="warning">Not available yet</StatusChip>}
                      {tool.connection === GATEWAY_CONNECTION && <StatusChip tone="accent">Banking gateway</StatusChip>}
                    </span>
                    {sub && <span className="mt-0.5 block truncate text-xs text-muted">{sub}</span>}
                  </span>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                </button>
                {items.length === 1 && entry &&
              <Toggle
                checked={on}
                disabled={disabled}
                label={`${entry.name || 'The agent'} can use ${tool.id}`}
                onChange={(v) => update(['agents', 'items', entryIndex, 'tools'], v ? [...(entry.tools ?? []), tool.id] : (entry.tools ?? []).filter((t) => t !== tool.id))} />
              }
              </li>);

        })}
          {undeclared.map((t) =>
        <li key={`missing-${t}`} className="flex items-start justify-between gap-4 bg-danger-soft/50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-danger">
                  <code className="font-mono">{t}</code> is used but doesn’t exist
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">Remove it from the agent, or add a tool with this id.</p>
              </div>
              <button
            type="button"
            disabled={disabled}
            onClick={() => update(['agents', 'items', entryIndex, 'tools'], (entry?.tools ?? []).filter((x) => x !== t))}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-danger transition-colors duration-150 hover:bg-danger/10">
                <XIcon className="h-3.5 w-3.5" aria-hidden />
                Remove
              </button>
            </li>
        )}
        </ul>
      }
      {query && shown.length === 0 && <p className="text-[13px] text-muted">No tool matches “{query}”.</p>}

      <AddToolDialog open={adding} config={config} onClose={() => setAdding(false)} onPick={pick} />
      {panel && tools[panel.index] &&
      <ToolPanel
        config={config}
        index={panel.index}
        isNew={panel.isNew}
        disabled={disabled}
        errors={errors}
        update={update}
        onDelete={() => remove(panel.index)}
        onClose={() => setPanel(null)}
        onOpenJson={() => {
          setPanel(null);
          onOpenJson();
        }} />
      }
    </div>);

}
