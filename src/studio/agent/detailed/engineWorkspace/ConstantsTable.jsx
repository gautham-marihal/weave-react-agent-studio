import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { setPath } from '../schemaFacts.js';
import { deleteWithUndo } from '../Detailed.jsx';
import { constantsIn, nameProblem, shownValue, typedValue, usedWords } from './engineWords.js';

// Fixed values as a table edited in place (canvas board E3): each value's name, the value, and how many places use it
// ({{const.name}}). A number stays a number and true or false stay as they are; a name is written once it is one the
// schema takes (lower case, digits and _), so a half-typed name never makes the draft invalid. Renaming keeps its place.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const write = (ctx, entries) => ctx.set(setPath(ctx.config, ['constants'], entries.length ? Object.fromEntries(entries) : undefined));
const entriesOf = (config) => Object.entries(isObj(config?.constants) ? config.constants : {});

function ConstRow({ ctx, index, item, taken, focusMe, idBase }) {
  const [name, setName] = useState(item.name);
  const [text, setText] = useState(item.shown);
  const [seen, setSeen] = useState(item);
  const nameBox = useRef(null);
  // changed elsewhere (Undo, the JSON): follow it, unless what is typed already means the same
  if (seen.name !== item.name || seen.shown !== item.shown) {
    setSeen(item);
    if (item.name !== name && !nameProblem(name, taken)) setName(item.name);
    if (shownValue(typedValue(text)) !== item.shown) setText(item.shown);
  }
  useEffect(() => {
    if (focusMe) nameBox.current?.focus();
  }, [focusMe]);
  const problem = name === item.name ? '' : nameProblem(name, taken);
  const rename = (next) => {
    setName(next);
    if (nameProblem(next, taken)) return;
    write(
      ctx,
      entriesOf(ctx.config).map(([k, v], i) => (i === index ? [next, v] : [k, v])),
    );
  };
  const change = (next) => {
    setText(next);
    write(
      ctx,
      entriesOf(ctx.config).map(([k, v], i) => (i === index ? [k, typedValue(next)] : [k, v])),
    );
  };
  const remove = () =>
    deleteWithUndo(ctx, 'value', item.name, (c) =>
      write(
        c,
        entriesOf(c.config).filter((_, i) => i !== index),
      ),
    );
  return (
    <li className="enConst">
      <span className="enConstName">
        <Input
          ref={nameBox}
          id={`${idBase}-name-${index}`}
          className="enMono"
          value={name}
          aria-label={`Name of fixed value ${index + 1}`}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${idBase}-err-${index}` : undefined}
          onChange={(event) => rename(event.target.value)}
        />
        {problem && (
          <small id={`${idBase}-err-${index}`} className="stFieldError" role="alert">
            {problem}
          </small>
        )}
      </span>
      <Input className="enMono" value={text} placeholder="Its value" aria-label={`Value of ${item.name}`} onChange={(event) => change(event.target.value)} />
      <small className={`enUsed ${item.uses ? '' : 'none'}`}>{usedWords(item.uses)}</small>
      <Button type="button" variant="quiet" size="small" onClick={remove} aria-label={`Remove ${item.name}`}>
        <Icon name="close" size={14} />
      </Button>
    </li>
  );
}

export default function ConstantsTable({ ctx, id }) {
  const items = constantsIn(ctx.config);
  const [focusAt, setFocusAt] = useState(-1);
  const add = () => {
    const names = items.map((x) => x.name);
    let n = items.length + 1;
    while (names.includes(`value_${n}`)) n += 1;
    write(ctx, [...entriesOf(ctx.config), [`value_${n}`, '']]);
    setFocusAt(items.length);
  };
  return (
    <div className="enConsts" id={id}>
      {items.length ? (
        <ul className="enConstList" aria-label="Fixed values">
          {items.map((item, index) => (
            <ConstRow
              key={index}
              ctx={ctx}
              index={index}
              item={item}
              idBase={id}
              focusMe={focusAt === index}
              taken={items.filter((_, i) => i !== index).map((x) => x.name)}
            />
          ))}
        </ul>
      ) : (
        <p className="apNone">No fixed values yet. A value used in many places, such as a payment link, is set once here.</p>
      )}
      <div className="enConstAdd">
        <Button type="button" variant="secondary" size="small" onClick={add}>
          <Icon name="plus" size={14} />
          Add a value
        </Button>
        <span className="apHint">Use one in any text as {'{{const.name}}'}. A number stays a number. Not for secrets.</span>
      </div>
    </div>
  );
}
