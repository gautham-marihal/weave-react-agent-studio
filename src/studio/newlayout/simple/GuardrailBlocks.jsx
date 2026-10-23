import React, { useState } from 'react';
import {
  LIMITS,
  MOMENTS,
  endingTools,
  limitsOf,
  momentsOf,
  setLimit,
  setLimitSay,
  setMoment,
  setMomentWords,
  setOffTopic,
  setTopics,
  topicsOf,
} from './guardrailModel.js';
import { Card, Chips, NumberBox, SayField } from './SimpleParts.jsx';

// The top of the Guardrails page, in plain words: the topics it keeps to, when it hands over or ends the call by itself, and the limits on a call.
// The checks on what is said (with their own pickers) are in the lists below these.

export function TopicsBlock({ config, set }) {
  const topics = topicsOf(config);
  const tools = endingTools(config);
  const off = topics.offTopic;
  const offOn = !!off;
  const firstTool = tools[0]?.id || '';
  return (
    <div className="suFields">
      <Chips
        label="What it talks about"
        help="Leave it empty and it talks about anything its instructions allow."
        items={topics.allowed}
        placeholder="appointments"
        onChange={(items) => set(setTopics(config, 'allowed', items))}
      />
      <Chips
        label="What it must not talk about"
        help="It declines politely and comes back to what it is for."
        items={topics.blocked}
        placeholder="politics"
        onChange={(items) => set(setTopics(config, 'blocked', items))}
      />
      <Card
        icon="flag"
        title="When someone keeps going off topic"
        text="After a few tries, it ends the conversation or passes them on."
        on={offOn}
        onToggle={tools.length || offOn ? (on) => set(setOffTopic(config, on && firstTool ? { strikes: 3, then: firstTool } : null)) : null}
      >
        {!tools.length && !offOn ? (
          <p className="suNote">Switch on ending the conversation, or passing people to a person, on the Tools page first: this uses one of them.</p>
        ) : offOn ? (
          <>
            <div className="smSentence">
              <span>After</span>
              <NumberBox value={off.strikes} aria-label="How many tries" onChange={(v) => v !== '' && set(setOffTopic(config, { ...off, strikes: v }))} />
              <span>tries, it will</span>
              <select
                className="stFInput smSelect"
                aria-label="What it does then"
                value={off.then}
                onChange={(event) => set(setOffTopic(config, { ...off, then: event.target.value }))}
              >
                {/* a rule made by hand without a tool: nothing is shown as chosen until one is */}
                {!off.then && (
                  <option value="" disabled>
                    Choose what it does
                  </option>
                )}
                {!tools.some((t) => t.id === off.then) && off.then && <option value={off.then}>Run “{off.then}”</option>}
                {tools.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <SayField
              label="What it says first"
              value={off.say}
              refId={off.sayRef}
              placeholder="I can only help with our services, so I’ll stop here."
              onChange={(text) => set(setOffTopic(config, { ...off, say: text, sayRef: text.trim() ? '' : off.sayRef }))}
            />
          </>
        ) : null}
      </Card>
    </div>
  );
}

export function MomentsBlock({ config, set }) {
  const state = momentsOf(config);
  const [refused, setRefused] = useState({}); // { [moment id]: why its last word was kept }
  return (
    <div className="suFields">
      {MOMENTS.map((m) => {
        const s = state[m.id];
        return (
          <Card
            key={m.id}
            icon={m.needs === 'transfer' ? 'phoneTransfer' : 'endCall'}
            title={m.label}
            text={s.changed || (s.possible ? m.text : s.why)}
            on={s.on}
            onToggle={
              s.possible || s.on
                ? (on) => {
                    setRefused({ ...refused, [m.id]: '' });
                    set(setMoment(config, m.id, on, { keywords: s.keywords }));
                  }
                : null
            }
          >
            {/* the words are asked here only while the rule still listens for words; one changed in the list below is changed there */}
            {s.on && m.keywords && !s.changed ? (
              <>
                <Chips
                  label="The words"
                  items={s.keywords}
                  placeholder="refund"
                  onChange={(items) => {
                    const result = setMomentWords(config, m.id, items);
                    setRefused({ ...refused, [m.id]: result.refused });
                    if (!result.refused) set(result.config);
                  }}
                />
                {refused[m.id] && (
                  <p className="suNote warn" role="alert">
                    {refused[m.id]}
                  </p>
                )}
              </>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

//   onShowNudges(): opens Settings › Conversation flow, where the nudges before the silence limit are set
export function LimitsBlock({ config, set, onShowNudges = null }) {
  const limits = limitsOf(config);
  const any = Object.keys(limits.values).length > 0;
  return (
    <div className="suFields">
      <div className="smLimits">
        {LIMITS.map((l) => (
          <label key={l.key} className="smLimit">
            <span className="smLimitText">
              <strong>{l.label}</strong>
              <small>{l.help}</small>
            </span>
            <span className="smWithUnit">
              <NumberBox
                value={l.toInput(limits.values[l.key])}
                placeholder="No limit"
                aria-label={l.unit ? `${l.label}, in ${l.unit}` : l.label}
                onChange={(v) => set(setLimit(config, l.key, v))}
              />
              <span className="smUnit">{l.unit}</span>
            </span>
          </label>
        ))}
      </div>
      {/* shown while there is a limit, or a line typed for one (kept while a limit is being retyped) */}
      {(any || limits.say || limits.sayRef) && (
        <SayField
          label="What it says when a limit ends the call"
          help={any ? '' : 'No limit is set, so this is not said.'}
          value={limits.say}
          refId={limits.sayRef}
          placeholder="I’m sorry, I have to end the call now. Please get in touch again."
          onChange={(text) => set(setLimitSay(config, text))}
        />
      )}
      <p className="suNote">
        The gentle nudges when someone goes quiet, before this limit, are under{' '}
        {onShowNudges ? (
          <button type="button" className="linkButton" onClick={onShowNudges}>
            Settings › Conversation flow
          </button>
        ) : (
          'Settings › Conversation flow'
        )}
        .
      </p>
    </div>
  );
}
