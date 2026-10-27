import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import Icon from '../../ui/Icon.jsx';
import { Switch } from '../form/fields.jsx';
import { ACCEPT_ATTRIBUTE, fileTypeProblem, formatBytes } from '../knowledge/model.js';
import { useProviders } from '../models/useProviders.js';
import { useChannelTypes } from '../form/useChannelTypes.js';
import { agentLabel } from '../agent/rowNames.js';
import { readSimple, setRecordingNotice } from '../simple/simpleModel.js';
import { readModels, voicesFor } from '../models/config.js';
import { providerLabel } from '../models/catalog.js';
import {
  ACTIONS,
  DETAIL_FIELDS,
  REACH,
  actionsOf,
  addKnowledgeFile,
  addKnowledgePage,
  cleanUrl,
  knowledgeOf,
  numberProblem,
  reachOf,
  removeKnowledge,
  setDetails,
  setEndCall,
  setHandOver,
  setLookup,
  setReach,
} from './setupModel.js';

// The setup's simple controls, shared with the agent's own pages, so a choice is made the same way every time.

// A phone number box that keeps the spaces people type ("+65 6123 4567") while the draft gets it trimmed (trimming the
// box would remove each space as it is typed). Only overwritten when the number changes from somewhere else.
function NumberBox({ value, onChange, ...rest }) {
  const [text, setText] = useState(value || '');
  const [was, setWas] = useState(value);
  if (value !== was) {
    setWas(value);
    if ((value || '') !== text.trim()) setText(value || '');
  }
  return (
    <input
      {...rest}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.trim());
      }}
    />
  );
}

// Where people reach it: chat on your website, talk on your website, phone calls, each a switch. Used by the setup and
// atop the Channels page, so a later change is the same move as the first.
//   onPage: on the Channels page; the recording notice is asked under After the call there (the setup asks it here)
//   onShowNotice(): opens After the call › Recording, for the link under the choices on the Channels page
//   onShowVoice(), onShowNumber(): open the Agent page's voice, and Releases where a phone number is added
export function ReachChoices({ config, set, botId, onPage = false, onShowNotice = null, onShowVoice = null, onShowNumber = null }) {
  const { providers } = useProviders();
  // another enabled channel of a kind that runs today lets the last of these three be switched off
  const { types } = useChannelTypes();
  const reach = reachOf(config);
  const [refused, setRefused] = useState('');
  // on the page, what the last switch also did: a voice and recording line it brought, what is still to do (a voice,
  // a phone number), or that a way of reaching it is off
  const [brought, setBrought] = useState(null);
  const simple = readSimple(config);
  const toggle = (r) => {
    const on = !reach[r.type];
    const result = setReach(config, r.type, on, { providers, botId, types });
    setRefused(result.refused);
    if (result.refused) return;
    set(result.config);
    if (!onPage) return;
    if (!on) {
      setBrought({ label: r.label, on: false });
      return;
    }
    const before = readModels(config).tts;
    const after = readModels(result.config).tts;
    const voice = !before.voiceId && after.voiceId ? voicesFor(after.provider).find((v) => v.voiceId === after.voiceId) : null;
    const spoken = ['sip_voice', 'web_voice'].includes(r.type);
    setBrought({
      label: r.label,
      on: true,
      voice: voice ? `${voice.name}${after.provider ? `, ${providerLabel(after.provider)}` : ''}` : !before.voiceId && after.voiceId ? 'a voice' : '',
      noVoice: spoken && !after.voiceId,
      notice: spoken && !readSimple(config).recordingNotice && !!readSimple(result.config).recordingNotice,
      number: r.type === 'sip_voice',
    });
  };
  return (
    <div className="suFields">
      <div className="suChoices" role="group" aria-label="Where people reach it">
        {REACH.map((r) => (
          <button
            key={r.type}
            type="button"
            role="checkbox"
            aria-checked={reach[r.type]}
            className={`suChoice ${reach[r.type] ? 'on' : ''}`}
            onClick={() => toggle(r)}
          >
            <span className="suChoiceIcon" aria-hidden="true">
              <Icon name={r.icon} size={18} />
            </span>
            <span className="suChoiceText">
              <strong>{r.label}</strong>
              <small>{r.text}</small>
            </span>
            <span className="suTick" aria-hidden="true">
              {reach[r.type] && <Icon name="check" size={14} />}
            </span>
          </button>
        ))}
      </div>
      {refused && (
        <p className="suNote warn" role="alert">
          {refused}
        </p>
      )}
      {brought && !refused && (
        <div className={`suNote suBrought ${brought.noVoice ? 'warn' : ''}`} role="status">
          {brought.on ? (
            <ul>
              <li>
                <strong>{brought.label} is on.</strong>
              </li>
              {brought.voice && (
                <li>
                  It speaks with {brought.voice === 'a voice' ? 'a voice chosen for it' : `the voice ${brought.voice}`}.{' '}
                  {onShowVoice && (
                    <button type="button" className="linkButton" onClick={onShowVoice}>
                      Change the voice
                    </button>
                  )}
                </li>
              )}
              {brought.noVoice && (
                <li>
                  No voice could be chosen for it, so it can’t speak yet.{' '}
                  {onShowVoice && (
                    <button type="button" className="linkButton" onClick={onShowVoice}>
                      Pick a voice
                    </button>
                  )}
                </li>
              )}
              {brought.notice && (
                <li>
                  Callers first hear that the call may be recorded.{' '}
                  {onShowNotice && (
                    <button type="button" className="linkButton" onClick={onShowNotice}>
                      Change what they hear
                    </button>
                  )}
                </li>
              )}
              {brought.number && (
                <li>
                  Still to do: a phone number, added when it goes live.{' '}
                  {onShowNumber && (
                    <button type="button" className="linkButton" onClick={onShowNumber}>
                      Open Releases
                    </button>
                  )}
                </li>
              )}
            </ul>
          ) : (
            <p>
              <strong>{brought.label} is off.</strong> Nobody can reach it this way until it is switched back on, as it was.
            </p>
          )}
          <button type="button" className="linkButton suBroughtClose" onClick={() => setBrought(null)}>
            Dismiss
          </button>
        </div>
      )}
      {simple.voiceChannel && onPage && !brought?.notice && (
        <p className="suNote">
          The recording notice is under After the call › Recording.{' '}
          {onShowNotice && (
            <button type="button" className="linkButton" onClick={onShowNotice}>
              Open it
            </button>
          )}
        </p>
      )}
      {simple.voiceChannel && !onPage && (
        <label className="suField">
          <span>Recording notice</span>
          <small>Said at the start of every call, before the greeting: tell callers the call is recorded. Many places require it.</small>
          <input
            className="stFInput"
            value={simple.recordingNotice}
            placeholder="This call may be recorded to improve our service."
            onChange={(event) => set(setRecordingNotice(config, event.target.value))}
          />
        </label>
      )}
    </div>
  );
}

function savedSystems() {
  try {
    const saved = JSON.parse(localStorage.getItem('weave_integrations') || '{}');
    return Object.values(saved && typeof saved === 'object' ? saved : {}).filter((c) => /^https?:\/\//i.test(String(c?.first || '')));
  } catch {
    return [];
  }
}

function LookupForm({ config, set, current, onCancel }) {
  const [form, setFormState] = useState({ url: current.url || '', finds: current.finds || '', needs: current.needs || '' });
  // the form follows the configuration (e.g. a Connections panel change) until typed in: a stale form saved as it is
  // would put the old address back
  const [edited, setEdited] = useState(false);
  const setForm = (next) => {
    setEdited(true);
    setFormState(next);
  };
  useEffect(() => {
    if (!edited) setFormState({ url: current.url || '', finds: current.finds || '', needs: current.needs || '' });
  }, [current.url, current.finds, current.needs, edited]);
  const [problem, setProblem] = useState('');
  const systems = useMemo(savedSystems, []);
  const apply = () => {
    const result = setLookup(config, true, form);
    setProblem(result.problem);
    if (!result.problem) {
      set(result.config);
      setEdited(false);
    }
  };
  // when switched on, an edit is applied as focus leaves the card (no second Save beside the page's own); one that
  // can't be applied stays in the boxes, and the note says why
  const leave = (event) => {
    if (!current.on || !edited || event.currentTarget.contains(event.relatedTarget)) return;
    apply();
  };
  return (
    <div className="suActionMore" onBlur={leave}>
      {systems.length > 0 && (
        <p className="suSystems">
          Your connected systems:{' '}
          {systems.map((s) => (
            <button key={s.first} type="button" className="suChip" onClick={() => setForm((f) => ({ ...f, url: s.first }))}>
              {s.name}
            </button>
          ))}
        </p>
      )}
      {/* the one technical ask of the setup: who to ask for it, and that the agent works without it */}
      {!current.on && (
        <p className="suNote">
          This needs a web address from your booking, order or customer system: ask whoever runs it (your IT person or the system’s support). Not sure? Leave it
          off. Your agent can still take requests and pass people to your team.
        </p>
      )}
      <label className="suField">
        <span>The web address it asks</span>
        <small>Put what the person tells it in curly brackets, for example https://shop.example.com/orders/&#123;order number&#125;.</small>
        <input className="stFInput" value={form.url} placeholder="https://" onChange={(event) => setForm({ ...form, url: event.target.value })} />
      </label>
      <div className="suInline">
        <label className="suField grow">
          <span>What it finds</span>
          <input
            className="stFInput"
            value={form.finds}
            placeholder="an order’s status"
            onChange={(event) => setForm({ ...form, finds: event.target.value })}
          />
        </label>
        <label className="suField grow">
          <span>What it needs from the person</span>
          <input className="stFInput" value={form.needs} placeholder="order number" onChange={(event) => setForm({ ...form, needs: event.target.value })} />
        </label>
      </div>
      {problem && (
        <p className="suNote warn" role="alert">
          {current.on ? `Not changed yet: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}` : problem}
          {current.on && current.url ? ` It still asks ${current.url}.` : ''}
        </p>
      )}
      {!current.on && (
        <div className="suActionButtons">
          <button type="button" className="quietButton" onClick={apply}>
            Switch it on
          </button>
          {onCancel && (
            <button type="button" className="linkButton" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// What it can do, as switches (end politely, pass to a person, take details, look something up). Each switch makes
// everything it needs (see setupModel.js). Used by the setup and atop the Tools page.
//   onPage: on the agent's own page (no closing note about those pages; a note when several agents share the work)
export function ActionSwitches({ config, set, onPage = false }) {
  const actions = actionsOf(config);
  const reach = reachOf(config);
  // with several agents, say which one the switches are for
  const agents = Array.isArray(config?.agents?.items) ? config.agents.items : [];
  const entryName = agents.length > 1 ? agentLabel(config, config?.agents?.entry || agents[0]?.id) : '';
  const [lookupOpen, setLookupOpen] = useState(false);
  const toggle = (id) => {
    const on = !actions[id].on;
    if (id === 'end_call') set(setEndCall(config, on));
    if (id === 'hand_over') set(setHandOver(config, on));
    if (id === 'details') set(setDetails(config, on, { fields: actions.details.fields }));
    if (id === 'lookup') {
      if (on) setLookupOpen(true);
      else {
        setLookupOpen(false);
        set(setLookup(config, false).config);
      }
    }
  };
  return (
    <div className="suFields">
      {ACTIONS.map((a) => {
        const state = actions[a.id];
        const open = state.on || (a.id === 'lookup' && lookupOpen);
        return (
          <section key={a.id} className={`suAction ${state.on ? 'on' : ''}`} aria-label={a.label}>
            <div className="suActionHead">
              <span className="suChoiceIcon" aria-hidden="true">
                <Icon name={a.icon} size={18} />
              </span>
              <span className="suChoiceText">
                <strong>{a.label}</strong>
                <small>{a.text}</small>
              </span>
              <Switch checked={state.on} onChange={() => toggle(a.id)} label={a.label} />
            </div>
            {/* off but kept because something else uses it: said so the switch and "All its tools" don't disagree */}
            {!state.on && state.kept && (
              <p className="suNote" role="status">
                {state.kept}
              </p>
            )}
            {open && a.id === 'hand_over' && (
              <div className="suActionMore">
                {state.numberElsewhere ? (
                  <p className="suNote">
                    The number depends on what the caller asks for. Change it under Phone transfers{onPage ? ', below' : ', on the Tools page'}.
                  </p>
                ) : reach.sip_voice ? (
                  <label className="suField">
                    <span>The number to pass calls to</span>
                    <small>Leave it empty and it offers to have someone call back instead.</small>
                    <NumberBox
                      className="stFInput"
                      inputMode="tel"
                      value={state.number}
                      placeholder="+6561234567"
                      onChange={(number) => set(setHandOver(config, true, { number }))}
                      aria-invalid={numberProblem(state.number) ? true : undefined}
                    />
                    {numberProblem(state.number) && <small className="suNote warn">{numberProblem(state.number)}</small>}
                  </label>
                ) : (
                  <p className="suNote">In a chat it can’t pass the person on directly, so it offers to have someone get back to them.</p>
                )}
              </div>
            )}
            {open && a.id === 'details' && (
              <div className="suActionMore">
                <span className="suFieldLabel">What it asks for</span>
                <div className="suChecks">
                  {DETAIL_FIELDS.map((f) => {
                    const checked = state.fields.includes(f.name);
                    return (
                      <label key={f.name} className="suCheck">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={f.name === 'name'}
                          onChange={() =>
                            set(setDetails(config, true, { fields: checked ? state.fields.filter((n) => n !== f.name) : [...state.fields, f.name] }))
                          }
                        />
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {open && a.id === 'lookup' && <LookupForm config={config} set={set} current={state} onCancel={state.on ? null : () => setLookupOpen(false)} />}
          </section>
        );
      })}
      {!onPage && <p className="suNote">Anything more (several agents, rules, other systems) is on the agent’s own pages once it is set up.</p>}
      {onPage && entryName && (
        <p className="suNote">These are for {entryName}, the agent that answers first. To give another agent a tool, open the tool in the list below.</p>
      )}
    </div>
  );
}

// What it knows: documents and web pages in one list, in one knowledge base the answering agent reads every turn
// (see setupModel.js). Used by the setup and atop the Knowledge page.
//   latest(): the newest draft (an upload takes a while and other changes may come meanwhile)
//   onPage: on the Knowledge page (the index is built there, below, not when the setup moves on)
//   onUploaded: called after uploads (the page re-reads the knowledge: a replaced document is no longer what was read)
export function KnowledgeBlock({ botId, config, set, latest, onPage = false, onUploaded }) {
  const { files, pages, depths } = knowledgeOf(config);
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [page, setPage] = useState('');
  const [pageProblem, setPageProblem] = useState('');
  const [over, setOver] = useState(false);
  const [keyMissing, setKeyMissing] = useState(false);
  // why the last one stayed when it was removed (see removeKnowledge)
  const [refused, setRefused] = useState('');
  // the documents just uploaded again under a name the list already had: the new copy took the old one's place
  const [replaced, setReplaced] = useState([]);
  const pageInput = useRef(null);
  useEffect(() => {
    // on the page, the line under this block says when the server can't read documents
    if (onPage) return undefined;
    let gone = false;
    api
      .getKnowledge(botId)
      .then((k) => !gone && setKeyMissing(k?.embedding_key_available === false))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [botId, onPage]);

  const upload = async (picked) => {
    const chosen = [...picked];
    if (!chosen.length) return;
    setBusy(true);
    const found = [];
    const added = [];
    for (const file of chosen) {
      const bad = fileTypeProblem(file.name);
      if (bad) {
        found.push(bad);
        continue;
      }
      try {
        await api.uploadKnowledgeFile(botId, file.name, file);
        added.push(file.name);
      } catch (e) {
        found.push(
          e?.status === 413
            ? `“${file.name}” is too big (${formatBytes(file.size)}).`
            : `“${file.name}” didn’t upload: ${e?.message || 'something went wrong'}.`,
        );
      }
    }
    // the newest draft, so files added while others uploaded are kept
    const listed = knowledgeOf(latest()).files;
    if (added.length) {
      set(added.reduce((c, name) => addKnowledgeFile(c, name), latest()));
      setRefused('');
    }
    setReplaced(added.filter((name) => listed.includes(name)));
    setProblems(found);
    setBusy(false);
    if (added.length) onUploaded?.();
  };
  const addPage = () => {
    setReplaced([]);
    const url = cleanUrl(page);
    if (!url) {
      setPageProblem('Type a web address, for example www.example.com/help.');
      return;
    }
    setPageProblem('');
    setRefused('');
    set(addKnowledgePage(config, url, { linked }));
    setPage('');
    setLinked(false);
  };
  // Takes one out. Focus moves to the next Remove (else the one before, else the web page box), not to the page top.
  const remove = (event, kind, value) => {
    setReplaced([]);
    const result = removeKnowledge(config, kind, value);
    setRefused(result.refused);
    if (result.refused) return;
    const item = event.currentTarget.closest('li');
    const near = item?.nextElementSibling || item?.previousElementSibling;
    (near?.querySelector('button') || pageInput.current)?.focus();
    set(result.config);
  };

  return (
    <div className="suFields">
      <label
        className={`suDrop ${over ? 'over' : ''} ${busy ? 'busy' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          upload(event.dataTransfer.files);
        }}
      >
        {/* hidden from sight, not from the keyboard: Tab reaches it, and Enter or Space opens the chooser */}
        <input
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="srOnly"
          disabled={busy}
          onChange={(event) => {
            upload(event.target.files);
            // emptied, so the same file chosen again (after a Remove) is added again
            event.target.value = '';
          }}
          aria-label="Add documents"
        />
        <Icon name="paperclip" size={20} />
        <strong>{busy ? 'Adding…' : 'Drop documents here, or choose them'}</strong>
        <small>PDF, text, markdown, HTML, CSV or JSON files.</small>
      </label>
      {problems.map((p) => (
        <p key={p} className="suNote warn" role="alert">
          {p}
        </p>
      ))}
      <div className="suInline">
        <label className="suField grow">
          <span>Or a web page</span>
          <input
            ref={pageInput}
            className="stFInput"
            value={page}
            placeholder="www.example.com/help"
            onChange={(event) => setPage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addPage();
              }
            }}
          />
          {pageProblem && <small className="suWarn">{pageProblem}</small>}
        </label>
        <button type="button" className="quietButton" onClick={addPage} disabled={!page.trim()}>
          Add the page
        </button>
      </div>
      <label className="suCheck suLinked">
        <input type="checkbox" checked={linked} onChange={(event) => setLinked(event.target.checked)} />
        Also read the pages it links to <small>for a website’s home page or a help centre’s contents</small>
      </label>
      {(files.length > 0 || pages.length > 0) && (
        <ul className="suList" aria-label="What it knows">
          {files.map((name) => (
            <li key={`f:${name}`}>
              <Icon name="records" size={15} />
              <span>{name}</span>
              <button type="button" className="linkButton" aria-label={`Remove ${name}`} onClick={(event) => remove(event, 'file', name)}>
                Remove
              </button>
            </li>
          ))}
          {pages.map((url) => (
            <li key={`u:${url}`}>
              <Icon name="globe" size={15} />
              <span>
                {url}
                {depths[url] > 0 && <small className="suLinkedNote"> · and the pages it links to</small>}
              </span>
              <button type="button" className="linkButton" aria-label={`Remove ${url}`} onClick={(event) => remove(event, 'url', url)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {refused && (
        <p className="suNote warn" role="alert">
          {refused}
        </p>
      )}
      {replaced.length > 0 && (
        <p className="suNote" role="status">
          {replaced.length === 1 ? `Replaced “${replaced[0]}” with the copy you chose.` : `Replaced ${replaced.length} documents with the copies you chose.`}
        </p>
      )}
      {/* with nothing added yet, what that means for the agent (and no word about building an index of nothing) */}
      {onPage ? (
        // on the page, what happens next is said in one line under this block (saved, read, ready)
        !files.length &&
        !pages.length && (
          <p className="suNote">Nothing yet. Until you add documents or pages, it answers only from what its instructions on the Agent page say.</p>
        )
      ) : (
        <p className="suNote">
          {keyMissing
            ? 'This server can’t read documents yet (whoever runs it has to add the key for it). They are kept, and used as soon as it can.'
            : 'They are read when you move on. Ask about them in the Try it step.'}
        </p>
      )}
    </div>
  );
}
