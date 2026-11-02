import React, { useState } from 'react';
import { DatabaseIcon, FileTextIcon, GlobeIcon, LoaderCircleIcon, RefreshCwIcon, SearchIcon, UploadIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import {
  STATE_TEXT,
  agentLabel,
  baseState,
  fixActionFor,
  howItSearches,
  humanize,
  isBuilding,
  lastLog,
  readableFix,
  readersInWords,
  readersOf,
  refreshNote,
  settingsOf,
  type KnowledgeBaseView,
  type KnowledgeBuild,
} from '../../../../models/knowledge';
import { entryIndex } from '../../../../models/setup';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import { SearchPanel } from './SearchPanel';
import { whenInWords } from './words';

interface BaseCardProps {
  agentId: string;
  baseId: string;
  /** The base as the server has it (the saved draft); null while it is only in the editor. */
  base: KnowledgeBaseView | null;
  config: AgentConfig;
  build?: KnowledgeBuild | null;
  buildError?: string;
  canEdit: boolean;
  onBuild: (baseId: string) => void;
  onAttach: (baseId: string) => void;
  onUpload: () => void;
}

/**
 * One knowledge base, in words: its kind, when it is read and by whom, its sources, its index and what it needs, with
 * Build, a real search and "How it searches". A base nothing reads offers to give it to the agent that answers first.
 */
export function BaseCard({ agentId, baseId, base, config, build, buildError, canEdit, onBuild, onAttach, onUpload }: BaseCardProps) {
  const [searching, setSearching] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const draft = (Array.isArray(config.knowledge) ? config.knowledge : []).find((b: { id?: string }) => b?.id === baseId) as { type?: string; mode?: string } | undefined;
  const live = build || base?.build || null;
  const state = base ? baseState({ ...base, build: live }) : null;
  const info = state ? STATE_TEXT[state] : null;
  const building = isBuilding(live);
  const buildable = base ? base.buildable : draft?.type === 'vector_store';
  const mode = draft?.mode || base?.mode || 'tool';
  const readers = draft ? readersInWords(config, baseId) : '';
  const read = draft ? readersOf(config, baseId).agents.length > 0 : false;
  const entry = entryIndex(config) >= 0 ? config.agents?.items?.[entryIndex(config)] : null;
  const settings = settingsOf(config, baseId);
  const refresh = buildable ? refreshNote(settings.refresh) : '';
  // the index line already says there is none, and Build builds it: that problem is not said twice
  const problems = (base?.problems ?? []).filter((p) => !/no index has been built/i.test(p.problem));
  const titleId = `kb-${baseId}`;

  return (
    <section aria-labelledby={titleId} data-base={baseId} className="rounded-xl border border-line bg-surface p-5 shadow-panel">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden>
            <DatabaseIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h4 id={titleId} className="text-sm font-semibold text-ink">
              {humanize(baseId)} <code className="ml-1 font-mono text-xs font-normal text-muted">{baseId}</code>
            </h4>
            <p className="text-xs text-muted">
              {buildable ? 'Your documents and web pages' : 'Your own search service'} · {mode === 'inject' ? 'read in every conversation' : 'looked up when it needs to'}
            </p>
          </div>
        </div>
        {info ? <StatusChip tone={info.tone} dot title={info.hint}>{info.label}</StatusChip> : <StatusChip tone="warning" dot>Not saved yet</StatusChip>}
      </header>

      <div className="mt-3 text-[13px]">
        {!draft ?
        <p className="text-muted">Taken out of the draft: it goes from the server when the draft is saved.</p> :
        read ?
        <p className="text-ink-soft">{readers}</p> :

        <p className="flex flex-wrap items-center gap-2">
            <span className="text-warning">{readers || 'Nothing reads it yet, so no agent answers from it.'}</span>
            {entry && canEdit &&
          <Button size="sm" variant="secondary" onClick={() => onAttach(baseId)}>
                Let {agentLabel(config, entry.id)} use it
              </Button>
          }
          </p>
        }
      </div>
      {!base && draft &&
      <p className="mt-2 text-[13px] text-muted">The server builds and searches the saved draft: save it, then build this base’s index.</p>
      }
      {refresh && <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink-soft" role="note">{refresh}</p>}

      {base && buildable &&
      <>
          <ul aria-label={`Sources of ${baseId}`} className="mt-3 divide-y divide-line rounded-lg border border-line">
            {base.sources.map((s, i) =>
          <li key={`${s.kind}-${s.label}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                {s.kind === 'url' ? <GlobeIcon className="h-3.5 w-3.5 text-muted" aria-hidden /> : <FileTextIcon className="h-3.5 w-3.5 text-muted" aria-hidden />}
                <span className="min-w-0 truncate font-mono text-xs text-ink">{s.label}</span>
                <span className="text-xs text-muted">{s.kind === 'url' ? 'web page' : 'file'}</span>
                {s.kind === 'file' && s.uploaded === false && <StatusChip tone="danger">Not uploaded</StatusChip>}
                {s.kind === 'file' && s.uploaded === true && <StatusChip tone="success">Uploaded</StatusChip>}
              </li>
          )}
            {base.sources.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No sources yet.</li>}
          </ul>

          {base.index ?
        <p className="mt-3 text-[13px] text-ink-soft">
              Index built{whenInWords(base.index.builtAt) ? ` ${whenInWords(base.index.builtAt)}` : ''}: <strong className="font-semibold text-ink">{base.index.passages.toLocaleString()}</strong>{' '}
              {base.index.passages === 1 ? 'passage' : 'passages'}
              {base.index.embedding ? ` with ${base.index.embedding}` : ''}.{' '}
              {base.index.documents.length > 0 &&
          <button type="button" className="font-medium text-accent hover:underline" aria-expanded={showDocs} onClick={() => setShowDocs((v) => !v)}>
                  {showDocs ? 'Hide' : 'Show'} the {base.index.documents.length} {base.index.documents.length === 1 ? 'document' : 'documents'}
                </button>
          }
            </p> :

        <p className="mt-3 text-[13px] text-muted">There is no index yet: searches find nothing until one is built.</p>
        }
          {showDocs && base.index &&
        <ul className="mt-2 space-y-1 pl-4 text-xs text-ink-soft">
              {base.index.documents.map((d) =>
          <li key={d.name}>
                  <code className="font-mono">{d.name}</code>
                  {d.passages !== undefined ? ` · ${d.passages} ${d.passages === 1 ? 'passage' : 'passages'}` : ''}
                </li>
          )}
            </ul>
        }
        </>
      }

      {problems.length > 0 &&
      <ul aria-label={`Problems with ${baseId}`} className="mt-3 space-y-1.5 rounded-lg border border-warning/30 bg-warning-soft p-3">
          {problems.map((p, i) =>
        <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
              <strong className="font-medium text-ink">{p.problem}</strong>
              {readableFix(p) && <span className="text-ink-soft">{readableFix(p)}</span>}
              {fixActionFor(p) === 'upload' && canEdit &&
          <Button size="sm" variant="ghost" onClick={onUpload}>
                  <UploadIcon className="h-3.5 w-3.5" aria-hidden />
                  Upload a file
                </Button>
          }
            </li>
        )}
        </ul>
      }

      {building &&
      <p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-[13px] text-ink-soft">
          <LoaderCircleIcon className="h-4 w-4 animate-spin text-info" aria-hidden />
          <span>
            <strong className="font-medium text-ink">Building the index…</strong> {lastLog(live)}
          </span>
        </p>
      }
      {live?.status === 'failed' &&
      <p role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          The last build failed: {live.error || 'no reason was given.'} {base?.index ? 'The previous index is still answering.' : ''}
        </p>
      }
      {live?.status === 'done' && live.passages !== undefined &&
      <p role="status" className="mt-3 text-[13px] text-success">Build finished: {live.passages.toLocaleString()} {live.passages === 1 ? 'passage' : 'passages'}.</p>
      }
      {live && live.log.length > 1 &&
      <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">Progress of the build ({live.log.length} lines)</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {live.log.map((line, i) => <li key={i}>{line}</li>)}
          </ol>
        </details>
      }
      {buildError && <p role="alert" className="mt-2 text-[13px] text-danger">{buildError}</p>}
      {base && buildable && !base.keyAvailable &&
      <p className="mt-2 text-[13px] text-warning">This server has no embedding key, so it can’t build indexes. Whoever runs it has to set it.</p>
      }

      {base && buildable &&
      <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
          size="sm"
          variant="secondary"
          disabled={!canEdit || building || !base.keyAvailable || base.sources.length === 0}
          onClick={() => onBuild(baseId)}
          title="The server builds from the saved draft">
            <RefreshCwIcon className={building ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden />
            {building ? 'Building…' : base.index ? 'Rebuild the index' : 'Build the index'}
          </Button>
          <Button size="sm" variant="ghost" aria-expanded={searching} onClick={() => setSearching((v) => !v)} disabled={!base.index}>
            <SearchIcon className="h-3.5 w-3.5" aria-hidden />
            {searching ? 'Close the search' : 'Try a search'}
          </Button>
          {!base.index && <span className="text-xs text-muted">Build the index before trying a search.</span>}
        </div>
      }
      {searching && base?.index &&
      <div className="mt-4 rounded-lg border border-line bg-subtle/40 p-4">
          <SearchPanel agentId={agentId} baseId={baseId} settings={settings} />
        </div>
      }

      {draft &&
      <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">How it searches</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-soft">
            {howItSearches(config, baseId).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted">
            These are the base’s <code className="font-mono">mode</code>, <code className="font-mono">top_k</code> and{' '}
            <code className="font-mono">retrieval</code> settings, changed in the JSON view.
          </p>
        </details>
      }
    </section>);

}
