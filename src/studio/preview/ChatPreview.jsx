import React, { useEffect, useRef, useState } from 'react';
import { Notice } from '../ui.jsx';
import './preview.css';

// The preview beside the agent's settings: talk to the agent while you edit it, with the state of the connection always visible.
// It shows either the REAL agent (a real conversation over LiveKit, on the saved draft) or a SIMULATED one (rules in the browser on your
// current edits, no server). The two are never confused: the panel says which, and every simulated reply carries a "Simulated" tag.
//
// States: idle, loading (starting / connecting / waiting for the agent), live, reconnecting, ended, and error.

export const PREVIEW_STATES = ['idle', 'loading', 'live', 'reconnecting', 'ended', 'error'];

export function previewState(session) {
  if (session.status === 'error') return 'error';
  if (session.status === 'ended') return 'ended';
  if (session.status === 'idle') return 'idle';
  if (session.reconnecting) return 'reconnecting';
  if (session.status === 'live') return 'live';
  return 'loading';
}

const LOADING_TEXT = { starting: 'Asking for a conversation…', connecting: 'Connecting…', waiting: 'Waiting for the agent to join…' };

function Line({ message }) {
  if (message.role === 'system') return <li className="pvSystem" role="note">{message.text}</li>;
  const mine = message.role === 'user';
  return (
    <li className={`pvMsg ${mine ? 'me' : 'bot'}`}>
      <span className="pvWho">{mine ? 'You' : 'Agent'}{message.simulated && <b className="pvSimTag" title="Made up by a simulation in your browser, not by the real agent">Simulated</b>}</span>
      <p>{message.text || '…'}</p>
    </li>
  );
}

export default function ChatPreview({ session, mode, modeLocked, onMode, botId, editor, onClose }) {
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);
  const state = previewState(session);
  const simulated = mode === 'simulated';
  const running = ['starting', 'connecting', 'waiting', 'live'].includes(session.status);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [session.messages]);

  const start = () => session.startFor(botId, { ref: 'draft', identity: `preview-${Math.random().toString(36).slice(2, 6)}` });
  const send = async () => { const text = draft; if (!text.trim() || state !== 'live') return; setDraft(''); await session.sendText(text); };
  const voice = !simulated && session.info?.channel?.type === 'web_voice';

  return (
    <section className={`pvPanel ${simulated ? 'simulated' : 'real'}`} aria-label="Preview" data-state={state} data-mode={mode}>
      <header className="pvHead">
        <strong>Preview</strong>
        <div className="pvModes" role="group" aria-label="What to talk to">
          <button type="button" className={!simulated ? 'on' : ''} aria-pressed={!simulated} disabled={modeLocked || running} onClick={() => onMode('real')}
            title={modeLocked ? 'Demo mode has no real agent to talk to' : 'A real conversation with the saved draft'}>Real agent</button>
          <button type="button" className={simulated ? 'on' : ''} aria-pressed={simulated} disabled={running} onClick={() => onMode('simulated')}
            title="Made-up replies from simple rules, using your current edits. No server.">Simulated</button>
        </div>
        {onClose && <button type="button" className="stIconBtn" aria-label="Hide the preview" onClick={onClose}>×</button>}
      </header>

      <p className={`pvBanner ${simulated ? 'sim' : 'real'}`} role="note">
        {simulated
          ? <><b>Simulated.</b> Replies are made up by simple rules in your browser from your current edits (saved or not). This is not the real agent running{modeLocked ? ', and demo mode has none' : ''}.</>
          : <><b>Real agent.</b> A live conversation with the <em>saved draft</em> through the server{editor?.dirty ? '. You have unsaved edits: they are not in it until you save' : ''}.</>}
      </p>
      {!simulated && editor?.dirty && state !== 'live' && (
        <button type="button" className="quietButton pvSave" onClick={() => editor.save()} disabled={editor.saving || !!editor.parsed?.error}>{editor.saving ? 'Saving…' : 'Save draft'}</button>
      )}

      {state === 'idle' && (
        <div className="pvEmpty">
          <strong>No conversation yet</strong>
          <span>The agent greets you first. Change a setting, save if it is the real agent, and start again to see the difference.</span>
          <button type="button" className="primaryCta compactCta" onClick={start}>{simulated ? 'Start a simulated chat' : 'Start a conversation'}</button>
        </div>
      )}

      {state === 'loading' && (
        <div className="pvLoading" role="status" aria-live="polite">
          <i className="pvSpin" aria-hidden="true" />
          <strong>{LOADING_TEXT[session.status] || 'Connecting…'}</strong>
          <span>{session.agentHint ? 'The agent hasn’t joined yet. The runtime may not be running for it. You can end this and try again.' : 'This takes a few seconds.'}</span>
          <button type="button" className="quietButton" onClick={session.stop}>Cancel</button>
        </div>
      )}

      {state === 'error' && (
        <div className="pvError">
          <Notice kind="error" title={session.error?.title || 'The conversation didn’t start'} actions={<button type="button" className="quietButton" onClick={() => { session.clearError(); start(); }}>Try again</button>}>
            {session.error?.body || 'Something went wrong starting it.'}
            {!simulated && !modeLocked && <> You can still try the <button type="button" className="stLink" onClick={() => { session.clearError(); onMode('simulated'); }}>simulated preview</button>.</>}
          </Notice>
        </div>
      )}

      {(state === 'live' || state === 'reconnecting' || state === 'ended') && (
        <>
          {state === 'reconnecting' && <p className="pvBanner warn" role="status"><b>Connection lost.</b> Trying to reconnect…</p>}
          <ul className="pvLog" aria-label="Conversation" aria-live="polite">
            {session.messages.map((message) => <Line key={message.id} message={message} />)}
            <li ref={endRef} aria-hidden="true" />
          </ul>
          {voice && <p className="pvHint">This agent talks by voice. Use the Test tab to speak with it; typing here still works.</p>}
          {state === 'ended' ? (
            <div className="pvEnded" role="status"><span>The conversation ended.</span><button type="button" className="primaryCta compactCta" onClick={start}>Start again</button></div>
          ) : (
            <div className="pvComposer">
              <input type="text" value={draft} placeholder="Type a message…" aria-label="Message to the agent" disabled={state !== 'live'} onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); send(); } }} />
              <button type="button" className="primaryCta compactCta" onClick={send} disabled={state !== 'live' || !draft.trim()}>Send</button>
              <button type="button" className="quietButton" onClick={session.stop}>End</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
