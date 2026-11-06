import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { useVoicePreview } from '../../../../pages/voicePreview.js';
import { languageName, readSimple } from '../../../simple/simpleModel.js';
import { readModels, summarizeModels } from '../../../models/config.js';
import { modelLabel, providerLabel } from '../../../models/catalog.js';
import { spokenChips, voiceInUse } from '../../pickers/pickerLogic.js';
import { navigate, routeHref, useRoute } from '../../../route.js';
import { AllSettings, Line, More, Popover, Rows, Tok, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { setAgentView, useAgentView } from './agentView.js';
import { speaks } from './speaks.js';
import './agentProfile.css';

// Build › Agent as a character, not a form (design: canvas page "1 · Agent, redesigned").
// Profile: the agent's name and avatar, Hear and Talk, and one sentence that says everything that matters; each part of
// the sentence opens a small editor right where it is. Then three chapters: the brief, how it talks, how it thinks.
// All settings: every one of the part's settings in one searchable list, all of them open, for people who know what they
// want. Both views edit with the part's own rows (agentForm), so each setting is the same control, saved in the same
// place, with the same checks. Each setting has one place in each view.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const words = (text) => (String(text || '').match(/\S+/g) || []).length;
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const VIEWS = { set: setAgentView, use: useAgentView };
const FIRST = ['profile', 'Profile'];

// The parts of the sentence: what each says, which settings its editor holds, and whether it may stay empty
const TOKENS = {
  name: { title: 'Who it is', ids: ['name.persona', 'name.name', 'name.description', 'name.tags', 'name.owner'], blank: 'a name' },
  company: { title: 'The company it works for', ids: ['name.company'], blank: 'your company', optional: true },
  greeting: { title: 'Its first words', ids: ['says.greeting'], blank: 'its first words' },
  tone: { title: 'How it sounds', ids: ['says.tone'], blank: 'a tone', optional: true },
  language: { title: 'Languages', ids: ['voice.primary', 'voice.speaks', 'voice.detect', 'voice.understands'], blank: 'a language' },
  voice: { title: 'Its voice', ids: ['voice.voice', 'voice.speed'], blank: 'a voice' },
  model: { title: 'What it thinks with', ids: ['models.llm'], blank: 'a model' },
};

// what the page shows from the draft
function readAgent(config) {
  const read = readSimple(config);
  const tts = readModels(config).tts;
  const models = summarizeModels(config);
  const model = (stage) => models.find((m) => m.stage === stage);
  const talks = speaks(config);
  const voice = voiceInUse(tts);
  // the other languages, counted as "Also speaks" shows them (by language, so en next to en-SG is not another one)
  const others = spokenChips({ primary: read.primaryLanguage, speaks: read.speaks })
    .filter((chip) => !chip.main)
    .map((chip) => chip.code);
  return {
    read,
    talks,
    voice,
    voiceSet: !!tts.voiceId,
    persona: read.persona,
    listed: read.name,
    company: typeof config?.persona?.company === 'string' ? config.persona.company : '',
    greeting: read.greeting,
    tone: read.tone,
    language: read.primaryLanguage ? languageName(read.primaryLanguage) : '',
    others,
    detect: config?.defaults?.language?.auto_detect === true,
    llm: model('llm'),
    stt: model('stt'),
    tts: model('tts'),
    temperature: config?.defaults?.models?.llm?.temperature,
    realtime: isObj(config?.defaults?.models?.realtime) ? config.defaults.models.realtime : null,
    tools: config?.defaults?.models?.llm?.tool_calling !== false,
    vision: config?.defaults?.models?.llm?.vision === true,
    role: read.role,
    shared: list(config?.persona?.shared_rules).filter((r) => typeof r === 'string' && r.trim()),
    style: read.styleRules.filter((r) => r.trim()),
    lines: list(config?.messages).filter(isObj).length,
  };
}

// ---- the profile ------------------------------------------------------------------------------------------------------

function Profile({ ctx, form, view }) {
  const rows = useMemo(() => rowsOf(form), [form]);
  const route = useRoute();
  const a = readAgent(ctx.config);
  const hero = useRef(null);
  const anchors = useRef({});
  // what is open: a part of the sentence ({ token }) or a line of a chapter ({ line }); one at a time
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const preview = useVoicePreview();
  const describe = () => navigate(routeHref(route.botId, 'describe'), { guard: false });
  const openToken = (key) => {
    setOpen({ token: key });
    reveal(hero.current);
  };

  // the parts of the sentence: words, or the blank to fill
  const filled = {
    name: a.persona || a.listed,
    company: a.company,
    greeting: a.greeting ? `“${clip(a.greeting, 110)}”` : '',
    tone: a.tone,
    language: a.language ? `${a.language}${a.others.length ? ` and ${a.others.length} more` : ''}` : '',
    voice: a.voice ? `${a.voice.name}’s` : a.voiceSet ? 'your own' : '',
    model: a.llm?.set ? a.llm.modelName || a.llm.model : '',
  };
  const needed = ['name', 'greeting', 'language', ...(a.talks ? ['voice'] : []), 'model'];
  const toFill = needed.filter((k) => !filled[k]).length;
  const s = { open, setOpen, openToken, close, rows, ctx, filled, anchors, tokens: TOKENS, partId: 'agent' };
  const name = a.persona || a.listed || '';
  const initials =
    (name || '?')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';

  const roleWords = words(a.role);
  const length = roleWords === 0 ? '' : roleWords < 80 ? 'short: say a little more' : roleWords > 450 ? 'long: think about trimming it' : 'a good length';
  const temp = typeof a.temperature === 'number' ? a.temperature : null;

  return (
    <section className="dtPart apWrap" data-part="agent" aria-labelledby="dt-agent-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-agent-title">Agent</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={setAgentView} first={FIRST} label="How to see the agent" />
      </header>

      {toFill >= 2 && (
        <div className="apAi">
          <span className="apAiIcon" aria-hidden="true">
            <Icon name="sparkle" size={17} />
          </span>
          <span className="apAiText">
            <b>Describe it, and the blanks are filled for you</b>
            <span>Say in a sentence what it should do. You can change everything afterwards.</span>
          </span>
          <Button type="button" variant="primary" size="small" onClick={describe}>
            Describe it
          </Button>
        </div>
      )}

      <section ref={hero} className="apHero" aria-label="The agent">
        <div className="apId">
          <span className={`apAvatar ${name ? '' : 'empty'}`} aria-hidden="true">
            {initials}
          </span>
          <div className="apName">
            <h2>{name || 'Your new agent'}</h2>
            <p>{a.listed && a.persona ? `Listed as ${a.listed}` : 'Give it a name, and it introduces itself by it'}</p>
          </div>
          <div className="apActs">
            {a.talks && a.voice && (
              <Button type="button" variant="secondary" className="apSoft" onClick={() => preview.play(a.voice)} aria-pressed={preview.playing === a.voice.id}>
                <Icon name={preview.playing === a.voice.id ? 'stop' : 'play'} size={13} />
                {preview.playing === a.voice.id ? 'Stop' : 'Hear the voice'}
              </Button>
            )}
            {ctx.onTest && (
              <Button type="button" variant="primary" className="apInk" onClick={ctx.onTest}>
                <Icon name="chat" size={15} />
                Talk to {a.persona || 'it'}
              </Button>
            )}
          </div>
        </div>
        <p className="apSentence">
          <Tok s={s} k="name" /> works for <Tok s={s} k="company" />. It greets callers with <Tok s={s} k="greeting" />, sounds <Tok s={s} k="tone" />, speaks{' '}
          <Tok s={s} k="language" />
          {a.talks ? (
            <>
              {' '}
              in <Tok s={s} k="voice" /> voice
            </>
          ) : null}
          , and thinks with <Tok s={s} k="model" />.
        </p>
        <p className="apHint">
          {toFill ? `${toFill} ${toFill === 1 ? 'blank' : 'blanks'} to fill. Click any part to change it.` : 'Click any part to change it.'}
        </p>
        {preview.note && <p className="apHint">{preview.note}</p>}
        {open?.token && (
          <Popover key={open.token} anchor={anchors.current[open.token]} box={hero} title={TOKENS[open.token].title} onClose={close}>
            {/* a picker (voice, model) shows its list at once: the editor is for that one choice */}
            <Rows ids={TOKENS[open.token].ids} rows={rows} ctx={{ ...ctx, pickersOpen: true }} partId="agent" />
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="ap-brief">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="ap-brief">The brief</h2>
          <span className="apChSub">What it does, in your words</span>
          <Button type="button" variant="secondary" size="small" className="apSoft" onClick={describe}>
            <Icon name="sparkle" size={13} />
            Improve with AI
          </Button>
        </div>
        <div className="apDoc">
          {/* while it is being edited, the box below shows it in full: no preview of it on top */}
          {open?.line === 'brief' ? null : a.role ? (
            <p className="apBrief">{clip(a.role, 320)}</p>
          ) : (
            <p className="apBrief empty">Write it like a briefing for a new colleague: who they talk to, what they help with, and what they must never do.</p>
          )}
          <div className="apMeta">
            {/* while editing, the box counts the words itself */}
            {roleWords > 0 && open?.line !== 'brief' && <span className={length === 'a good length' ? 'good' : 'warn'}>{roleWords} words</span>}
            {length && <span>{length}</span>}
            {a.shared.length > 0 && (
              <span>
                · {a.shared.length} {a.shared.length === 1 ? 'rule' : 'rules'} all its subagents share
              </span>
            )}
            <span className="apGrow" />
            <button
              type="button"
              className="apChange"
              aria-expanded={open?.line === 'brief'}
              onClick={() => setOpen(open?.line === 'brief' ? null : { line: 'brief' })}
            >
              {open?.line === 'brief' ? 'Done' : a.role ? 'Edit the brief' : 'Write the brief'}
            </button>
          </div>
          {open?.line === 'brief' && <Rows ids={['does.role', 'does.shared']} rows={rows} ctx={ctx} partId="agent" />}
        </div>
      </section>

      <section className="apCh" aria-labelledby="ap-talks">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="ap-talks">How it talks</h2>
          <span className="apChSub">Words, language and voice</span>
        </div>
        <div className="apDoc lines">
          {a.talks && (
            <Line s={s} k="voice" label="Voice" token="voice" muted={!a.voice && !a.voiceSet}>
              {a.voice ? (
                <>
                  <button
                    type="button"
                    className="apPlay"
                    aria-label={preview.playing === a.voice.id ? `Stop ${a.voice.name}` : `Listen to ${a.voice.name}`}
                    onClick={() => preview.play(a.voice)}
                  >
                    <Icon name={preview.playing === a.voice.id ? 'stop' : 'play'} size={12} />
                  </button>
                  <b>{a.voice.name}</b>
                  <span className="apDim">{[a.voice.style, a.voice.gender].filter(Boolean).join(' · ').toLowerCase()}</span>
                </>
              ) : a.voiceSet ? (
                'A voice of your own'
              ) : (
                'Not chosen yet'
              )}
            </Line>
          )}
          <Line s={s} k="language" label="Languages" token="language" muted={!a.language}>
            {a.language || 'Not chosen yet'}
            {a.others.length > 0 && <span className="apDim"> and {a.others.length} more</span>}
            <span className="apDim"> · switches to the caller’s: {a.detect ? 'on' : 'off'}</span>
          </Line>
          <Line s={s} k="style" label="Style rules" ids={['says.style']} muted={!a.style.length}>
            {a.style.length ? a.style[0] : 'None'}
            {a.style.length > 1 && <span className="apDim"> and {a.style.length - 1} more</span>}
          </Line>
          <Line s={s} k="lines" label="Fixed lines" ids={['says.lines']} muted={!a.lines}>
            {a.lines ? `${a.lines} ${a.lines === 1 ? 'line' : 'lines'} said word for word` : 'None'}
          </Line>
        </div>
        <More s={s} k="talksMore" ids={['voice.clean', 'voice.voiceid', 'voice.sttlang', 'voice.keyterms']} />
      </section>

      <section className="apCh" aria-labelledby="ap-thinks">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="ap-thinks">How it thinks</h2>
          <span className="apChSub">Chosen for you; change it if you need to</span>
        </div>
        <div className="apDoc lines">
          <Line s={s} k="llm" label="Thinks with" abbr="LLM" token="model" muted={!a.llm?.set}>
            {a.llm?.set ? (
              <>
                {a.llm.modelName || a.llm.model}
                <span className="apDim"> · {a.llm.providerName}</span>
              </>
            ) : (
              'Not chosen yet'
            )}
          </Line>
          {a.talks && (
            <Line s={s} k="ears" label="Hears and speaks" abbr="STT · TTS" ids={['models.stt', 'models.tts']}>
              {a.stt?.set ? a.stt.modelName || a.stt.model : 'Not chosen'}
              <span className="apDim"> · </span>
              {a.tts?.set ? a.tts.modelName || a.tts.model : 'Not chosen'}
            </Line>
          )}
          <Line s={s} k="answers" label="Its answers" ids={['models.temperature', 'models.tools', 'models.vision']}>
            {temp === null ? 'Usual creativity' : temp <= 0.5 ? 'Predictable' : temp >= 1.2 ? 'Varied' : 'Balanced'}
            <span className="apDim">
              {temp === null ? '' : ` (${temp})`} · {a.tools ? 'uses tools' : 'no tools'} · {a.vision ? 'sees pictures' : 'no pictures'}
            </span>
          </Line>
          <Line s={s} k="realtime" label="Speech-to-speech" abbr="S2S" ids={['models.realtime']} muted={!a.realtime}>
            {a.realtime ? (
              <>
                {a.realtime.model ? modelLabel('realtime', a.realtime.provider, a.realtime.model) : 'No model chosen'}
                {a.realtime.provider && <span className="apDim"> · {providerLabel(a.realtime.provider)}</span>}
                <span className="apDim"> · hears, thinks and speaks in one model</span>
              </>
            ) : (
              'Not used: it hears, thinks and speaks in separate steps'
            )}
          </Line>
        </div>
        <More s={s} k="thinksMore" ids={['models.parallel', 'models.fallbacks', 'models.key', 'models.address', 'models.options', 'models.model']} />
      </section>
    </section>
  );
}

export default function AgentWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the agent’s settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label="How to see the agent" />}
      />
    );
  return <Profile ctx={ctx} form={form} view={view} />;
}
