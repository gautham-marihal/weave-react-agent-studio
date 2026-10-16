import { isObj } from './engine.js';
import { useConfigSelect, useForm } from './ctx.js';
import { StringList, Switch, TextInput } from './fields.jsx';
import { IdChip } from './IdTools.jsx';
import { useProviders } from '../models/useProviders.js';
import { addDefaultSpeechModels } from '../models/config.js';
import { providerLabel } from '../models/catalog.js';
import { ObjectBody } from './Node.jsx';
import { CHANNEL_TYPES, ENTRY_FIELDS, ENTRY_LABELS, TYPE_LABELS, changeChannelType, modalityNotes } from './presets.js';
import { TechKey } from './TechName.jsx';

// One channel, drawn for what it is: the type decides which fields are shown, so a phone line never offers a widget id
// and a web chat never offers a phone number. The id is a permanent key (Rename… rewrites everything that points at it).
// What is left (modalities, greeting, instructions) uses the ordinary form; the rarely-needed parts are collapsed.

const HANDLED = ['id', 'type', 'enabled', 'entry', 'capabilities'];
const REQUIRES_ENTRY = ['sip_voice', 'web_chat'];
const COLLAPSED = new Set(['match', 'inputs', 'overrides']);

// What each capability means and what it is when nobody has said (the schema's own wording).
const CAPABILITIES = [
  { key: 'dtmf', label: 'Keypad tones (DTMF)', help: 'Callers can press keys and the agent can send tones. Phone and voice channels only.', fallback: () => false },
  { key: 'human_transfer', label: 'Hand over to a person', help: 'Off: a transfer tool skips the transfer on this channel and runs its fallback straight away.', fallback: () => true },
  { key: 'forms', label: 'Show forms', help: 'Can this channel show a form? Where it can’t, a form runs its “otherwise” actions instead.', fallback: (type) => type === 'web_chat' || type === 'web_voice' },
];

const sortByOrder = (obj, order) => {
  const rank = (key) => { const i = order.indexOf(key); return i === -1 ? order.length : i; };
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => rank(a) - rank(b)));
};

export default function ChannelBody({ shape, value, path, onChange, disabled }) {
  const ctx = useForm();
  const obj = isObj(value) ? value : {};
  const type = obj.type;
  const botId = useConfigSelect((c) => c?.meta?.id || '');
  const notes = useConfigSelect((c) => modalityNotes(obj, c));
  const { providers } = useProviders();
  // A voice channel on an agent with no speech models: one click sets a default for each missing stage (from what the server can run)
  const firstSpeech = notes.findIndex((note) => note.stage); // the button goes under the first of the notes about speech, once
  const addSpeech = () => {
    const { config: next, added, skipped } = addDefaultSpeechModels(ctx.store.get(), providers);
    if (!added.length) return;
    ctx.applyConfig(next, `Added default speech models: ${added.map((a) => `${a.stage === 'stt' ? 'listening' : 'speaking'} with ${providerLabel(a.provider)}${a.keySet ? '' : ' (its key may not be set on the server)'}`).join(', ')}.${skipped.length ? ' No provider is available for the rest.' : ''}`);
  };
  const order = Object.keys(shape.properties);

  const handled = Object.fromEntries(Object.entries(obj).filter(([key]) => HANDLED.includes(key)));
  const rest = Object.fromEntries(Object.entries(obj).filter(([key]) => !HANDLED.includes(key)));
  const restShape = {
    ...shape,
    properties: Object.fromEntries(Object.entries(shape.properties).filter(([key]) => !HANDLED.includes(key))),
    required: (shape.required || []).filter((key) => !HANDLED.includes(key)),
  };
  const set = (patch) => onChange(sortByOrder({ ...obj, ...patch }, order));

  const changeType = (next) => {
    if (next === type) return;
    const { channel, cleared } = changeChannelType(obj, next, botId);
    if (cleared.length && !window.confirm(`Changing this channel to ${TYPE_LABELS[next] || next} clears: ${cleared.join(', ')}. Continue?`)) return;
    onChange(sortByOrder(channel, order));
  };

  // ---- entry: only the fields that apply to this type
  const entry = isObj(obj.entry) ? obj.entry : {};
  const applicable = ENTRY_FIELDS[type];
  const setEntry = (key, v) => {
    const next = { ...entry };
    if (v === '' || (Array.isArray(v) && v.length === 0)) delete next[key]; else next[key] = v;
    if (!Object.keys(next).length && !REQUIRES_ENTRY.includes(type)) { const { entry: _drop, ...without } = obj; onChange(sortByOrder(without, order)); return; }
    set({ entry: next });
  };
  const stray = applicable ? Object.keys(entry).filter((key) => !applicable.includes(key)) : [];
  const shown = (applicable || []).filter((key) => !['sip_trunk', 'dispatch_rule'].includes(key));
  const advanced = (applicable || []).filter((key) => ['sip_trunk', 'dispatch_rule'].includes(key));
  const entryControl = (key) => {
    const [label, help, example] = ENTRY_LABELS[key] || [key, '', ''];
    const id = `${path.join('-')}-${key}`;
    return (
      <div className="stFRow wide" key={key} data-path={`${path.join('.')}.entry.${key}`}>
        <div className="stFLabel"><label htmlFor={id}>{label}</label>{type === 'web_chat' && key === 'widget_id' && <abbr title="Required" className="stFReq">*</abbr>}<TechKey name={key} path={[...path, 'entry', key]} /></div>
        {key === 'allowed_origins'
          ? <StringList values={Array.isArray(entry[key]) ? entry[key] : []} onChange={(v) => setEntry(key, v)} disabled={disabled} placeholder={example} />
          : <TextInput id={id} value={entry[key] ?? ''} onChange={(v) => setEntry(key, v)} disabled={disabled} placeholder={example} />}
        {help && <p className="stFHelp">{help}</p>}
      </div>
    );
  };

  const caps = isObj(obj.capabilities) ? obj.capabilities : {};
  const setCap = (key, on) => set({ capabilities: { ...caps, [key]: on } });

  return (
    <div className="stFObject stChannel" data-channel-type={type}>
      <div className="stFGrid">
        {obj.id ? <IdChip id={obj.id} disabled={disabled} onRename={() => ctx.requestRename('channels', obj.id)} /> : (
          <div className="stFRow wide"><div className="stFLabel"><label>Id</label><abbr title="Required" className="stFReq">*</abbr></div><TextInput value={obj.id ?? ''} onChange={(v) => set({ id: v })} disabled={disabled} placeholder="phone" /></div>
        )}
        <div className="stFRow">
          <div className="stFLabel"><label htmlFor={`${path.join('-')}-type`}>Kind of channel</label><abbr title="Required" className="stFReq">*</abbr></div>
          <select id={`${path.join('-')}-type`} className="stFInput" value={type ?? ''} disabled={disabled} onChange={(event) => changeType(event.target.value)}>
            {!CHANNEL_TYPES.includes(type) && <option value={type ?? ''}>{type || 'Choose a kind…'}</option>}
            {CHANNEL_TYPES.map((item) => <option key={item} value={item}>{TYPE_LABELS[item]}</option>)}
          </select>
          <p className="stFHelp">Changing it clears the fields that only belong to the old kind (you are asked first).</p>
        </div>
        <div className="stFRow">
          <div className="stFLabel"><label>Enabled</label></div>
          <Switch checked={obj.enabled !== false} onChange={(v) => set({ enabled: v })} disabled={disabled} label="Enabled" />
        </div>
      </div>

      {applicable && (applicable.length > 0 || stray.length > 0) && (
        <fieldset className="stChannelBlock">
          <legend>How it is reached</legend>
          <p className="stFHelp stChannelNote">For reference only. These fields describe the route and are not read by the runtime: {type === 'sip_voice' ? 'a call reaches an agent through the SIP dispatch rule for its number, which the platform sets up. Typing the number here does not connect it.' : 'a visitor reaches an agent through the session token for the widget. Nothing here connects it.'}</p>
          {shown.map(entryControl)}
          {advanced.length > 0 && (
            <details className="stChannelAdvanced">
              <summary>Advanced ({advanced.length})</summary>
              {advanced.map(entryControl)}
            </details>
          )}
          {stray.map((key) => (
            <div className="stFRow wide" key={key}>
              <div className="stFLabel"><label>{key}</label><span className="stFTag warn">doesn’t apply to {TYPE_LABELS[type] || type}</span>
                <button type="button" className="stFDel small" disabled={disabled} onClick={() => { ctx.markDelete(`entry.${key}`); const next = { ...entry }; delete next[key]; set({ entry: next }); }}>Delete</button></div>
              <code className="stFIdChip">{JSON.stringify(entry[key])}</code>
            </div>
          ))}
        </fieldset>
      )}

      <fieldset className="stChannelBlock">
        <legend>What it can do</legend>
        <div className="stCaps">
          {CAPABILITIES.map((cap) => {
            const explicit = cap.key in caps;
            return (
              <div className="stCap" key={cap.key}>
                <strong className="stCapName" aria-hidden="true">{cap.label}</strong>
                <Switch checked={explicit ? !!caps[cap.key] : cap.fallback(type)} onChange={(v) => setCap(cap.key, v)} disabled={disabled} label={cap.label} />
                <p className="stFHelp">{cap.help}{explicit ? '' : ' (using the default for this kind)'}</p>
              </div>
            );
          })}
        </div>
      </fieldset>

      <ObjectBody shape={restShape} value={rest} path={path} disabled={disabled} collapsedKeys={COLLAPSED}
        onChange={(nextRest) => onChange(sortByOrder({ ...handled, ...nextRest }, order))} />

      {notes.length > 0 && (
        <ul className="stChannelNotes" aria-label="What this channel needs">
          {notes.map((note, index) => (
            <li key={index} className={note.level}>
              <span>{note.text}</span>
              {note.fix === 'models' && ctx.openModels && <button type="button" className="stLink" onClick={ctx.openModels}>Open Models</button>}
              {index === firstSpeech && !disabled && <button type="button" className="stAddBtn" onClick={addSpeech}>Add default speech models</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
