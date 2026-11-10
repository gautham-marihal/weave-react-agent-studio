import React, { useEffect, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { Input, TextArea } from '../../ui/Input.tsx';
import Select from '../../ui/Select.tsx';
import { IMAGE_FAULTS, IMAGE_NAME, describeImage, freshImageName, sampleImage } from './model.js';
import { isObj } from '../form/engine.js';
import './samplePictures.css';

// A scenario's sample pictures (schema 1.2 `images`, and the scenario-level `camera`): cards drawn from lines of text
// with faults switched on, so a scenario can show what happens to a blurry or dark photo. The card here is a preview
// drawn by the browser; the runner draws the real picture from the same settings. Nothing here is real data.

const COLOURS = { blue: ['#e5ecf7', '#bdcbe3'], green: ['#e3f3ea', '#b9dcc8'], sand: ['#f6eedf', '#e3cfa9'], grey: ['#eceef1', '#c9ced6'] };

// The preview of one sample picture. `small` for the thumbnail beside a turn.
export function SampleCard({ image, small = false }) {
  const pic = isObj(image) ? image : {};
  if (pic.empty || typeof pic.text === 'string' || pic.file || pic.base64 || pic.data_url)
    return (
      <span className={`spCard other ${small ? 'small' : ''}`} aria-hidden="true">
        <Icon name={pic.file || pic.base64 || pic.data_url ? 'image' : 'note'} size={small ? 14 : 22} />
        {!small && <small>{describeImage(pic)}</small>}
      </span>
    );
  const [from, to] = COLOURS[pic.colour] || COLOURS.blue;
  const blur = typeof pic.blur === 'number' ? pic.blur : 0;
  const brightness = typeof pic.brightness === 'number' ? pic.brightness : 1;
  const style = {
    '--sp-from': from,
    '--sp-to': to,
    filter: `${blur ? `blur(${(small ? blur / 4 : blur * 0.6).toFixed(2)}px) ` : ''}brightness(${brightness})`,
    transform: `rotate(${typeof pic.rotate === 'number' ? pic.rotate : 0}deg)${typeof pic.skew === 'number' ? ` skewX(${pic.skew}deg)` : ''}`,
    clipPath: typeof pic.crop === 'number' && pic.crop > 0 ? `inset(0 ${Math.round(pic.crop * 100)}% 0 0 round 8px)` : undefined,
  };
  const lines = (Array.isArray(pic.lines) ? pic.lines : []).slice(0, small ? 0 : 5);
  return (
    <span className={`spCard ${small ? 'small' : ''}`} style={style} aria-hidden="true">
      {!small && <span className="spTitle">{pic.title || ''}</span>}
      <span className="spFace" />
      {!small && (
        <span className="spLines">
          {lines.map((line, i) => {
            const [label, ...rest] = String(line).split(':');
            return rest.length ? (
              <span key={i}>
                <b>{label}</b>
                {rest.join(':').trim()}
              </span>
            ) : (
              <span key={i}>{line}</span>
            );
          })}
        </span>
      )}
      {small && <span className="spMiniLines" />}
      {typeof pic.glare === 'number' && pic.glare > 0 && <span className="spGlare" style={{ opacity: Math.min(1, pic.glare) }} />}
    </span>
  );
}

// a name box that commits when it is valid and not taken, and says why when it isn't
function NameBox({ name, taken, onRename, index }) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const problem = !IMAGE_NAME.test(text)
    ? 'Lowercase letters, digits, - or _, starting with a letter.'
    : text !== name && taken.includes(text)
      ? 'Another picture has this name.'
      : '';
  const commit = () => {
    if (!problem && text !== name) onRename(text);
    else if (problem) setText(name);
  };
  return (
    <label className="spName">
      <span>Name</span>
      <Input
        size="small"
        mono
        value={text}
        aria-label={`Sample picture ${index + 1}: name`}
        aria-invalid={!!problem || undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      {problem && <small className="stFErr">{problem}</small>}
    </label>
  );
}

export default function SamplePictures({ scenario, onChange }) {
  const images = isObj(scenario.images) ? scenario.images : {};
  const names = Object.keys(images);
  // a change to the pictures, carried into the turns and the camera that name them
  const setImages = (next, renamed = null) => {
    const patch = { images: Object.keys(next).length ? next : undefined };
    if (renamed) {
      const [from, to] = renamed;
      patch.turns = (scenario.turns || []).map((t) => (isObj(t) && t.upload === from ? { upload: to } : isObj(t) && t.camera === from ? { camera: to } : t));
      if (scenario.camera === from) patch.camera = to;
    }
    onChange(patch);
  };
  const setImage = (name, image) => setImages({ ...images, [name]: image });
  const rename = (from, to) => setImages(Object.fromEntries(Object.entries(images).map(([k, v]) => [k === from ? to : k, v])), [from, to]);
  const remove = (name) => {
    const { [name]: _gone, ...rest } = images;
    const patch = { images: Object.keys(rest).length ? rest : undefined };
    if (scenario.camera === name) patch.camera = undefined;
    onChange(patch);
  };
  const add = (image, base) => setImages({ ...images, [freshImageName(images, base)]: image });
  const used = (name) => (scenario.turns || []).some((t) => isObj(t) && (t.upload === name || t.camera === name)) || scenario.camera === name;

  return (
    <div className="spList">
      {names.length === 0 && <p className="stMuted">No sample pictures yet. Add one for an upload or camera turn to send.</p>}
      {names.map((name, index) => {
        const image = images[name];
        const drawn = isObj(image) && !image.empty && typeof image.text !== 'string' && !image.file && !image.base64 && !image.data_url;
        const fault = (key) => isObj(image) && image[key] !== undefined && !(key === 'brightness' && image.brightness === 1);
        return (
          <section key={name} className="spItem" aria-label={`Sample picture ${name}`}>
            <div className="spStage">
              <SampleCard image={image} />
            </div>
            <div className="spFields">
              <div className="spRow">
                <NameBox name={name} index={index} taken={names} onRename={(to) => rename(name, to)} />
                <button
                  type="button"
                  className="stIconBtn danger"
                  aria-label={`Delete the sample picture ${name}`}
                  title={used(name) ? 'A turn or the camera uses it: change that too' : 'Delete'}
                  onClick={() => remove(name)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              {drawn ? (
                <>
                  <label>
                    <span>Title on the card</span>
                    <Input size="small" value={image.title || ''} onChange={(event) => setImage(name, { ...image, title: event.target.value || undefined })} />
                  </label>
                  <label>
                    <span>Lines on the card, one per line</span>
                    <TextArea
                      size="small"
                      rows={3}
                      value={(image.lines || []).join('\n')}
                      onChange={(event) => setImage(name, { ...image, lines: event.target.value.split('\n') })}
                    />
                  </label>
                  <div className="spFaults" role="group" aria-label={`Faults of ${name}`}>
                    {IMAGE_FAULTS.map((f) => {
                      const on = fault(f.key);
                      return (
                        <button
                          key={f.key}
                          type="button"
                          className={`spFault ${on ? 'on' : ''}`}
                          aria-pressed={on}
                          title={f.hint}
                          onClick={() => {
                            const { [f.key]: _gone, ...rest } = image;
                            setImage(name, on ? rest : { ...image, [f.key]: f.on });
                          }}
                        >
                          <span className="spSwitch" aria-hidden="true" />
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="stMuted">{describeImage(image)}. Change it with “Edit as JSON”.</p>
              )}
            </div>
          </section>
        );
      })}
      <div className="spAdd">
        <Button type="button" size="compact" onClick={() => add(sampleImage(), 'clear')}>
          <Icon name="plus" size={14} /> Add a sample card
        </Button>
        <Button type="button" size="compact" onClick={() => add({ ...sampleImage(), blur: 4 }, 'blurry')}>
          <Icon name="plus" size={14} /> A blurry one
        </Button>
        <Button type="button" size="compact" onClick={() => add({ text: 'This is not a picture.' }, 'not_a_picture')}>
          <Icon name="plus" size={14} /> A file that isn’t a picture
        </Button>
      </div>
      {names.length > 0 && (
        <label className="spCamera">
          <span>The camera shows from the start</span>
          <Select
            className="stFInput small"
            value={scenario.camera || ''}
            aria-label="The camera shows from the start"
            onChange={(event) => onChange({ camera: event.target.value || undefined })}
          >
            <option value="">Nothing (no camera until a turn shows one)</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
      )}
    </div>
  );
}
