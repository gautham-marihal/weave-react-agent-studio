import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, getApiUser } from '../../api/client.js';
import Icon from '../../ui/Icon.jsx';
import { pictureProblem } from '../preview/useDictation.js';
import AiOrb, { orbState } from '../preview/AiOrb.jsx';
import PlainIssues from '../validation/PlainIssues.jsx';
import { envLabel, Notice } from '../ui.jsx';
import { navigate, routeHref } from '../route.js';
import { useAsync } from '../useAsync.js';
import { sameModels, summarizeModels } from '../models/config.js';
import FormPrompt from './FormPrompt.jsx';
import { drawsVoice, testability } from './channels.js';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import TraceView from '../trace/TraceView.jsx';
import { useTrace } from '../trace/useTrace.js';
import { finalStateOf, toolsUsedIn } from '../trace/records.js';
import { scenarioFromConversation } from '../scenarios/model.js';
import { browserChannels } from '../form/channelTypes.js';
import './test.css';
import '../preview/preview.css';
import '../models/models.css';

const STATUS_TEXT = {
  idle: 'Not started',
  starting: 'Starting…',
  connecting: 'Connecting…',
  waiting: 'Waiting for the agent',
  live: 'Live',
  ended: 'Ended',
  error: 'Failed',
};

function makeIdentity() {
  const base =
    (getApiUser() || 'tester')
      .replace(/[^A-Za-z0-9_.@-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'tester';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Bubble({ message, botName }) {
  if (message.role === 'system')
    return (
      <div className="stTSystem" role="note">
        {message.text}
      </div>
    );
  const mine = message.role === 'user';
  return (
    <div className={`stTMsg ${mine ? 'me' : 'bot'}`}>
      {!mine && (
        <span className="stTAvatar" aria-hidden="true">
          {(botName || 'A').slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="stTBubble">
        <small>
          {mine ? 'You' : botName}
          {message.simulated && (
            <b className="pvSimTag" title="Made up by a simulation in your browser, not by the real agent">
              Simulated
            </b>
          )}
        </small>
        <p>
          {message.text || '…'}
          {!message.final && message.text && <i className="stTCaret" aria-hidden="true" />}
        </p>
      </div>
    </div>
  );
}

export default function TestTab({ botId, name, summary, editor, session, mode = 'real', modeLocked = false, onMode }) {
  const [ref, setRef] = useState('draft');
  const [channelPick, setChannelPick] = useState(''); // which web channel to try, when the agent offers chat and voice side by side
  const [draftText, setDraftText] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [used, setUsed] = useState(null); // the models this conversation started with
  const endRef = useRef(null);
  const listRef = useRef(null);
  const stickRef = useRef(true);
  const fileRef = useRef(null);
  const { status, info, messages, events, error, form, media, agentHint } = session;
  const trace = useTrace({ botId, session });
  const [saved, setSaved] = useState(null); // the id of a scenario just made from this conversation
  const [pictureNote, setPictureNote] = useState(''); // why a picture was not sent, in words, next to where it was chosen

  const running = ['starting', 'connecting', 'waiting', 'live'].includes(status);
  const connected = status === 'waiting' || status === 'live';
  const deployed = useMemo(() => summary?.deployed || {}, [summary]);
  const options = useMemo(() => {
    const list = [{ value: 'draft', label: 'Draft (the saved working copy)' }];
    if (summary?.latest_version) list.push({ value: 'latest', label: `Latest published (v${summary.latest_version})` });
    Object.entries(deployed).forEach(([env, version]) => list.push({ value: env, label: `${envLabel(env)} (v${version})` }));
    return list;
  }, [summary, deployed]);
  useEffect(() => {
    if (!options.some((o) => o.value === ref)) setRef('draft');
  }, [options, ref]);

  // The saved draft is what a draft test runs; edits that aren't saved yet are not part of it.
  const config = editor.parsed.value;
  const botName = config?.persona?.name || name;
  const channelCfg = useMemo(() => (Array.isArray(config?.channels) ? config.channels.find((c) => c.id === info?.channel?.id) : null), [config, info]);
  const inputs = info?.channel?.input || [];
  const isVoice = drawsVoice(info?.channel);
  const imageCfg = ref === 'draft' ? channelCfg?.inputs?.image : null;
  const unsupported = editor.report?.unsupported || [];

  // The models a test runs with. A draft test runs the saved draft (edits not saved yet are not part of it); a test of
  // a published version or an environment runs that version, whatever the draft says now.
  const version = ref === 'draft' ? null : ref === 'latest' ? summary?.latest_version : summary?.deployed?.[ref];
  const versionLoad = useAsync((signal) => (version ? api.getVersion(botId, version, { signal }) : Promise.resolve(null)), [botId, version]);
  const testConfig = ref === 'draft' ? editor.savedConfig || config : versionLoad.data?.config;
  const reach = testability(testConfig);
  // every enabled web channel of what is being tried: a button for each (the server's own list comes back with the session)
  const webChannels = useMemo(() => browserChannels(testConfig), [testConfig]);
  const channelId = webChannels.some((c) => c.id === channelPick) ? channelPick : webChannels[0]?.id || '';
  const simulated = mode === 'simulated';
  const noWebChannel = !simulated && reach.state === 'none' && !running;
  const modelsUnsaved = ref === 'draft' && !!config && !!editor.savedConfig && !sameModels(config, editor.savedConfig);
  const shownModels = running || status === 'ended' ? used : testConfig ? summarizeModels(testConfig) : null;
  const openModels = () => {
    try {
      sessionStorage.setItem('weave_open_models', '1');
    } catch {
      /* storage unavailable */
    }
    navigate(routeHref(botId, 'config'), { guard: false });
  };

  const { attachPreview } = session;
  useEffect(() => {
    if (media.camera) attachPreview();
  }, [media.camera, attachPreview]);

  // Keep the newest message in view, unless you scrolled up to read.
  // (the list is scrolled itself: scrollIntoView would also scroll the whole page to the end of an empty chat)
  useEffect(() => {
    const el = listRef.current;
    if (stickRef.current && el) el.scrollTop = el.scrollHeight;
  }, [messages, form]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const start = () => {
    stickRef.current = true;
    setUsed(testConfig ? summarizeModels(testConfig) : null);
    // `channel` is what the server is asked for, `channelId` what the simulated conversation plays
    session.startFor(botId, { ref, identity: makeIdentity(), ...(channelId ? { channel: channelId, channelId } : {}) });
  };
  const send = async () => {
    const text = draftText;
    if (!text.trim() || !connected) return;
    setDraftText('');
    stickRef.current = true;
    await session.sendText(text);
  };
  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !imageCfg) return;
    const problem = pictureProblem(file, { acceptedMime: imageCfg.accepted_mime || [], maxBytes: imageCfg.max_bytes || 0 });
    setPictureNote(problem);
    if (problem) return;
    await session.sendImage(file, imageCfg.topic || 'image-upload');
  };

  // A finished conversation becomes a starting scenario (the caller's turns, the tools used, the final state) for the author to edit.
  const canSave = messages.some((m) => m.role === 'user') && !running && !!config && editor.isObject && !editor.parsed.error;
  const saveAsScenario = () => {
    const made = scenarioFromConversation(config, {
      channel: info?.channel?.id,
      messages,
      tools: toolsUsedIn(trace.records),
      finalState: finalStateOf(trace.records),
    });
    editor.setValue({ ...config, tests: [...(Array.isArray(config.tests) ? config.tests : []), made] });
    setSaved(made.id);
  };

  return (
    <div className="stTest">
      <section className="stCard stTHead">
        <div className="stTIntro">
          <h3>Try this agent</h3>
          <p className="stMuted">
            {simulated ? (
              <>
                Starts a <strong>simulated</strong> conversation with {name} in your browser: made-up replies from simple rules, using your current edits. It is
                not the agent running, so tools and hand-offs are only imitated.
              </>
            ) : (
              <>Starts a real conversation with {name} in your browser. It uses the actual runtime, so tools, handoffs and forms really run.</>
            )}
          </p>
          {onMode && (
            <div className="pvModes stTMode" role="group" aria-label="What to talk to">
              <button
                type="button"
                className={!simulated ? 'on' : ''}
                aria-pressed={!simulated}
                disabled={modeLocked || running}
                onClick={() => onMode('real')}
                title={modeLocked ? 'Demo mode has no real agent to talk to' : undefined}
              >
                Real agent
              </button>
              <button type="button" className={simulated ? 'on' : ''} aria-pressed={simulated} disabled={running} onClick={() => onMode('simulated')}>
                Simulated
              </button>
            </div>
          )}
        </div>
        <div className="stTControls">
          {webChannels.length > 1 && (
            <div className="stTChannels" role="group" aria-label="Try it as">
              <span>Try it as</span>
              {webChannels.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={c.id === channelId ? 'on' : ''}
                  aria-pressed={c.id === channelId}
                  disabled={running}
                  onClick={() => setChannelPick(c.id)}
                >
                  {drawsVoice(c) ? 'Web voice' : 'Web chat'}
                  {webChannels.filter((o) => o.type === c.type).length > 1 ? ` (${c.id})` : ''}
                </button>
              ))}
            </div>
          )}
          <label>
            <span>Version to try</span>
            <select value={ref} onChange={(event) => setRef(event.target.value)} disabled={running}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {running ? (
            <button type="button" className="dangerButton" onClick={session.stop}>
              End conversation
            </button>
          ) : (
            <button
              type="button"
              className="primaryCta compactCta"
              onClick={start}
              disabled={noWebChannel}
              title={noWebChannel ? 'This agent has no web channel to try' : undefined}
            >
              {status === 'ended' || status === 'error' ? 'Start again' : 'Start conversation'}
            </button>
          )}
          <span className={`stTStatus ${status}`} role="status">
            <i aria-hidden="true" />
            {STATUS_TEXT[status]}
          </span>
        </div>
      </section>

      {noWebChannel && (
        <Notice kind="info" title="This agent can’t be tried in the browser">
          The Test tab talks to the agent over the web, so it needs a web chat or web voice channel
          {reach.phone.length ? `. This one only has a phone line (${reach.phone.join(', ')}), and a phone line is tried by calling its number` : ''}. Add a web
          channel under Config → Channels to test here. Phone numbers aren’t connected from the studio yet: for now they are set up with the platform’s SIP
          tool.
        </Notice>
      )}
      {reach.state === 'off' && !running && (
        <Notice kind="warn" title="The web channels of this agent are switched off">
          Switch one on under Config → Channels, or the server may refuse to start a conversation.
        </Notice>
      )}
      {simulated && <DemoNote kind="test">Replies in this conversation are made up in your browser. Nothing here is the real agent or its models.</DemoNote>}
      {!simulated && modelsUnsaved && !running && (
        <Notice
          kind="warn"
          title="The models you chose aren’t saved yet"
          actions={
            <button type="button" className="quietButton" onClick={() => editor.save()} disabled={editor.saving || !!editor.parsed.error}>
              {editor.saving ? 'Saving…' : 'Save draft'}
            </button>
          }
        >
          A draft test uses the saved draft, so it would still run with the models listed on the right. Save the draft to test the new ones.
        </Notice>
      )}
      {!simulated && ref === 'draft' && editor.dirty && !modelsUnsaved && !running && (
        <Notice
          kind="warn"
          title="You have unsaved edits"
          actions={
            <button type="button" className="quietButton" onClick={() => editor.save()} disabled={editor.saving || !!editor.parsed.error}>
              {editor.saving ? 'Saving…' : 'Save draft'}
            </button>
          }
        >
          A draft conversation uses the saved draft, which doesn’t include them yet.
        </Notice>
      )}
      {unsupported.length > 0 && ref === 'draft' && !running && (
        <Notice kind="warn" title={`${unsupported.length} part${unsupported.length === 1 ? '' : 's'} of this agent aren’t available in the runtime yet`}>
          The conversation may behave differently from what the config describes. The Config tab lists them under “Not available yet”.
        </Notice>
      )}
      {error && (
        <Notice
          kind="error"
          title={error.title}
          actions={
            <button type="button" className="quietButton" onClick={session.clearError}>
              Dismiss
            </button>
          }
        >
          {error.body}
          {error.details && (
            <details className="stErrDetail">
              <summary>Details for the person who runs the server</summary>
              <p>{error.details}</p>
            </details>
          )}
          {error.errors?.length > 0 && <PlainIssues issues={error.errors} severity="error" config={editor.parsed.value} />}
        </Notice>
      )}

      {saved && (
        <Notice
          kind="good"
          title={`Added the scenario “${saved}” to the draft`}
          actions={
            <button type="button" className="quietButton" onClick={() => navigate(routeHref(botId, 'scenarios'), { guard: false })}>
              Open Scenarios
            </button>
          }
        >
          It has what you said, the tools that were used and the final state. Edit what it checks, then run it. The draft isn’t saved yet.
        </Notice>
      )}

      <div className="stTGrid">
        <section className="stCard stTChat" aria-label="Conversation">
          {/* above the conversation once it has lines; before that, the orb in the middle says the same */}
          {status !== 'idle' && messages.length > 0 && (
            <div
              className={`pvHud stTHud ${status === 'live' ? 'live' : status === 'ended' || status === 'error' ? 'ended' : 'reconnecting'}`}
              aria-hidden="true"
            >
              <AiOrb size={26} state={orbState(status)} />
              <span className="pvBars">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <small>{status === 'live' ? 'Connected' : status === 'ended' ? 'Ended' : status === 'error' ? 'Didn’t connect' : 'Connecting…'}</small>
            </div>
          )}
          <div className="stTMessages" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages">
            {messages.length === 0 && (
              <div className="stTEmpty">
                <div className="pvStage stTStage" aria-hidden="true">
                  <AiOrb size={116} state={orbState(status)} />
                </div>
                {status === 'idle' && (
                  <>
                    <strong>No conversation yet</strong>
                    <span>
                      Press “Start conversation”. The agent greets you first, then you can reply here{inputs.includes('audio') ? ' or by speaking' : ''}.
                    </span>
                  </>
                )}
                {(status === 'starting' || status === 'connecting') && (
                  <>
                    <strong>{STATUS_TEXT[status]}</strong>
                    <span>Asking the server for a session…</span>
                  </>
                )}
                {status === 'waiting' && (
                  <>
                    <strong>Waiting for the agent to join…</strong>
                    <span>It usually greets you within a few seconds.</span>
                  </>
                )}
                {status === 'live' && (
                  <>
                    <strong>Connected</strong>
                    <span>Say hello.</span>
                  </>
                )}
                {(status === 'error' || status === 'ended') && (
                  <>
                    <strong>{status === 'ended' ? 'The conversation ended' : 'The conversation didn’t start'}</strong>
                    <span>You can start again.</span>
                  </>
                )}
              </div>
            )}
            {messages.map((message) => (
              <Bubble key={message.id} message={message} botName={botName} />
            ))}
            {agentHint && status === 'waiting' && (
              <Notice kind="warn" title="The agent hasn’t joined yet">
                If nothing arrives soon, the runtime may not be running for this agent, or the deployed version is still starting. Try ending and starting
                again.
              </Notice>
            )}
            {form && <FormPrompt key={form.requestId} form={form} onSubmit={session.submitForm} onDismiss={session.dismissForm} />}
            <div ref={endRef} />
          </div>
          <div className="stTComposer">
            <textarea
              rows={2}
              value={draftText}
              disabled={!connected}
              placeholder={connected ? 'Type a message…' : 'Start a conversation to type here'}
              aria-label="Message"
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="stTComposerRow">
              <small>Enter to send · Shift+Enter for a new line</small>
              <button type="button" className="primaryCta compactCta" onClick={send} disabled={!connected || !draftText.trim()}>
                Send
              </button>
            </div>
          </div>
        </section>

        <aside className="stCard stTSide" aria-label="Session">
          <section className="stTModels" aria-label="Models">
            <div className="stTModelsHead">
              <h3>{running || status === 'ended' ? 'Models in this conversation' : 'Models for this test'}</h3>
              <button type="button" className="stLink" onClick={openModels}>
                Change
              </button>
            </div>
            {!shownModels ? (
              <p className="stMuted">{versionLoad.error ? 'Couldn’t load this version’s models.' : 'Loading…'}</p>
            ) : (
              <ul>
                {shownModels.map((item) => (
                  <li key={item.stage} className={item.set ? '' : 'unset'}>
                    <span>{item.label}</span>
                    <strong>{item.set ? `${item.providerName} · ${item.modelName || 'no model set'}` : 'Not set'}</strong>
                    {item.set && item.model && item.modelName !== item.model && <code>{item.model}</code>}
                  </li>
                ))}
              </ul>
            )}
            {ref !== 'draft' && (
              <p className="stMuted">
                This runs {version ? `version ${version}` : 'that version'} with the models it was published with. Publish and deploy to test new ones this way.
              </p>
            )}
          </section>
          <h3>Session</h3>
          {info ? (
            <dl className="stTDetails">
              <div>
                <dt>Room</dt>
                <dd>
                  <code>{info.room}</code>
                </dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>
                  {info.version === 'draft' ? 'Draft' : `v${info.version}`} <span className="stMuted">({info.ref})</span>
                </dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd>
                  {info.channel?.id}{' '}
                  <span className="stMuted">
                    ({info.channel?.realType || info.channel?.type}
                    {info.channel?.realType && info.channel.realType !== info.channel.type ? ', written out as text' : ''})
                  </span>
                </dd>
              </div>
              {info.expiresInS && (
                <div>
                  <dt>Join window</dt>
                  <dd>{Math.round(info.expiresInS / 60)} min to connect</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="stMuted">Details appear once a conversation starts.</p>
          )}

          {(isVoice || inputs.includes('video') || inputs.includes('image')) && (
            <div className="stTMedia">
              {isVoice && (
                <button
                  type="button"
                  className={`stTMediaBtn ${media.mic ? 'on' : ''}`}
                  onClick={() => session.toggle('mic')}
                  disabled={!connected}
                  aria-pressed={media.mic}
                >
                  <Icon name="mic" size={16} /> {media.mic ? 'Microphone on' : 'Microphone off'}
                </button>
              )}
              {inputs.includes('video') && (
                <button
                  type="button"
                  className={`stTMediaBtn ${media.camera ? 'on' : ''}`}
                  onClick={() => session.toggle('camera')}
                  disabled={!connected}
                  aria-pressed={media.camera}
                >
                  <Icon name="camera" size={16} /> {media.camera ? 'Camera on' : 'Camera off'}
                </button>
              )}
              {inputs.includes('video') && channelCfg?.inputs?.video?.screen_share !== false && ref === 'draft' && channelCfg?.inputs?.video?.screen_share && (
                <button
                  type="button"
                  className={`stTMediaBtn ${media.screen ? 'on' : ''}`}
                  onClick={() => session.toggle('screen')}
                  disabled={!connected}
                  aria-pressed={media.screen}
                >
                  <Icon name="monitor" size={16} /> {media.screen ? 'Sharing screen' : 'Share screen'}
                </button>
              )}
              {inputs.includes('image') && (
                <>
                  <button
                    type="button"
                    className="stTMediaBtn"
                    onClick={() => fileRef.current?.click()}
                    disabled={!connected || !imageCfg}
                    title={imageCfg ? 'Send a picture' : 'Pictures can be sent when testing the draft'}
                  >
                    <Icon name="paperclip" size={16} /> Send a picture
                  </button>
                  <input ref={fileRef} type="file" accept={(imageCfg?.accepted_mime || ['image/*']).join(',')} hidden onChange={onFile} />
                </>
              )}
              {pictureNote && (
                <p className="stTNote" role="alert">
                  {pictureNote}
                </p>
              )}
              {media.camera && <video ref={session.localVideoRef} className="stTPreview" autoPlay muted playsInline aria-label="Your camera" />}
            </div>
          )}

          {canSave && (
            <button
              type="button"
              className="quietButton stTSaveScenario"
              onClick={saveAsScenario}
              disabled={!!saved}
              title="Turns what you said and what the agent did into a test scenario in the draft"
            >
              {saved ? 'Saved as a scenario' : 'Save as a scenario'}
            </button>
          )}

          <div className="stTLog">
            <button type="button" className="stLink" onClick={() => setLogOpen((v) => !v)} aria-expanded={logOpen}>
              {logOpen ? 'Hide' : 'Show'} connection log ({events.length})
            </button>
            {logOpen && (
              <ol>
                {events.length === 0 && <li className="stMuted">Nothing yet.</li>}
                {events.map((event) => (
                  <li key={event.id} className={event.kind}>
                    <time>{clock(event.at)}</time>
                    <span>{event.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>

      {(status !== 'idle' || trace.records.length > 0) && (
        <section className="stCard stTTrace" aria-label="Trace">
          <TraceView
            records={trace.records}
            live={trace.following}
            title="What happened in this conversation"
            emptyText={running ? 'Waiting for the first record…' : 'Nothing was recorded.'}
            note={
              session.simulated ? 'These records were made by the simulated conversation, in the same shape a real call has. No runtime wrote them.' : undefined
            }
          />
          {trace.problem && (
            <p className="stMuted" role="status">
              {trace.problem}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
