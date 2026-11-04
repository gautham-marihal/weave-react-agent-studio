import React from 'react';
import AddPicker from '../../form/AddPicker.jsx';
import { INTRO, WHAT, pickerFor, takenIdsAt } from '../../form/pickerOptions.js';
import { uniqueId } from '../../form/ctx.js';
import { useChannelTypes } from '../../form/useChannelTypes.js';
import { useProviders } from '../../models/useProviders.js';
import { addChannel } from '../../setup/setupModel.js';
import { getAtPath, schemaAtPath } from '../schemaPath.js';
import { setPath } from './schemaFacts.js';
import { withA } from './Detailed.jsx';

// "+ Add" for a list of the draft, with the same choices the studio offers everywhere (pickerOptions.js): the kinds of
// tool, channel or check, each made with its sensible start. Ending the call and passing to a person need one tool
// each: picking one it already has chooses that one instead of adding a second.
//   path: the list; pickerKey: pickerOptions' key ('tools', 'channels', 'guardrails.input'…); word: names an item
//   onAdded(key): the new item's key (its id, or its place), so its card opens

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ONE_OF = { end_call: 'end_call', hand_over: 'transfer_or_callback' };

// The config with the agent that answers first offered the tool `id` (a new tool is otherwise used by nobody).
function offerToEntry(config, id) {
  const items = list(config?.agents?.items);
  const at = Math.max(
    0,
    items.findIndex((a) => isObj(a) && a.id === config?.agents?.entry),
  );
  if (typeof id !== 'string' || !id || !isObj(items[at]) || list(items[at].tools).includes(id)) return config;
  return setPath(config, ['agents', 'items', at, 'tools'], [...list(items[at].tools), id]);
}

export default function AddItem({ ctx, path, pickerKey, word, onAdded, label }) {
  const { types: channelTypes } = useChannelTypes();
  const { providers } = useProviders();
  const { engine, schema, config } = ctx;
  if (!engine || !schema) return null;
  const listSchema = schemaAtPath(engine, schema, path, config);
  const shape = listSchema ? engine.resolveShape(listSchema, getAtPath(config, path)) : null;
  const rawItems = shape?.items || null;
  const items = rawItems ? engine.flatten(rawItems) : null;
  const isUnion = !!items && engine.kindOf(items) === 'union';
  const takenIds = takenIdsAt(config, path);
  const offered = pickerFor(pickerKey, { engine, branches: isUnion ? engine.branchesOf(items) : null, takenIds, botId: config?.meta?.id || '', channelTypes });
  const options = (
    offered ||
    (rawItems
      ? [
          {
            id: 'plain',
            group: 'Add',
            label: `A new ${word}`,
            help: '',
            make: () => {
              const made = engine.defaultFor(rawItems);
              if (isObj(made) && 'id' in made && !made.id) made.id = uniqueId(takenIds, word.replace(/\s+/g, '_'));
              return made;
            },
          },
        ]
      : [])
  ).map((option) => {
    // a tool of a kind it may have only once: chosen, not added again
    const builtin = pickerKey === 'tools' ? ONE_OF[option.id] : null;
    const at = builtin ? list(config?.tools).findIndex((t) => isObj(t) && t.type === 'builtin' && t.builtin === builtin) : -1;
    return at < 0 ? option : { ...option, help: `${option.help} It has one already: this opens it.`, existing: at };
  });
  if (!options.length) return null;
  const pick = (option, made) => {
    if (option.existing !== undefined) {
      const tool = list(config?.tools)[option.existing];
      onAdded?.(String(tool?.id ?? option.existing));
      return;
    }
    let next;
    if (pickerKey === 'channels') next = addChannel(config, made, { providers });
    else {
      next = setPath(config, path, [...list(getAtPath(config, path)), made]);
      if (pickerKey === 'tools') next = offerToEntry(next, made?.id);
    }
    ctx.set(next);
    onAdded?.(String(isObj(made) && typeof made.id === 'string' ? made.id : list(getAtPath(next, path)).length - 1));
  };
  return (
    <AddPicker
      what={WHAT[pickerKey] || `a ${word}`}
      intro={INTRO[pickerKey]}
      label={label || `Add ${withA(word)}`}
      options={options}
      onPick={pick}
      className="dtAddPicker"
    />
  );
}
