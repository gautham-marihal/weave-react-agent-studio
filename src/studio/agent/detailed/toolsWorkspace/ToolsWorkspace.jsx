import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { replaceRoute, routeHref, useRoute } from '../../../route.js';
import { AllSettings, Line, Popover, Rows, Tok, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import { useAddChoices } from '../AddItem.jsx';
import ToolTry from '../parts/ToolTry.jsx';
import ToolPage from './ToolPage.jsx';
import { TOKENS } from './toolsLayout.js';
import { abilitiesOf, sentenceOf, summaryLine, toolsOf } from './toolsWords.js';
import './toolsWorkspace.css';

// Build › Tools as what the agent can do (design: canvas page "4 · Tools, redesigned"). A sentence says what it can
// do, with each quick ability a part that opens its switch and details in place (one not on yet is a blank), and the
// tools of its own; under it, a tile for each, saying only its state. Then three chapters: the quick abilities, its
// tools (each opens as the steps of one run, on a page of its own), and trying a tool. All settings: every setting.
// Every view edits with the part's own rows (toolsForm), so each setting is the same control everywhere.

const VIEWS = makeViewStore('weave_tools_view', 'overview');
const FIRST = ['overview', 'What it can do'];
const LABEL = 'How to see the tools';

const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

// words run together as a sentence does: "a, b and c"
function joined(nodes, last = 'and') {
  return nodes.map((node, i) => (
    <React.Fragment key={i}>
      {i > 0 && (i === nodes.length - 1 ? ` ${last} ` : ', ')}
      {node}
    </React.Fragment>
  ));
}

// "Add a tool": each kind it can add, by what it does; one the server doesn't run yet says so
function ToolKinds({ ctx, onAdded }) {
  const choices = useAddChoices({ ctx, path: ['tools'], pickerKey: 'tools', word: 'tool', onAdded });
  if (!choices) return null;
  return (
    <div className="tlKindsWrap">
      <div className="tlKinds" role="group" aria-label="What should it be able to do?">
        {choices.options.map((option) => (
          <button key={option.id} type="button" className={`tlKind ${option.unavailable ? 'later' : ''}`} onClick={() => choices.pick(option)}>
            <span className="tlKindIcon" aria-hidden="true">
              <Icon name={option.icon || 'plus'} size={16} />
            </span>
            <b>{option.label}</b>
            <small>{option.unavailable ? 'Not run by the server yet.' : option.help}</small>
          </button>
        ))}
      </div>
      <p className="apHint">Each starts filled in the usual way and opens as its steps. One marked is kept in the file, but the server doesn’t run it yet.</p>
    </div>
  );
}

// Try it: the tools to choose from, then the try-out of the one chosen (nothing is called, saved or read from a secret)
function TryTool({ ctx, tryKey, setTryKey }) {
  const entries = ctx.items('tools');
  const entry = entries.find((e) => e.key === tryKey) || entries[0];
  if (!entry) return <p className="apNone">Add a tool first.</p>;
  return (
    <div className="tlTry">
      {entries.length > 1 && (
        <div className="cvPills tlPills" role="group" aria-label="The tool to try">
          {entries.map((e) => (
            <button key={e.key} type="button" aria-pressed={e.key === entry.key} className={e.key === entry.key ? 'on' : ''} onClick={() => setTryKey(e.key)}>
              {e.name}
            </button>
          ))}
        </div>
      )}
      <ToolTry key={entry.key} ctx={ctx} entry={entry} />
    </div>
  );
}

function Overview({ ctx, form, view }) {
  const rows = useMemo(() => rowsOf(form), [form]);
  const route = useRoute();
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  // a tool open on its own page: from the address (?item=tools:id), so a link or a reload opens the same tool
  // (and follows it: going to the plain address, from the menu say, closes the page)
  const itemParam = String(route.params?.item || '');
  const fromParam = (param) => (param.startsWith('tools:') ? param.slice(6) : null);
  const [tool, setTool] = useState(() => fromParam(itemParam));
  const [seen, setSeen] = useState(itemParam);
  if (itemParam !== seen) {
    setSeen(itemParam);
    setTool(fromParam(itemParam));
  }
  const [tryKey, setTryKey] = useState(null);
  const config = ctx.config;
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const abilities = abilitiesOf(config);
  const tools = toolsOf(config, ctx.editor?.report?.unsupported);
  const said = sentenceOf(config);

  const openToken = (key) => {
    setOpen({ token: key });
    reveal(hero.current);
  };
  const openTool = (key) => {
    setOpen(null);
    ctx.choose('tools', key);
    setTool(key);
    requestAnimationFrame(() => reveal(document.querySelector('.tlPage')));
  };
  const back = () => {
    setTool(null);
    if (route.view === 'bot') replaceRoute(routeHref(route.botId, route.tab, { ...route.params, item: undefined }));
  };
  const openLine = (line) => {
    setOpen({ line });
    requestAnimationFrame(() => reveal(document.querySelector(`.tlWrap [data-line="${line}"]`)));
  };
  const tryTool = (key) => {
    setTryKey(key);
    back();
    requestAnimationFrame(() => openLine('try'));
  };

  if (tool)
    return (
      <section className="dtPart apWrap tlWrap" data-part="tools" aria-label="Tools">
        <ToolPage ctx={ctx} form={form} toolKey={tool} onBack={back} onTry={() => tryTool(tool)} />
      </section>
    );

  const filled = Object.fromEntries(abilities.map((a) => [a.key, a.on ? a.words : '']));
  const s = { open, setOpen, openToken, close, rows, ctx, filled, anchors, tokens: TOKENS, partId: 'tools' };
  const onParts = said.on.map((a) => <Tok key={a.key} s={s} k={a.key} />);
  const ownParts = said.own.map((t) => (
    <button key={t.id} type="button" className="apTok tlToolTok" onClick={() => openTool(t.id)}>
      {t.name}
      <span className="srOnly"> (open this tool)</span>
    </button>
  ));
  const offParts = said.off.map((a) => <Tok key={a.key} s={s} k={a.key} />);
  const own = tools.filter((t) => !t.madeBy);
  const tryEntry = ctx.items('tools').find((e) => e.key === tryKey) || ctx.items('tools')[0];

  return (
    <section className="dtPart apWrap tlWrap" data-part="tools" aria-labelledby="dt-tools-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-tools-title">Tools</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero tlHero" aria-label="What it can do">
        <div className="apId">
          <span className="apAvatar tlAvatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>What {name} can do</h2>
            <p>{summaryLine(config)}</p>
          </div>
          <div className="apActs">
            <Button type="button" variant="primary" className="apInk" onClick={() => openLine('try')} disabled={!tools.length}>
              <Icon name="play" size={14} />
              Try a tool
            </Button>
          </div>
        </div>
        <p className="apSentence tlSentence">
          {onParts.length + ownParts.length ? (
            <>
              {name} can {joined(onParts)}
              {onParts.length > 0 && ownParts.length > 0 && ' and '}
              {ownParts.length > 0 && <>use {joined(ownParts)}</>}.
            </>
          ) : (
            <>{name} can only talk for now.</>
          )}
          {offParts.length > 0 && <> Not yet: {joined(offParts, 'or')}.</>}
        </p>
        <p className="apHint">Click any part to change it.</p>
        <ul className="tlTiles" aria-label="Its abilities and tools">
          {abilities.map((a) => (
            <li key={a.key}>
              <button type="button" className={`tlTile ${a.on ? 'on' : ''}`} onClick={() => openToken(a.key)}>
                <span className="tlTileHead">
                  <span className="tlTileIcon" aria-hidden="true">
                    <Icon name={a.icon} size={15} />
                  </span>
                  <b>{a.name}</b>
                </span>
                <small>{a.on ? a.detail : a.about}</small>
                <span className={`tlState ${a.on ? 'good' : 'off'}`}>{a.on ? 'On' : 'Off'}</span>
                <span className="srOnly"> (change it)</span>
              </button>
            </li>
          ))}
          {own.map((t) => (
            <li key={t.id}>
              <button type="button" className="tlTile on" onClick={() => openTool(t.id)}>
                <span className="tlTileHead">
                  <span className="tlTileIcon" aria-hidden="true">
                    <Icon name={t.icon} size={15} />
                  </span>
                  <b>{t.name}</b>
                </span>
                <small>
                  {t.does}
                  {t.agents.length ? ` · used by ${t.agents.join(', ')}` : ''}
                </small>
                <span className={`tlState ${t.state.tone}`}>{t.state.words}</span>
                <span className="srOnly"> (open it)</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="tlTile add" onClick={() => openLine('add')}>
              <Icon name="plus" size={15} />
              Add a tool
            </button>
          </li>
        </ul>
        {open?.token && (
          <Popover
            key={open.token}
            anchor={anchors.current[open.token]}
            box={hero}
            title={TOKENS[open.token].title}
            onClose={close}
            width={TOKENS[open.token].width}
          >
            <Rows ids={TOKENS[open.token].ids} rows={rows} ctx={ctx} partId="tools" />
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="tl-quick">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="tl-quick">Quick abilities</h2>
          <span className="apChSub">Switch one on and say the details: the tool is made for you</span>
        </div>
        <div className="apDoc lines">
          {abilities.map((a) => (
            <Line key={a.key} s={s} k={a.key} icon={a.icon} label={a.name} token={a.key} action={a.on ? 'Change' : 'Switch on'} muted={!a.on}>
              {a.on ? 'On' : 'Off'}
              <span className="apDim"> · {a.on ? a.detail : a.about.charAt(0).toLowerCase() + a.about.slice(1)}</span>
            </Line>
          ))}
        </div>
      </section>

      <section className="apCh" aria-labelledby="tl-mine">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="tl-mine">Your tools</h2>
          <span className="apChSub">Each opens as the steps of one run</span>
        </div>
        <div className="apDoc lines">
          {tools.map((t) => (
            <Line key={t.id} s={s} k={`tool:${t.id}`} icon={t.icon} label={t.name} action="Open" onAction={() => openTool(t.id)}>
              {t.does}
              <span className="apDim">
                {t.madeBy ? ` · made by “${t.madeBy}”` : ''}
                {t.agents.length ? ` · ${t.agents.join(', ')}` : ''}
              </span>
              <span className={`tlPill ${t.state.tone}`}>{t.state.words}</span>
            </Line>
          ))}
          <Line s={s} k="add" icon="plus" label="Add a tool" action="Add" muted below={<ToolKinds ctx={ctx} onAdded={(key) => openTool(key)} />}>
            {tools.length ? '' : 'None yet · '}
            look up or save, search knowledge, show a form, pass the caller on…
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="tl-try">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="tl-try">Try it</h2>
          <span className="apChSub">Give a tool sample values and see what would happen</span>
        </div>
        <div className="apDoc lines">
          <Line
            s={s}
            k="try"
            icon="play"
            label="Try a tool"
            action="Try it"
            locked={!tools.length}
            muted={!tools.length}
            below={<TryTool ctx={ctx} tryKey={tryEntry?.key} setTryKey={setTryKey} />}
          >
            {tryEntry ? tryEntry.name : 'Add a tool first'}
            <span className="apDim"> · nothing is called, saved or read from a secret</span>
          </Line>
        </div>
      </section>
    </section>
  );
}

export default function ToolsWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the tools’ settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
