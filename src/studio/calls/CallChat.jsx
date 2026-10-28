import React, { useMemo } from 'react';
import { agentLabel, humanize } from '../agent/rowNames.js';
import { chatOf } from './callChat.js';
import TranscriptView from './TranscriptView.jsx';

// A call as a chat: the agents' lines on the left and the caller's on the right, each with who said it and when, and a
// line wherever one agent hands the caller to another. Built from the call's records, which say which agent spoke.
//   events: the call's records; config: the agent's draft, for its agents' names (none when opened from the Calls page)
//   botName: the agent's name, used when the call had only one agent; caller: who called, from the call's summary

// each agent of the call keeps one avatar colour, in order of first appearance
const AVATAR_TONES = 6;

export default function CallChat({ botId, callId, events, config, botName, caller }) {
  const chat = useMemo(() => chatOf(events), [events]);
  // records with nobody speaking (an old call, or a log cut short): the transcript endpoint still has the words
  if (!chat.turns) return <TranscriptView botId={botId} callId={callId} />;

  const nameOf = (agent) => {
    if (config) return agentLabel(config, agent);
    if (chat.agents.length <= 1) return botName || humanize(agent) || 'Agent';
    return humanize(agent) || botName || 'Agent';
  };
  const callerName = chat.caller || caller || 'Caller';

  return (
    <section className="clChat" aria-label="Conversation transcript">
      <h3>
        Conversation transcript ({chat.turns} {chat.turns === 1 ? 'turn' : 'turns'})
      </h3>
      {chat.agents.length > 1 && <p className="clChatAgents">Agents in this call: {chat.agents.map((agent) => nameOf(agent)).join(', ')}</p>}
      <ol className="clChatList">
        {chat.items.map((item, index) =>
          item.type === 'handover' ? (
            <li key={index} className="clHandover">
              <span>
                {nameOf(item.from)} passed the caller to <strong>{nameOf(item.to)}</strong>
              </span>
              {item.time && <time>{item.time}</time>}
            </li>
          ) : (
            <ChatLine
              key={index}
              item={item}
              speaker={item.role === 'caller' ? callerName : nameOf(item.agent)}
              tone={item.role === 'caller' ? null : Math.max(0, chat.agents.indexOf(item.agent)) % AVATAR_TONES}
            />
          ),
        )}
      </ol>
    </section>
  );
}

function ChatLine({ item, speaker, tone }) {
  const isCaller = item.role === 'caller';
  return (
    <li className={`clMsg ${isCaller ? 'caller' : 'agent'}`} data-tone={isCaller ? undefined : tone}>
      {!isCaller && (
        <span className="clAvatar" aria-hidden="true">
          {speaker.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="clBubble">
        <header>
          <strong>{speaker}</strong>
          {item.time && <time>{item.time}</time>}
        </header>
        <p>{item.text}</p>
        {item.interrupted && <small className="clInterrupted">Cut off by the caller</small>}
      </div>
    </li>
  );
}
