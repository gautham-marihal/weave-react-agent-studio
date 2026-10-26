import React from 'react';
import { api } from '../../api/client.ts';
import { Notice } from '../ui.jsx';
import { formatWhen } from '../format.js';
import { useAsync } from '../useAsync.js';

// A call as a conversation and nothing else: who said what, in order (`GET /bots/{id}/calls/{call}/transcript`). The
// trace beside it shows everything that happened (tools, requests, state); this is for reading the call the way the
// caller and the agent lived it. It holds what the caller said.
const SPEAKER = { user: 'Caller', caller: 'Caller', agent: 'Agent', assistant: 'Agent', system: 'System', tool: 'Tool' };
const speakerOf = (role) => SPEAKER[String(role || '').toLowerCase()] || (role ? String(role) : 'Someone');

export default function TranscriptView({ botId, callId }) {
  const transcript = useAsync((signal) => api.getTranscript(botId, callId, { signal }), [botId, callId]);
  const turns = Array.isArray(transcript.data?.turns) ? transcript.data.turns : [];
  if (transcript.loading && !transcript.data)
    return (
      <p className="stMuted" role="status">
        Loading the conversation…
      </p>
    );
  if (transcript.error)
    return (
      <Notice kind="error" title="The conversation couldn’t be read">
        {transcript.error.message || 'Something went wrong.'}
      </Notice>
    );
  if (!turns.length) return <p className="stFEmpty">Nobody said anything in this call.</p>;
  return (
    <ol className="clTranscript" aria-label="The conversation">
      {turns.map((turn, index) => (
        <li key={index} className={`clTurn ${String(turn.role || '').toLowerCase() === 'user' || turn.role === 'caller' ? 'caller' : 'agent'}`}>
          <header>
            <strong>{speakerOf(turn.role)}</strong>
            {turn.at && <time dateTime={turn.at}>{formatWhen(turn.at)}</time>}
          </header>
          <p>{typeof turn.text === 'string' ? turn.text : JSON.stringify(turn.text)}</p>
        </li>
      ))}
    </ol>
  );
}
