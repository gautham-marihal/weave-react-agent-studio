import React, { useId, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import Select from '../../../../ui/Select.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { CustomerPreview, SharpnessScale, StrictnessPick } from '../../../pictures/PictureSteps.jsx';
import { STRICTNESS_WORDS, strictnessOf } from '../../../pictures/strictness.js';
import { addPictureRequest, addTargets, pictureSteps, setAllStrictness, sharedStrictness } from '../../../pictures/mediaModel.js';
import { compareValues } from '../../../../demo/simulatedPictures.js';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { RECIPES, addRecipe, letWaysTake } from './pictureRecipes.js';
import { methodWords, plural } from './mediaWords.js';

// Images & Videos' own editors, used as rows of the part (mediaPart.jsx), so they are the same on a step's page and in
// All settings: how picky a request is (three words, or its own numbers), which pictures a step reads or forgets, the
// details a reading reads (a table), the pairs a comparison compares (a table, and a try-out run with the same rules as
// the server), how picky every photo or camera check is at once, and adding a picture step (a starting point, or one
// step).

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const vars = (config) => Object.keys(isObj(config?.state?.variables) ? config.state.variables : {});
// the remembered values a request keeps a picture in
const pictureVars = (config) => [...new Set(pictureSteps(config).flatMap((h) => (h.step.type === 'request_image' && h.step.into ? [h.step.into] : [])))];

// ---- how picky one request is: the three words, the exact numbers, and what the customer sees
export function PickyEditor({ ctx, base, id }) {
  const step = getAtPath(ctx.config, base) || {};
  const kind = step.kind === 'camera' ? 'camera' : 'upload';
  const set = (quality) => ctx.set(setPath(ctx.config, [...base, 'quality'], isObj(quality) && Object.keys(quality).length ? quality : undefined));
  const num = (key, label, max) => (
    <label className="mdNum">
      <span>{label}</span>
      <Input
        size="small"
        type="number"
        min={0}
        max={max}
        value={isObj(step.quality) && typeof step.quality[key] === 'number' ? step.quality[key] : ''}
        placeholder="No limit"
        onChange={(event) => {
          const n = event.target.value === '' ? undefined : Number(event.target.value);
          const q = { ...(isObj(step.quality) ? step.quality : {}) };
          if (n === undefined || !Number.isFinite(n)) delete q[key];
          else q[key] = n;
          set(q);
        }}
      />
    </label>
  );
  return (
    <div className="mdPicky" id={id}>
      <StrictnessPick kind={kind} quality={step.quality} onChange={set} labelId={`${id}-label`} />
      <SharpnessScale kind={kind} quality={step.quality} onChange={set} />
      <div className="mdNums">
        {num('min_brightness', 'Brightness at least', 255)}
        {num('max_brightness', 'Brightness at most', 255)}
        {num('min_dimension', 'Smallest side at least (px)')}
      </div>
      <small className="apHint">0 is black and 255 white. Real calls show each picture’s scores in the call record, to tune these numbers.</small>
    </div>
  );
}

// what the customer sees, under the words shown beside the button
export function SeesPreview({ ctx, base }) {
  const step = getAtPath(ctx.config, base) || {};
  const words = typeof step.prompt === 'string' ? step.prompt : step.prompt?.message;
  return (
    <CustomerPreview kind={step.kind === 'camera' ? 'camera' : 'upload'} prompt={words} timeout={typeof step.timeout_s === 'number' ? step.timeout_s : 120} />
  );
}

// ---- which pictures a step reads or forgets (the values requests keep pictures in; at most `max`)
export function ImagesPick({ ctx, base, id, max = 4, label }) {
  const chosen = list(getAtPath(ctx.config, [...base, 'images'])).filter((v) => typeof v === 'string');
  const offered = [...new Set([...pictureVars(ctx.config), ...chosen])];
  const put = (next) => ctx.set(setPath(ctx.config, [...base, 'images'], next.length ? next : undefined));
  if (!offered.length) return <p className="apNone">No step asks for a picture yet: add “Ask for a photo” first.</p>;
  return (
    <div className="cvPills" role="group" aria-label={label} id={id}>
      {offered.map((v) => {
        const on = chosen.includes(v);
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            className={on ? 'on' : ''}
            disabled={!on && chosen.length >= max}
            onClick={() => put(on ? chosen.filter((x) => x !== v) : [...chosen, v])}
          >
            <Icon name="image" size={13} />
            <span className="mdMono">{v}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- the details a reading reads: name, kind, must be read, where it is kept, and whether that value is secret
const FIELD_KINDS = [
  ['string', 'Text'],
  ['number', 'A number'],
  ['date', 'A date'],
  ['boolean', 'Yes or no'],
];
const NAME = /^[a-z][a-z0-9_]{0,40}$/;
function DetailRow({ ctx, base, name, spec, index, taken, onGoSecret }) {
  const step = getAtPath(ctx.config, base) || {};
  const [typed, setTyped] = useState(name);
  const into = isObj(step.into) ? step.into : {};
  const keptIn = into[name] || name;
  const required = list(step.required).includes(name);
  const secret = getAtPath(ctx.config, ['state', 'variables', keptIn, 'sensitive']) === true;
  const bad = typed !== name && (!NAME.test(typed) || taken.includes(typed));
  const write = (change) => ctx.set(change(ctx.config));
  const rename = (next) => {
    setTyped(next);
    if (!NAME.test(next) || taken.includes(next) || next === name) return;
    write((c) => {
      const s = getAtPath(c, base);
      const fields = Object.fromEntries(Object.entries(s.fields || {}).map(([k, v]) => [k === name ? next : k, v]));
      let out = setPath(c, [...base, 'fields'], fields);
      out = setPath(
        out,
        [...base, 'required'],
        list(s.required).map((f) => (f === name ? next : f)),
      );
      if (isObj(s.into) && s.into[name] !== undefined) {
        const { [name]: kept, ...rest } = s.into;
        out = setPath(out, [...base, 'into'], { ...rest, [next]: kept });
      }
      return out;
    });
  };
  return (
    <tr>
      <td>
        <Input
          size="small"
          mono
          aria-label={`Detail ${index + 1}`}
          aria-invalid={bad || undefined}
          value={typed}
          onChange={(event) => rename(event.target.value)}
        />
        {bad && <small className="stFieldError">{taken.includes(typed) ? 'Another detail has this name' : 'Lower case, digits and _'}</small>}
      </td>
      <td>
        <Select
          className="stFInput"
          aria-label={`Kind of ${name}`}
          value={spec?.type || 'string'}
          onChange={(event) => write((c) => setPath(c, [...base, 'fields', name, 'type'], event.target.value))}
        >
          {FIELD_KINDS.map(([v, words]) => (
            <option key={v} value={v}>
              {words}
            </option>
          ))}
        </Select>
      </td>
      <td className="mdCenter">
        <input
          type="checkbox"
          className="mdCheck"
          aria-label={`${name} must be read`}
          checked={required}
          onChange={(event) =>
            write((c) => {
              const now = list(getAtPath(c, [...base, 'required']));
              const next = event.target.checked ? [...now, name] : now.filter((f) => f !== name);
              return setPath(c, [...base, 'required'], next.length ? next : undefined);
            })
          }
        />
      </td>
      <td>
        <Input
          size="small"
          mono
          aria-label={`Where ${name} is kept`}
          value={into[name] || ''}
          placeholder={name}
          onChange={(event) =>
            write((c) => {
              const now = { ...(isObj(getAtPath(c, [...base, 'into'])) ? getAtPath(c, [...base, 'into']) : {}) };
              if (event.target.value.trim()) now[name] = event.target.value.trim();
              else delete now[name];
              return setPath(c, [...base, 'into'], Object.keys(now).length ? now : undefined);
            })
          }
        />
      </td>
      <td>
        {secret ? (
          <button type="button" className="mdSecret on" onClick={onGoSecret}>
            <Icon name="lock" size={12} />
            Secret
          </button>
        ) : (
          <button type="button" className="mdSecret" onClick={onGoSecret}>
            —<span className="srOnly"> (not secret: whether {keptIn} is secret is set on Conversation)</span>
          </button>
        )}
      </td>
      <td>
        <Button
          type="button"
          variant="quiet"
          size="small"
          aria-label={`Remove ${name}`}
          onClick={() =>
            write((c) => {
              const s = getAtPath(c, base);
              const { [name]: _gone, ...fields } = s.fields || {};
              let out = setPath(c, [...base, 'fields'], fields);
              const req = list(s.required).filter((f) => f !== name);
              out = setPath(out, [...base, 'required'], req.length ? req : undefined);
              if (isObj(s.into) && s.into[name] !== undefined) {
                const { [name]: _x, ...rest } = s.into;
                out = setPath(out, [...base, 'into'], Object.keys(rest).length ? rest : undefined);
              }
              return out;
            })
          }
        >
          <Icon name="close" size={14} />
        </Button>
      </td>
    </tr>
  );
}
export function DetailsTable({ ctx, base, id, onGoSecret }) {
  const step = getAtPath(ctx.config, base) || {};
  const fields = isObj(step.fields) ? Object.entries(step.fields) : [];
  const add = () => {
    const names = fields.map(([k]) => k);
    let n = names.length + 1;
    while (names.includes(`detail_${n}`)) n += 1;
    ctx.set(setPath(ctx.config, [...base, 'fields', `detail_${n}`], { type: 'string' }));
  };
  return (
    <div className="mdTable" id={id}>
      {fields.length > 0 && (
        <table className="mdT">
          <thead>
            <tr>
              <th style={{ width: '24%' }}>Detail</th>
              <th style={{ width: '19%' }}>Kind</th>
              <th style={{ width: '12%' }}>Must be read</th>
              <th style={{ width: '23%' }}>Kept in</th>
              <th style={{ width: '12%' }}>Secret</th>
              <th style={{ width: 52 }}>
                <span className="srOnly">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map(([name, spec], index) => (
              <DetailRow
                key={index}
                ctx={ctx}
                base={base}
                name={name}
                spec={spec}
                index={index}
                taken={fields.map(([k]) => k).filter((k) => k !== name)}
                onGoSecret={onGoSecret}
              />
            ))}
          </tbody>
        </table>
      )}
      <div className="mdTableFoot">
        <Button type="button" variant="secondary" size="small" onClick={add} disabled={fields.length >= 24}>
          <Icon name="plus" size={14} />
          Add a detail
        </Button>
        <span className="apHint">Each comes back as its kind, or empty: never guessed. A secret value is never in logs or shown back in full.</span>
      </div>
    </div>
  );
}

// ---- the pairs a comparison compares
const METHODS = ['text', 'id', 'exact', 'date', 'date_on_or_after', 'number'];
const METHOD_LABELS = {
  text: 'A name',
  id: 'A code or number',
  exact: 'Exactly the same',
  date: 'The same day',
  date_on_or_after: 'On or after',
  number: 'The same number',
};
export function PairsTable({ ctx, base, id }) {
  const pairs = list(getAtPath(ctx.config, [...base, 'pairs']));
  const listId = useId();
  const names = vars(ctx.config);
  const put = (i, patch) =>
    ctx.set(
      setPath(
        ctx.config,
        [...base, 'pairs'],
        pairs.map((p, n) => (n === i ? Object.fromEntries(Object.entries({ ...p, ...patch }).filter(([, v]) => v !== undefined && v !== '')) : p)),
      ),
    );
  return (
    <div className="mdTable" id={id}>
      <datalist id={listId}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {pairs.length > 0 && (
        <table className="mdT">
          <thead>
            <tr>
              <th style={{ width: '18%' }}>Named</th>
              <th>Left</th>
              <th>Right</th>
              <th style={{ width: '26%' }}>How it compares</th>
              <th style={{ width: '10%' }}>Optional</th>
              <th style={{ width: 52 }}>
                <span className="srOnly">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr key={i}>
                <td>
                  <Input
                    size="small"
                    aria-label={`Name of pair ${i + 1}`}
                    value={p.label || ''}
                    placeholder={p.left || 'a pair'}
                    onChange={(e) => put(i, { label: e.target.value })}
                  />
                </td>
                <td>
                  <Input
                    size="small"
                    mono
                    list={listId}
                    aria-label={`Left of pair ${i + 1}`}
                    value={p.left || ''}
                    onChange={(e) => put(i, { left: e.target.value.trim() })}
                  />
                </td>
                <td>
                  <Input
                    size="small"
                    mono
                    list={listId}
                    aria-label={`Right of pair ${i + 1}`}
                    value={p.right || ''}
                    onChange={(e) => put(i, { right: e.target.value.trim() })}
                  />
                </td>
                <td>
                  <Select
                    className="stFInput"
                    aria-label={`How pair ${i + 1} compares`}
                    value={p.method || 'text'}
                    onChange={(e) => put(i, { method: e.target.value === 'text' ? undefined : e.target.value })}
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                  {(p.method || 'text') === 'text' && (
                    <label className="mdNum mdTight">
                      <span>Close enough at</span>
                      <Input
                        size="small"
                        type="number"
                        min={0.5}
                        max={1}
                        step={0.05}
                        value={typeof p.threshold === 'number' ? p.threshold : 0.85}
                        onChange={(e) =>
                          put(i, { threshold: e.target.value === '' || Math.abs(Number(e.target.value) - 0.85) < 1e-9 ? undefined : Number(e.target.value) })
                        }
                      />
                    </label>
                  )}
                  {(p.method === 'date' || p.method === 'date_on_or_after') && (
                    <Select
                      className="stFInput mdTight"
                      aria-label={`How pair ${i + 1} reads 05/04/1990`}
                      value={p.date_order || 'dmy'}
                      onChange={(e) => put(i, { date_order: e.target.value === 'dmy' ? undefined : e.target.value })}
                    >
                      <option value="dmy">05/04 is 5 April</option>
                      <option value="mdy">05/04 is May 4</option>
                    </Select>
                  )}
                </td>
                <td className="mdCenter">
                  <input
                    type="checkbox"
                    className="mdCheck"
                    aria-label={`Pair ${i + 1} is left out when either side is empty`}
                    checked={p.optional === true}
                    onChange={(e) => put(i, { optional: e.target.checked || undefined })}
                  />
                </td>
                <td>
                  <Button
                    type="button"
                    variant="quiet"
                    size="small"
                    aria-label={`Remove pair ${i + 1}`}
                    onClick={() =>
                      ctx.set(
                        setPath(
                          ctx.config,
                          [...base, 'pairs'],
                          pairs.filter((_, n) => n !== i),
                        ),
                      )
                    }
                  >
                    <Icon name="close" size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mdTableFoot">
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={() => ctx.set(setPath(ctx.config, [...base, 'pairs'], [...pairs, { left: '', right: '' }]))}
        >
          <Icon name="plus" size={14} />
          Add a pair
        </Button>
        <span className="apHint">A value missing on either side never matches, unless the pair is optional.</span>
      </div>
    </div>
  );
}

// an example for each way of comparing, as two values that should match
const EXAMPLE = {
  text: ['Jane Anne Sample', 'SAMPLE, JANE ANNE'],
  id: ['S1234567D', 's 1234567 d'],
  exact: ['Gold', 'gold'],
  date: ['04/05/1990', '1990-05-04'],
  date_on_or_after: ['2030-01-31', new Date().toISOString().slice(0, 10)],
  number: ['1200', '1200.0'],
};
// try the comparison on values of your own, with the server's rules (run here; nothing is saved)
export function PairsTry({ ctx, base, id }) {
  const step = getAtPath(ctx.config, base) || {};
  const pairs = list(step.pairs).filter(isObj);
  const [typed, setTyped] = useState({});
  if (!pairs.length) return <p className="apNone">Add a pair first.</p>;
  const valueOf = (i, side) => typed[`${i}:${side}`] ?? EXAMPLE[pairs[i].method || 'text'][side === 'left' ? 0 : 1];
  const state = {};
  const named = pairs.map((p, i) => ({ ...p, left: `l${i}`, right: `r${i}`, label: p.label || p.left || `pair ${i + 1}` }));
  pairs.forEach((p, i) => {
    state[`l${i}`] = valueOf(i, 'left');
    state[`r${i}`] = valueOf(i, 'right');
  });
  const result = compareValues({ ...step, pairs: named }, state);
  return (
    <div className="mdTryBox" id={id}>
      <table className="mdT">
        <thead>
          <tr>
            <th style={{ width: '28%' }}>Pair</th>
            <th>Left</th>
            <th>Right</th>
            <th style={{ width: '16%' }}>Result</th>
          </tr>
        </thead>
        <tbody>
          {named.map((p, i) => (
            <tr key={i}>
              <td>
                {p.label}
                <small className="mdSub">{methodWords(pairs[i].method)}</small>
              </td>
              {['left', 'right'].map((side) => (
                <td key={side}>
                  <Input
                    size="small"
                    aria-label={`${p.label}: ${side} value`}
                    value={valueOf(i, side)}
                    onChange={(e) => setTyped((t) => ({ ...t, [`${i}:${side}`]: e.target.value }))}
                  />
                </td>
              ))}
              <td>
                <span className={`tlPill ${result.pairs[i].matched ? 'good' : 'bad'}`}>
                  {result.pairs[i].skipped ? 'Left out' : result.pairs[i].matched ? 'Matches' : 'Differs'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`cxNote ${result.matched ? '' : 'grWarn'}`} role="status">
        <Icon name={result.matched ? 'check' : 'info'} size={14} />
        {result.matched ? 'It passes.' : `It doesn’t pass. What differed: ${result.differences.join(', ') || 'nothing compared'}.`}
        <span className="apDim"> Run here with the server’s rules; nothing is saved.</span>
      </p>
    </div>
  );
}

// ---- how picky every photo, or every camera check, is at once
export function PickyAll({ ctx, kind, id }) {
  const n = pictureSteps(ctx.config).filter((h) => h.step.type === 'request_image' && (h.step.kind === 'camera') === (kind === 'camera')).length;
  const now = sharedStrictness(ctx.config, kind, strictnessOf);
  if (!n) return <p className="apNone">{kind === 'camera' ? 'No camera check yet.' : 'No photo request yet.'}</p>;
  return (
    <div className="mdPickyAll" id={id}>
      <div className="cvPills" role="radiogroup" aria-label={kind === 'camera' ? 'How picky, for every camera check' : 'How picky, for every photo'}>
        {STRICTNESS_WORDS.map((w) => (
          <button
            key={w.value}
            type="button"
            role="radio"
            aria-checked={now === w.value}
            className={now === w.value ? 'on' : ''}
            onClick={() => ctx.set(setAllStrictness(ctx.config, kind, w.value))}
          >
            {w.label}
          </button>
        ))}
      </div>
      <small className="apHint">
        {STRICTNESS_WORDS.find((w) => w.value === now)?.hint || 'They differ now: a choice here sets them all.'} Sets{' '}
        {plural(n, kind === 'camera' ? 'camera check' : 'photo request')}.
      </small>
    </div>
  );
}

// ---- adding a picture step: a starting point (ask, read, forget) or a single step, in a list of steps
const SINGLE = [
  { id: 'upload', icon: 'image', name: 'Ask for a photo', help: 'They send one from their device' },
  { id: 'camera', icon: 'camera', name: 'Ask for the camera', help: 'A frame is taken from their camera' },
  { id: 'analyze_image', icon: 'read', name: 'Read a picture', help: 'The AI reads the details you name' },
  { id: 'compare_values', icon: 'compare', name: 'Compare in code', help: 'Pairs of values, the way a person would' },
  { id: 'discard_image', icon: 'forget', name: 'Forget pictures', help: 'As soon as they are used' },
];
const ICON_OF = { document: 'read', damage: 'image', receipt: 'note', camera: 'camera' };
export function AddPictureStep({ ctx, onAdded, onNoForm, starts = true }) {
  const targets = addTargets(ctx.config);
  const [target, setTarget] = useState('');
  const chosen = targets.find((t) => t.value === (target || targets[0]?.value));
  if (!targets.length)
    return (
      <p className="cxNote">
        <Icon name="info" size={14} />
        Pictures are asked for in a form’s steps, and this agent has no form yet.{' '}
        <button type="button" className="stLink" onClick={onNoForm}>
          Add a form on Connections
        </button>
      </p>
    );
  const single = (kind) => {
    const listPath = chosen.path;
    const now = list(getAtPath(ctx.config, listPath));
    const pics = pictureVars(ctx.config);
    if (kind === 'upload' || kind === 'camera') {
      // a request with its own value to keep the picture in, held to the tested standard; its words for any agent
      const made = addPictureRequest(ctx.config, listPath, kind);
      const worded = setPath(
        made.config,
        [...made.path, 'prompt'],
        kind === 'camera' ? 'Hold it up to the camera, in good light' : 'A clear photo, in good light',
      );
      ctx.set(letWaysTake(worded, kind));
      onAdded?.(made.path, 'request_image');
      return;
    }
    const step =
      kind === 'analyze_image'
        ? { type: 'analyze_image', images: pics.slice(-1), instructions: '', fields: { detail_1: { type: 'string' } } }
        : kind === 'compare_values'
          ? { type: 'compare_values', pairs: [{ left: '', right: '' }], require: 'all' }
          : { type: 'discard_image', images: pics };
    ctx.set(setPath(ctx.config, listPath, [...now, step]));
    onAdded?.([...listPath, now.length], kind);
  };
  const recipe = (rid) => {
    const r = addRecipe(ctx.config, chosen.path, rid);
    ctx.set(r.config);
    onAdded?.(r.path, 'request_image');
  };
  return (
    <div className="tlKindsWrap mdAdd">
      <label className="mdWhere">
        <span>Add it to</span>
        <Select className="stFInput" value={chosen.value} onChange={(event) => setTarget(event.target.value)}>
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </label>
      {starts && (
        <>
          <b className="mdAddHead">Start from</b>
          <div className="tlKinds" role="group" aria-label="Start from">
            {RECIPES.map((r) => (
              <button key={r.id} type="button" className="tlKind" onClick={() => recipe(r.id)}>
                <span className="tlKindIcon" aria-hidden="true">
                  <Icon name={ICON_OF[r.id] || 'image'} size={16} />
                </span>
                <b>{r.name}</b>
                <small>{r.help}</small>
              </button>
            ))}
          </div>
          <b className="mdAddHead">Or one step</b>
        </>
      )}
      <div className="tlKinds" role="group" aria-label="One step">
        {SINGLE.map((s) => (
          <button key={s.id} type="button" className="tlKind" onClick={() => single(s.id)}>
            <span className="tlKindIcon" aria-hidden="true">
              <Icon name={s.icon} size={16} />
            </span>
            <b>{s.name}</b>
            <small>{s.help}</small>
          </button>
        ))}
      </div>
      {starts && (
        <p className="apHint">
          A starting point adds three steps: ask, read and forget, each with the values it keeps. The check in code is the request’s own standard.
        </p>
      )}
    </div>
  );
}
export { METHOD_LABELS };
