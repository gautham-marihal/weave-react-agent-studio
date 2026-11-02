import React from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position, getBezierPath, type EdgeProps, type NodeProps } from '@xyflow/react';
import { NODE_SIZE, type EdgeKind } from '../../../../models/workflow';
import { KIND_TONE, STROKE, captionOf, iconOf, strokeOf, type ArrowEdge, type BlockNode } from './look';
import { cn } from '../../../../utils/styles';

// The blocks and arrows on the canvas. Everything shown is read from the config (models/workflow.ts); text is rendered
// as text (never as HTML), so a description or a server message can't inject markup.

const handleClass =
  '!h-3 !w-3 !rounded-full !border-2 !border-surface !bg-line-strong transition-colors hover:!bg-accent group-hover:!bg-accent/70 [&.connectingto]:!bg-accent [&.valid]:!bg-success';

export function Block({ data, selected }: NodeProps<BlockNode>) {
  const { node, errors, warnings } = data;
  const Icon = iconOf(node);
  return (
    <div
      style={{ width: NODE_SIZE[node.kind].w }}
      className={cn(
        'group relative rounded-lg border bg-surface shadow-panel transition-[border-color,box-shadow] duration-150',
        selected
          ? 'border-accent ring-2 ring-accent/25'
          : errors
            ? 'border-danger/70 ring-1 ring-danger/20'
            : node.loose
              ? 'border-dashed border-line-strong'
              : 'border-line hover:border-line-strong',
        node.disabled && 'opacity-60'
      )}>
      {node.in && <Handle type="target" position={Position.Left} className={handleClass} />}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', KIND_TONE[node.kind])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{captionOf(node)}</p>
          <p className="truncate text-[13px] font-semibold leading-snug text-ink" title={node.label}>{node.label}</p>
          {node.sub && <p className={cn('mt-0.5 break-words text-xs text-muted', node.kind === 'tool' ? 'line-clamp-1' : 'line-clamp-2')} title={node.sub}>{node.sub}</p>}
        </div>
      </div>
      {(node.entry || node.disabled || node.loose) &&
      <div className="flex flex-wrap gap-1 border-t border-line/70 px-3 py-1.5 text-[11px]">
          {node.entry && <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">Answers first</span>}
          {node.disabled && <span className="rounded bg-subtle px-1.5 py-0.5 font-medium text-muted">Switched off</span>}
          {node.loose && <span className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning" title={node.loose}>Not connected</span>}
        </div>
      }
      {(errors > 0 || warnings > 0) &&
      <span
        className={cn('absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white shadow-sm', errors ? 'bg-danger' : 'bg-warning')}
        title={`${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} from the server’s checks`}>
          {errors || warnings}
        </span>
      }
      {node.out && <Handle type="source" position={Position.Right} className={handleClass} />}
    </div>);

}

export function Arrow({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<ArrowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const kind = data?.edge.kind ?? 'uses';
  const error = !!data?.error;
  const label = data?.edge.label;
  // What an agent can use is drawn faintly until it or the tool is selected, so the hand-offs read first.
  const faint = kind === 'uses' && !selected && !error && !data?.active;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{ stroke: strokeOf(kind, error, !!selected), strokeWidth: selected || error || data?.active ? 2.25 : 1.5, opacity: faint ? 0.45 : 1, strokeDasharray: STROKE[kind].dashed ? '5 4' : undefined }} />
      {label &&
      <EdgeLabelRenderer>
          <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className={cn(
            'nodrag nopan pointer-events-none absolute max-w-[180px] truncate rounded border bg-surface px-1.5 py-0.5 text-[11px] shadow-sm',
            error ? 'border-danger/50 text-danger' : selected ? 'border-accent/50 text-accent' : 'border-line text-muted'
          )}>
            {label}
          </div>
        </EdgeLabelRenderer>
      }
    </>);

}

/** A line in the legend, drawn as the arrow of that kind is. */
export function LegendSwatch({ kind }: { kind: EdgeKind }) {
  return (
    <svg width="28" height="8" aria-hidden className="shrink-0">
      <line x1="1" y1="4" x2="27" y2="4" style={{ stroke: STROKE[kind].color, strokeWidth: 2, strokeDasharray: STROKE[kind].dashed ? '4 3' : undefined }} />
    </svg>);

}
