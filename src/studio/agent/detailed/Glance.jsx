import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import { momentsOf, topicsOf, MOMENTS } from '../blocks/guardrailModel.js';
import { afterCallOf } from '../blocks/afterCallModel.js';
import { getAtPath } from '../schemaPath.js';
import { joinAnd, plural, clip } from './describe.js';

// "At a glance": the top of a Build part, what is set there in a few tiles a newcomer can read before any form, each
// opening the card where it is changed. Each part says its own things (After the call: what happens
// once it ends…). Nothing here is edited: it only reads the draft.
//   tile: { card, label, value, tone?: 'good' | 'warn' | 'bad' | 'off', icon }

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

// brings a card into view and puts the keyboard on its title
function openCard(partId, card) {
  const el = document.querySelector(`[data-card="${partId}.${card}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.querySelector('h2')?.focus?.({ preventScroll: true });
}

export function Glance({ partId, label, lead = null, tiles }) {
  return (
    <section className="glBox" aria-label={label}>
      {lead}
      <ul className="glTiles">
        {tiles.map((t) => (
          <li key={t.label}>
            <button type="button" className={`glTile ${t.tone || ''}`} onClick={() => openCard(partId, t.card)}>
              <span className="glIcon" aria-hidden="true">
                <Icon name={t.icon || 'info'} size={15} />
              </span>
              <span className="glText">
                <span className="glLabel">{t.label}</span>
                <span className="glValue">{typeof t.value === 'string' ? t.value.charAt(0).toUpperCase() + t.value.slice(1) : t.value}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// a time in words: "3 minutes", "90 seconds"
const secondsWords = (s) => (s >= 60 && s % 60 === 0 ? plural(s / 60, 'minute') : s >= 90 ? `${Math.round((s / 60) * 10) / 10} minutes` : plural(s, 'second'));
// ---- 3 Knowledge: what it has to answer from, and how
export function KnowledgeGlance({ ctx }) {
  const c = ctx.config;
  const bases = list(c?.knowledge).filter(isObj);
  const stores = bases.filter((b) => b.type === 'vector_store');
  const sources = stores.flatMap((b) => list(b.sources).filter(isObj));
  const files = sources.filter((s) => s.type === 'file').length;
  const pages = sources.length - files;
  const external = bases.filter((b) => b.type !== 'vector_store').length;
  const readers = list(c?.agents?.items).filter((a) => isObj(a) && list(a.knowledge).length).length;
  return (
    <Glance
      partId="knowledge"
      label="What it knows at a glance"
      tiles={[
        { card: 'docs', icon: 'records', label: 'Documents', value: files ? plural(files, 'document') : 'None yet', tone: files ? 'good' : 'off' },
        { card: 'docs', icon: 'globe', label: 'Web pages', value: pages ? plural(pages, 'page') : 'None yet', tone: pages ? 'good' : 'off' },
        {
          card: 'docs',
          icon: 'agent',
          label: 'Who reads it',
          value: sources.length || external ? (readers ? plural(readers, 'agent') : 'No agent yet') : 'Nothing to read yet',
          tone: sources.length || external ? (readers ? 'good' : 'warn') : 'off',
        },
        {
          card: 'rag',
          icon: 'search',
          label: 'Your own search service',
          value: external ? plural(external, 'service') : 'Not used',
          tone: external ? 'good' : 'off',
        },
        {
          card: 'try',
          icon: 'chat',
          label: 'How it answers',
          value: sources.length || external ? 'From these first, then its instructions' : 'From its instructions only',
          tone: 'off',
        },
      ]}
    />
  );
}

// ---- 9/10 Guardrails: what keeps it safe, by kind
export function GuardrailsGlance({ ctx }) {
  const c = ctx.config;
  const topics = topicsOf(c);
  const moments = momentsOf(c);
  const on = MOMENTS.filter((m) => moments[m.id]?.on).map((m) => m.label.replace(/^Pass /, 'passes ').replace(/^End /, 'ends '));
  const inChecks = list(c?.guardrails?.input).filter(isObj);
  const outChecks = list(c?.guardrails?.output).filter(isObj);
  const limits = c?.guardrails?.limits || {};
  const limitWords = [
    limits.max_call_duration_s && `calls up to ${secondsWords(limits.max_call_duration_s)}`,
    limits.max_silence_s && `silence up to ${secondsWords(limits.max_silence_s)}`,
    limits.max_tool_calls && `${plural(limits.max_tool_calls, 'tool use')}`,
  ].filter(Boolean);
  return (
    <Glance
      partId="guardrails"
      label="Its guardrails at a glance"
      tiles={[
        {
          card: 'topics',
          icon: 'chat',
          label: 'Topics',
          value:
            topics.allowed.length || topics.blocked.length
              ? [
                  topics.allowed.length && `keeps to ${plural(topics.allowed.length, 'topic')}`,
                  topics.blocked.length && `avoids ${plural(topics.blocked.length, 'topic')}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Follows its instructions',
          tone: topics.allowed.length || topics.blocked.length ? 'good' : 'off',
        },
        {
          card: 'moments',
          icon: 'phoneTransfer',
          label: 'Hands over or ends',
          value: on.length ? clip(joinAnd(on), 70) : 'Never on its own',
          tone: on.length ? 'good' : 'off',
        },
        {
          card: 'input',
          icon: 'shield',
          label: 'Checks on what callers say',
          value: inChecks.length ? clip(inChecks.map((x) => String(x.id || x.type || 'check').replace(/_/g, ' ')).join(', '), 60) : 'None',
          tone: inChecks.length ? 'good' : 'off',
        },
        {
          card: 'output',
          icon: 'shield',
          label: 'Checks on what it says',
          value: outChecks.length ? plural(outChecks.length, 'check') : 'None',
          tone: outChecks.length ? 'good' : 'off',
        },
        {
          card: 'limits',
          icon: 'clock',
          label: 'Limits',
          value: limitWords.length ? joinAnd(limitWords) : 'No limits',
          tone: limitWords.length ? 'good' : 'off',
        },
      ]}
    />
  );
}

// ---- 11 After the call: what happens once it ends, in order
export function AfterCallGlance({ ctx }) {
  const c = ctx.config;
  const after = afterCallOf(c);
  const log = getAtPath(c, ['observability', 'session_log', 'enabled']);
  const kept = [after.recording.audio && 'the audio', after.recording.transcript && 'the transcript'].filter(Boolean);
  return (
    <Glance
      partId="aftercall"
      label="After the call at a glance"
      tiles={[
        {
          card: 'summary',
          icon: 'note',
          label: '1 · A summary',
          value: after.summary.on ? 'Written after every call' : 'Not written',
          tone: after.summary.on ? 'good' : 'off',
        },
        {
          card: 'questions',
          icon: 'help',
          label: '2 · Questions answered',
          value: after.questions.length ? plural(after.questions.length, 'question') : 'None',
          tone: after.questions.length ? 'good' : 'off',
        },
        {
          card: 'recording',
          icon: 'records',
          label: '3 · What is kept',
          value:
            [log === false ? 'No call log' : 'A log of each call', ...kept].join(', ') +
            (after.recording.days ? `, for ${plural(after.recording.days, 'day')}` : ''),
          tone: 'good',
        },
        {
          card: 'privacy',
          icon: 'shield',
          label: '4 · What is hidden',
          value: after.redaction.on ? `${plural(list(c?.post_call?.redaction?.entities).length || 0, 'kind')} of personal detail` : 'Nothing extra',
          tone: after.redaction.on ? 'good' : 'warn',
        },
      ]}
    />
  );
}

// ---- 12 Engine and details: what it runs on, in a line each
export function EngineGlance({ ctx }) {
  const c = ctx.config;
  const meta = c?.meta || {};
  const runtime = c?.runtime || {};
  const constants = isObj(c?.constants) ? Object.keys(c.constants).length : 0;
  const ENGINE = { 'livekit-agents': 'LiveKit Agents' };
  return (
    <Glance
      partId="settings"
      label="What runs it at a glance"
      tiles={[
        { card: 'version', icon: 'flag', label: 'Version', value: `${meta.version || 'Not set'} · ${meta.status || 'draft'}`, tone: 'good' },
        {
          card: 'engine',
          icon: 'bolt',
          label: 'Engine',
          value: ENGINE[runtime.engine] || runtime.engine || 'Not chosen',
          tone: runtime.engine ? 'good' : 'bad',
        },
        {
          card: 'engine',
          icon: 'key',
          label: 'Models come from',
          value: runtime.provider_mode === 'inference' ? 'LiveKit Inference' : 'Your own provider keys',
          tone: 'good',
        },
        { card: 'engine', icon: 'clock', label: 'Time zone', value: runtime.timezone || 'Not set: UTC', tone: runtime.timezone ? 'good' : 'off' },
        { card: 'constants', icon: 'pin', label: 'Fixed values', value: constants ? plural(constants, 'value') : 'None', tone: constants ? 'good' : 'off' },
      ]}
    />
  );
}
