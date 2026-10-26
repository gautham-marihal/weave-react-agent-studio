import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { PartPanel, PartRow, Parts } from '../../ui/Parts.tsx';
import ChoiceMenu from '../../ui/ChoiceMenu.tsx';
import { DemoNote } from '../../demo/DemoBadge.jsx';
import { formatWhen } from '../format.js';
import { navigate, routeHref } from '../route.js';
import { Notice } from '../ui.jsx';
import { decideQuestion, questionDecisions, undoQuestion, useInsights } from './insightsStore.js';
import { REASONS, addAnswer, addTest, answerInDraft, askedSince, closeness, removeAnswer, ruleFor, testFor, SAME_QUESTION } from './questionsModel.js';
import { useQuestions } from './useQuestions.js';
import Select from '../../ui/Select.tsx';
import './insights.css';

const PERIODS = [
  [7, 'Last 7 days'],
  [14, 'Last 14 days'],
  [30, 'Last 30 days'],
];
const DISMISS = [
  ['not_for_it', 'It shouldn’t answer this'],
  ['fixed', 'Already taken care of'],
  ['not_a_question', 'Not a real question'],
];
const DISMISS_LABEL = Object.fromEntries(DISMISS);
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

// which decision belongs to which group: the closest one, if it is close enough
function matchDecisions(groups, decisions) {
  const byGroup = new Map();
  const used = new Set();
  groups.forEach((g) => {
    let best = null;
    let bestScore = 0;
    decisions.forEach((d) => {
      const score = closeness(g.words, d.words || d.text);
      if (score > bestScore) {
        best = d;
        bestScore = score;
      }
    });
    if (best && bestScore >= SAME_QUESTION) {
      byGroup.set(g, best);
      used.add(best);
    }
  });
  return { byGroup, unmatched: decisions.filter((d) => !used.has(d)) };
}

function ReasonChips({ reasons }) {
  return (
    <div className="inChips">
      {Object.entries(reasons)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, n]) => (
          <span key={reason} className={`inChip ${reason === 'passed_on' ? 'warn' : ''}`}>
            {REASONS[reason]?.label || reason}
            {n > 1 ? ` · ${n}` : ''}
          </span>
        ))}
    </div>
  );
}

// The wordings callers used, and the calls it was asked in: folded into one line until asked for (`open` shows them at once).
function Evidence({ group, onOpenCall, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const ways = group.wordings.length;
  const summary = [ways > 1 ? `${ways} ways of asking it` : '', `${group.calls.length} call${group.calls.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return (
    <div className="inEvidence">
      {!startOpen && (
        <button type="button" className="inMore" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name="chevronRight" size={14} />
          {open ? 'Hide how it was asked' : `How it was asked: ${summary}`}
        </button>
      )}
      {open && ways > 1 && (
        <ul className="inWordings" aria-label="How callers put it">
          {group.wordings.slice(0, 6).map((w) => (
            <li key={w.text}>
              <span>{w.text}</span>
              {w.count > 1 && <small className="stMuted"> · {times(w.count)}</small>}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="inQCalls">
          <span className="stMuted">Asked in</span>
          {group.calls.slice(0, 8).map((c) => (
            <button
              key={c.callId}
              type="button"
              className="linkButton"
              onClick={() => onOpenCall(c.callId)}
              title={`“${c.text}”: ${REASONS[c.reason]?.label || ''}`}
            >
              the call {formatWhen(c.startedAt)}
            </button>
          ))}
          {group.calls.length > 8 && <span className="stMuted">and {group.calls.length - 8} more</span>}
        </div>
      )}
    </div>
  );
}

function AnswerForm({ group, agents, defaultAgent, initial = '', onCancel, onSave, changing = false }) {
  const [answer, setAnswer] = useState(initial);
  const [agentId, setAgentId] = useState(defaultAgent);
  const [withTest, setWithTest] = useState(true);
  const ready = answer.trim().length >= 3;
  const agentName = agents.find((a) => a.id === agentId)?.name || agentId;
  const id = `answer-${group.key.replace(/\W+/g, '-')}`;
  return (
    <form
      className="inAnswer"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSave({ answer: answer.trim(), agentId, withTest });
      }}
    >
      <label htmlFor={id}>
        <span>What should it say?</span>
      </label>
      <textarea
        id={id}
        className="stFInput"
        autoFocus
        value={answer}
        placeholder="For example: We deliver Monday to Saturday. Sunday delivery isn’t available yet, but next-day delivery on Saturday is."
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && ready) onSave({ answer: answer.trim(), agentId, withTest });
        }}
      />
      <div className="inAnswerRow">
        {agents.length > 1 && (
          <label>
            Who answers it
            <Select className="stFInput" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {!changing && (
          <label>
            <input type="checkbox" checked={withTest} onChange={(event) => setWithTest(event.target.checked)} />
            Also add a test that asks it
          </label>
        )}
      </div>
      {ready && (
        <p className="inPreview">
          Added to the instructions of {agentName}: {ruleFor(group.text, answer)}
        </p>
      )}
      <div className="inActions">
        <button type="submit" className="primaryCta compactCta" disabled={!ready}>
          {changing ? 'Change the answer' : 'Add to the draft'}
        </button>
        <button type="button" className="quietButton" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DismissMenu({ onPick }) {
  return <ChoiceMenu label="Dismiss" menuLabel="Why dismiss it" align="end" choices={DISMISS.map(([id, label]) => [label, () => onPick(id)])} />;
}

// "Questions it couldn't answer": what callers asked this agent that it did not know, passed on, or found nothing for, grouped however it was worded;
// each one answered in a sentence (added to the agent's instructions in the draft, with a test that asks it) or dismissed.
export default function QuestionsPage({ botId, editor, onOpenCall }) {
  const [days, setDays] = useState(14);
  const [tab, setTab] = useState('open');
  const [answering, setAnswering] = useState(null); // group key
  // an answer's form closed without saving: the keyboard goes back to the button that opened it (gone while the form was open, so it is found again)
  const [refocus, setRefocus] = useState(null);
  useEffect(() => {
    if (refocus === null) return;
    document.querySelector(`[data-answer-for="${CSS.escape(refocus)}"]`)?.focus({ preventScroll: true });
    setRefocus(null);
  }, [refocus]);
  const cancelAnswer = (key) => {
    setAnswering(null);
    setRefocus(key);
  };
  const [showOnce, setShowOnce] = useState(false);
  const [done, setDone] = useState(null); // { text, agentName, testId, decision }
  const { loading, error, groups, read, total, truncated, failed, at, refresh } = useQuestions(botId, { days });
  const insights = useInsights();
  const decisions = questionDecisions(insights, botId);
  const config = editor.parsed.value;
  const agents = useMemo(
    () =>
      (Array.isArray(config?.agents?.items) ? config.agents.items : [])
        .filter((a) => a && typeof a === 'object' && a.id)
        .map((a) => ({ id: a.id, name: a.name || a.id })),
    [config],
  );
  const entry = config?.agents?.entry || agents[0]?.id || '';
  const defaultAgentFor = (group) => group.agents.find((id) => agents.some((a) => a.id === id)) || entry;
  const agentName = (id) => agents.find((a) => a.id === id)?.name || id;
  const openCall = onOpenCall || ((callId) => navigate(routeHref(botId, 'calls', { call: callId }), { guard: false }));

  const { byGroup, unmatched } = useMemo(() => matchDecisions(groups, decisions), [groups, decisions]);
  const open = groups.filter((g) => !byGroup.has(g));
  const answered = [
    ...groups.filter((g) => byGroup.get(g)?.kind === 'answered').map((g) => ({ group: g, decision: byGroup.get(g) })),
    ...unmatched.filter((d) => d.kind === 'answered').map((d) => ({ group: null, decision: d })),
  ];
  const dismissed = [
    ...groups.filter((g) => byGroup.get(g)?.kind === 'dismissed').map((g) => ({ group: g, decision: byGroup.get(g) })),
    ...unmatched.filter((d) => d.kind === 'dismissed').map((d) => ({ group: null, decision: d })),
  ];
  const askedTimes = open.reduce((n, g) => n + g.count, 0);

  const save = (group, { answer, agentId, withTest }, previous = null) => {
    let next = previous ? removeAnswer(config, previous) : config;
    next = addAnswer(next, { agentId, question: group.text, answer });
    let testId = previous?.testId || '';
    if (withTest && !previous) {
      const test = testFor(next, { question: group.text, answer, agentId, wasPassedOn: !!group.reasons.passed_on });
      next = addTest(next, test);
      testId = test.id;
    }
    editor.setValue(next);
    const decision = { words: group.words, text: group.text, kind: 'answered', answer, agentId, rule: ruleFor(group.text, answer), testId };
    decideQuestion(botId, decision);
    setAnswering(null);
    setDone({ text: group.text, agentName: agentName(agentId), testId, decision, changed: !!previous, before: config, after: next });
  };
  // right after answering, with nothing else changed since, the draft goes back exactly as it was; later, the rule and its test are taken out of it
  const undo = (decision) => {
    if (done?.decision === decision && JSON.stringify(config) === JSON.stringify(done.after)) editor.setValue(done.before);
    else if (config) editor.setValue(removeAnswer(config, decision));
    undoQuestion(botId, decision.text);
    setDone(null);
  };

  const canEdit = !!config && agents.length > 0;
  // asked more than once first; the ones asked once wait behind a line, so a stray question doesn't bury the ones that keep coming
  const repeated = open.filter((g) => g.count > 1);
  const once = open.filter((g) => g.count <= 1);
  const openRow = (group) => (
    <li key={group.key} className="inQ">
      <div className="inQHead">
        <span className="inQCount" title={`Asked ${times(group.count)}`}>
          <span>
            {group.count}
            <small>{group.count === 1 ? 'call' : 'calls'}</small>
          </span>
        </span>
        <div className="inQMain">
          <h3>{group.text}</h3>
          <p>
            Last asked {formatWhen(group.lastAt)}
            {group.count > 1 && group.firstAt !== group.lastAt ? `, first ${formatWhen(group.firstAt)}` : ''}
          </p>
          <ReasonChips reasons={group.reasons} />
        </div>
        {answering !== group.key && (
          <div className="inActions">
            <button type="button" className="secondaryCta compactCta" disabled={!canEdit} onClick={() => setAnswering(group.key)} data-answer-for={group.key}>
              Answer it
            </button>
            <DismissMenu onPick={(reason) => decideQuestion(botId, { words: group.words, text: group.text, kind: 'dismissed', reason })} />
          </div>
        )}
      </div>
      <Evidence group={group} onOpenCall={openCall} />
      {answering === group.key && (
        <AnswerForm
          group={group}
          agents={agents}
          defaultAgent={defaultAgentFor(group)}
          onCancel={() => cancelAnswer(group.key)}
          onSave={(a) => save(group, a)}
        />
      )}
    </li>
  );

  return (
    <div className="inPage inQuestions">
      <DemoNote kind="calls">These are made-up calls. The questions in them are examples of what this page finds.</DemoNote>
      <div className="inQToolbar">
        <p className="inQSummary" role="status">
          {loading && !at ? (
            'Reading the calls…'
          ) : (
            <span>
              {open.length ? (
                <>
                  <strong>
                    {open.length} question{open.length === 1 ? '' : 's'}
                  </strong>{' '}
                  it couldn’t answer, asked {times(askedTimes)}
                </>
              ) : (
                <strong>Nothing left to answer</strong>
              )}
              , from {read} call{read === 1 ? '' : 's'}
              {truncated ? ` (the newest ${read} of ${total}${total >= 500 ? '+' : ''})` : ''} in the {PERIODS.find((p) => p[0] === days)?.[1].toLowerCase()}.
              {loading && ' Reading again…'}
            </span>
          )}
        </p>
        <div className="inActions" style={{ margin: 0 }}>
          <Select className="stFInput" value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Period">
            {PERIODS.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </Select>
          <button type="button" className="quietButton" onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <Notice kind="error" title="The calls couldn’t be read">
          {error}
        </Notice>
      )}
      {failed > 0 && (
        <Notice kind="warn" title={`${failed} call${failed === 1 ? '' : 's'} couldn’t be read`}>
          Their questions are left out. Refresh to try again.
        </Notice>
      )}
      {!config && (
        <Notice kind="warn" title="The draft isn’t valid JSON right now">
          Fix it on the Settings page’s JSON to add answers from here.
        </Notice>
      )}
      {done && (
        <Notice
          kind="good"
          title={done.changed ? 'Answer changed in the draft' : 'Added to the draft'}
          actions={
            <>
              {done.testId && (
                <button type="button" className="quietButton" onClick={() => navigate(routeHref(botId, 'scenarios'), { guard: false })}>
                  See the test
                </button>
              )}
              <button type="button" className="quietButton" onClick={() => undo(done.decision)}>
                Undo
              </button>
            </>
          }
        >
          {done.agentName} will answer “{done.text}” once the draft is saved and published
          {done.testId ? ', and a test now asks it, so it stays answered' : ''}.
        </Notice>
      )}

      <Parts value={tab} onChange={setTab}>
        <PartRow
          className="inTabs"
          label="Questions"
          value={tab}
          items={[
            ['open', 'To answer', open.length],
            ['answered', 'Answered', answered.length],
            ['dismissed', 'Dismissed', dismissed.length],
          ].map(([id, label, n]) => ({ id, label: `${label}${n ? ` (${n})` : ''}` }))}
        />
        <PartPanel value={tab}>
          {tab === 'open' &&
            (loading && !at ? (
              <p className="stMuted">Finding the questions callers asked that it didn’t answer…</p>
            ) : open.length === 0 ? (
              <div className="inEmpty">
                <strong>{groups.length ? 'All caught up' : read ? 'Every question was answered' : 'No calls yet'}</strong>
                <p>
                  {groups.length
                    ? 'Every question callers asked that it couldn’t answer has been answered or dismissed.'
                    : read
                      ? `In ${read} call${read === 1 ? '' : 's'}, the agent didn’t say it didn’t know, pass anyone on, or come up empty. Try a longer period to look further back.`
                      : 'When people call this agent, the questions it can’t answer show up here, grouped however they were worded.'}
                </p>
              </div>
            ) : (
              <>
                <ul className="inQList">{(repeated.length ? repeated : once).map(openRow)}</ul>
                {repeated.length > 0 && once.length > 0 && (
                  <>
                    <button type="button" className="inMore" aria-expanded={showOnce} onClick={() => setShowOnce((v) => !v)}>
                      <Icon name="chevronRight" size={14} />
                      {showOnce ? 'Hide the questions asked once' : `Asked once: ${once.length} more question${once.length === 1 ? '' : 's'}`}
                    </button>
                    {showOnce && <ul className="inQList">{once.map(openRow)}</ul>}
                  </>
                )}
              </>
            ))}

          {tab === 'answered' &&
            (answered.length === 0 ? (
              <div className="inEmpty">
                <strong>Nothing answered yet</strong>
                <p>A question you answer here moves to this list, with whether callers still ask it unanswered.</p>
              </div>
            ) : (
              <ul className="inQList">
                {answered.map(({ group, decision }) => {
                  const since = group ? askedSince(group, decision.at) : [];
                  const inDraft = config ? answerInDraft(config, decision) : true;
                  const key = group?.key || decision.text;
                  return (
                    <li key={key} className="inQ">
                      <div className="inQHead">
                        <span className="inQCount" aria-hidden="true">
                          <Icon name="check" size={18} />
                        </span>
                        <div className="inQMain">
                          <h3>{decision.text}</h3>
                          <p>
                            Answered {formatWhen(decision.at)}
                            {decision.agentId && agents.length > 1 ? ` by ${agentName(decision.agentId)}` : ''}: “{decision.answer}”
                          </p>
                        </div>
                        {answering !== key && (
                          <div className="inActions">
                            {group && canEdit && (
                              <button type="button" className="quietButton" onClick={() => setAnswering(key)} data-answer-for={key}>
                                Change the answer
                              </button>
                            )}
                            <button
                              type="button"
                              className="quietButton"
                              onClick={() => undo(decision)}
                              title="Take the answer (and its test) out of the draft"
                            >
                              Undo
                            </button>
                          </div>
                        )}
                      </div>
                      {!group && loading ? (
                        <p className="stMuted">Checking the calls…</p>
                      ) : !inDraft ? (
                        <p className="inDone again">The answer isn’t in the draft any more. Undo to put the question back on the list.</p>
                      ) : since.length ? (
                        <p className="inDone again">
                          Asked {times(since.length)} since, still unanswered. Publish the draft if you haven’t, or make the answer clearer.
                        </p>
                      ) : (
                        <p className="inDone">
                          {group ? 'Not asked unanswered since.' : `Not asked unanswered in the ${PERIODS.find((p) => p[0] === days)?.[1].toLowerCase()}.`}
                        </p>
                      )}
                      {group && since.length > 0 && <Evidence open group={{ ...group, calls: since, wordings: [] }} onOpenCall={openCall} />}
                      {group && answering === key && (
                        <AnswerForm
                          group={group}
                          agents={agents}
                          defaultAgent={decision.agentId || defaultAgentFor(group)}
                          initial={decision.answer}
                          changing
                          onCancel={() => cancelAnswer(key)}
                          onSave={(a) => save(group, a, decision)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}

          {tab === 'dismissed' &&
            (dismissed.length === 0 ? (
              <div className="inEmpty">
                <strong>Nothing dismissed</strong>
                <p>Questions it shouldn’t answer, or that are taken care of, go here so they stop coming back.</p>
              </div>
            ) : (
              <ul className="inQList">
                {dismissed.map(({ group, decision }) => (
                  <li key={group?.key || decision.text} className="inQ">
                    <div className="inQHead">
                      <span className="inQCount">{group ? group.count : '–'}</span>
                      <div className="inQMain">
                        <h3>{decision.text}</h3>
                        <p>
                          {DISMISS_LABEL[decision.reason] || 'Dismissed'} · {formatWhen(decision.at)}
                        </p>
                      </div>
                      <div className="inActions">
                        <button type="button" className="quietButton" onClick={() => undoQuestion(botId, decision.text)}>
                          Bring it back
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </PartPanel>
      </Parts>
    </div>
  );
}
