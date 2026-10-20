import React, { useEffect, useRef, useState } from 'react';
import { Notice } from '../ui.jsx';
import './preview.css';
import Icon from '../../ui/Icon.jsx';
import AiOrb from './AiOrb.jsx';
import { inputCapabilities, pictureProblem, useDictation } from './useDictation.js';

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

const STATUS_WORDS = { idle: 'Ready', loading: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', ended: 'Ended', error: 'Problem' };
const LOADING_TEXT = { starting: 'Asking for a conversation…', connecting: 'Connecting…', waiting: 'Waiting for the agent to join…' };

function Line({ message }) {
  if (message.role === 'system')
    return (
      <li className="pvSystem" role="note">
        {message.text}
      </li>
    );
  const mine = message.role === 'user';
  return (
    <li className={`pvMsg ${mine ? 'me' : 'bot'}`}>
      <span className="pvWho">
        {mine ? 'You' : 'Agent'}
        {message.simulated && (
          <b className="pvSimTag" title="Made up by a simulation in your browser, not by the real agent">
            Simulated
          </b>
        )}
      </span>
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
  // the log scrolls itself; scrollIntoView would move the whole page too
  useEffect(() => {
    const el = endRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.messages]);

  const start = () => session.startFor(botId, { ref: 'draft', identity: `preview-${Math.random().toString(36).slice(2, 6)}` });
  const send = async () => {
    const text = draft;
    if (!text.trim() || state !== 'live') return;
    dictation.cancel();
    setDraft('');
    await session.sendText(text);
  };
  const voice = !simulated && session.info?.channel?.type === 'web_voice';

  // What the channel lets a caller send, from the draft's own settings: the microphone, pictures, the camera.
  const can = inputCapabilities(editor?.parsed?.value, session.info?.channel);
  const fileRef = useRef(null);
  const [note, setNote] = useState('');
  // what was already typed when the microphone was turned on stays; what is said is added after it
  const dictBase = useRef('');
  const dictation = useDictation((text) => setDraft(`${dictBase.current}${dictBase.current && !/\s$/.test(dictBase.current) ? ' ' : ''}${text}`));
  useEffect(() => {
    if (state !== 'live') dictation.cancel();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const connected = state === 'live';
  const micOn = simulated ? dictation.listening : !!session.media?.mic;
  const micUnavailable = simulated && !dictation.supported;
  const toggleMic = () => {
    if (simulated && !dictation.listening) dictBase.current = draft;
    return simulated ? dictation.toggle() : session.toggle('mic');
  };
  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !can.image) return;
    const problem = pictureProblem(file, can.image);
    setNote(problem);
    if (!problem) await session.sendImage(file, can.image.topic);
  };
  const hasTools = can.voice || !!can.image || (can.video && !simulated);
  const tools = hasTools ? (
    <span className="pvTools">
      {can.voice && (
        <button
          type="button"
          className={`pvTool ${micOn ? 'on' : ''}`}
          aria-label={micOn ? 'Turn the microphone off' : 'Speak to the agent'}
          aria-pressed={micOn}
          disabled={!connected || micUnavailable}
          title={
            micUnavailable
              ? 'This browser can’t turn speech into text. Use the Test tab to speak with the real agent.'
              : !connected
                ? 'Start a conversation first'
                : micOn
                  ? 'Listening: press to stop'
                  : simulated
                    ? 'Speak: what you say is typed into the box'
                    : 'Turn the microphone on'
          }
          onClick={toggleMic}
        >
          <Icon name="mic" size={18} />
        </button>
      )}
      {can.image && (
        <>
          <button
            type="button"
            className="pvTool"
            aria-label="Attach a picture"
            disabled={!connected}
            title={
              connected
                ? `Send a picture${can.image.acceptedMime.length ? ` (${can.image.acceptedMime.map((m) => m.replace('image/', '')).join(', ')})` : ''}`
                : 'Start a conversation first'
            }
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="paperclip" size={18} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={(can.image.acceptedMime.length ? can.image.acceptedMime : ['image/*']).join(',')}
            hidden
            aria-label="Choose a picture to send"
            onChange={onFile}
          />
        </>
      )}
      {can.video && !simulated && (
        <button
          type="button"
          className={`pvTool ${session.media?.camera ? 'on' : ''}`}
          aria-label={session.media?.camera ? 'Turn the camera off' : 'Turn the camera on'}
          aria-pressed={!!session.media?.camera}
          disabled={!connected}
          title={connected ? 'Camera' : 'Start a conversation first'}
          onClick={() => session.toggle('camera')}
        >
          <Icon name="camera" size={18} />
        </button>
      )}
    </span>
  ) : null;

  return (
    <section className={`pvPanel ${simulated ? 'simulated' : 'real'}`} aria-label="Preview" data-state={state} data-mode={mode}>
      <header className="pvHead">
        <strong>Preview</strong>
        <span className={`pvStatus ${state}`}>
          <i aria-hidden="true" />
          {STATUS_WORDS[state] || 'Ready'}
        </span>
        <div className="pvModes" role="group" aria-label="What to talk to">
          <button
            type="button"
            className={!simulated ? 'on' : ''}
            aria-pressed={!simulated}
            disabled={modeLocked || running}
            onClick={() => onMode('real')}
            title={modeLocked ? 'Demo mode has no real agent to talk to' : 'A real conversation with the saved draft'}
          >
            Real agent
          </button>
          <button
            type="button"
            className={simulated ? 'on' : ''}
            aria-pressed={simulated}
            disabled={running}
            onClick={() => onMode('simulated')}
            title="Made-up replies from simple rules, using your current edits. No server."
          >
            Simulated
          </button>
        </div>
        {onClose && (
          <button type="button" className="stIconBtn" aria-label="Hide the preview" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        )}
      </header>

      <p className={`pvBanner ${simulated ? 'sim' : 'real'}`} role="note">
        {simulated ? (
          <>
            <b>Simulated.</b> Replies are made up by simple rules in your browser from your current edits (saved or not). This is not the real agent running
            {modeLocked ? ', and demo mode has none' : ''}.
          </>
        ) : (
          <>
            <b>Real agent.</b> A live conversation with the <em>saved draft</em> through the server
            {editor?.dirty ? '. You have unsaved edits: they are not in it until you save' : ''}.
          </>
        )}
      </p>
      {!simulated && editor?.dirty && state !== 'live' && (
        <button type="button" className="quietButton pvSave" onClick={() => editor.save()} disabled={editor.saving || !!editor.parsed?.error}>
          {editor.saving ? 'Saving…' : 'Save draft'}
        </button>
      )}

      {state === 'idle' && (
        <div className="pvEmpty">
          <div className="pvStage">
            {/* a shortcut for the mouse: the button below is the one for everyone */}
            <button type="button" className="pvOrbButton" onClick={start} tabIndex={-1} aria-hidden="true">
              <AiOrb size={132} />
            </button>
          </div>
          <strong>No conversation yet</strong>
          <span>The agent greets you first. Change a setting, save if it is the real agent, and start again to see the difference.</span>
          <button type="button" className="primaryCta compactCta" onClick={start}>
            {simulated ? 'Start a simulated chat' : 'Start a conversation'}
          </button>
        </div>
      )}

      {state === 'loading' && (
        <div className="pvLoading" role="status" aria-live="polite">
          <AiOrb size={96} state="thinking" />
          <strong>{LOADING_TEXT[session.status] || 'Connecting…'}</strong>
          <span>
            {session.agentHint
              ? 'The agent hasn’t joined yet. The runtime may not be running for it. You can end this and try again.'
              : 'This takes a few seconds.'}
          </span>
          <button type="button" className="quietButton" onClick={session.stop}>
            Cancel
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="pvError">
          <Notice
            kind="error"
            title={session.error?.title || 'The conversation didn’t start'}
            actions={
              <button
                type="button"
                className="quietButton"
                onClick={() => {
                  session.clearError();
                  start();
                }}
              >
                Try again
              </button>
            }
          >
            {session.error?.body || 'Something went wrong starting it.'}
            {session.error?.details && (
              <details className="stErrDetail">
                <summary>Details for the person who runs the server</summary>
                <p>{session.error.details}</p>
              </details>
            )}
            {!simulated && !modeLocked && (
              <>
                {' '}
                You can still try the{' '}
                <button
                  type="button"
                  className="stLink"
                  onClick={() => {
                    session.clearError();
                    onMode('simulated');
                  }}
                >
                  simulated preview
                </button>
                .
              </>
            )}
          </Notice>
        </div>
      )}

      {state === 'idle' && (
        <div className="pvComposer pvComposerIdle">
          {tools}
          <input
            type="text"
            readOnly
            value=""
            placeholder="Send a message to start a chat"
            aria-label="Start a conversation by typing here"
            onClick={start}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                start();
              }
            }}
          />
          <button type="button" className="pvSendRound" aria-label={simulated ? 'Start a simulated chat' : 'Start a conversation'} onClick={start}>
            <Icon name="arrowRight" size={18} />
          </button>
        </div>
      )}

      {(state === 'live' || state === 'reconnecting' || state === 'ended') && (
        <>
          {state === 'reconnecting' && (
            <p className="pvBanner warn" role="status">
              <b>Connection lost.</b> Trying to reconnect…
            </p>
          )}
          <div className={`pvHud ${state}`} aria-hidden="true">
            <AiOrb size={26} state={state === 'ended' ? 'rest' : state === 'reconnecting' ? 'thinking' : 'live'} />
            <span className="pvBars">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <small>{state === 'ended' ? 'Ended' : state === 'reconnecting' ? 'Reconnecting…' : 'Connected'}</small>
          </div>
          <ul className="pvLog" aria-label="Conversation" aria-live="polite">
            {session.messages.map((message) => (
              <Line key={message.id} message={message} />
            ))}
            <li ref={endRef} aria-hidden="true" />
          </ul>
          {voice && <p className="pvHint">This agent talks by voice. Use the Test tab to speak with it; typing here still works.</p>}
          {(note || dictation.error) && (
            <p className="pvHint warn" role="alert">
              {note || dictation.error}
            </p>
          )}
          {state === 'ended' ? (
            <div className="pvEnded" role="status">
              <span>The conversation ended.</span>
              <button type="button" className="primaryCta compactCta" onClick={start}>
                Start again
              </button>
            </div>
          ) : (
            <div className="pvComposer">
              {tools}
              <input
                type="text"
                value={draft}
                placeholder="Type a message…"
                aria-label="Message to the agent"
                disabled={state !== 'live'}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent?.isComposing) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <button type="button" className="primaryCta compactCta" onClick={send} disabled={state !== 'live' || !draft.trim()}>
                Send
              </button>
              <button type="button" className="quietButton" onClick={session.stop}>
                End
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
