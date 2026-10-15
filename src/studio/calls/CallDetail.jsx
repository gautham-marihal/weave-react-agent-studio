import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUrl, followCall } from '../../api/client.js';
import { Notice } from '../ui.jsx';
import { formatWhen } from '../format.js';
import TraceView from '../trace/TraceView.jsx';
import TranscriptView from './TranscriptView.jsx';
import { channelLabel, countsLine, formatSeconds, ndjson, statusOf } from './callModel.js';

// One call: who and when, how it went, and the trace of everything that happened in it (the same component a Test conversation and a
// failed scenario use). A call still in progress is followed live. The records hold what the caller said, so the screen says so.
const PAGE = 500;
const MAX_EVENTS = 5000;

export default function CallDetail({ botId, botName, callId, summary, onClose }) {
  const [call, setCall] = useState(summary || null);
  const [events, setEvents] = useState([]);
  const [meta, setMeta] = useState({ counts: {}, finalState: null, usage: [] });
  const [state, setState] = useState({ loading: true, error: null, truncated: false });
  const [view, setView] = useState('trace'); // 'trace' (everything that happened) | 'conversation' (only what was said)
  const lastSeq = useRef(0);
  const summaryRef = useRef(summary);
  summaryRef.current = summary; // the row the list showed, until the call itself is read (a refreshed list must not make this reload)

  useEffect(() => {
    let off = false;
    let stop = () => {};
    lastSeq.current = 0;
    setEvents([]); setState({ loading: true, error: null, truncated: false });
    const append = (records) => setEvents((old) => { const have = new Set(old.map((e) => e.seq)); const fresh = records.filter((r) => !have.has(r.seq)); return fresh.length ? [...old, ...fresh].sort((a, b) => a.seq - b.seq) : old; });
    (async () => {
      try {
        let after = 0; let all = []; let last = null;
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          const page = await api.getCall(botId, callId, { after, limit: PAGE });
          last = page;
          all = all.concat(Array.isArray(page.events) ? page.events : []);
          after = page.next_after ?? after;
          if (!page.more || all.length >= MAX_EVENTS) break;
        }
        if (off) return;
        lastSeq.current = all.length ? all[all.length - 1].seq : 0;
        setCall(last.call || summaryRef.current);
        setMeta({ counts: last.counts || {}, finalState: last.final_state ?? null, usage: Array.isArray(last.usage) ? last.usage : [] });
        setEvents(all);
        setState({ loading: false, error: null, truncated: !!last.more });
        if ((last.call || summaryRef.current)?.status === 'in_progress') {
          stop = followCall(botId, callId, {
            after: lastSeq.current,
            onRecord: (record) => { if (!off) append([record]); },
            onEnd: () => { if (!off) setCall((c) => (c ? { ...c, status: 'ended' } : c)); },
          });
        }
      } catch (error) {
        if (!off) setState({ loading: false, error, truncated: false });
      }
    })();
    return () => { off = true; stop(); };
  }, [botId, callId]);

  const status = statusOf(call?.status);
  const live = call?.status === 'in_progress';
  const href = useMemo(() => apiUrl(`/bots/${encodeURIComponent(botId)}/calls/${encodeURIComponent(callId)}/download`), [botId, callId]);
  const downloadDemo = () => {
    const url = URL.createObjectURL(new Blob([ndjson(events)], { type: 'application/x-ndjson' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${callId}.ndjson`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const tokens = meta.usage.reduce((sum, u) => ({ input: sum.input + (u.input_tokens || 0), output: sum.output + (u.output_tokens || 0) }), { input: 0, output: 0 });

  return (
    <section className="clDetail stCard" aria-label="Call detail">
      <header className="clDetailHead">
        <div>
          <h3>{botName || botId} · {formatWhen(call?.started_at)}</h3>
          <p className="stMuted"><code>{callId}</code></p>
        </div>
        <div className="clDetailActions">
          {href ? <a className="quietButton" href={href} download>Download the log</a> : <button type="button" className="quietButton" onClick={downloadDemo} disabled={!events.length}>Download the log</button>}
          <button type="button" className="quietButton" onClick={onClose}>Close</button>
        </div>
      </header>

      {call && (
        <dl className="clFacts">
          <div><dt>Status</dt><dd><span className={`clStatus ${status.tone}`} title={status.hint}>{status.label}</span></dd></div>
          <div><dt>Channel</dt><dd>{channelLabel(call.channel) || '—'}</dd></div>
          <div><dt>Caller</dt><dd>{call.caller || 'unknown'}</dd></div>
          <div><dt>Duration</dt><dd>{formatSeconds(call.duration_s) || '—'}</dd></div>
          <div><dt>Turns</dt><dd>{call.caller_turns ?? 0} from the caller, {call.agent_turns ?? 0} from the agent</dd></div>
          <div><dt>Version</dt><dd>{call.version || '—'}{call.ref ? ` (${call.ref})` : ''}</dd></div>
          {(tokens.input || tokens.output) ? <div><dt>Model use</dt><dd>{tokens.input.toLocaleString()} in · {tokens.output.toLocaleString()} out tokens</dd></div> : null}
        </dl>
      )}
      {meta.finalState && Object.keys(meta.finalState).length > 0 && <p className="clState">Final state: <code>{JSON.stringify(meta.finalState)}</code></p>}

      {countsLine(meta.counts) && <p className="clCounts">{countsLine(meta.counts)}</p>}
      <div className="clViews" role="group" aria-label="How to read this call">
        <button type="button" className={view === 'trace' ? 'on' : ''} aria-pressed={view === 'trace'} onClick={() => setView('trace')}>What happened</button>
        <button type="button" className={view === 'conversation' ? 'on' : ''} aria-pressed={view === 'conversation'} onClick={() => setView('conversation')}>Conversation only</button>
      </div>

      {state.loading && <p className="stMuted" role="status">Loading the call…</p>}
      {state.error && <Notice kind="error" title="This call couldn’t be read">{state.error.message || 'Something went wrong.'}</Notice>}
      {state.truncated && <Notice kind="warn" title="Only the first records are shown">This call has more than {MAX_EVENTS.toLocaleString()} records. Download the log to read all of it.</Notice>}
      {!state.loading && !state.error && view === 'trace' && <TraceView records={events} live={live} title="What happened" emptyText="No records were written for this call." />}
      {!state.loading && !state.error && view === 'conversation' && <TranscriptView botId={botId} callId={callId} />}
    </section>
  );
}
