import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input, TextArea } from '../../../../ui/Input.tsx';
import Select from '../../../../ui/Select.tsx';
import { Modal } from '../../../ui.jsx';
import { SampleCard } from '../../../scenarios/SamplePictures.jsx';
import { IMAGE_FAULTS, IMAGE_NAME, sampleImage } from '../../../scenarios/model.js';
import { measureFile } from '../../../pictures/measure.js';
import { STRICTNESS } from '../../../pictures/strictness.js';
import { addPicture, pictureBytes, pictureLibrary, pictureSrc, removePicture, renamePicture, setPicture } from '../../../pictures/mediaModel.js';
import { navigate, routeHref, useRoute } from '../../../route.js';
import { plural } from '../describe.js';

// The picture library of Images & Videos: every sample picture the agent's test scenarios use (schema 1.2
// `tests[].images`), as a grid or a list, searched and filtered by kind. A picture opens in a preview with its details:
// its numbers measured here the way the server measures them, where it is used, and, for a drawn card, its words and
// faults. Pictures can be uploaded, drawn, replaced, renamed and removed; each change is the scenario's own setting.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const KIND_WORDS = { card: 'Sample card', photo: 'Your photo', file: 'File in the agent’s folder', text: 'Not a picture', empty: 'Empty file' };
const FILTERS = [
  { id: 'all', label: 'All', keep: () => true },
  { id: 'card', label: 'Sample cards', keep: (p) => p.kind === 'card' },
  { id: 'photo', label: 'Photos', keep: (p) => p.kind === 'photo' || p.kind === 'file' },
  { id: 'other', label: 'Not pictures', keep: (p) => p.kind === 'text' || p.kind === 'empty' },
];
const MAX_BYTES = 2 * 1024 * 1024;
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const faultsOf = (image) => (isObj(image) ? IMAGE_FAULTS.filter((f) => image[f.key] !== undefined && !(f.key === 'brightness' && image.brightness === 1)) : []);

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
const dataUrlToBlob = async (src) => (await fetch(src)).blob();

// The picture itself: a photo of their own as it is, a card drawn from its settings, or what the file is
function Thumb({ item, large = false }) {
  const src = pictureSrc(item.image);
  if (src) return <img className="mvImg" src={src} alt={`Sample picture ${item.name}`} />;
  if (item.kind === 'card')
    return (
      <span className={`mvCardWrap ${large ? 'large' : ''}`} role="img" aria-label={`Sample card ${item.name}`}>
        <SampleCard image={item.image} />
      </span>
    );
  return (
    <span className="mvOther" role="img" aria-label={`${KIND_WORDS[item.kind]}: ${item.name}`}>
      <Icon name={item.kind === 'file' ? 'image' : 'note'} size={large ? 34 : 24} />
      <small>{item.kind === 'file' ? item.image.file : KIND_WORDS[item.kind]}</small>
    </span>
  );
}

// What the server would make of a photo of their own: its size, sharpness and brightness, and whether each photo check
// would take it
function Measured({ image }) {
  const [m, setM] = useState(null);
  const [dims, setDims] = useState(null);
  const src = pictureSrc(image);
  useEffect(() => {
    let alive = true;
    setM(null);
    setDims(null);
    if (!src) return undefined;
    const img = new Image();
    img.onload = () => alive && setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
    dataUrlToBlob(src)
      .then((blob) => measureFile(blob))
      .then((r) => alive && setM(r?.error ? { failed: true } : r))
      .catch(() => alive && setM({ failed: true }));
    return () => {
      alive = false;
    };
  }, [src]);
  if (!src) return null;
  const sharp = m && !m.failed ? Math.round(m.sharpness) : null;
  return (
    <div className="mvMeasured">
      <dl className="mvFacts">
        <dt>Size</dt>
        <dd>
          {kb(pictureBytes(image))}
          {dims ? ` · ${dims.w} × ${dims.h} px` : ''}
        </dd>
        <dt>Sharpness</dt>
        <dd>{sharp === null ? (m?.failed ? 'Couldn’t be measured' : 'Measuring…') : sharp}</dd>
        <dt>Brightness</dt>
        <dd>{m && !m.failed ? `${Math.round(m.brightness)} of 255` : '…'}</dd>
      </dl>
      {sharp !== null && (
        <ul className="mvChecks" aria-label="The photo checks">
          {['relaxed', 'standard', 'strict'].map((word) => {
            const need = STRICTNESS.upload[word].min_sharpness;
            const ok = sharp >= need;
            return (
              <li key={word} className={ok ? 'good' : 'bad'}>
                <Icon name={ok ? 'check' : 'close'} size={12} />
                {word[0].toUpperCase() + word.slice(1)} photo check (sharpness {need}): {ok ? 'accepted' : 'turned down'}
              </li>
            );
          })}
        </ul>
      )}
      <small className="mvNote">Measured in this browser the way the server measures a photo: its sharpness and brightness, never what is on it.</small>
    </div>
  );
}

// A name that commits when it is valid and free
function NameField({ id, item, taken, onRename }) {
  const [text, setText] = useState(item.name);
  useEffect(() => setText(item.name), [item.name]);
  const problem = !IMAGE_NAME.test(text)
    ? 'Lowercase letters, digits, - or _, starting with a letter.'
    : text !== item.name && taken.includes(text)
      ? 'Another picture in this scenario has this name.'
      : '';
  return (
    <div className="cnField">
      <label htmlFor={id}>Name</label>
      <small className="cnHelp">What the scenario’s turns call it.</small>
      <Input
        id={id}
        mono
        value={text}
        aria-invalid={problem ? true : undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => (problem ? setText(item.name) : text !== item.name && onRename(text))}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      />
      {problem && <small className="stFieldError">{problem}</small>}
    </div>
  );
}

// One picture, large, with its details and what can be done with it; arrows go through the pictures shown
function Details({ ctx, item, items, onMove, onClose }) {
  const route = useRoute();
  const fileRef = useRef(null);
  const [problem, setProblem] = useState('');
  const index = items.findIndex((p) => p.key === item.key);
  const taken = Object.keys(ctx.config.tests?.[item.scenario]?.images || {});
  const set = (image) => ctx.set(setPicture(ctx.config, item.scenario, item.name, image));
  const replace = async (file) => {
    setProblem('');
    if (!file) return;
    if (!/^image\//.test(file.type)) return setProblem('That file isn’t a picture. Choose a JPEG, PNG or WEBP photo.');
    if (file.size > MAX_BYTES) return setProblem(`That photo is ${kb(file.size)}. Use one under ${kb(MAX_BYTES)}: it is kept inside the agent’s settings.`);
    set({ data_url: await readAsDataUrl(file) });
    return undefined;
  };
  const footer = (
    <>
      <Button type="button" variant="secondary" disabled={index <= 0} onClick={() => onMove(items[index - 1].key)} aria-label="The picture before">
        <Icon name="chevronLeft" size={16} />
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={index >= items.length - 1}
        onClick={() => onMove(items[index + 1].key)}
        aria-label="The picture after"
      >
        <Icon name="chevronRight" size={16} />
      </Button>
      <span className="cnFootSpace" />
      <Button type="button" variant="primary" onClick={onClose}>
        Done
      </Button>
    </>
  );
  return (
    <Modal title={item.name} subtitle={`${KIND_WORDS[item.kind]} · scenario “${item.scenarioId}”`} onClose={onClose} footer={footer} wide>
      <div className="mvDetail">
        <div className="mvStage">
          <Thumb item={item} large />
        </div>
        <div className="mvSide">
          <NameField
            id="mv-name"
            item={item}
            taken={taken}
            onRename={(to) => {
              ctx.set(renamePicture(ctx.config, item.scenario, item.name, to));
              onMove(`${item.scenario}:${to}`);
            }}
          />
          <div className="cnField">
            <span className="cnLabel">Where it is used</span>
            {item.uses.length ? (
              <ul className="mvUses">
                {item.uses.map((u) => (
                  <li key={u}>{u[0].toUpperCase() + u.slice(1)}</li>
                ))}
              </ul>
            ) : (
              <small className="cnHelp">Not used by a turn yet.</small>
            )}
            <button
              type="button"
              className="stLink mvLink"
              onClick={() => navigate(routeHref(route.botId, 'scenarios', { scenario: item.scenarioId }), { guard: false })}
            >
              Open the scenario on Test
            </button>
          </div>
          {item.kind === 'photo' && <Measured image={item.image} />}
          {item.kind === 'card' && (
            <>
              <div className="cnField">
                <label htmlFor="mv-title">Title on the card</label>
                <Input id="mv-title" value={item.image.title || ''} onChange={(event) => set({ ...item.image, title: event.target.value || undefined })} />
              </div>
              <div className="cnField">
                <label htmlFor="mv-lines">Lines on the card, one per line</label>
                <small className="cnHelp">Made-up details only: the server draws the real picture from these words.</small>
                <TextArea
                  id="mv-lines"
                  rows={3}
                  value={(item.image.lines || []).join('\n')}
                  onChange={(event) => set({ ...item.image, lines: event.target.value.split('\n') })}
                />
              </div>
              <div className="cnField">
                <span className="cnLabel" id="mv-faults">
                  Faults
                </span>
                <small className="cnHelp">Switch one on to see how the agent handles a poor photo.</small>
                <div className="psPills" role="group" aria-labelledby="mv-faults">
                  {IMAGE_FAULTS.map((f) => {
                    const on = faultsOf(item.image).some((x) => x.key === f.key);
                    return (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={on}
                        className={on ? 'on' : ''}
                        title={f.hint}
                        onClick={() => {
                          const { [f.key]: _gone, ...rest } = item.image;
                          set(on ? rest : { ...item.image, [f.key]: f.on });
                        }}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          {item.kind === 'text' && (
            <div className="cnField">
              <label htmlFor="mv-text">What the file says</label>
              <small className="cnHelp">Sent instead of a picture, to check the agent refuses it politely.</small>
              <TextArea id="mv-text" rows={3} value={item.image.text} onChange={(event) => set({ text: event.target.value })} />
            </div>
          )}
          <div className="mvActions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => replace(event.target.files?.[0])} />
            <Button type="button" variant="secondary" size="small" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} />
              {item.kind === 'photo' ? 'Replace the photo' : 'Use a photo instead'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={item.uses.length > 0}
              title={item.uses.length ? 'A turn uses it: change that turn on Test first' : undefined}
              onClick={() => {
                ctx.set(removePicture(ctx.config, item.scenario, item.name));
                onClose();
              }}
            >
              <Icon name="trash" size={14} />
              Remove
            </Button>
          </div>
          {item.uses.length > 0 && <small className="cnHelp">It can be removed once no turn uses it.</small>}
          {problem && (
            <small className="stFieldError" role="alert">
              {problem}
            </small>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Adding a picture to a scenario: a photo of their own, a drawn sample card, or a file that isn't a picture
function AddDialog({ ctx, onClose, onAdded }) {
  const tests = (Array.isArray(ctx.config.tests) ? ctx.config.tests : []).map((t, i) => ({ i, id: t?.id || `scenario ${i + 1}`, words: t?.description || '' }));
  const [si, setSi] = useState(tests[0]?.i ?? 0);
  const [problem, setProblem] = useState('');
  const fileRef = useRef(null);
  const add = (image, base) => {
    const made = addPicture(ctx.config, si, image, base);
    ctx.set(made.config);
    onAdded(`${si}:${made.name}`);
  };
  const upload = async (file) => {
    setProblem('');
    if (!file) return;
    if (!/^image\//.test(file.type)) return setProblem('That file isn’t a picture. Choose a JPEG, PNG or WEBP photo.');
    if (file.size > MAX_BYTES) return setProblem(`That photo is ${kb(file.size)}. Use one under ${kb(MAX_BYTES)}: it is kept inside the agent’s settings.`);
    add({ data_url: await readAsDataUrl(file) }, file.name.replace(/\.[^.]+$/, ''));
    return undefined;
  };
  return (
    <Modal title="Add a picture" subtitle="Pictures belong to a test scenario, which sends them as photos or shows them to the camera." onClose={onClose}>
      <div className="cnStep">
        <div className="cnField">
          <label htmlFor="mv-scenario">Scenario</label>
          <Select id="mv-scenario" className="stFInput" value={String(si)} onChange={(event) => setSi(Number(event.target.value))}>
            {tests.map((t) => (
              <option key={t.i} value={t.i}>
                {t.id}
                {t.words ? ` · ${t.words.slice(0, 60)}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="cnKinds">
          <button type="button" onClick={() => fileRef.current?.click()}>
            <span className="cnIcon" aria-hidden="true">
              <Icon name="upload" size={18} />
            </span>
            <strong>Upload a photo</strong>
            <span>A JPEG, PNG or WEBP under 2 MB. It is kept inside the agent’s settings, so use a made-up card, never a real one.</span>
          </button>
          <button type="button" onClick={() => add(sampleImage(), 'sample_card')}>
            <span className="cnIcon" aria-hidden="true">
              <Icon name="image" size={18} />
            </span>
            <strong>Draw a sample card</strong>
            <span>A card drawn from made-up lines of text. Switch on blur, glare or a cut-off edge to test a poor photo.</span>
          </button>
          <button type="button" onClick={() => add({ text: 'This file is not a picture.' }, 'not_a_picture')}>
            <span className="cnIcon" aria-hidden="true">
              <Icon name="note" size={18} />
            </span>
            <strong>A file that isn’t a picture</strong>
            <span>To check that the agent refuses it and says why.</span>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => upload(event.target.files?.[0])} />
        {problem && (
          <small className="stFieldError" role="alert">
            {problem}
          </small>
        )}
      </div>
    </Modal>
  );
}

export default function MediaLibrary({ ctx }) {
  const route = useRoute();
  const all = useMemo(() => pictureLibrary(ctx.config), [ctx.config]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('grid');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const hasTests = Array.isArray(ctx.config.tests) && ctx.config.tests.length > 0;
  const q = query.trim().toLowerCase();
  const shown = all
    .filter(FILTERS.find((f) => f.id === filter).keep)
    .filter(
      (p) =>
        !q || [p.name, p.scenarioId, p.scenarioWords, KIND_WORDS[p.kind], ...(p.image?.lines || []), p.image?.title || ''].join(' ').toLowerCase().includes(q),
    );
  const openItem = all.find((p) => p.key === open) || null;
  const count = (id) => all.filter(FILTERS.find((f) => f.id === id).keep).length;

  if (!hasTests)
    return (
      <div className="dtIEmpty">
        <span className="dtIEmptyIcon" aria-hidden="true">
          <Icon name="image" size={20} />
        </span>
        <div>
          <strong>No pictures to try it with yet</strong>
          <p>
            The library holds the pictures your test scenarios send as photos or show to the camera. Write a scenario on Test first, then add its pictures here.
          </p>
        </div>
        <Button type="button" variant="secondary" size="small" onClick={() => navigate(routeHref(route.botId, 'scenarios'), { guard: false })}>
          Go to scenarios
        </Button>
      </div>
    );
  return (
    <div className="mvLib">
      <div className="mvBar">
        <div className="mvSearch">
          <Icon name="search" size={15} />
          <Input
            aria-label="Search the pictures"
            placeholder="Search by name, scenario or the words on a card"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="segmented" role="group" aria-label="Show which pictures">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label} <span className="mvCount">{count(f.id)}</span>
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Show as">
          <button type="button" aria-pressed={view === 'grid'} className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="A grid">
            <Icon name="grid" size={15} />
          </button>
          <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="A list">
            <Icon name="list" size={15} />
          </button>
        </div>
        <Button type="button" variant="secondary" size="small" className="dtAddBtn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          Add a picture
        </Button>
      </div>
      {shown.length === 0 && <p className="dtNote">{all.length ? 'No picture matches.' : 'No pictures yet. Add one to a scenario.'}</p>}
      {shown.length > 0 && (
        <ul className={view === 'grid' ? 'mvGrid' : 'mvRows'} aria-label="Pictures">
          {shown.map((p) => {
            const faults = faultsOf(p.image);
            return (
              <li key={p.key}>
                <button type="button" className="mvTile" onClick={() => setOpen(p.key)}>
                  <span className="mvThumb">
                    <Thumb item={p} />
                  </span>
                  <span className="mvText">
                    <b>{p.name}</b>
                    <small>
                      {KIND_WORDS[p.kind]} · {p.scenarioId}
                    </small>
                    {view === 'list' && <small>{p.uses.length ? p.uses.join(' · ') : 'Not used by a turn yet'}</small>}
                  </span>
                  <span className="mvTags">
                    {faults.map((f) => (
                      <span key={f.key} className="mvTag">
                        {f.label}
                      </span>
                    ))}
                    {p.kind === 'photo' && <span className="mvTag">{kb(pictureBytes(p.image))}</span>}
                    {!p.uses.length && <span className="mvTag muted">Unused</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mvSum">
        {plural(all.length, 'picture')} in {plural(new Set(all.map((p) => p.scenario)).size, 'scenario')}. They are only ever used to try the agent; customers
        never see them.
      </p>
      {openItem && <Details ctx={ctx} item={openItem} items={shown} onMove={setOpen} onClose={() => setOpen(null)} />}
      {adding && (
        <AddDialog
          ctx={ctx}
          onClose={() => setAdding(false)}
          onAdded={(key) => {
            setAdding(false);
            setOpen(key);
          }}
        />
      )}
    </div>
  );
}
