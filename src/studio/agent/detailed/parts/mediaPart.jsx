import React, { useState } from 'react';
import MediaLibrary from './MediaLibrary.jsx';
import LiveCamera from './LiveCamera.jsx';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import Select from '../../../../ui/Select.tsx';
import { Switch } from '../../../form/fields.jsx';
import { channelName } from '../../../simple/simpleModel.js';
import { DEMO_GRADE } from '../../../pictures/pictureSteps.js';
import { STRICTNESS_WORDS, strictnessOf } from '../../../pictures/strictness.js';
import {
  addPictureRequest,
  addTargets,
  aiSeesPictures,
  channelPictures,
  forgetting,
  pictureCounts,
  pictureGroups,
  pictureLibrary,
  setAllStrictness,
  setChannelInput,
  sharedStrictness,
} from '../../../pictures/mediaModel.js';
import { navigate, replaceRoute, routeHref, useRoute } from '../../../route.js';
import { locate } from '../../pages.js';
import { StepCard } from '../StepsView.jsx';
import { joinAnd, plural } from '../describe.js';
import '../../../pictures/pictureSteps.css';

// 7 · Images & Videos: everything about photos and the camera in one place. Which channels can take them and whether
// the AI can see them; every picture step the agent has, wherever it sits, each editable here; how picky the photo
// checks are, for all of them at once; whether the pictures are forgotten; and what such a check can and cannot do.
// Nothing new is stored: each control writes the channels' inputs and the steps' own settings.

// a link to the page that holds a place in the draft
function useGo() {
  const route = useRoute();
  return (page, params) => navigate(routeHref(route.botId, page, params), { guard: false });
}

// Where people can send them: each channel, its photo and camera switches, and whether the AI can see pictures
function Reach({ ctx }) {
  const go = useGo();
  const channels = channelPictures(ctx.config);
  const ai = aiSeesPictures(ctx.config);
  const anyOn = channels.some((c) => c.photo || c.camera);
  return (
    <div className="mdReach">
      {channels.length === 0 && <p className="dtNote">No channels yet. Add one on Channels first.</p>}
      {channels.length > 0 && (
        <ul className="mdChannels" aria-label="Channels">
          {channels.map((c) => {
            const name = `${channelName(c.channel?.type)}${c.channel?.id ? ` (${c.channel.id})` : ''}`;
            return (
              <li key={c.index} className={c.on ? '' : 'off'}>
                <span className="dtIIcon" aria-hidden="true">
                  <Icon name={c.web ? 'globe' : 'phone'} size={16} />
                </span>
                <span className="mdChName">
                  <b>{name}</b>
                  {!c.on && <small>switched off</small>}
                </span>
                {c.web ? (
                  <>
                    <span className="mdSw">
                      <Switch
                        id={`md-photo-${c.index}`}
                        checked={c.photo}
                        label={`${name}: customers can send photos`}
                        onChange={(on) => ctx.set(setChannelInput(ctx.config, c.index, 'image', on))}
                      />
                      <label htmlFor={`md-photo-${c.index}`}>Photos</label>
                    </span>
                    <span className="mdSw">
                      <Switch
                        id={`md-camera-${c.index}`}
                        checked={c.camera}
                        label={`${name}: customers can turn on their camera`}
                        onChange={(on) => ctx.set(setChannelInput(ctx.config, c.index, 'video', on))}
                      />
                      <label htmlFor={`md-camera-${c.index}`}>Camera</label>
                    </span>
                  </>
                ) : (
                  <span className="mdVoice">Voice only: a phone call carries no pictures</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className={`mdAi ${ai.sees ? 'good' : anyOn ? 'bad' : ''}`}>
        <Icon name={ai.sees ? 'check' : 'info'} size={14} />
        <span>
          {ai.sees
            ? 'The AI can see pictures.'
            : anyOn
              ? 'A channel takes pictures, but the AI isn’t marked as seeing them, so the server will refuse the agent.'
              : 'The AI is marked as seeing pictures as soon as a channel takes them.'}{' '}
          <button type="button" className="stLink" onClick={() => go('agent', { focus: 'vision' })}>
            AI models on Agent
          </button>
        </span>
      </p>
    </div>
  );
}

// Where it asks for them: every picture step by the list it is in, each opening its editor here
function Requests({ ctx }) {
  const go = useGo();
  const groups = pictureGroups(ctx.config);
  const targets = addTargets(ctx.config);
  const [open, setOpen] = useState(null);
  const [target, setTarget] = useState('');
  const add = (kind) => {
    const chosen = targets.find((t) => t.value === (target || targets[0]?.value));
    if (!chosen) return;
    const made = addPictureRequest(ctx.config, chosen.path, kind);
    ctx.set(made.config);
    setOpen(made.path.join('.'));
  };
  const counts = pictureCounts(ctx.config);
  const sum = [
    counts.photo && plural(counts.photo, 'photo request'),
    counts.video && plural(counts.video, 'video check'),
    counts.read && plural(counts.read, 'picture reading', 'picture readings'),
    counts.compare && plural(counts.compare, 'comparison'),
    counts.forget && plural(counts.forget, 'step that forgets pictures', 'steps that forget pictures'),
  ].filter(Boolean);
  return (
    <div className="mdRequests">
      {groups.length === 0 ? (
        <div className="dtIEmpty">
          <span className="dtIEmptyIcon" aria-hidden="true">
            <Icon name="image" size={20} />
          </span>
          <div>
            <strong>It doesn’t ask for pictures yet</strong>
            <p>Add a photo request or a video check to a form’s steps: the customer is asked on screen, and the picture is checked before anything reads it.</p>
          </div>
        </div>
      ) : (
        <p className="svSum">
          <b>{sum.length ? joinAnd(sum) : 'Picture steps'}</b>
        </p>
      )}
      {groups.map((group) => {
        const place = locate(group.list);
        const formIndex = group.list[0] === 'forms' ? group.list[1] : null;
        const formId = formIndex !== null ? ctx.config.forms?.[formIndex]?.id : null;
        return (
          <section key={group.key} className="mdGroup" aria-label={group.name}>
            <header className="mdGroupHead">
              <h3>{group.name}</h3>
              <button type="button" className="stLink" onClick={() => go(place.page, formId ? { item: `forms:${formId}` } : undefined)}>
                See all its steps
              </button>
            </header>
            <ol className="svList">
              {group.steps.map((hit) => {
                const key = hit.path.join('.');
                return (
                  <StepCard
                    key={key}
                    step={hit.step}
                    number={hit.index + 1}
                    path={hit.path}
                    ctx={ctx}
                    open={open === key}
                    onToggle={() => setOpen(open === key ? null : key)}
                  />
                );
              })}
            </ol>
          </section>
        );
      })}
      {targets.length > 0 ? (
        <div className="mdAdd">
          <label htmlFor="md-add-to">Add to</label>
          <Select id="md-add-to" className="stFInput" value={target || targets[0].value} onChange={(event) => setTarget(event.target.value)}>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" size="small" className="dtAddBtn" onClick={() => add('upload')}>
            <Icon name="image" size={14} />
            Add a photo request
          </Button>
          <Button type="button" variant="secondary" size="small" className="dtAddBtn" onClick={() => add('camera')}>
            <Icon name="camera" size={14} />
            Add a video check
          </Button>
        </div>
      ) : (
        <p className="dtNote">
          Pictures are asked for in a form’s steps. Add a form on Connections first.{' '}
          <button type="button" className="stLink" onClick={() => go('connections', { item: 'forms:' })}>
            Go to forms
          </button>
        </p>
      )}
    </div>
  );
}

// How picky: one choice for every photo upload, one for every camera check
function Standards({ ctx }) {
  const counts = pictureCounts(ctx.config);
  const row = (kind, label, n) => {
    const now = sharedStrictness(ctx.config, kind, strictnessOf);
    const id = `md-strict-${kind}`;
    return (
      <div className="dtRow" key={kind}>
        <div className="dtLabel">
          <label id={id}>{label}</label>
          <small>
            {n
              ? `${plural(n, kind === 'camera' ? 'video check' : 'photo request')}. ${now === '' ? 'They differ now; a choice here sets them all.' : 'A choice here sets them all.'}`
              : `None yet.`}
          </small>
        </div>
        <div className="dtControl">
          <div className="dtPills" role="radiogroup" aria-labelledby={id}>
            {STRICTNESS_WORDS.map((w) => (
              <button
                key={w.value}
                type="button"
                role="radio"
                aria-checked={now === w.value}
                className={now === w.value ? 'on' : ''}
                disabled={!n}
                onClick={() => ctx.set(setAllStrictness(ctx.config, kind, w.value))}
              >
                {w.label}
              </button>
            ))}
          </div>
          <small className="dtNote">
            {STRICTNESS_WORDS.find((w) => w.value === now)?.hint || (now === 'custom' ? 'Their own numbers, set on each step.' : '')}
          </small>
        </div>
      </div>
    );
  };
  return (
    <>
      {row('upload', 'Photo uploads', counts.photo)}
      {row('camera', 'Video checks', counts.video)}
    </>
  );
}

// Privacy: whether every picture asked for is forgotten by a step, and what the server never does with them
function Privacy({ ctx }) {
  const go = useGo();
  const { asked, forgotten } = forgetting(ctx.config);
  const kept = asked.filter((v) => !forgotten.includes(v));
  return (
    <div className="mdPrivacy">
      <p className={`mdAi ${kept.length ? 'bad' : asked.length ? 'good' : ''}`}>
        <Icon name={kept.length ? 'alert' : 'check'} size={14} />
        <span>
          {!asked.length
            ? 'Nothing to forget yet: it doesn’t ask for pictures.'
            : kept.length
              ? `${joinAnd(kept)} ${kept.length === 1 ? 'is' : 'are'} never forgotten by a step. Add a “Forget pictures” step after the check.`
              : `Every picture is forgotten by a step after the check (${joinAnd(forgotten)}).`}
        </span>
      </p>
      <p className="mdAi">
        <Icon name="lock" size={14} />
        <span>
          Pictures stay in the call’s memory only: the server never logs, saves or sends them anywhere. Only a step that reads one passes it to the AI.
        </span>
      </p>
      <p className="mdAi">
        <Icon name="shield" size={14} />
        <span>
          Hiding personal details in saved conversations is set on{' '}
          <button type="button" className="stLink" onClick={() => go('aftercall')}>
            After the call
          </button>
          .
        </span>
      </p>
    </div>
  );
}

function Honest() {
  return (
    <p className="psHonest" role="note">
      <span className="psHonestIcon" aria-hidden="true">
        <Icon name="read" size={16} />
      </span>
      <span>
        <b>A demo-grade check, not identity verification</b>
        {DEMO_GRADE}
      </span>
    </p>
  );
}

function TryIt() {
  const go = useGo();
  return (
    <div className="mdTry">
      <p className="dtNote">
        On Test, talk to it and answer its requests with your own photos or camera. The simulation measures each picture the way the server does.
      </p>
      <Button type="button" variant="secondary" size="small" onClick={() => go('tests')}>
        <Icon name="test" size={14} />
        Try it on Test
      </Button>
    </div>
  );
}

// A section of a tab: its title, a line on what it is for, and its contents
function Block({ id, title, lead, children }) {
  return (
    <section className="dtCard mvBlock" aria-labelledby={`md-${id}`}>
      <header className="dtCardHead">
        <h2 id={`md-${id}`}>{title}</h2>
      </header>
      {lead && <p className="dtLead">{lead}</p>}
      {children}
    </section>
  );
}

// the views of the workspace; the chosen one is kept in the address (?view=), so a link or a reload opens it again
const VIEWS = [
  { id: 'library', label: 'Library', icon: 'grid' },
  { id: 'requests', label: 'What it asks for', icon: 'list' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];

function MediaWorkspace({ ctx }) {
  const route = useRoute();
  const asked = VIEWS.some((v) => v.id === route.params?.view) ? route.params.view : 'library';
  const [view, setView] = useState(asked);
  const choose = (id) => {
    setView(id);
    replaceRoute(routeHref(route.botId, route.tab, { ...route.params, view: id }));
  };
  const counts = pictureCounts(ctx.config);
  const pictures = pictureLibrary(ctx.config).length;
  const badge = { library: pictures, requests: counts.photo + counts.video + counts.read + counts.compare + counts.forget, camera: counts.video };
  return (
    <div className="mvWork">
      <div className="mvTabs" role="tablist" aria-label="Images & Videos">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            id={`mv-tab-${v.id}`}
            aria-selected={view === v.id}
            aria-controls={`mv-panel-${v.id}`}
            className={view === v.id ? 'on' : ''}
            onClick={() => choose(v.id)}
          >
            <Icon name={v.icon} size={15} />
            {v.label}
            {badge[v.id] > 0 && <span className="mvCount">{badge[v.id]}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`mv-panel-${view}`} aria-labelledby={`mv-tab-${view}`} className="mvPanel">
        {view === 'library' && (
          <Block
            id="library"
            title="Pictures to try it with"
            lead="The photos and sample cards your test scenarios send, as a customer would. Open one to see it large, measure it, change it or replace it."
          >
            <MediaLibrary ctx={ctx} />
          </Block>
        )}
        {view === 'requests' && (
          <>
            <Block
              id="requests"
              title="What it asks customers for"
              lead="Every photo request, video check, picture reading and comparison, wherever it is. Open one to change it here."
            >
              <Requests ctx={ctx} />
            </Block>
            <Block
              id="standard"
              title="How picky the checks are"
              lead="Checked in code before anything reads the picture. A picture that falls short is turned down and asked for again."
            >
              <Standards ctx={ctx} />
            </Block>
          </>
        )}
        {view === 'camera' && (
          <Block
            id="camera"
            title="The camera, as a video check sees it"
            lead="Your own camera, live, with the numbers the server measures on each frame. Nothing is recorded or sent."
          >
            <LiveCamera ctx={ctx} />
          </Block>
        )}
        {view === 'settings' && (
          <>
            <Block id="reach" title="Where people can send them" lead="Photos and the camera work in chat and talk on your website.">
              <Reach ctx={ctx} />
            </Block>
            <Block id="privacy" title="Privacy">
              <Privacy ctx={ctx} />
            </Block>
            <Block id="honest" title="What a picture check can do">
              <Honest />
            </Block>
            <Block id="try" title="Try it">
              <TryIt />
            </Block>
          </>
        )}
      </div>
    </div>
  );
}

export const mediaPart = {
  id: 'media',
  num: '7',
  title: 'Images & Videos',
  question: 'The pictures you try it with, the photos and video checks it asks customers for, how picky those checks are, and what happens to the pictures.',
  cols: [],
  top: (ctx) => <MediaWorkspace ctx={ctx} />,
};
