import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Notice } from '../ui.jsx';
import { Choice, OneOf } from '../../ui/OneOf.tsx';
import './preview.css';
import Icon from '../../ui/Icon.jsx';
import AiOrb from './AiOrb.jsx';
import VoiceStage from './VoiceStage.jsx';
import { speaksOnly, withWrittenReplies } from './voiceState.js';
import { maskConversation } from '../privacy/maskConfidential.js';
import { browserChannels } from '../form/channelTypes.js';
import { inputCapabilities, pictureProblem, useDictation } from './useDictation.js';
import { randomTag } from '../format.js';
import Button from '../../ui/Button.tsx';
import FormPrompt from '../test/FormPrompt.jsx';
import { formTimeLimit } from '../test/formQueue.js';
import { drawsVoice } from '../test/channels.ts';
import PictureRequest, { PictureLine } from '../pictures/PictureRequest.jsx';

// The preview beside the agent's settings: talk to the agent while editing it. It is either the REAL agent (LiveKit,
// on the saved draft) or a SIMULATED one (rules in the browser on current edits); the panel says which, and every
// simulated reply is tagged "Simulated". States: idle, loading, live, reconnecting, ended, error.

function previewState(session) {
  if (session.status === 'error') return 'error';
  if (session.status === 'ended') return 'ended';
  if (session.status === 'idle') return 'idle';
  if (session.reconnecting) return 'reconnecting';
  if (session.status === 'live') return 'live';
  return 'loading';
}

const COUNT_WORDS = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
const STATUS_WORDS = { idle: 'Ready', loading: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', ended: 'Ended', error: 'Problem' };
const LOADING_TEXT = { starting: 'Asking for a conversation…', connecting: 'Connecting…', waiting: 'Waiting for the agent to join…' };

function Line({ message }) {
  // what a picture request the agent made came to (received, timed out…), in the conversation where it happened
  if (message.role === 'picture')
    return (
      <li className="pvPictureLine">
        <PictureLine picture={message.picture} />
      </li>
    );
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

export default function ChatPreview({ session, mode, modeLocked, onMode, botId, editor }) {
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
  // a form or a picture request the agent asks for opens at its top (its title first), in the log's own scroll
  const formId = session.form?.requestId;
  const pictureId = session.picture?.id;
  useEffect(() => {
    const el = endRef.current?.parentElement;
    const card = el?.querySelector('.pvForm, .pvPicture');
    if (el && card) el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top;
  }, [formId, pictureId]);

  // The ways in (the guide, section 6): an agent offering two or more web channels (web chat, web voice) is tried as the
  // one chosen, and the server is asked for that channel. The real agent runs the saved draft, the simulation the
  // current edits, so the channels are read from the same. One web channel: the panel is as it always was.
  const triedConfig = simulated ? editor?.parsed?.value : editor?.savedConfig || editor?.parsed?.value;
  // how long a form may take before the real agent ends the conversation for silence (a simulation never does)
  const formLimit = simulated ? null : formTimeLimit(triedConfig, session.info?.channel?.id);
  const ways = useMemo(() => browserChannels(triedConfig), [triedConfig]);
  const choosing = ways.length > 1;
  const spoken = (c) => drawsVoice({ ...c, type: c?.realType || c?.type });
  const twin = (c) => ways.filter((o) => spoken(o) === spoken(c)).length > 1; // two of a kind are told apart by name
  const wayWord = (c) => `${spoken(c) ? 'Talk' : 'Chat'}${twin(c) ? ` · ${c.id}` : ''}`;
  const channelWord = (c) => `${spoken(c) ? 'Web voice' : 'Web chat'}${twin(c) ? ` · ${c.id}` : ''}`;
  // the channel of the conversation that ran last (still known once it ended), else a chat, else the first
  const lastWay = ways.find((c) => c.id === session.info?.channel?.id) || null;
  const defaultWay = lastWay || ways.find((c) => !spoken(c)) || ways[0] || null;
  // start(channel): that channel; start() as the panel always did, on the last way used when there is a choice
  const start = (channel) => {
    const pick = (channel && typeof channel === 'object' && typeof channel.id === 'string' ? channel : null) || (choosing ? defaultWay : null);
    session.startFor(botId, { ref: 'draft', identity: `preview-${randomTag()}`, ...(pick ? { channel: pick.id, channelId: pick.id } : {}) });
  };
  const send = async () => {
    const text = draft;
    if (!text.trim() || state !== 'live') return;
    dictation.cancel();
    setDraft('');
    await session.sendText(text);
  };
  // voice by what the channel carries, not only its kind (the guide, section 5), as on the Test page
  const voice = !simulated && drawsVoice(session.info?.channel);
  // shown as a call (the orb and captions) when it runs on a web voice channel, or before it starts when every web
  // channel the agent has is voice; a simulation of one is written out, but still looks like a call
  const voiceView =
    session.info && state !== 'idle'
      ? [session.info.channel?.type, session.info.channel?.realType].includes('web_voice')
      : browserChannels(editor?.parsed?.value).length > 0 && browserChannels(editor?.parsed?.value).every((c) => c.type === 'web_voice');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // the real agent writes no transcript for a voice channel whose replies are only spoken (the saved draft decides)
  const draftConfig = editor?.parsed?.value;
  const voiceChannelId = session.info?.channel?.id || browserChannels(draftConfig)[0]?.id;
  const findChannel = (config) => (Array.isArray(config?.channels) ? config.channels : []).find((c) => c?.id === voiceChannelId);
  const noCaptions = !simulated && voiceView && speaksOnly(findChannel(editor?.savedConfig || draftConfig));

  // What the channel lets a caller send, from the settings of what runs (the saved draft for the real agent, the edits
  // for the simulation): the microphone, pictures, the camera.
  const can = inputCapabilities(triedConfig, session.info?.channel);
  const fileRef = useRef(null);
  const [note, setNote] = useState('');
  // what was already typed when the microphone was turned on stays; what is said is added after it
  const dictBase = useRef('');
  // heard in the agent's language: what it listens for (`stt.language`), else its main language
  const hearIn = String(triedConfig?.defaults?.models?.stt?.language || triedConfig?.defaults?.language?.primary || '');
  const dictation = useDictation((text) => setDraft(`${dictBase.current}${dictBase.current && !/\s$/.test(dictBase.current) ? ' ' : ''}${text}`), hearIn);
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
    // the agent's own request decides what it takes while one is open; otherwise the channel's settings do
    const problem = session.picture ? '' : pictureProblem(file, can.image);
    setNote(problem);
    if (!problem) setNote((await session.sendImage(file, can.image.topic)) || '');
  };
  // the card for a picture the agent asks for, answered from here
  const pictureCard = session.picture ? (
    <PictureRequest
      key={session.picture.id}
      request={session.picture}
      onSend={(file) => session.sendImage(file, can.image?.topic)}
      onCamera={session.pictureCamera}
      cameraOn={!!session.media?.camera}
      attachCamera={session.attachCamera}
      simulated={simulated}
    />
  ) : null;
  // the camera is wanted: a camera request, or a camera check's retake (a picture from the camera, never a file)
  const cameraWanted = session.picture?.kind === 'camera' || !!session.picture?.cameraOnly;
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
              ? 'This browser can’t turn speech into text. Use Tests › Try it to speak with the real agent.'
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
            disabled={!connected || cameraWanted}
            title={
              !connected
                ? 'Start a conversation first'
                : cameraWanted
                  ? 'The agent wants the camera now: use the card above'
                  : `Send a picture${can.image.acceptedMime.length ? ` (${can.image.acceptedMime.map((m) => m.replace('image/', '')).join(', ')})` : ''}`
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
          {/* with a choice of channels, the one this conversation runs on, in the same badge (the head has no room for two) */}
          {choosing && state !== 'idle' && session.info?.channel && (
            <span className="pvChannel"> · {channelWord(ways.find((c) => c.id === session.info.channel.id) || session.info.channel)}</span>
          )}
        </span>
        <OneOf className="pvModes" label="What to talk to" value={simulated ? 'simulated' : 'real'} onChange={onMode}>
          <Choice
            value="real"
            disabled={modeLocked || running}
            title={modeLocked ? 'Demo mode has no real agent to talk to' : 'A real conversation with the saved draft'}
          >
            Real agent
          </Choice>
          <Choice value="simulated" disabled={running} title="Made-up replies from simple rules, using your current edits. No server.">
            Simulated
          </Choice>
        </OneOf>
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
      {noCaptions && (
        <p className="pvHint warn" role="note">
          This voice channel only speaks its replies, so there are no captions.{' '}
          {speaksOnly(findChannel(draftConfig)) ? (
            <button type="button" className="stLink" onClick={() => editor.setValue(withWrittenReplies(draftConfig, voiceChannelId))}>
              Write replies out too
            </button>
          ) : (
            'Save the draft to use written replies.'
          )}
        </p>
      )}
      {!simulated && editor?.dirty && state !== 'live' && (
        <Button type="button" className="pvSave" onClick={() => editor.save()} disabled={editor.saving || !!editor.parsed?.error}>
          {editor.saving ? 'Saving…' : 'Save draft'}
        </Button>
      )}

      {state === 'idle' && choosing && (
        <div className="pvEmpty pvWaysIn">
          <div className="pvStage" aria-hidden="true">
            <AiOrb size="var(--pv-orb-ways, 88px)" />
          </div>
          <strong>How do you want to try it?</strong>
          <span>It can be reached {COUNT_WORDS[ways.length] || ways.length} ways on your website. It greets you first.</span>
          <div className="pvWays" role="group" aria-label="How to try it">
            {ways.map((c) => (
              <button key={c.id} type="button" className="pvWay" onClick={() => start(c)}>
                <span className="pvWayIcon" aria-hidden="true">
                  <Icon name={spoken(c) ? 'mic' : 'chat'} size={18} />
                </span>
                <b>{wayWord(c)}</b>
                <small>{spoken(c) ? 'Speak to it, as a website caller would' : 'Type to it, as in the chat box on your site'}</small>
                <span className="pvWayGo">
                  {spoken(c) ? (simulated ? 'Start a simulated call' : 'Start a call') : simulated ? 'Start a simulated chat' : 'Start chatting'}
                  <Icon name="arrowRight" size={13} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {state === 'idle' && voiceView && !choosing && (
        <VoiceStage session={session} size="var(--pv-voice-orb, 168px)" badge={false} className="pvVoice">
          <Button type="button" variant="primary" size="compact" onClick={() => start()}>
            {simulated ? 'Start a simulated call' : 'Start a call'}
          </Button>
        </VoiceStage>
      )}

      {state === 'idle' && !voiceView && !choosing && (
        <div className="pvEmpty">
          <div className="pvStage">
            {/* a shortcut for the mouse: the button below is the one for everyone */}
            <button type="button" className="pvOrbButton" onClick={() => start()} tabIndex={-1} aria-hidden="true">
              <AiOrb size="var(--pv-orb, 132px)" />
            </button>
          </div>
          <strong>No conversation yet</strong>
          <span>The agent greets you first. Change a setting, save if it is the real agent, and start again to see the difference.</span>
          <Button type="button" variant="primary" size="compact" onClick={() => start()}>
            {simulated ? 'Start a simulated chat' : 'Start a conversation'}
          </Button>
        </div>
      )}

      {state === 'loading' && voiceView && (
        <VoiceStage session={session} size="var(--pv-voice-orb, 168px)" badge={false} className="pvVoice">
          {session.agentHint && <p className="pvHint">The agent hasn’t joined yet. The runtime may not be running for it. You can end this and try again.</p>}
          <Button type="button" onClick={session.stop}>
            Cancel
          </Button>
        </VoiceStage>
      )}

      {state === 'loading' && !voiceView && (
        <div className="pvLoading" role="status" aria-live="polite">
          <AiOrb size="var(--pv-orb-small, 96px)" state="thinking" />
          <strong>{LOADING_TEXT[session.status] || 'Connecting…'}</strong>
          <span>
            {session.agentHint
              ? 'The agent hasn’t joined yet. The runtime may not be running for it. You can end this and try again.'
              : 'This takes a few seconds.'}
          </span>
          <Button type="button" onClick={session.stop}>
            Cancel
          </Button>
        </div>
      )}

      {state === 'error' && voiceView && (
        <VoiceStage session={session} size="var(--pv-voice-orb, 168px)" badge={false} className="pvVoice">
          {session.error?.details && (
            <details className="stErrDetail">
              <summary>Details for the person who runs the server</summary>
              <p>{session.error.details}</p>
            </details>
          )}
          <span className="pvVoiceActions">
            <Button
              type="button"
              variant="primary"
              size="compact"
              onClick={() => {
                session.clearError();
                start();
              }}
            >
              Try again
            </Button>
            {!simulated && !modeLocked && (
              <Button
                type="button"
                size="compact"
                onClick={() => {
                  session.clearError();
                  onMode('simulated');
                }}
              >
                Use the simulated preview
              </Button>
            )}
          </span>
        </VoiceStage>
      )}

      {state === 'error' && !voiceView && (
        <div className="pvError">
          <Notice
            kind="error"
            title={session.error?.title || 'The conversation didn’t start'}
            actions={
              <Button
                type="button"
                onClick={() => {
                  session.clearError();
                  start();
                }}
              >
                Try again
              </Button>
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

      {/* the box that starts a chat by typing; with a choice of channels, the ways in above are the start */}
      {state === 'idle' && !choosing && (
        <div className="pvComposer pvComposerIdle">
          {tools}
          <input
            type="text"
            readOnly
            value=""
            placeholder="Send a message to start a chat"
            aria-label="Start a conversation by typing here"
            onClick={() => start()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                start();
              }
            }}
          />
          <button type="button" className="pvSendRound" aria-label={simulated ? 'Start a simulated chat' : 'Start a conversation'} onClick={() => start()}>
            <Icon name="arrowRight" size={18} />
          </button>
        </div>
      )}

      {(state === 'live' || state === 'reconnecting' || state === 'ended') && (
        <>
          {state === 'reconnecting' && !voiceView && (
            <p className="pvBanner warn" role="status">
              <b>Connection lost.</b> Trying to reconnect…
            </p>
          )}
          {voiceView && (
            <>
              <VoiceStage session={session} size="var(--pv-voice-orb, 168px)" badge={false} announce={!transcriptOpen} className="pvVoice" />
              <button type="button" className="stLink pvTranscriptToggle" onClick={() => setTranscriptOpen((v) => !v)} aria-expanded={transcriptOpen}>
                {transcriptOpen ? 'Hide the transcript' : `Show the transcript (${session.messages.length})`}
              </button>
            </>
          )}
          {!voiceView && (
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
          )}
          {(!voiceView || transcriptOpen) && (
            <ul className="pvLog" aria-label="Conversation" aria-live="polite">
              {maskConversation(session.messages).map((message) => (
                <Line key={message.id} message={message} />
              ))}
              {/* a form the agent asks for (the guide's job d): the same card as on the Test page, answered from here. In
                  the log, so it scrolls with the conversation and the box to type in stays in view */}
              {session.form && (
                <li className="pvForm">
                  <FormPrompt
                    key={session.form.requestId}
                    form={session.form}
                    onSubmit={session.submitForm}
                    onDismiss={session.dismissForm}
                    limitS={formLimit}
                  />
                </li>
              )}
              {/* a picture the agent asks for (MEDIA_PROTOCOL): the upload or the camera, in the conversation */}
              {pictureCard && <li className="pvPicture">{pictureCard}</li>}
              <li ref={endRef} aria-hidden="true" />
            </ul>
          )}
          {/* a voice call with its transcript folded: the form shows under the call */}
          {voiceView && !transcriptOpen && session.form && (
            <FormPrompt key={session.form.requestId} form={session.form} onSubmit={session.submitForm} onDismiss={session.dismissForm} limitS={formLimit} />
          )}
          {voiceView && !transcriptOpen && pictureCard}
          {voice && <p className="pvHint">This agent talks by voice. Use Tests › Try it to speak with it; typing here still works.</p>}
          {(note || dictation.error) && (
            <p className="pvHint warn" role="alert">
              {note || dictation.error}
            </p>
          )}
          {state === 'ended' ? (
            <div className="pvEnded" role="status">
              <span>The conversation ended.</span>
              {choosing ? (
                <span className="pvEndedWays">
                  {[defaultWay, ...ways.filter((c) => c !== defaultWay)].map((c, index) => (
                    <Button key={c.id} type="button" variant={index === 0 ? 'primary' : undefined} size="compact" onClick={() => start(c)}>
                      <Icon name={spoken(c) ? 'mic' : 'chat'} size={14} />
                      {index === 0 ? `${wayWord(c)} again` : `${wayWord(c)} instead`}
                    </Button>
                  ))}
                </span>
              ) : (
                <Button type="button" variant="primary" size="compact" onClick={() => start()}>
                  Start again
                </Button>
              )}
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
              <Button type="button" variant="primary" size="compact" onClick={send} disabled={state !== 'live' || !draft.trim()}>
                Send
              </Button>
              <Button type="button" onClick={session.stop}>
                End
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
