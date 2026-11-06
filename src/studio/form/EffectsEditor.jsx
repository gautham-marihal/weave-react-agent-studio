import React from 'react';
import SmartSelect from '../SmartSelect.jsx';
import { isObj } from './engine.js';
import { useForm, useItemKeys } from './ctx.js';
import Node, { ObjectBody } from './Node.jsx';
import PictureStep, { PICTURE_STEPS } from '../pictures/PictureSteps.jsx';
import { ACTION_KINDS, describeAction, describeRule, kindLabel, moveItem } from './effects.js';
import { carryOver } from './cardLogic.js';
import Icon from '../../ui/Icon.jsx';
import { DragHandle, SortableItem, SortableList } from '../../ui/Sortable.jsx';

// A list of actions as numbered steps: a plain menu picks each kind (grouped: talk, state and flow, pictures, other
// systems), the ordinary form fills in the details, and any step can run "Only when…" a condition holds (schema 1.2).
// The picture steps have their own editor (pictures/PictureSteps.jsx). Used wherever the schema asks for actions, so
// every trigger reads the same. `label` names the list for screen readers.
export function ActionSteps({ shape, value, path, onChange, disabled, label = 'the list' }) {
  const ctx = useForm();
  const { engine } = ctx;
  const actions = Array.isArray(value) ? value : [];
  const keys = useItemKeys(actions);
  const actionSchema = shape.items;
  const branches = engine.branchesOf(engine.flatten(actionSchema));
  const branchOf = (type) => branches.find((branch) => engine.flatten(branch).properties?.type?.const === type);
  const kinds = ACTION_KINDS.filter((kind) => branchOf(kind.type));
  const makeAction = (type) => engine.defaultFor(branchOf(type));
  const where = path.join('.');
  const options = kinds.map((kind) => ({ value: kind.type, label: kind.label, group: kind.group, description: kind.hint }));
  // a step's own settings: all but its kind and its condition, which have their own places above and below
  const body = (action, j) => {
    const type = isObj(action) ? action.type : undefined;
    const branch = branchOf(type);
    const change = (next) => onChange(actions.map((a, k) => (k === j ? next : a)));
    if (!branch) return <Node schema={actionSchema} value={action} path={[...path, j]} onChange={change} disabled={disabled} />;
    const flat = engine.flatten(branch);
    if (PICTURE_STEPS.has(type)) return <PictureStep shape={flat} value={action} path={[...path, j]} onChange={change} disabled={disabled} />;
    const keys = Object.keys(flat.properties || {}).filter((k) => k !== 'type' && k !== 'when');
    return keys.length ? <ObjectBody shape={flat} value={action} path={[...path, j]} onChange={change} disabled={disabled} onlyKeys={keys} /> : null;
  };
  // "Only when…": the same condition editor as rules and hooks
  const condition = (action, j) => {
    const branch = branchOf(isObj(action) ? action.type : undefined);
    const whenSchema = branch ? engine.flatten(branch).properties?.when : null;
    if (!whenSchema) return null;
    const change = (next) => onChange(actions.map((a, k) => (k === j ? next : a)));
    if (action.when === undefined)
      return disabled ? null : (
        <p className="stActionWhen">
          <button type="button" className="stLink" onClick={() => change({ ...action, when: engine.defaultFor(whenSchema) })}>
            Only when…
          </button>
        </p>
      );
    return (
      <div className="stActionWhen">
        <span className="stRuleLabel">Only when</span>
        <div className="stActionWhenBody">
          <Node
            schema={whenSchema}
            value={action.when}
            path={[...path, j, 'when']}
            onChange={(next) => change({ ...action, when: next })}
            disabled={disabled}
          />
          {!disabled && (
            <button
              type="button"
              className="stLink"
              onClick={() => {
                ctx.markDelete(`the condition of step ${j + 1}`);
                const { when: _gone, ...rest } = action;
                change(rest);
              }}
            >
              Remove the condition (always do this)
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <ol className="stActions" aria-label={`What ${label} does, in order`}>
        <SortableList
          ids={keys}
          label={`the steps of ${label}`}
          nameOf={(id) => `step ${keys.indexOf(id) + 1} (${kindLabel(actions[keys.indexOf(id)]?.type)})`}
          onMove={(from, to) => onChange(moveItem(actions, from, to))}
        >
          {actions.map((action, j) => {
            const type = isObj(action) ? action.type : undefined;
            const branch = branchOf(type);
            return (
              <SortableItem as="li" id={keys[j]} key={keys[j]} className="stAction" data-path={`${where}.${j}`}>
                <div className="stActionHead">
                  <span className="stActionNo" aria-hidden="true">
                    {j + 1}
                  </span>
                  <SmartSelect
                    className="stFInput small"
                    value={branch ? type : ''}
                    disabled={disabled}
                    ariaLabel={`Step ${j + 1} of ${label}: what to do`}
                    placeholder={type ? kindLabel(type) : 'Choose…'}
                    options={options}
                    onChange={(chosen) => {
                      if (!chosen || chosen === type) return;
                      // what the new kind can hold too is kept (as other kind pickers
                      // do); the rest can be undone from the bar that says so
                      const made = carryOver(engine, action, branchOf(chosen), makeAction(chosen));
                      const lost = isObj(action) ? Object.keys(action).filter((key) => key !== 'type' && !(isObj(made) && key in made)) : [];
                      if (lost.length) ctx.markDelete(`the settings step ${j + 1} had for “${kindLabel(type)}”`);
                      onChange(actions.map((a, k) => (k === j ? made : a)));
                    }}
                  />
                  {!disabled && (
                    <span className="stRuleActions">
                      <DragHandle disabled={actions.length < 2} label={`Drag step ${j + 1} of ${label}`} />
                      <button
                        type="button"
                        className="stIconBtn"
                        aria-label={`Move step ${j + 1} of ${label} up`}
                        disabled={j === 0}
                        onClick={() => onChange(moveItem(actions, j, j - 1))}
                      >
                        <Icon name="chevronUp" size={14} />
                      </button>
                      <button
                        type="button"
                        className="stIconBtn"
                        aria-label={`Move step ${j + 1} of ${label} down`}
                        disabled={j === actions.length - 1}
                        onClick={() => onChange(moveItem(actions, j, j + 1))}
                      >
                        <Icon name="chevronDown" size={14} />
                      </button>
                      <button
                        type="button"
                        className="stIconBtn danger"
                        aria-label={`Delete step ${j + 1} of ${label}`}
                        onClick={() => {
                          ctx.markDelete(`step ${j + 1} of ${label}`);
                          onChange(actions.filter((_, k) => k !== j));
                        }}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </span>
                  )}
                </div>
                <p className="stActionSentence">{describeAction(action)}</p>
                {isObj(action) && condition(action, j)}
                {body(action, j)}
              </SortableItem>
            );
          })}
        </SortableList>
      </ol>
      {actions.length === 0 &&
        (Array.isArray(value) && engine.flatten(shape).minItems >= 1 ? (
          <p className="stFWarn">Needs at least one step.</p>
        ) : (
          <p className="stFEmpty">No steps yet.</p>
        ))}
      {!disabled && (
        <SmartSelect
          action
          className="stFInput small"
          ariaLabel={`Add a step to ${label}`}
          placeholder="Add a step…"
          options={options}
          onChange={(chosen) => {
            if (chosen) onChange([...actions, makeAction(chosen)]);
          }}
        />
      )}
    </>
  );
}

// A tool's effects as rules: each applies always or when a condition holds, does its steps in order, and is also
// written as a sentence. Action details use the ordinary form, so nothing the schema allows is out of reach.
export default function EffectsEditor({
  shape,
  value,
  path,
  onChange,
  disabled,
  emptyText = 'No rules yet. Add one to say a line, change state, hand off or end the call.',
}) {
  const ctx = useForm();
  const { engine } = ctx;
  const rules = Array.isArray(value) ? value : [];
  const ruleKeys = useItemKeys(rules);
  const ruleShape = engine.flatten(shape.items);
  const whenSchema = ruleShape.properties.when;
  const makeAction = (type) =>
    engine.defaultFor(
      engine.branchesOf(engine.flatten(ruleShape.properties.do.items)).find((branch) => engine.flatten(branch).properties?.type?.const === type),
    );
  const setRule = (index, rule) => onChange(rules.map((item, i) => (i === index ? rule : item)));
  const removeRule = (index) => {
    ctx.markDelete(`rule ${index + 1}`);
    onChange(rules.filter((_, i) => i !== index));
  };
  const addRule = () => onChange([...rules, { do: [makeAction('say')] }]);

  return (
    <div className="stEffects">
      {rules.length === 0 && <p className="stFEmpty">{emptyText}</p>}
      <SortableList
        ids={ruleKeys}
        label="the rules"
        nameOf={(id) => `rule ${ruleKeys.indexOf(id) + 1}`}
        onMove={(from, to) => onChange(moveItem(rules, from, to))}
      >
        {rules.map((rule, index) => {
          const actions = Array.isArray(rule?.do) ? rule.do : [];
          const hasWhen = isObj(rule) && rule.when !== undefined;
          const setActions = (next) => setRule(index, { ...rule, do: next });
          return (
            <SortableItem
              as="section"
              id={ruleKeys[index]}
              key={ruleKeys[index]}
              className="stRule"
              data-path={`${path.join('.')}.${index}`}
              aria-label={`Rule ${index + 1}`}
            >
              <header>
                <strong>Rule {index + 1}</strong>
                <span className="stRuleSentence">{describeRule(rule)}</span>
                {!disabled && (
                  <span className="stRuleActions">
                    <DragHandle disabled={rules.length < 2} label={`Drag rule ${index + 1}`} />
                    <button
                      type="button"
                      className="stIconBtn"
                      aria-label={`Move rule ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => onChange(moveItem(rules, index, index - 1))}
                    >
                      <Icon name="chevronUp" size={14} />
                    </button>
                    <button
                      type="button"
                      className="stIconBtn"
                      aria-label={`Move rule ${index + 1} down`}
                      disabled={index === rules.length - 1}
                      onClick={() => onChange(moveItem(rules, index, index + 1))}
                    >
                      <Icon name="chevronDown" size={14} />
                    </button>
                    <button type="button" className="stFDel small" aria-label={`Delete rule ${index + 1}`} onClick={() => removeRule(index)}>
                      Delete
                    </button>
                  </span>
                )}
              </header>

              <div className="stRuleWhen">
                <span className="stRuleLabel">When</span>
                {hasWhen ? (
                  <div className="stRuleCondition">
                    <Node
                      schema={whenSchema}
                      value={rule.when}
                      path={[...path, index, 'when']}
                      onChange={(next) => setRule(index, { ...rule, when: next })}
                      disabled={disabled}
                    />
                    {!disabled && (
                      <button
                        type="button"
                        className="stLink"
                        onClick={() => {
                          ctx.markDelete('the condition');
                          const { when: _gone, ...rest } = rule;
                          setRule(index, rest);
                        }}
                      >
                        Remove the condition (always do this)
                      </button>
                    )}
                  </div>
                ) : (
                  <span>
                    Always
                    {!disabled && (
                      <>
                        {' '}
                        <button type="button" className="stLink" onClick={() => setRule(index, { when: engine.defaultFor(whenSchema), ...rule })}>
                          Only when…
                        </button>
                      </>
                    )}
                  </span>
                )}
              </div>

              <ActionSteps
                shape={ruleShape.properties.do}
                value={actions}
                path={[...path, index, 'do']}
                disabled={disabled}
                label={`rule ${index + 1}`}
                onChange={setActions}
              />
            </SortableItem>
          );
        })}
      </SortableList>
      {!disabled && (
        <button type="button" className="stAddBtn" onClick={addRule}>
          <Icon name="plus" size={14} /> Add a rule
        </button>
      )}
    </div>
  );
}
