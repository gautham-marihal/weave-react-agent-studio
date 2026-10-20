import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { providerLabel } from '../models/catalog.js';
import { Notice } from '../ui.jsx';
import { usePref } from '../usePref.js';
import { alternatives, money, seconds, summarize } from './costModel.js';
import {
  PRICES_REVIEWED,
  PRICE_FIELDS,
  STAGE_NAMES,
  STARTING_PRICES,
  mergePrices,
  ownPriceCount,
  priceKey,
  resetAllPrices,
  resetPrice,
  setPrice,
  usePrices,
} from './prices.js';
import { PER_AGENT, useCostData } from './useCostData.js';
import './cost.css';

const PERIODS = [
  [7, 'Last 7 days'],
  [14, 'Last 14 days'],
  [30, 'Last 30 days'],
];
const TARGET_KEY = 'weave_speed_target';
const PART_LABEL = { llm: 'Language model', stt: 'Listening', tts: 'Speaking' };
const modelName = (provider, model) => `${providerLabel(provider)} ${model}`;
const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);

// One number with what it means under it.
function Stat({ value, label, sub, tone = '' }) {
  return (
    <div className={`csStat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// The prices in use, each one editable; a model in use with no price is listed first, asking for one.
function PriceTable({ prices, own, missing, focusKey }) {
  const [adding, setAdding] = useState({ stage: 'llm', provider: '', model: '' });
  const rows = [];
  missing.forEach((m) => rows.push({ stage: m.stage, key: m.key, price: null, missing: true }));
  Object.keys(STAGE_NAMES).forEach((stage) =>
    Object.entries(prices[stage])
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([key, price]) => rows.push({ stage, key, price, own: !!own?.[stage]?.[key], starting: !!STARTING_PRICES[stage][key] })),
  );
  const save = (stage, key, field, raw, current) => {
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value) || value < 0) return;
    const next = { ...(current || {}) };
    PRICE_FIELDS[stage].forEach((f) => {
      if (typeof next[f.key] !== 'number') next[f.key] = 0;
    });
    next[field] = value;
    setPrice(stage, key, next);
  };
  return (
    <div className="csPrices">
      <table>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Model</th>
            <th scope="col">Price (US$)</th>
            <th scope="col">
              <span className="srOnly">Where it comes from</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const [provider, ...rest] = r.key.split('/');
            return (
              <tr key={`${r.stage}|${r.key}|${r.missing ? 'm' : ''}`} className={r.missing ? 'missing' : ''}>
                <td>{PART_LABEL[r.stage]}</td>
                <td>
                  <b>{rest.join('/')}</b> <span className="stMuted">{providerLabel(provider)}</span>
                </td>
                <td className="csPriceInputs">
                  {PRICE_FIELDS[r.stage].map((f) => (
                    <label key={f.key}>
                      <span>{f.label}</span>
                      <input
                        type="number"
                        className="stFInput small"
                        min="0"
                        step="any"
                        autoFocus={r.missing && focusKey === r.key && f === PRICE_FIELDS[r.stage][0]}
                        defaultValue={r.price ? r.price[f.key] : ''}
                        placeholder={r.missing ? 'Add' : ''}
                        aria-label={`${PART_LABEL[r.stage]} ${r.key}: ${f.label} ${f.unit}`}
                        onBlur={(event) => save(r.stage, r.key, f.key, event.target.value, r.price)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                      <small>{f.unit}</small>
                    </label>
                  ))}
                </td>
                <td className="csPriceWhere">
                  {r.missing ? (
                    <span className="csTag warn">No price yet</span>
                  ) : r.own ? (
                    <>
                      <span className="csTag">Yours</span>
                      {r.starting && (
                        <button type="button" className="linkButton" onClick={() => resetPrice(r.stage, r.key)}>
                          List price
                        </button>
                      )}
                      {!r.starting && (
                        <button type="button" className="linkButton" onClick={() => setPrice(r.stage, r.key, null)}>
                          Remove
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="stMuted">List price</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form
        className="csAddPrice"
        onSubmit={(event) => {
          event.preventDefault();
          if (!adding.provider.trim() || !adding.model.trim()) return;
          const zero = Object.fromEntries(PRICE_FIELDS[adding.stage].map((f) => [f.key, 0]));
          setPrice(adding.stage, priceKey(adding.provider.trim(), adding.model.trim()), zero);
          setAdding({ ...adding, model: '' });
        }}
      >
        <strong>Add a model</strong>
        <select className="stFInput small" value={adding.stage} onChange={(event) => setAdding({ ...adding, stage: event.target.value })} aria-label="Part">
          {Object.keys(STAGE_NAMES).map((s) => (
            <option key={s} value={s}>
              {PART_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          className="stFInput small"
          placeholder="Provider, e.g. anthropic"
          aria-label="Provider"
          value={adding.provider}
          onChange={(event) => setAdding({ ...adding, provider: event.target.value })}
        />
        <input
          className="stFInput small"
          placeholder="Model id"
          aria-label="Model id"
          value={adding.model}
          onChange={(event) => setAdding({ ...adding, model: event.target.value })}
        />
        <button type="submit" className="quietButton" disabled={!adding.provider.trim() || !adding.model.trim()}>
          Add
        </button>
      </form>
      <p className="stMuted csFine">
        Starting prices are the providers’ public list prices, checked on {PRICES_REVIEWED}. A price that depends on your plan (ElevenLabs, Cartesia, the newest
        Anthropic and OpenAI models) is not filled in: add what you pay. Your prices are kept in this browser.
        {ownPriceCount(own) > 0 && (
          <>
            {' '}
            <button type="button" className="linkButton" onClick={resetAllPrices}>
              Use the list prices again
            </button>
          </>
        )}
      </p>
    </div>
  );
}

// "Cost and speed": what an agent costs per call and per month, where the money and the time go, and what a cheaper model would cost. On the workspace
// it compares the agents; on an agent's own page (agentOnly) it can put a cheaper model of the same provider in the draft.
export default function CostPage({ bots = [], agentOnly = false, editor = null, onOpenCall, onOpenAgent }) {
  const [days, setDays] = useState(14);
  const [targetPref, setTargetPref] = usePref(TARGET_KEY, '2');
  const target = Math.min(30, Math.max(0.5, Number(targetPref) || 2));
  const own = usePrices();
  const prices = useMemo(() => mergePrices(own), [own]);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [focusKey, setFocusKey] = useState('');
  const pricesRef = useRef(null);
  const [switched, setSwitched] = useState(null); // { from, to, before }
  const config = editor?.parsed?.value || null;
  const configs = useMemo(() => (agentOnly && config && bots[0] ? { [bots[0].id]: config } : null), [agentOnly, config, bots]);
  const data = useCostData(bots, { days, configs });
  const names = Object.fromEntries(bots.map((b) => [b.id, b.name || b.id]));

  const all = useMemo(
    () =>
      summarize({
        samples: data.samples,
        totalCalls: Object.values(data.totals).reduce((a, b) => a + b, 0),
        modelsByBot: data.modelsByBot,
        prices,
        days,
        targetMs: target * 1000,
      }),
    [data.samples, data.totals, data.modelsByBot, prices, days, target],
  );
  const perAgent = useMemo(
    () =>
      bots.map((b) => ({
        bot: b,
        summary: summarize({
          samples: data.samples.filter((s) => s.bot === b.id),
          totalCalls: data.totals[b.id] || 0,
          modelsByBot: data.modelsByBot,
          prices,
          days,
          targetMs: target * 1000,
        }),
        models: data.modelsByBot[b.id],
      })),
    [bots, data.samples, data.totals, data.modelsByBot, prices, days, target],
  );
  const current = agentOnly ? data.modelsByBot[bots[0]?.id]?.llm : null;
  const alt = useMemo(() => (agentOnly ? alternatives({ current, tokens: all.tokens, prices }) : null), [agentOnly, current, all.tokens, prices]);

  const openPrices = (key = '') => {
    setFocusKey(key);
    setPricesOpen(true);
    window.setTimeout(() => pricesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
  };
  const switchModel = (option) => {
    if (!editor || !config) return;
    const llm = config.defaults?.models?.llm || {};
    editor.setValue({ ...config, defaults: { ...config.defaults, models: { ...config.defaults.models, llm: { ...llm, model: option.model } } } });
    setSwitched({ from: llm.model, to: option.model, before: config });
  };

  const totalParts = (all.parts.llm || 0) + (all.parts.stt || 0) + (all.parts.tts || 0);
  const empty = !data.loading && all.sampled === 0;
  const maxBucket = Math.max(1, ...all.speed.buckets.map((b) => b.n));
  const cheaper = alt?.options.filter((o) => o.saving !== null && o.saving > 0.05) || [];

  return (
    <div className="csPage">
      <section className="welcomeBlock">
        <div>
          <h1>Cost and speed</h1>
          <p>
            {agentOnly ? `What ${bots[0]?.name || 'this agent'} costs to run` : 'What your agents cost to run'}, where the money and the time go, and what a
            different model would cost. Worked out from the calls; nothing is changed.
          </p>
        </div>
        <div className="csControls">
          <select className="stFInput small" value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Period">
            {PERIODS.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="quietButton" onClick={data.refresh} disabled={data.loading}>
            {data.loading ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </section>
      <DemoNote kind="calls">The calls are made up, and so are their timings and the tokens they report. The prices are real list prices.</DemoNote>
      {data.errors.map((e) => (
        <Notice
          key={e.botId || e.message}
          kind="error"
          title={e.botId ? `The calls of ${names[e.botId] || e.botId} couldn’t be read` : 'The calls couldn’t be read'}
        >
          {e.message}
        </Notice>
      ))}
      {switched && (
        <Notice
          kind="good"
          title={`The draft now uses ${switched.to}`}
          actions={
            <button
              type="button"
              className="quietButton"
              onClick={() => {
                editor.setValue(switched.before);
                setSwitched(null);
              }}
            >
              Undo
            </button>
          }
        >
          It was {switched.from}. A smaller model can follow instructions less well: run the tests before you publish.
        </Notice>
      )}

      {data.loading && !data.at ? (
        <p className="stMuted">Reading the calls…</p>
      ) : empty ? (
        <div className="csEmpty">
          <strong>No calls to work it out from</strong>
          <p>
            Once {agentOnly ? 'this agent has' : 'your agents have'} had calls in the {PERIODS.find((p) => p[0] === days)[1].toLowerCase()}, this page shows
            what a call costs and how fast it is answered. A conversation in Test is a call too.
          </p>
        </div>
      ) : (
        <>
          <p className="csBasis">
            From {all.sampled} call{all.sampled === 1 ? '' : 's'}
            {all.totalCalls > all.sampled ? ` (the newest ${PER_AGENT} of each agent, out of ${all.totalCalls})` : ''} in the{' '}
            {PERIODS.find((p) => p[0] === days)[1].toLowerCase()}. Estimates; phone line charges are not included.{' '}
            <button type="button" className="linkButton" onClick={() => openPrices()}>
              The prices
            </button>
          </p>

          <div className="csStats">
            <Stat value={money(all.costPerCall)} label="per call" sub={all.perMinute !== null ? `${money(all.perMinute)} a minute` : ''} />
            <Stat
              value={all.monthly !== null ? `${money(all.monthly)}` : '–'}
              label="a month"
              sub={all.perDay !== null ? `at ${all.perDay < 10 ? all.perDay.toFixed(1) : Math.round(all.perDay)} calls a day, as lately` : ''}
            />
            <Stat
              value={seconds(all.speed.p50)}
              label="to answer"
              sub={all.speed.p90 !== null ? `half the answers; 1 in 10 took over ${seconds(all.speed.p90)}` : 'no answers timed yet'}
            />
            <div className={`csStat ${all.speed.within !== null && all.speed.within < 0.8 ? 'warn' : ''}`}>
              <strong>{pct(all.speed.within)}</strong>
              <span>
                answered within{' '}
                <input
                  type="number"
                  className="stFInput small csTarget"
                  min="0.5"
                  max="30"
                  step="0.5"
                  value={targetPref}
                  aria-label="Target answer time, in seconds"
                  onChange={(event) => setTargetPref(event.target.value)}
                />{' '}
                s
              </span>
              <small>your target, kept in this browser</small>
            </div>
          </div>

          {(all.missing.length > 0 || all.unreported > 0) && (
            <Notice kind="warn" title="Part of the cost is left out">
              <ul className="csMissing">
                {all.missing.map((m) => (
                  <li key={`${m.stage}|${m.key}`}>
                    No price for {PART_LABEL[m.stage].toLowerCase()} on <b>{modelName(m.provider, m.model)}</b> ({m.calls} call{m.calls === 1 ? '' : 's'}).{' '}
                    <button type="button" className="linkButton" onClick={() => openPrices(m.key)}>
                      Add a price
                    </button>
                  </li>
                ))}
                {all.unreported > 0 && (
                  <li>
                    {all.unreported} call{all.unreported === 1 ? '' : 's'} didn’t report model use
                    {all.unreportedCutOff === all.unreported
                      ? ` (${all.unreported === 1 ? 'it was' : 'they were'} cut off before the end, where a call reports it)`
                      : all.unreportedCutOff
                        ? ` (${all.unreportedCutOff} of them cut off before the end, where a call reports it)`
                        : ''}
                    , so the language model’s share is missing for {all.unreported === 1 ? 'it' : 'them'}.
                  </li>
                )}
              </ul>
            </Notice>
          )}

          <section className="csSection" aria-labelledby="csMoney">
            <h2 id="csMoney">Where the money goes</h2>
            {totalParts > 0 ? (
              <>
                <div
                  className="csBar"
                  role="img"
                  aria-label={`Per call: ${Object.entries(all.parts)
                    .map(([k, v]) => `${PART_LABEL[k]} ${money(v)}`)
                    .join(', ')}`}
                >
                  {Object.entries(all.parts)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => (
                      <span key={k} className={`csSeg ${k}`} style={{ width: `${Math.max(2, (v / totalParts) * 100)}%` }} />
                    ))}
                </div>
                <ul className="csLegend">
                  {Object.entries(all.parts).map(([k, v]) => (
                    <li key={k}>
                      <i className={`csSeg ${k}`} aria-hidden="true" />
                      {PART_LABEL[k]}{' '}
                      {all.missing.some((m) => m.stage === k) && !v ? (
                        <button type="button" className="linkButton" onClick={() => openPrices(all.missing.find((m) => m.stage === k).key)}>
                          no price yet
                        </button>
                      ) : (
                        <>
                          <b>{money(v)}</b> <span className="stMuted">{totalParts ? pct(v / totalParts) : ''}</span>
                        </>
                      )}
                      {k !== 'llm' && all.voiceCalls === 0 && <span className="stMuted"> · no voice calls</span>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="stMuted">Nothing could be priced yet.</p>
            )}
            {all.models.length > 0 && (
              <table className="csTable">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Calls</th>
                    <th scope="col">Tokens a call, in / out</th>
                    <th scope="col">A call</th>
                  </tr>
                </thead>
                <tbody>
                  {all.models.map((m) => (
                    <tr key={priceKey(m.provider, m.model)}>
                      <td>
                        <b>{m.model}</b> <span className="stMuted">{providerLabel(m.provider)}</span>
                      </td>
                      <td>{m.calls}</td>
                      <td>
                        {Math.round(m.input).toLocaleString('en-US')} / {Math.round(m.output).toLocaleString('en-US')}
                      </td>
                      <td>
                        {m.costPerCall !== null ? (
                          money(m.costPerCall)
                        ) : (
                          <button type="button" className="linkButton" onClick={() => openPrices(priceKey(m.provider, m.model))}>
                            Add a price
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="csSection" aria-labelledby="csTime">
            <h2 id="csTime">Where the time goes</h2>
            {all.speed.answers ? (
              <>
                <p className="stMuted">
                  How long callers waited for each answer ({all.speed.answers} answers).
                  {all.speed.ttftP50 !== null &&
                    ` The model starts to answer after ${seconds(all.speed.ttftP50)} (half the time); the rest is tools and speech.`}
                </p>
                <ol className="csHist" aria-label="Answers by how long they took">
                  {all.speed.buckets.map((b) => (
                    <li key={b.label} className={b.slow ? 'slow' : ''}>
                      <span className="csHistLabel">{b.label}</span>
                      <span className="csHistBar">
                        <i style={{ width: `${(b.n / maxBucket) * 100}%` }} />
                      </span>
                      <span className="csHistN">{b.n}</span>
                    </li>
                  ))}
                </ol>
                <div className="csTwo">
                  <div>
                    <h3>The slowest answers</h3>
                    <ul className="csSlow">
                      {all.speed.slowest.map((w) => (
                        <li key={`${w.callId}|${w.ms}|${w.say}`}>
                          <b>{seconds(w.ms)}</b>
                          <span>
                            “{w.say.length > 70 ? `${w.say.slice(0, 70)}…` : w.say}”{!agentOnly && <span className="stMuted"> · {names[w.bot] || w.bot}</span>}
                          </span>
                          {onOpenCall && (
                            <button type="button" className="linkButton" onClick={() => onOpenCall(w.bot, w.callId)}>
                              Open the call
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {all.speed.tools.length > 0 && (
                    <div>
                      <h3>Tools, slowest first</h3>
                      <ul className="csSlow">
                        {all.speed.tools.slice(0, 6).map((t) => (
                          <li key={t.tool}>
                            <b>{seconds(t.avgMs)}</b>
                            <span>
                              {t.tool}{' '}
                              <span className="stMuted">
                                · {t.n} use{t.n === 1 ? '' : 's'}, slowest {seconds(t.maxMs)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="stMuted">None of these calls has an answer to time yet.</p>
            )}
          </section>

          {agentOnly ? (
            <section className="csSection" aria-labelledby="csAlt">
              <h2 id="csAlt">Another language model</h2>
              {!current ? (
                <p className="stMuted">The draft names no language model.</p>
              ) : alt.current === null ? (
                <p>
                  There is no price for <b>{modelName(current.provider, current.model)}</b>, so it can’t be compared.{' '}
                  <button type="button" className="linkButton" onClick={() => openPrices(priceKey(current.provider, current.model))}>
                    Add a price
                  </button>
                </p>
              ) : (
                <>
                  <p className="stMuted">
                    With the same conversations ({Math.round(all.tokens.input || 0).toLocaleString('en-US')} tokens in and{' '}
                    {Math.round(all.tokens.output || 0).toLocaleString('en-US')} out a call), {modelName(current.provider, current.model)} costs{' '}
                    {money(alt.current)} a call. Others would cost:
                  </p>
                  <table className="csTable">
                    <thead>
                      <tr>
                        <th scope="col">Model</th>
                        <th scope="col">A call</th>
                        <th scope="col">A month, as lately</th>
                        <th scope="col">
                          <span className="srOnly">Use it</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {alt.options.slice(0, 8).map((o) => (
                        <tr key={o.key} className={o.saving > 0.05 ? 'cheaper' : ''}>
                          <td>
                            <b>{o.model}</b> <span className="stMuted">{providerLabel(o.provider)}</span>
                          </td>
                          <td>
                            {money(o.costPerCall)}{' '}
                            {o.saving !== null && Math.abs(o.saving) >= 0.01 && (
                              <span className={`csDelta ${o.saving > 0 ? 'good' : ''}`}>{o.saving > 0 ? `−${pct(o.saving)}` : `+${pct(-o.saving)}`}</span>
                            )}
                          </td>
                          <td>{all.perDay !== null ? money(o.costPerCall * all.perDay * 30) : '–'}</td>
                          <td>
                            {o.sameProvider && editor ? (
                              <button type="button" className="quietButton" onClick={() => switchModel(o)} disabled={!config}>
                                Use in the draft
                              </button>
                            ) : (
                              <span className="stMuted" title="Another provider needs its own key: choose it on the Agent page">
                                Another provider
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="stMuted csFine">
                    {cheaper.length
                      ? `${cheaper.length} model${cheaper.length === 1 ? ' is' : 's are'} cheaper. `
                      : 'It is already one of the cheapest with a price. '}
                    This compares prices only: a smaller model can follow instructions less well, so run the tests after a change.
                  </p>
                </>
              )}
            </section>
          ) : (
            <section className="csSection" aria-labelledby="csAgents">
              <h2 id="csAgents">By agent</h2>
              <table className="csTable">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col">Model</th>
                    <th scope="col">Calls</th>
                    <th scope="col">A call</th>
                    <th scope="col">A month</th>
                    <th scope="col">To answer</th>
                    <th scope="col">Within {target} s</th>
                    <th scope="col">
                      <span className="srOnly">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perAgent
                    .sort((a, b) => (b.summary.monthly || 0) - (a.summary.monthly || 0))
                    .map(({ bot, summary, models }) => (
                      <tr key={bot.id}>
                        <td>
                          <b>{bot.name || bot.id}</b>
                        </td>
                        <td>{models?.llm ? models.llm.model : <span className="stMuted">–</span>}</td>
                        <td>{data.totals[bot.id] || 0}</td>
                        <td>
                          {money(summary.costPerCall)}
                          {summary.missing.length > 0 && (
                            <span className="csTag warn" title="Part of the cost has no price">
                              partial
                            </span>
                          )}
                        </td>
                        <td>{money(summary.monthly)}</td>
                        <td>{seconds(summary.speed.p50)}</td>
                        <td className={summary.speed.within !== null && summary.speed.within < 0.8 ? 'csWarnText' : ''}>{pct(summary.speed.within)}</td>
                        <td>
                          {onOpenAgent && (
                            <button type="button" className="linkButton" onClick={() => onOpenAgent(bot.id, 'cost')}>
                              Open
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      <section className="csSection" ref={pricesRef} aria-labelledby="csPricesHead">
        <button type="button" className="csFold" aria-expanded={pricesOpen} onClick={() => setPricesOpen((v) => !v)} id="csPricesHead">
          <Icon name="chevronRight" size={16} />
          Prices
          <span className="stMuted">
            {' '}
            · list prices checked {PRICES_REVIEWED}
            {ownPriceCount(own) ? `, ${ownPriceCount(own)} of yours` : ''}
          </span>
        </button>
        {pricesOpen && <PriceTable prices={prices} own={own} missing={all.missing} focusKey={focusKey} />}
      </section>
    </div>
  );
}
