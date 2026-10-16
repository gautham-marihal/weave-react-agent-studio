import { useMemo, useState } from 'react';
import SmartSelect from '../SmartSelect.jsx';
import { isDemoMode } from '../../demo/demoMode.js';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { Notice } from '../ui.jsx';
import { formatWhen } from '../format.js';
import CallDetail from './CallDetail.jsx';
import { ALL_AGENTS_LIMIT, CALL_STATUS, RANGES, channelsIn, rowOf } from './callModel.js';
import { useCalls } from './useCalls.js';
import './calls.css';

// The calls an agent (or every agent) has had: who called, when, for how long, how it went. Selecting one opens the trace of what
// happened in it. The API serves these per agent, so "All agents" asks each agent and merges the answers. These records hold what
// callers said, and the API cannot yet limit who reads them, so the screen says so.
export default function CallsView({ bots = [], fixedBotId = '', onOpenAgent, initialCall = null }) {
  const [botId, setBotId] = useState(fixedBotId);
  const [range, setRange] = useState('7d');
  const [caller, setCaller] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [auto, setAuto] = useState(false);
  const [openCall, setOpenCall] = useState(initialCall); // { botId, id, raw }
  const effectiveBot = fixedBotId || botId;
  const filters = useMemo(() => ({ range, caller, channel, status }), [range, caller, channel, status]);
  const { calls, loading, loadingMore, errors, hasMore, loadMore, reload, skipped } = useCalls({ bots, botId: effectiveBot, filters, refreshMs: auto ? 10000 : 0 });
  const names = useMemo(() => Object.fromEntries(bots.map((b) => [b.id, b.name])), [bots]);
  const rows = useMemo(() => calls.map((c) => rowOf(c, names[c.bot])), [calls, names]);
  const channels = useMemo(() => channelsIn(calls), [calls]);
  const showAgent = !effectiveBot;

  return (
    <div className="clView">
      <p className="clPrivacy" role="note">
        <b>These records contain what callers said.</b> The studio can’t limit who reads them yet: anyone who can open it can read every call{isDemoMode() ? '' : ' of every agent'}.
      </p>
      <DemoNote kind="calls">These calls are made-up examples, plus the simulated conversations you had in the preview. No real caller is involved.</DemoNote>

      <div className="clFilters" role="group" aria-label="Filter the calls">
        {!fixedBotId && (
          <label><span>Agent</span>
            <SmartSelect className="stFInput small" value={botId} ariaLabel="Agent" placeholder={`All agents${bots.length > ALL_AGENTS_LIMIT ? ` (the first ${ALL_AGENTS_LIMIT})` : ''}`}
              options={[{ value: '', label: `All agents${bots.length > ALL_AGENTS_LIMIT ? ` (the first ${ALL_AGENTS_LIMIT})` : ''}` }, ...bots.map((b) => ({ value: b.id, label: b.name || b.id, description: b.id }))]} onChange={(chosen) => { setBotId(chosen); setOpenCall(null); }} />
          </label>
        )}
        <label><span>When</span>
          <select className="stFInput small" value={range} onChange={(event) => setRange(event.target.value)}>{RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </label>
        <label><span>Status</span>
          <select className="stFInput small" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any</option>
            {Object.entries(CALL_STATUS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
          </select>
        </label>
        <label><span>Channel</span>
          <select className="stFInput small" value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="">Any</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            {channel && !channels.some((c) => c.id === channel) && <option value={channel}>{channel}</option>}
          </select>
        </label>
        <label><span>Caller</span>
          <input className="stFInput small" type="search" value={caller} placeholder="part of a number" onChange={(event) => setCaller(event.target.value)} />
        </label>
        <span className="clFilterActions">
          <button type="button" className="quietButton" onClick={reload} disabled={loading}>Refresh</button>
          <label className="clAuto"><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} /> Every 10 s</label>
        </span>
      </div>

      {skipped > 0 && <Notice kind="info" title={`Showing the first ${ALL_AGENTS_LIMIT} agents`}>The API lists calls one agent at a time, so “All agents” asks each one. Choose an agent to see the others.</Notice>}
      {errors.map((e) => <Notice key={e.botId} kind="error" title={`The calls of ${names[e.botId] || e.botId} couldn’t be read`}>{e.message}</Notice>)}

      {openCall && <CallDetail botId={openCall.botId} botName={names[openCall.botId]} callId={openCall.id} summary={openCall.raw} onClose={() => setOpenCall(null)} />}

      <div className="clTableWrap">
        <table className="clTable">
          <thead>
            <tr><th>Started</th>{showAgent && <th>Agent</th>}<th>Caller</th><th>Channel</th><th>Duration</th><th title="from the caller / from the agent">Turns</th><th>Handoffs</th><th>Status</th><th>Version</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.bot}/${row.id}`} className={`clRow ${openCall?.id === row.id ? 'on' : ''}`} tabIndex={0} aria-label={`Open the call from ${formatWhen(row.startedAt)}`}
                onClick={() => setOpenCall({ botId: row.bot, id: row.id, raw: row.raw })} onKeyDown={(event) => { if (event.key === 'Enter') setOpenCall({ botId: row.bot, id: row.id, raw: row.raw }); }}>
                <td>{formatWhen(row.startedAt)}</td>
                {showAgent && <td>{row.botName}</td>}
                <td>{row.caller || <span className="stMuted">unknown</span>}</td>
                <td>{row.channel}</td>
                <td>{row.duration}</td>
                <td>{row.turns}</td>
                <td>{row.handoffs}</td>
                <td><span className={`clStatus ${row.tone}`} title={row.hint}>{row.statusLabel}</span></td>
                <td>{row.version}{row.ref && row.ref !== row.version ? <small className="stMuted"> {row.ref}</small> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && rows.length === 0 && <p className="clEmpty" role="status">Loading calls…</p>}
        {!loading && rows.length === 0 && errors.length === 0 && (
          <div className="clEmpty">
            <strong>No calls found</strong>
            <p>{status || channel || caller || range !== 'all' ? 'Nothing matches these filters. Try a longer time range or clear a filter.' : 'Nothing has called yet.'} A conversation from an agent’s Test tab is a call too.</p>
            {onOpenAgent && effectiveBot && <button type="button" className="secondaryCta" onClick={() => onOpenAgent(effectiveBot)}>Test this agent</button>}
          </div>
        )}
        {hasMore && <div className="clMore"><button type="button" className="quietButton" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more calls'}</button></div>}
      </div>
    </div>
  );
}
