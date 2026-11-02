import React, { useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { api } from '../../../../api/client';
import { normalizeSpeech, ruleWords, speechRequest, speechVerdict, type SpeechPreview } from '../../../../models/messagesSpeech';
import { Button } from '../../../ui/Button';
import { cn, inputClass } from '../../../../utils/styles';

/**
 * "Try a line": what the voice would be given for a line the agent might say, as the server works it out (POST
 * /preview/speech) with the rules in the editor, saved or not. Nothing is spoken and nothing is spent; when the server
 * cannot answer, it says so (there is no stand-in in the browser).
 */
export function TrySpeech({ config }: { config: AgentConfig }) {
  const agents = (config.agents?.items ?? []).filter((a) => a?.id);
  const channels = (config.channels ?? []).filter((c) => c?.id);
  const [line, setLine] = useState('');
  const [agent, setAgent] = useState('');
  const [channel, setChannel] = useState('');
  const [source, setSource] = useState<'model' | 'fixed'>('model');
  const [pieces, setPieces] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<SpeechPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!line.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setView(normalizeSpeech(await api.previewSpeech(speechRequest(config, line, { agent, channel, source, pieces }))));
    } catch (err: unknown) {
      setView(null);
      setError(err instanceof Error ? err.message : 'The server could not try it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Try how a line is said" className="rounded-lg bg-subtle px-4 py-4">
      <p className="text-sm font-medium text-ink">Try a line</p>
      <p className="mt-0.5 text-[13px] text-muted">Type something the agent might say and see what the voice would be given, worked out by the server. Nothing is spoken and nothing is spent.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className={cn(inputClass, 'min-w-[240px] flex-1')}
          aria-label="A line the agent might say"
          value={line}
          placeholder="Your balance is $12.50 and your appointment is at 4:30 PM."
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()} />
        <Button variant="secondary" onClick={() => void run()} disabled={busy || !line.trim()}>
          {busy ? <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Try it
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[13px] text-muted">
        <label className="flex items-center gap-2">
          Whose words
          <select className={cn(inputClass, 'h-8 w-auto py-1 text-[13px]')} value={source} onChange={(e) => setSource(e.target.value === 'fixed' ? 'fixed' : 'model')}>
            <option value="model">The AI’s own words</option>
            <option value="fixed">A fixed line I wrote</option>
          </select>
        </label>
        {agents.length > 1 &&
        <label className="flex items-center gap-2">
            Which agent
            <select className={cn(inputClass, 'h-8 w-auto py-1 text-[13px]')} value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">The one that answers first</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
          </label>
        }
        {channels.length > 1 &&
        <label className="flex items-center gap-2">
            On which channel
            <select className={cn(inputClass, 'h-8 w-auto py-1 text-[13px]')} value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">The first one</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
          </label>
        }
      </div>
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer font-medium text-ink-soft">Type it as it streams</summary>
        <p className="mt-1 text-muted">The AI’s words reach the voice in pieces. Write the pieces with a | between them to see what is spoken as each one arrives.</p>
        <input className={cn(inputClass, 'mt-2 font-mono text-[13px]')} aria-label="Pieces, separated by |" value={pieces} placeholder="at 4|:30 P|M" onChange={(e) => setPieces(e.target.value)} />
      </details>

      {error && <p role="alert" className="mt-3 text-[13px] text-danger">The server could not try this line: {error}</p>}
      {view &&
      <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-soft" aria-live="polite">
          <p role="status" className="font-medium text-ink">{speechVerdict(view)}</p>
          {view.applies &&
        <div data-block="spoken">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">What the voice is given</p>
              <pre aria-label="What the voice is given" className="mt-1 whitespace-pre-wrap rounded-md bg-subtle px-3 py-2 font-mono text-[13px] text-ink">{view.spoken}</pre>
              {view.changes.length > 0 &&
          <ul aria-label="What was changed" className="mt-2 space-y-0.5">
                  {view.changes.map((c, i) =>
            <li key={i}>
                      Rule {c.rule ?? '?'} ({ruleWords(c.type)}{c.label && c.label !== c.type && c.label !== ruleWords(c.type) ? `, “${c.label}”` : ''}): “{c.from}” becomes “{c.to}”
                    </li>
            )}
                </ul>
          }
              {view.heldBack && <p className="mt-1">If the line stopped here, this would wait for more text: “{view.heldBack}”</p>}
            </div>
        }
          {view.streaming &&
        <div data-block="streaming">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">As it arrives, piece by piece</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                {view.streaming.map((piece, i) => <li key={i}>“{piece}”</li>)}
              </ol>
              <p className="mt-1 text-xs text-muted">Ordinary words go out at once. Only a piece that could still become a match, such as the start of a time, waits for the next one.</p>
            </div>
        }
          {view.problems.length > 0 &&
        <ul className="space-y-0.5 text-warning">
              {view.problems.map((p) => <li key={p}>A rule cannot work: {p}</li>)}
            </ul>
        }
        </div>
      }
    </section>);

}
