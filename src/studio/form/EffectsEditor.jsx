import React from 'react';
import { isObj } from './engine.js';
import { useForm } from './ctx.js';
import Node from './Node.jsx';
import { ACTION_KINDS, describeAction, describeRule, kindLabel, moveItem } from './effects.js';

// A list of actions as ordered, numbered steps: pick what each step does from a plain-language menu, and fill in its details with
// the ordinary form for that kind of action. Used wherever the schema asks for actions (a tool's effects, an agent's on-enter
// steps, a transfer's fallbacks, what to do when a caller goes quiet…), so every trigger point reads the same. `label` names the
// list for screen readers ("rule 1", "the list").
export function ActionSteps({ shape, value, path, onChange, disabled, label = 'the list' }) {
  const ctx = useForm();
  const { engine } = ctx;
  const actions = Array.isArray(value) ? value : [];
  const actionSchema = shape.items;
  const branches = engine.branchesOf(engine.flatten(actionSchema));
  const branchOf = (type) => branches.find((branch) => engine.flatten(branch).properties?.type?.const === type);
  const kinds = ACTION_KINDS.filter((kind) => branchOf(kind.type));
  const makeAction = (type) => engine.defaultFor(branchOf(type));
  const where = path.join('.');

  return (
    <>
      <ol className="stActions" aria-label={`What ${label} does, in order`}>
        {actions.map((action, j) => {
          const type = isObj(action) ? action.type : undefined;
          const branch = branchOf(type);
          return (
            <li key={j} className="stAction" data-path={`${where}.${j}`}>
              <div className="stActionHead">
                <span className="stActionNo" aria-hidden="true">{j + 1}</span>
                <select className="stFInput small" value={branch ? type : ''} disabled={disabled} aria-label={`Step ${j + 1} of ${label}: what to do`}
                  onChange={(event) => { if (event.target.value && event.target.value !== type) onChange(actions.map((a, k) => (k === j ? makeAction(event.target.value) : a))); }}>
                  {!branch && <option value="">{type ? kindLabel(type) : 'Choose…'}</option>}
                  {kinds.map((kind) => <option key={kind.type} value={kind.type}>{kind.label}</option>)}
                </select>
                {!disabled && (
                  <span className="stRuleActions">
                    <button type="button" className="stIconBtn" aria-label={`Move step ${j + 1} of ${label} up`} disabled={j === 0} onClick={() => onChange(moveItem(actions, j, j - 1))}>↑</button>
                    <button type="button" className="stIconBtn" aria-label={`Move step ${j + 1} of ${label} down`} disabled={j === actions.length - 1} onClick={() => onChange(moveItem(actions, j, j + 1))}>↓</button>
                    <button type="button" className="stIconBtn danger" aria-label={`Delete step ${j + 1} of ${label}`} onClick={() => { ctx.markDelete(`step ${j + 1} of ${label}`); onChange(actions.filter((_, k) => k !== j)); }}>×</button>
                  </span>
                )}
              </div>
              <p className="stActionSentence">{describeAction(action)}</p>
              <Node schema={branch || actionSchema} value={action} path={[...path, j]} onChange={(next) => onChange(actions.map((a, k) => (k === j ? next : a)))} disabled={disabled} />
            </li>
          );
        })}
      </ol>
      {actions.length === 0 && (engine.flatten(shape).minItems >= 1 ? <p className="stFWarn">Needs at least one step.</p> : <p className="stFEmpty">No steps yet.</p>)}
      {!disabled && (
        <select className="stFInput small" value="" aria-label={`Add a step to ${label}`} onChange={(event) => { if (event.target.value) onChange([...actions, makeAction(event.target.value)]); }}>
          <option value="">＋ Add a step…</option>
          {kinds.map((kind) => <option key={kind.type} value={kind.type}>{kind.label}</option>)}
        </select>
      )}
    </>
  );
}

// A tool's effects as readable rules: each rule says when it applies ("Always", or a condition) and then lists, in order, what happens
// (say a line, change state, hand off, end the call…). Each rule is also written out as a sentence. The details of an action are the
// ordinary form for that kind of action, so nothing the schema allows is out of reach.
// A list of rules (`when` + `do`): each applies always or when a condition holds, then does its steps in order. Used for a tool's effects.
export default function EffectsEditor({ shape, value, path, onChange, disabled, emptyText = 'No rules yet. Add one to say a line, change state, hand off or end the call.' }) {
  const ctx = useForm();
  const { engine } = ctx;
  const rules = Array.isArray(value) ? value : [];
  const ruleShape = engine.flatten(shape.items);
  const whenSchema = ruleShape.properties.when;
  const makeAction = (type) => engine.defaultFor(engine.branchesOf(engine.flatten(ruleShape.properties.do.items)).find((branch) => engine.flatten(branch).properties?.type?.const === type));
  const setRule = (index, rule) => onChange(rules.map((item, i) => (i === index ? rule : item)));
  const removeRule = (index) => { ctx.markDelete(`rule ${index + 1}`); onChange(rules.filter((_, i) => i !== index)); };
  const addRule = () => onChange([...rules, { do: [makeAction('say')] }]);

  return (
    <div className="stEffects">
      {rules.length === 0 && <p className="stFEmpty">{emptyText}</p>}
      {rules.map((rule, index) => {
        const actions = Array.isArray(rule?.do) ? rule.do : [];
        const hasWhen = isObj(rule) && rule.when !== undefined;
        const setActions = (next) => setRule(index, { ...rule, do: next });
        return (
          <section className="stRule" key={index} data-path={`${path.join('.')}.${index}`} aria-label={`Rule ${index + 1}`}>
            <header>
              <strong>Rule {index + 1}</strong>
              <span className="stRuleSentence">{describeRule(rule)}</span>
              {!disabled && (
                <span className="stRuleActions">
                  <button type="button" className="stIconBtn" aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={() => onChange(moveItem(rules, index, index - 1))}>↑</button>
                  <button type="button" className="stIconBtn" aria-label={`Move rule ${index + 1} down`} disabled={index === rules.length - 1} onClick={() => onChange(moveItem(rules, index, index + 1))}>↓</button>
                  <button type="button" className="stFDel small" aria-label={`Delete rule ${index + 1}`} onClick={() => removeRule(index)}>Delete</button>
                </span>
              )}
            </header>

            <div className="stRuleWhen">
              <span className="stRuleLabel">When</span>
              {hasWhen ? (
                <div className="stRuleCondition">
                  <Node schema={whenSchema} value={rule.when} path={[...path, index, 'when']} onChange={(next) => setRule(index, { ...rule, when: next })} disabled={disabled} />
                  {!disabled && <button type="button" className="stLink" onClick={() => { ctx.markDelete('the condition'); const { when: _gone, ...rest } = rule; setRule(index, rest); }}>Remove the condition (always do this)</button>}
                </div>
              ) : (
                <span>Always{!disabled && <> <button type="button" className="stLink" onClick={() => setRule(index, { when: engine.defaultFor(whenSchema), ...rule })}>Only when…</button></>}</span>
              )}
            </div>

            <ActionSteps shape={ruleShape.properties.do} value={actions} path={[...path, index, 'do']} disabled={disabled} label={`rule ${index + 1}`}
              onChange={setActions} />
          </section>
        );
      })}
      {!disabled && <button type="button" className="stAddBtn" onClick={addRule}>＋ Add a rule</button>}
    </div>
  );
}
