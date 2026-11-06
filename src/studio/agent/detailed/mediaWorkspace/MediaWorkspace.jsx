import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { replaceRoute, routeHref, useRoute } from '../../../route.js';
import { withInput, DEMO_GRADE } from '../../../pictures/pictureSteps.js';
import { pictureLibrary } from '../../../pictures/mediaModel.js';
import { locate } from '../../pages.js';
import { setPath } from '../schemaFacts.js';
import { hiddenWords, hidesOf } from '../afterCallWorkspace/afterCallWords.js';
import { AllSettings, Line, Popover, Rows, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import Journey from './Journey.jsx';
import StepPage from './StepPage.jsx';
import { AddPictureStep } from './pictureEditors.jsx';
import { ITEM_ROWS, LINES, PAGES, TOKENS, TOOL_PAGES } from './mediaLayout.js';
import { LIST_OF, fieldVar, mediaIn, plural, stepKey, summaryLine, together, wayWords } from './mediaWords.js';
import { forgetKept, markSeeing } from './pictureRecipes.js';
import './mediaWorkspace.css';

// Build › Images & Videos as one picture's journey (design: canvas page "11 · Images & Videos, redesigned"), for any
// agent. A sentence says which ways in take photos and the camera, what it asks for and where, what it reads and with
// which model, what it compares, what it forgets and how picky the checks are; what is not set is a grey blank after
// "Not yet:". Under it, the journey: a lane per request, meeting where they are compared and forgotten. Then three
// chapters: where pictures come in (each way in and each agent's way of seeing open in place), what it asks for and how
// it checks (each step on a page of its own, StepPage), privacy, honesty and trying it (the pictures to try with and
// your camera, live, each on a page). All settings: every setting, searchable. Every view edits with the part's own rows
// (mediaForm).

const VIEWS = makeViewStore('weave_media_view', 'overview');
// many picture steps get filters by what they do
const MANY = 8;
const FILTERS = [
  { id: 'all', name: 'All', test: () => true },
  { id: 'ask', name: 'Asking', test: (x) => x.type === 'request_image' },
  { id: 'read', name: 'Reading', test: (x) => x.type === 'analyze_image' },
  { id: 'compare', name: 'Comparing', test: (x) => x.type === 'compare_values' },
  { id: 'forget', name: 'Forgetting', test: (x) => x.type === 'discard_image' },
  { id: 'bad', name: 'Needs a look', test: (x) => !!x.gap },
];
const FIRST = ['overview', 'Its pictures'];
const LABEL = 'How to see its pictures';

const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
function joined(nodes, last = 'and') {
  return nodes.map((node, i) => (
    <React.Fragment key={i}>
      {i > 0 && (i === nodes.length - 1 ? ` ${last} ` : ', ')}
      {node}
    </React.Fragment>
  ));
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// an item's rows: the card's rows for that item ({ id: row })
const itemRows = (ctx, card, listId, entry) => {
  const here = { ...ctx, chosen: (id) => (id === listId ? entry : ctx.chosen(id)) };
  return Object.fromEntries([...card.rowsFor(here), ...(card.advFor ? card.advFor(here) : [])].map((row) => [row.id, row]));
};

function ToolPage({ ctx, rows, id, title, sub, onBack }) {
  return (
    <div className="cxPage">
      <div className="tlPageBar">
        <button type="button" className="tlBack" onClick={onBack}>
          <Icon name="arrowLeft" size={14} />
          Back to <b>its pictures</b>
        </button>
      </div>
      <header className="tlPageHead">
        <span className="tlPageIcon" aria-hidden="true">
          <Icon name={id === 'camera.live' ? 'camera' : 'image'} size={20} />
        </span>
        <div className="tlPageName">
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
      </header>
      <section className="tlSection">
        <Rows ids={[id]} rows={rows} ctx={ctx} partId="media" />
      </section>
    </div>
  );
}

function Overview({ ctx, form, view }) {
  const route = useRoute();
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const [only, setOnly] = useState('all');
  const close = useCallback(() => setOpen(null), []);
  const rows = useMemo(() => rowsOf(form), [form]);
  const cards = useMemo(() => Object.fromEntries(form.cols.flat().map((c) => [c.id, c])), [form]);
  const config = ctx.config;
  const unsupported = ctx.editor?.report?.unsupported;
  const m = mediaIn(config, unsupported);
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const vars = isObj(config?.state?.variables) ? config.state.variables : {};
  const secret = (v) => vars[v]?.sensitive === true;
  const goPart = (id, params) => ctx.goPart?.(id, params);

  // a step or a tool open on its own page: from the address (?item=list:key), so a link or a reload opens it
  const itemParam = String(route.params?.item || '');
  const fromParam = (param) => {
    const [l, ...key] = param.split(':');
    return (PAGES[l] || TOOL_PAGES[l]) && key.length ? { list: l, key: key.join(':') } : null;
  };
  const [item, setItem] = useState(() => fromParam(itemParam));
  const [seen, setSeen] = useState(itemParam);
  if (itemParam !== seen) {
    setSeen(itemParam);
    setItem(fromParam(itemParam));
  }
  const openItem = (l, key) => {
    setOpen(null);
    if (PAGES[l]) ctx.choose(l, key);
    else if (route.view === 'bot') replaceRoute(routeHref(route.botId, route.tab, { ...route.params, item: `${l}:${key}` }));
    setItem({ list: l, key });
    requestAnimationFrame(() => reveal(document.querySelector('.cxPage')));
  };
  const back = () => {
    setItem(null);
    if (route.view === 'bot') replaceRoute(routeHref(route.botId, route.tab, { ...route.params, item: undefined }));
  };
  const openToken = (k) => {
    setOpen({ token: k });
    reveal(hero.current);
  };
  const openStep = (s) => openItem(s.list, s.key);
  // a step just added opens on its page (the draft holds it by the next draw)
  const added = (path, type) => openItem(LIST_OF[type] || 'requests', stepKey(path));
  const fix = (s) => {
    if (s.fix?.kind === 'input') ctx.set(withInput(config, s.fix.want));
    else if (s.fix?.kind === 'sharp') ctx.set(setPath(config, [...s.path, 'quality', 'min_sharpness'], 25));
    else openStep(s);
  };

  if (item)
    return (
      <section className="dtPart apWrap grWrap mdWrap" data-part="media" aria-label="Images & Videos">
        {PAGES[item.list] ? (
          <StepPage ctx={ctx} form={form} listId={item.list} itemKey={item.key} onBack={back} onOpen={openItem} />
        ) : item.list === 'library' ? (
          <ToolPage
            ctx={ctx}
            rows={rows}
            id={TOOL_PAGES.library}
            title="Pictures to try it with"
            sub="The photos and sample cards your test conversations send, as a customer would"
            onBack={back}
          />
        ) : (
          <ToolPage
            ctx={ctx}
            rows={rows}
            id={TOOL_PAGES.camera}
            title="Your camera, live"
            sub="What a camera check measures, on your own camera. Nothing is recorded or sent"
            onBack={back}
          />
        )}
      </section>
    );

  const tok = (k, words, blank = false) => (
    <button
      key={`${k}:${words}`}
      type="button"
      ref={(el) => {
        anchors.current[k] = el;
      }}
      className={['apTok', blank && 'blank optional', open?.token === k && 'on'].filter(Boolean).join(' ')}
      aria-expanded={open?.token === k}
      aria-haspopup="dialog"
      onClick={() => (open?.token === k ? close() : openToken(k))}
    >
      {blank ? TOKENS[k].blank : words}
      <span className="srOnly"> ({TOKENS[k].title}: change)</span>
    </button>
  );
  // a part of the sentence that opens a step's own page
  const stepTok = (s, words) => (
    <button key={`${s.key}:${words}`} type="button" className="apTok" onClick={() => openStep(s)}>
      {words}
      <span className="srOnly"> ({s.name}: open)</span>
    </button>
  );
  const s = { open, setOpen, openToken, close, rows, ctx, filled: {}, anchors, tokens: TOKENS, partId: 'media' };

  // ---- the sentence
  const photoWays = m.takes.filter((w) => w.photo);
  const camWays = m.takes.filter((w) => w.camera);
  const takesWords = [photoWays.length && 'photos', camWays.length && 'the camera'].filter(Boolean);
  const wayNames = [...new Set(m.takes.map((w) => w.name))];
  const first = m.takes.length ? (
    <>
      {name} takes {joined(takesWords.map((w) => tok('reach', w)))} on {joined(wayNames.map((w) => tok('reach', w)))}.
    </>
  ) : m.ways.some((w) => w.web) ? (
    <>{name} doesn’t take pictures yet.</>
  ) : m.ways.length ? (
    <>
      {name} can’t take pictures: its ways in are {together(m.ways.map((w) => w.name))}, and a phone call carries none.
    </>
  ) : (
    <>{name} has no way in yet.</>
  );
  // a request per picture (one asked again joins its picture), and every request for how picky they are
  const reqs = m.lanes.map((l) => l.req);
  const allReqs = m.steps.filter((x) => x.type === 'request_image');
  const reads = m.steps.filter((x) => x.type === 'analyze_image');
  const places = [...new Set(m.steps.map((x) => x.group.name.replace(/ · .*$/, '')))];
  const counts = [...new Set(reads.map((r) => r.fields.length))];
  const models = [...new Set(reads.map((r) => r.item.model?.model || ''))];
  const photos = reqs.filter((r) => r.kind !== 'camera');
  const cams = reqs.filter((r) => r.kind === 'camera');
  const second = [];
  if (reqs.length) {
    const asks = [
      photos.length && stepTok(photos[0], photos.length === 1 ? 'a photo' : `${photos.length} photos`),
      cams.length && stepTok(cams[0], cams.length === 1 ? 'the camera' : `the camera ${cams.length} times`),
    ].filter(Boolean);
    second.push(<React.Fragment key="ask">asks for {joined(asks)}</React.Fragment>);
    if (reads.length) {
      const each = reqs.length > 1 && m.lanes.every((l) => l.read) && counts.length === 1;
      second.push(
        <React.Fragment key="read">
          reads {stepTok(reads[0], `${counts.length > 1 ? 'up to ' : ''}${plural(Math.max(...counts), 'detail')}`)}
          {each ? ' from each' : ''} with{' '}
          {stepTok(reads[0], models.length > 1 ? 'more than one model' : models[0] || (m.llm ? `its own model (${m.llm})` : 'its own model'))}
        </React.Fragment>,
      );
    }
    if (m.compares.length === 1) {
      const c = m.compares[0];
      const n = c.pairs.length;
      second.push(
        <React.Fragment key="cmp">
          checks in code that {stepTok(c, c.item.require === 'any' ? 'any one matches' : n === 1 ? 'they match' : n === 2 ? 'both match' : `all ${n} match`)}
        </React.Fragment>,
      );
    } else if (m.compares.length > 1)
      second.push(<React.Fragment key="cmp">makes {stepTok(m.compares[0], `${m.compares.length} comparisons`)} in code</React.Fragment>);
    if (m.asked.length)
      second.push(
        m.kept.length ? (
          <React.Fragment key="fg">
            keeps {tok('add', m.kept.length === m.asked.length ? 'every picture' : together(m.kept))} until the call ends
          </React.Fragment>
        ) : (
          <React.Fragment key="fg">
            forgets {m.forgets[0] ? stepTok(m.forgets[0], m.asked.length > 1 ? 'every picture' : 'the picture') : 'it'} straight after
          </React.Fragment>
        ),
      );
  }
  const where = places.length === 1 ? <>In {places[0].replace(/^Form /, 'the form ')}</> : <>In {plural(places.length, 'place')}</>;
  const pickyWords = [];
  const uploadWords = [...new Set(allReqs.filter((r) => r.kind !== 'camera').map((r) => r.pickyWord))];
  const cameraWords = [...new Set(allReqs.filter((r) => r.kind === 'camera').map((r) => r.pickyWord))];
  if (uploadWords.length)
    pickyWords.push(
      <React.Fragment key="u">Photos are held to {tok('picky', uploadWords.length > 1 ? 'different standards' : uploadWords[0])}</React.Fragment>,
    );
  if (cameraWords.length)
    pickyWords.push(
      <React.Fragment key="c">
        {uploadWords.length ? 'the camera to ' : 'The camera is held to '}
        {tok('picky', cameraWords.length > 1 ? 'different standards' : cameraWords[0])}
      </React.Fragment>,
    );
  const webWays = m.ways.filter((w) => w.web);
  const blanks = [webWays.length && !m.takes.length && tok('reach', '', true), !reqs.length && tok('add', '', true)].filter(Boolean);

  // ---- what a part of the sentence opens
  const wayCard = cards.ways;
  const seeCard = cards.seeing;
  const entryOf = (listId, key) => ctx.items(listId).find((e) => e.key === key) || null;
  const popover = () => {
    const k = open.token;
    if (k === 'reach')
      return (
        <div className="mdPopWays">
          {webWays.map((w) => {
            const entry = entryOf('ways', w.key);
            if (!entry) return null;
            const r = itemRows(ctx, wayCard, 'ways', entry);
            return (
              <div key={w.key} className="mdPopWay">
                <b>
                  {w.name}
                  {w.id ? <span className="apDim"> ({w.id})</span> : null}
                </b>
                <Rows ids={['photo', 'camera']} rows={r} ctx={ctx} partId="media" />
              </div>
            );
          })}
          {!webWays.length && <p className="apNone">No way in on the website yet: add web chat or talk on your website on Channels.</p>}
          <p className="cxNote">
            <Icon name="info" size={14} />
            The size, kinds of file and what happens when a photo arrives are on each way in’s line, under “Where pictures come in”.
          </p>
        </div>
      );
    if (k === 'add')
      return (
        <AddPictureStep
          ctx={ctx}
          onAdded={(path, type) => {
            close();
            added(path, type);
          }}
          onNoForm={() => goPart('connections')}
        />
      );
    return <Rows ids={TOKENS[k].ids} rows={rows} ctx={ctx} partId="media" />;
  };

  // ---- the chapters
  const badPill = <span className="tlPill bad">Needs a look</span>;
  const aiProblem = m.takes.length > 0 && !m.ai.sees;
  const lib = pictureLibrary(config);
  const hides = hidesOf(config);
  const secretFields = [...new Set(reads.flatMap((r) => r.fields.map((f) => fieldVar(r.item, f))).filter(secret))];
  const groups = [];
  m.steps.forEach((x) => {
    const g = groups.find((y) => y.key === x.group.key);
    if (g) g.steps.push(x);
    else groups.push({ key: x.group.key, group: x.group, steps: [x] });
  });
  const groupPlace = (g) => {
    const place = locate(g.list);
    const formId = g.list[0] === 'forms' ? config.forms?.[g.list[1]]?.id : null;
    return () => goPart(place.page, formId ? { item: `forms:${formId}` } : undefined);
  };

  return (
    <section className="dtPart apWrap grWrap mdWrap" data-part="media" aria-labelledby="dt-media-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-media-title">Images &amp; Videos</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero grHero mdHero" aria-label="Its pictures">
        <div className="apId">
          <span className="apAvatar grAvatarBig" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>Pictures with {name}</h2>
            <p>{summaryLine(m)}</p>
          </div>
          <div className="apActs">
            <Button type="button" variant="primary" className="apInk" onClick={() => goPart('tests')}>
              <Icon name="image" size={13} />
              Try it with a picture
            </Button>
          </div>
        </div>
        <p className="apSentence grSentence">
          {first}
          {second.length > 0 && (
            <>
              {' '}
              {where} it {joined(second)}.
            </>
          )}
          {pickyWords.length > 0 && <> {joined(pickyWords)}.</>}
          {blanks.length > 0 && <> Not yet: {joined(blanks, 'or')}.</>}
        </p>
        <p className="apHint">Click any part to change it.</p>
        <Journey m={m} secret={secret} onStep={openStep} onAdd={() => openToken('add')} />
        {m.seeing.some((x) => x.mode !== 'off') ? (
          <p className="cxNote grWarn">
            <Icon name="eye" size={14} />
            <span>
              <b>Seeing during the conversation:</b> {together(m.seeing.filter((x) => x.mode !== 'off').map((x) => `${x.name}, ${x.words.toLowerCase()}`))}.
              Kept, but the server doesn’t do it yet.
            </span>
          </p>
        ) : (
          <p className="cxNote">
            <Icon name="eye" size={14} />
            <span>
              <b>Seeing during the conversation: off.</b> The AI sees a picture only when a step reads it.
            </span>
          </p>
        )}
        {open?.token && (
          <Popover
            key={open.token}
            anchor={anchors.current[open.token] || hero.current}
            box={hero}
            title={TOKENS[open.token].title}
            onClose={close}
            width={TOKENS[open.token].width}
          >
            {popover()}
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="md-comes">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="md-comes">Where pictures come in</h2>
          <span className="apChSub">Only on your website: a phone call carries no pictures</span>
        </div>
        <div className="apDoc lines">
          {m.ways.map((w) => {
            const words = wayWords(w);
            if (!w.web)
              return (
                <Line key={w.key} s={s} k={`way:${w.key}`} icon="phone" label={w.name} locked muted>
                  {words.main}
                  <span className="apDim"> · {words.more}</span>
                </Line>
              );
            const entry = entryOf('ways', w.key);
            const r = entry ? itemRows(ctx, wayCard, 'ways', entry) : {};
            return (
              <Line
                key={w.key}
                s={s}
                k={`way:${w.key}`}
                icon={w.type === 'web_voice' ? 'voice' : 'chat'}
                label={`${w.name}${w.id && m.ways.filter((x) => x.name === w.name).length > 1 ? ` (${w.id})` : ''}`}
                action={w.photo || w.camera ? 'Change' : 'Switch on'}
                muted={!w.photo && !w.camera}
                below={<Rows ids={ITEM_ROWS.ways} rows={r} ctx={ctx} partId="media" />}
              >
                {words.main}
                {words.more && <span className="apDim"> · {words.more}</span>}
                {!w.on && <span className="apDim"> · the way in is switched off</span>}
              </Line>
            );
          })}
          {!m.ways.length && (
            <Line s={s} k="noWays" icon="chat" label="Ways in" action="Open Channels" muted onAction={() => goPart('channels')}>
              None yet
            </Line>
          )}
          <Line
            s={s}
            k="ai"
            icon="eye"
            label="The AI can see pictures"
            action={aiProblem ? 'Mark it' : 'Open on Agent'}
            muted={!m.ai.sees && !aiProblem}
            onAction={() => (aiProblem ? ctx.set(markSeeing(config)) : goPart('agent'))}
          >
            {m.ai.sees
              ? 'Yes'
              : aiProblem
                ? 'A way in takes pictures, but the AI isn’t marked as reading them: the server refuses the agent'
                : 'Not needed yet'}
            <span className="apDim">
              {m.ai.sees
                ? ` · ${m.llm || 'its model'} is marked as reading images · set with its model on Agent`
                : aiProblem
                  ? ''
                  : ' · marked as soon as a way in takes pictures'}
            </span>
            {aiProblem && badPill}
          </Line>
          {m.seeing.length ? (
            m.seeing.map((x) => {
              const entry = entryOf('seeing', x.key);
              const r = entry ? itemRows(ctx, seeCard, 'seeing', entry) : {};
              return (
                <Line
                  key={x.key}
                  s={s}
                  k={`see:${x.key}`}
                  icon="eye"
                  label={m.seeing.length > 1 ? `${x.name}, during the conversation` : 'Seeing during the conversation'}
                  muted={x.mode === 'off'}
                  below={<Rows ids={ITEM_ROWS.seeing} rows={r} ctx={ctx} partId="media" />}
                >
                  {x.mode === 'off' ? 'Off' : x.words}
                  <span className="apDim">{x.mode === 'off' ? ' · it sees a picture only when a step reads it' : ''}</span>
                  {x.kept && <span className="tlPill warn">Not run yet</span>}
                </Line>
              );
            })
          ) : (
            <Line s={s} k="see" icon="eye" label="Seeing during the conversation" locked muted>
              Off<span className="apDim"> · it sees a picture only when a step reads it</span>
            </Line>
          )}
        </div>
      </section>

      <section className="apCh" aria-labelledby="md-asks">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="md-asks">What it asks for, and how it checks</h2>
          <span className="apChSub">Each step opens on a page of its own, and stays where it runs</span>
        </div>
        {m.steps.length > MANY && (
          <div className="cxFilters mdFilters">
            <div className="cvPills" role="group" aria-label="Show">
              {FILTERS.map((f) => {
                const n = m.steps.filter(f.test).length;
                if (!n && f.id !== 'all') return null;
                return (
                  <button key={f.id} type="button" aria-pressed={only === f.id} className={only === f.id ? 'on' : ''} onClick={() => setOnly(f.id)}>
                    {f.name} {n}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {groups
          .map((g) => ({ ...g, shown: g.steps.filter((FILTERS.find((f) => f.id === only) || FILTERS[0]).test) }))
          .filter((g) => g.shown.length)
          .map((g) => (
            <div key={g.key} className="apDoc lines mdGroup">
              <div className="mdGroupHead">
                <b>{g.group.name}</b>
                <span className="apDim">{plural(g.steps.length, 'picture step')}</span>
                <button type="button" className="stLink" onClick={groupPlace(g.group)}>
                  All its steps
                </button>
              </div>
              {g.shown.map((x) => (
                <Line
                  key={x.key}
                  s={s}
                  k={`step:${x.key}`}
                  icon={x.icon}
                  label={`${x.at} · ${x.name}`}
                  action={x.gap ? 'Fix' : 'Open'}
                  onAction={() => (x.gap ? fix(x) : openStep(x))}
                >
                  {x.gap || x.words}
                  {!x.gap && x.more && <span className="apDim"> · {x.more}</span>}
                  {x.when && <span className="apDim"> · only when…</span>}
                  {x.gap && badPill}
                </Line>
              ))}
            </div>
          ))}
        <div className="apDoc lines">
          {allReqs.some((r) => r.kind !== 'camera') && (
            <Line s={s} k="pickyUpload" icon="scan" label="How picky, for every photo" ids={LINES.pickyUpload}>
              {uploadWords.length > 1 ? 'They differ' : uploadWords[0]}
              <span className="apDim"> · one choice sets every photo request</span>
            </Line>
          )}
          {allReqs.some((r) => r.kind === 'camera') && (
            <Line s={s} k="pickyCamera" icon="scan" label="How picky, for every camera check" ids={LINES.pickyCamera}>
              {cameraWords.length > 1 ? 'They differ' : cameraWords[0]}
              <span className="apDim"> · one choice sets every camera check</span>
            </Line>
          )}
          <Line
            s={s}
            k="add"
            icon="plus"
            label={reqs.length ? 'Add a picture step' : 'Start with'}
            action="Add"
            muted
            below={<AddPictureStep ctx={ctx} onAdded={added} onNoForm={() => goPart('connections')} />}
          >
            {reqs.length
              ? 'A photo request, the camera, a reading, a comparison or forgetting'
              : 'A photo of a document · of damage or a product · a receipt · a camera check'}
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="md-privacy">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="md-privacy">Privacy, honesty and trying it</h2>
          <span className="apChSub">Pictures stay in the call’s memory; a picture check is a first look, not proof</span>
        </div>
        <div className="apDoc lines">
          <Line
            s={s}
            k="forgotten"
            icon="forget"
            label="Every picture is forgotten"
            action={m.kept.length ? 'Add the step' : 'Open'}
            locked={!m.kept.length && !m.forgets.length}
            muted={!m.asked.length}
            onAction={() => {
              if (m.kept.length) {
                const made = forgetKept(
                  config,
                  m.kept,
                  m.lanes.map((l) => l.req),
                );
                if (made.path) ctx.set(made.config);
              } else if (m.forgets[0]) openStep(m.forgets[0]);
            }}
          >
            {!m.asked.length ? 'Nothing to forget yet' : m.kept.length ? `${together(m.kept)} never forgotten by a step` : 'Yes'}
            <span className="apDim">
              {!m.asked.length
                ? ''
                : m.kept.length
                  ? ' · still forgotten when the call ends'
                  : ` · by ${plural(m.forgets.length, 'step')} · and always when the call ends`}
            </span>
            {m.kept.length > 0 && badPill}
          </Line>
          <Line s={s} k="where" icon="lock" label="Where pictures go" locked>
            Nowhere<span className="apDim"> · never logged, saved or sent; only a reading step passes one to the AI</span>
          </Line>
          <Line
            s={s}
            k="secret"
            icon="lock"
            label="Details kept secret"
            action="Open there"
            muted={!secretFields.length}
            onAction={() => goPart('conversation')}
          >
            {secretFields.length ? together(secretFields) : 'None'}
            <span className="apDim"> · never in logs or shown back in full · set on Conversation › What it remembers</span>
          </Line>
          <Line s={s} k="hidden" icon="eye" label="Hidden in what is kept" action="Open there" muted={!hides.on} onAction={() => goPart('aftercall')}>
            {hides.on ? cap(hiddenWords(hides)) || 'Nothing chosen yet' : 'Nothing extra'}
            <span className="apDim"> · in saved transcripts and the log · set on After the call</span>
          </Line>
          <Line s={s} k="honest" icon="shield" label="What a picture check can do" action="Read" below={<p className="apHint mdHonest">{DEMO_GRADE}</p>}>
            A first look, not identity verification<span className="apDim"> · it can’t tell a real card from a copy or a screen</span>
          </Line>
          <Line s={s} k="library" icon="image" label="Pictures to try it with" action="Open" muted={!lib.length} onAction={() => openItem('library', 'all')}>
            {lib.length ? lib.length : 'None yet'}
            <span className="apDim">
              {lib.length
                ? ` · ${together(lib.slice(0, 4).map((p) => p.name.replace(/_/g, ' ')))}${lib.length > 4 ? '…' : ''}`
                : ' · sample cards and photos for the test conversations'}
            </span>
          </Line>
          <Line s={s} k="camera" icon="camera" label="Your camera, live" action="Open" muted onAction={() => openItem('camera', 'live')}>
            See what a camera check measures on your own camera<span className="apDim"> · nothing is recorded</span>
          </Line>
        </div>
      </section>
    </section>
  );
}

export default function MediaWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the picture settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
