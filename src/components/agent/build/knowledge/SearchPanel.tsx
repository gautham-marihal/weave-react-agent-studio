import React, { useState } from 'react';
import { LoaderCircleIcon, SearchIcon } from 'lucide-react';
import { api } from '../../../../api/client';
import { applyMinScore, describeScore, normalizeSearch, type SearchAnswer } from '../../../../models/knowledge';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import { cn, inputClass } from '../../../../utils/styles';

interface SearchPanelProps {
  agentId: string;
  baseId: string;
  /** The base's settings in the draft: passages asked for, lowest score kept, and whether it is read on every turn. */
  settings: { topK?: number; minScore?: number; mode: string };
}

/**
 * A real search of one base's index (POST …/knowledge/{base}/search on the saved draft): what a caller might say, and
 * the passages found with their scores, which guide `retrieval.min_score`. Shared by Build › Knowledge and the
 * workspace Knowledge page.
 */
export function SearchPanel({ agentId, baseId, settings }: SearchPanelProps) {
  const inject = settings.mode === 'inject';
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState('');
  const [previous, setPrevious] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      const raw = await api.searchKnowledge(agentId, baseId, {
        query: query.trim(),
        ...(topK ? { top_k: Number(topK) } : {}),
        ...(inject && previous.trim() ? { previous_reply: previous.trim() } : {}),
      });
      setAnswer(normalizeSearch(raw));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The search failed.');
    } finally {
      setBusy(false);
    }
  };

  const hits = answer ? applyMinScore(answer.hits, settings.minScore) : [];
  const dropped = hits.filter((h) => !h.kept).length;

  return (
    <form onSubmit={run} aria-label={`Try a search of ${baseId}`} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="text-[13px] font-medium text-ink-soft">What a caller might say</span>
          <span className="relative mt-1 block">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              className={cn(inputClass, 'pl-9')}
              value={query}
              maxLength={2000}
              placeholder="For example: how do I get a refund?"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search text"
            />
          </span>
        </label>
        <label className="w-36">
          <span className="text-[13px] font-medium text-ink-soft">Passages to ask for</span>
          <input
            type="number"
            min={1}
            max={20}
            className={cn(inputClass, 'mt-1')}
            value={topK}
            placeholder={String(settings.topK ?? 4)}
            onChange={(e) => setTopK(e.target.value)}
            aria-label="Passages to ask for"
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !query.trim()}>
          {busy ? <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </div>
      {inject &&
      <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">
            What the agent said just before <span className="font-normal text-muted">(optional: shows how a follow-up is searched)</span>
          </span>
          <input className={cn(inputClass, 'mt-1')} value={previous} maxLength={4000} onChange={(e) => setPrevious(e.target.value)} aria-label="What the agent said just before" />
        </label>
      }
      {error &&
      <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          The search did not run: {error}
        </p>
      }
      {answer &&
      <div role="status" className="space-y-3">
          <p className="text-xs text-muted">
            {hits.length} {hits.length === 1 ? 'passage' : 'passages'}
            {answer.ms !== undefined ? ` in ${answer.ms} ms` : ''}
            {settings.minScore !== undefined ?
          ` · this base drops anything scoring under ${settings.minScore}${dropped ? ` (${dropped} of these)` : ''}` :
          ' · no minimum score is set, so every passage found is kept'}
            .
          </p>
          {hits.length === 0 &&
        <p className="text-[13px] text-muted">Nothing matched. Either the index doesn’t have this, or the question is worded very differently from the material.</p>
        }
          <ol className="space-y-2">
            {hits.map((hit, i) =>
          <li key={i} className={cn('rounded-lg border border-line bg-canvas p-3', !hit.kept && 'opacity-60')} data-score={hit.score}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {hit.score !== undefined &&
              <span
                className="inline-flex items-center gap-2 font-mono text-ink"
                title={`${describeScore(hit.score)}. With the default embeddings, related text scores about 0.5 to 0.75 and unrelated text below 0.25.`}>
                      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-subtle" aria-hidden>
                        <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.round(Math.min(1, Math.max(0, hit.score)) * 100)}%` }} />
                      </span>
                      Score {hit.score.toFixed(2)}
                    </span>
              }
                  {hit.score !== undefined && <span>{describeScore(hit.score)}</span>}
                  {hit.source && <span className="font-medium text-ink-soft">· {hit.source}</span>}
                  {!hit.kept && <StatusChip tone="warning">Dropped by the lowest score kept</StatusChip>}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{hit.text}</p>
              </li>
          )}
          </ol>
          {answer.modelIsShown &&
        <details className="rounded-lg border border-line bg-surface px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-medium text-ink">What the model is shown</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-soft">{answer.modelIsShown}</pre>
            </details>
        }
          <p className="text-xs text-muted">
            Scores are how you choose <code className="font-mono">retrieval.min_score</code>: set it just under what a good answer scores and above what an unrelated one
            does. Other embedding models score differently.
          </p>
        </div>
      }
    </form>);

}
