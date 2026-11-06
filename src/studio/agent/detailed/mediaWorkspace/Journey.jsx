import React from 'react';
import Icon from '../../../../ui/Icon.jsx';
import { fieldVar, plural, timeWords, together } from './mediaWords.js';

// The picture at the top of Images & Videos (canvas board M1): one picture's journey, a lane per request (asked, checked
// in code, read by the AI), then where the lanes meet (compared in code, forgotten). Each station opens the step it
// draws; a missing one is a dashed station that adds it. A dot says what really happens: set and run by the server,
// needs a look, or not set.

const HOW = { run: 'set, and run by the server', bad: 'needs a look', off: 'not set' };
const Dot = ({ how }) => <i className={`grDot ${how}`} aria-hidden="true" />;
const speech = (v) => (typeof v === 'string' ? v : typeof v?.message === 'string' ? v.message : '');
const clip = (t, n = 60) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

function Station({ n, title, how, children, sub, onClick, empty, wide, label }) {
  return (
    <button type="button" className={['mdSt', empty && 'empty', how === 'bad' && 'bad', wide && 'wide'].filter(Boolean).join(' ')} onClick={onClick}>
      <span className="mdStHead">
        <Dot how={how} />
        {n} · {title}
      </span>
      <span className="mdStMain">{children}</span>
      {sub && <small>{sub}</small>}
      {/* its name is what it shows, then what a click does (said only to a screen reader) */}
      {label && <span className="srOnly"> ({label})</span>}
    </button>
  );
}

export default function Journey({ m, secret, onStep, onAdd }) {
  const hows = new Set();
  const how = (h) => {
    hows.add(h);
    return h;
  };
  if (!m.lanes.length)
    return (
      <figure className="mdFigure" aria-label="One picture’s journey">
        <div className="mdJr n4">
          <div className="mdLane">
            <span className="mdLaneIcon" aria-hidden="true">
              <Icon name="image" size={15} />
            </span>
            <span>
              <b>A picture</b>
              <small>not asked for yet</small>
            </span>
          </div>
          <Station
            n={1}
            title="Asked"
            how={how('off')}
            empty
            onClick={onAdd}
            sub="Shown on their screen beside the upload button"
            label="Add a step that asks for a picture"
          >
            Ask for a photo or the camera
          </Station>
          <Station n={2} title="Checked in code" how="off" empty onClick={onAdd} sub="Before anything reads it" label="Add a step that asks for a picture">
            Sharp, bright and big enough
          </Station>
          <Station n={3} title="Read by the AI" how="off" empty onClick={onAdd} sub="Each one read, or left empty" label="Add a step that asks for a picture">
            The details you name
          </Station>
          <Station n={4} title="Forgotten" how="off" empty onClick={onAdd} sub="Always at the end of the call" label="Add a step that asks for a picture">
            As soon as it is used
          </Station>
        </div>
        <figcaption className="cxLegend grLegend">
          <span>
            <Dot how="off" />
            {HOW.off}
          </span>
        </figcaption>
      </figure>
    );
  const compare = m.compares[0] || null;
  const forget = m.forgets[0] || null;
  const allGone = m.asked.length > 0 && !m.kept.length;
  return (
    <figure className="mdFigure" aria-label="One picture’s journey">
      <div className="mdJr">
        {m.lanes.map(({ req, read, v, again }) => {
          const step = req.item;
          const q = step.quality || {};
          const fields = read ? read.fields : [];
          const required = read ? (Array.isArray(read.item.required) ? read.item.required : []) : [];
          return (
            <React.Fragment key={req.key}>
              <div className="mdLane">
                <span className="mdLaneIcon" aria-hidden="true">
                  <Icon name={req.kind === 'camera' ? 'camera' : 'image'} size={15} />
                </span>
                <span>
                  <b>{req.kind === 'camera' ? 'The camera' : 'The photo'}</b>
                  <small className="mdMono">{v || 'kept nowhere'}</small>
                </span>
              </div>
              <Station
                n={1}
                title="Asked"
                how={how(req.gap && req.fix?.kind !== 'sharp' ? 'bad' : 'run')}
                onClick={() => onStep(req)}
                sub={
                  req.gap && req.fix?.kind !== 'sharp'
                    ? req.gap
                    : [
                        `Gives up after ${timeWords(typeof step.timeout_s === 'number' ? step.timeout_s : 120)}`,
                        again.length ? `asked again in ${plural(again.length, 'more step')}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                }
                label={`Open ${req.name}`}
              >
                {speech(step.prompt) ? `“${clip(speech(step.prompt))}”` : req.kind === 'camera' ? 'The camera' : 'A photo'}
              </Station>
              <Station
                n={2}
                title="Checked in code"
                how={how(req.fix?.kind === 'sharp' ? 'bad' : req.picky ? 'run' : 'off')}
                onClick={() => onStep(req)}
                sub={
                  req.fix?.kind === 'sharp'
                    ? 'Too lenient for a camera: blurred frames get through'
                    : [
                        typeof q.min_dimension === 'number' && `smallest side ${q.min_dimension} px`,
                        typeof q.min_brightness === 'number' && `brightness ${q.min_brightness} or more`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || (req.picky ? '' : 'A blurred or tiny picture would be read as it is')
                }
                label={`How picky ${req.name} is`}
              >
                {req.picky ? `${req.pickyWord}${typeof q.min_sharpness === 'number' ? `: sharpness ${q.min_sharpness} or more` : ''}` : 'Not checked'}
              </Station>
              {read ? (
                <Station
                  n={3}
                  title="Read by the AI"
                  how={how(read.gap ? 'bad' : 'run')}
                  onClick={() => onStep(read)}
                  sub={read.gap || `${read.more}`}
                  label={`Open ${read.name}`}
                >
                  <span className="mdChips">
                    {fields.slice(0, 6).map((f) => (
                      <span key={f} className="mdChip">
                        {f}
                        {secret(fieldVar(read.item, f)) && <Icon name="lock" size={11} />}
                      </span>
                    ))}
                    {fields.length > 6 && <span className="mdChip quiet">+{fields.length - 6}</span>}
                    {!fields.length && 'No details yet'}
                  </span>
                </Station>
              ) : (
                <Station
                  n={3}
                  title="Read by the AI"
                  how={how('off')}
                  empty
                  onClick={onAdd}
                  sub="Add “Read a picture” to read details from it"
                  label="Add a reading"
                >
                  Not read
                </Station>
              )}
              {required.length > 0 && <span className="srOnly">{plural(required.length, 'detail')} must be read</span>}
            </React.Fragment>
          );
        })}
        <div className="mdLane">
          <span className="mdLaneIcon" aria-hidden="true">
            <Icon name="compare" size={15} />
          </span>
          <span>
            <b>{m.lanes.length > 1 ? 'Both' : 'Then'}</b>
            <small>in code</small>
          </span>
        </div>
        {compare ? (
          <Station
            n={4}
            title="Compared in code"
            how={how(compare.gap ? 'bad' : 'run')}
            wide
            onClick={() => onStep(compare)}
            sub={compare.gap || compare.more}
            label={`Open ${compare.name}`}
          >
            {compare.words}
            {m.compares.length > 1 ? ` · and ${plural(m.compares.length - 1, 'more comparison')}` : ''}
          </Station>
        ) : (
          <Station
            n={4}
            title="Compared in code"
            how={how('off')}
            empty
            wide
            onClick={onAdd}
            sub="Pairs of values, the way a person would: only needed to match two things"
            label="Add a comparison"
          >
            Not compared
          </Station>
        )}
        <Station
          n={5}
          title="Forgotten"
          how={how(m.kept.length ? 'bad' : 'run')}
          onClick={() => (forget ? onStep(forget) : onAdd())}
          sub={m.kept.length ? 'Still forgotten when the call ends' : 'As soon as they are used, pass or fail'}
          label={forget ? `Open ${forget.name}` : 'Add a step that forgets pictures'}
        >
          {m.kept.length
            ? `${together(m.kept)} never forgotten by a step`
            : allGone
              ? m.asked.length > 1
                ? 'Every picture'
                : 'The picture'
              : 'Nothing to forget'}
        </Station>
      </div>
      <figcaption className="cxLegend grLegend">
        {['run', 'bad', 'off']
          .filter((h) => hows.has(h))
          .map((h) => (
            <span key={h}>
              <Dot how={h} />
              {HOW[h]}
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
