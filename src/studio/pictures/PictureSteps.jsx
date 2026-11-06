import React, { useId, useRef } from 'react';
import { useForm, OwnerCtx } from '../form/ctx.js';
import { ObjectBody } from '../form/Node.jsx';
import { isObj } from '../form/engine.js';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { DEMO_GRADE, MARKS, SCALE_WORDS, SUGGESTED_SHARPNESS, channelGap, fromScale, sharpnessAdvice, toScale, withInput } from './pictureSteps.js';
import { STRICTNESS_WORDS, strictnessOf, withStrictness } from './strictness.js';
import './pictureSteps.css';

export { PICTURE_STEPS } from './pictureSteps.js';

// The four picture steps in Build (schema 1.2), wherever a list of steps is edited (EffectsEditor's ActionSteps): "Ask for
// a picture" with its own controls (upload or camera, the sharpness standard on a scale that says what the numbers mean,
// and whether a channel can take it at all), and the others as their settings in their own words (plainLanguage.js
// STEP_WORDS), with the honest note that a model reading a photo is not an identity check.

function KindTiles({ value, onChange, disabled, labelId }) {
  const refs = useRef([]);
  const options = [
    { value: 'upload', icon: 'image', title: 'Upload a photo', hint: 'From their device' },
    { value: 'camera', icon: 'camera', title: 'Show the camera', hint: 'The agent takes the frame' },
  ];
  const pick = (index) => {
    onChange(options[index].value);
    refs.current[index]?.focus();
  };
  return (
    <div className="psTiles" role="radiogroup" aria-labelledby={labelId}>
      {options.map((option, index) => {
        const on = (value || 'upload') === option.value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`psTile ${on ? 'on' : ''}`}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
                event.preventDefault();
                pick(index === 0 ? 1 : 0);
              }
            }}
          >
            <span className="psTileIcon" aria-hidden="true">
              <Icon name={option.icon} size={18} />
            </span>
            <span>
              <b>{option.title}</b>
              <small>{option.hint}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SharpnessScale({ kind, quality, onChange, disabled }) {
  const id = useId();
  const value = quality?.min_sharpness;
  const set = (next) => onChange(next === undefined ? omitKey(quality, 'min_sharpness') : { ...(isObj(quality) ? quality : {}), min_sharpness: next });
  if (typeof value !== 'number')
    return (
      <div className="psScaleOff">
        <span>Sharpness isn’t checked: a blurred photo would be read as it is.</span>
        {!disabled && (
          <Button type="button" size="compact" onClick={() => set(SUGGESTED_SHARPNESS[kind] || 8)}>
            Check sharpness
          </Button>
        )}
      </div>
    );
  const advice = sharpnessAdvice(kind, value);
  return (
    <div className="psScale">
      <div className="psScaleTop">
        <label htmlFor={`${id}-n`}>Sharp enough</label>
        <input
          id={`${id}-n`}
          className="stFInput psScaleNum"
          type="number"
          min={0}
          step="any"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (event.target.value !== '' && Number.isFinite(n) && n >= 0) set(n);
          }}
        />
      </div>
      <input
        type="range"
        className="psRange"
        min={0}
        max={1000}
        step={1}
        value={toScale(value)}
        disabled={disabled}
        aria-label="Least sharpness"
        aria-valuetext={`${value}`}
        onChange={(event) => set(fromScale(Number(event.target.value)))}
      />
      <div className="psMarks" aria-hidden="true">
        {MARKS.map((v) => (
          <span key={v} className="psMark" style={{ left: `${toScale(v) / 10}%` }}>
            {v}
          </span>
        ))}
      </div>
      <small className="psScaleWords">{SCALE_WORDS}</small>
      <p className={`psAdvice ${advice.tone}`} role="status">
        <Icon name={advice.tone === 'warn' ? 'alert' : 'check'} size={14} />
        <span>{advice.text}</span>
        {advice.tone === 'warn' && kind === 'camera' && value < 15 && !disabled && (
          <button type="button" className="stLink" onClick={() => set(SUGGESTED_SHARPNESS.camera)}>
            Use 25
          </button>
        )}
      </p>
      {!disabled && (
        <button type="button" className="stLink psScaleClear" onClick={() => set(undefined)}>
          Don’t check sharpness
        </button>
      )}
    </div>
  );
}

// Relaxed · Standard · Strict: the picture standard's numbers in three words ("Your own numbers" when they are set by hand)
export function StrictnessPick({ kind, quality, onChange, disabled, labelId }) {
  const now = strictnessOf(kind, quality);
  const chosen = STRICTNESS_WORDS.find((w) => w.value === now);
  return (
    <div className="psStrict">
      <div className="psPills" role="radiogroup" aria-labelledby={labelId}>
        {STRICTNESS_WORDS.map((w) => (
          <button
            key={w.value}
            type="button"
            role="radio"
            aria-checked={now === w.value}
            className={now === w.value ? 'on' : ''}
            disabled={disabled}
            onClick={() => onChange(withStrictness(kind, quality, w.value))}
          >
            {w.label}
          </button>
        ))}
      </div>
      <small className="psStrictWords">
        {chosen
          ? chosen.hint
          : now === 'custom'
            ? 'Your own numbers (below). Pick a word to use one of the presets instead.'
            : 'Not checked: a blurred or tiny photo would be read as it is.'}
      </small>
    </div>
  );
}

// The request as the customer meets it: the instruction beside an upload button or a camera view, and the time they have
export function CustomerPreview({ kind, prompt, timeout }) {
  const time = typeof timeout === 'number' && timeout > 0 ? (timeout >= 60 && timeout % 60 === 0 ? `${timeout / 60} min` : `${timeout} s`) : '';
  return (
    <div className="psPreview" aria-label="Preview of what the customer sees">
      <div className="psPreviewHead">
        <Icon name={kind === 'camera' ? 'camera' : 'image'} size={15} />
        <b>{prompt || (kind === 'camera' ? 'Show your card to the camera' : 'Upload a photo')}</b>
        {time && <span className="psPreviewTime">{time} to send it</span>}
      </div>
      {kind === 'camera' ? (
        <div className="psPreviewCam" aria-hidden="true">
          <Icon name="camera" size={22} />
          <span>Their camera shows here, large enough for a face and a card. A short countdown comes first, and “Take a picture” if it doesn’t catch one.</span>
        </div>
      ) : (
        <div className="psPreviewDrop" aria-hidden="true">
          <Icon name="upload" size={18} />
          <span>Drop a photo or choose one · JPEG, PNG or WEBP</span>
        </div>
      )}
      <small className="psPreviewNote">Preview only. Try it for real on Test, where the request appears in the conversation.</small>
    </div>
  );
}

const omitKey = (obj, key) => {
  if (!isObj(obj)) return undefined;
  const { [key]: _gone, ...rest } = obj;
  return Object.keys(rest).length ? rest : undefined;
};

// "Ask for a picture"
function AskForPicture({ shape, value, path, onChange, disabled }) {
  const ctx = useForm();
  const labelId = useId();
  const action = isObj(value) ? value : {};
  const kind = action.kind === 'camera' ? 'camera' : 'upload';
  const set = (key, next) => onChange(next === undefined ? omitKey(action, key) || { type: action.type } : { ...action, [key]: next });
  const gap = channelGap(ctx.store.get(), kind);
  const qualityShape = ctx.engine.flatten(shape.properties.quality);
  const fix = () =>
    ctx.applyConfig(
      withInput(ctx.store.get(), gap.want),
      `Web channels now take ${gap.want === 'video' ? 'the camera' : 'photos'}, and the language model is marked as reading pictures: check that the one you chose can`,
    );
  return (
    <div className="psAsk">
      <div className="psRow">
        <div className="psLabel">
          <b id={labelId}>What they do</b>
          <small>Pick one</small>
        </div>
        <KindTiles value={kind} onChange={(next) => set('kind', next)} disabled={disabled} labelId={labelId} />
      </div>
      {gap && (
        <p className="psGap" role="note">
          <Icon name="alert" size={15} />
          <span>
            {gap.none
              ? 'This agent has no web chat or web voice channel, and a phone call carries no pictures, so this step can’t run yet.'
              : `None of this agent’s web channels takes ${gap.want === 'video' ? 'video, so the camera can’t be asked for' : 'pictures, so a photo can’t be sent'} yet.`}
          </span>
          {!gap.none && !disabled && (
            <Button type="button" size="compact" onClick={fix}>
              {gap.want === 'video' ? 'Let them show the camera' : 'Let them send photos'}
            </Button>
          )}
        </p>
      )}
      <OwnerCtx.Provider value="request_image">
        <ObjectBody shape={shape} value={action} path={path} onChange={onChange} disabled={disabled} onlyKeys={['prompt', 'into', 'timeout_s']} />
      </OwnerCtx.Provider>
      <div className="psRow">
        <div className="psLabel">
          <b id={`${labelId}-strict`}>How picky the photo check is</b>
          <small>Checked in code before the model ever sees it. A picture that falls short is turned down and asked for again.</small>
        </div>
        <div className="psStandard">
          <StrictnessPick kind={kind} quality={action.quality} onChange={(next) => set('quality', next)} disabled={disabled} labelId={`${labelId}-strict`} />
          <details className="psExact">
            <summary>The exact numbers</summary>
            <SharpnessScale kind={kind} quality={action.quality} onChange={(next) => set('quality', next)} disabled={disabled} />
            {qualityShape && (
              <OwnerCtx.Provider value="quality">
                <ObjectBody
                  shape={qualityShape}
                  value={isObj(action.quality) ? action.quality : {}}
                  path={[...path, 'quality']}
                  onChange={(next) => set('quality', isObj(next) && Object.keys(next).length ? next : undefined)}
                  disabled={disabled}
                  onlyKeys={['min_brightness', 'max_brightness', 'min_dimension']}
                />
              </OwnerCtx.Provider>
            )}
          </details>
        </div>
      </div>
      <div className="psRow">
        <div className="psLabel">
          <b>What the customer sees</b>
          <small>A preview of the request on their screen. The agent says its own words in the conversation.</small>
        </div>
        <CustomerPreview kind={kind} prompt={action.prompt} timeout={action.timeout_s} />
      </div>
      <OwnerCtx.Provider value="request_image">
        <ObjectBody shape={shape} value={action} path={path} onChange={onChange} disabled={disabled} onlyKeys={['on_timeout']} />
      </OwnerCtx.Provider>
    </div>
  );
}

// The body of a picture step, under its head in the list of steps.
export default function PictureStep({ shape, value, path, onChange, disabled }) {
  const type = isObj(value) ? value.type : '';
  const keysOf = (skip) => Object.keys(shape.properties || {}).filter((k) => !skip.includes(k));
  if (type === 'request_image') return <AskForPicture shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} />;
  return (
    <div className="psStep">
      {type === 'analyze_image' && (
        <p className="psHonest" role="note">
          <span className="psHonestIcon" aria-hidden="true">
            <Icon name="read" size={16} />
          </span>
          <span>
            <b>A demo-grade check, not identity verification</b>
            {DEMO_GRADE}
          </span>
        </p>
      )}
      <OwnerCtx.Provider value={type}>
        <ObjectBody shape={shape} value={value} path={path} onChange={onChange} disabled={disabled} onlyKeys={keysOf(['type', 'when'])} />
      </OwnerCtx.Provider>
    </div>
  );
}
