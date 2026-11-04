import React, { useMemo, useState } from 'react';
import { Modal, Notice } from '../ui.jsx';
import { COLLECTIONS, ID_PATTERN, describeUsage, findUsage } from './references.js';
import Button from '../../ui/Button.tsx';

// What the form shows for machine keys that other parts of the config point at (an id, or a map key):
//   IdChip: the key, read-only, with a Rename… action (typing in it would break every pointer)
//   RenameDialog: asks for the new name, says where it is used, and rewrites every pointer
//   DeleteDialog: warns when something still points at what is about to be deleted

const wordOf = (collection) => COLLECTIONS[collection]?.word || 'item';

export function IdChip({ id, onRename, disabled }) {
  return (
    <div className="stFRow wide stFIdRow">
      <div className="stFLabel">
        <label>Id</label>
        <span className="stFTag" title="Other parts of the agent point at this key, so it isn’t edited in place. Rename… changes it everywhere.">
          permanent key
        </span>
      </div>
      <div className="stFIdBox">
        <code className="stFIdChip">{id}</code>
        <Button type="button" size="small" disabled={disabled} onClick={onRename}>
          Rename…
        </Button>
      </div>
    </div>
  );
}

function PlacesList({ places }) {
  if (!places.length) return <p className="stMuted">Nothing else in the agent uses it.</p>;
  return (
    <>
      <p className="stMuted">
        Used in {places.length} place{places.length === 1 ? '' : 's'}:
      </p>
      <ul className="stPlain stFPlaces">
        {places.map((place) => (
          <li key={place}>{place}</li>
        ))}
      </ul>
    </>
  );
}

export function RenameDialog({ engine, config, collection, id, takenIds, onClose, onApply }) {
  const [name, setName] = useState(id);
  const info = COLLECTIONS[collection] || {};
  const pattern = info.pattern || ID_PATTERN;
  const usage = useMemo(() => findUsage(engine, config, collection, id), [engine, config, collection, id]);
  const places = useMemo(() => describeUsage(config, usage), [config, usage]);
  const next = name.trim();
  const problem = !next
    ? 'Enter a name.'
    : next === id
      ? ''
      : takenIds.includes(next)
        ? `There is already a ${wordOf(collection)} called “${next}”.`
        : !new RegExp(pattern).test(next)
          ? `Use lowercase letters, digits and ${collection === 'state_vars' || collection === 'constants' ? '_' : '- or _'}, starting with a letter (up to 64 characters).`
          : '';
  const ready = next !== id && !problem;
  return (
    <Modal
      eyebrow="RENAME"
      title={`Rename ${wordOf(collection)} “${id}”`}
      subtitle="The new name is written everywhere the old one is used, so nothing is left pointing at a name that no longer exists."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modalCreate"
            disabled={!ready}
            onClick={() => {
              onApply(next, usage.length);
              onClose();
            }}
          >
            Rename{usage.length ? ` and update ${usage.length} place${usage.length === 1 ? '' : 's'}` : ''}
          </button>
        </>
      }
    >
      <div className="stFormStack">
        <label className={`workspaceField ${problem ? 'bad' : ''}`}>
          <span>New name</span>
          <input
            autoFocus
            value={name}
            spellCheck={false}
            onChange={(event) => setName(event.target.value.toLowerCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && ready) {
                onApply(next, usage.length);
                onClose();
              }
            }}
            aria-invalid={!!problem}
          />
          {problem && <small className="stFieldError">{problem}</small>}
        </label>
        <PlacesList places={places} />
        {collection === 'state_vars' && usage.some((hit) => hit.type === 'template') && (
          <p className="stMuted">
            Text such as <code>{'{{state.' + id + '}}'}</code> is updated too.
          </p>
        )}
      </div>
    </Modal>
  );
}

// `proceed()` deletes just the item. `onDeleteAll()` also removes the pointers that can be removed.
export function DeleteDialog({ engine, config, collection, id, onClose, onDeleteOnly, onDeleteAll, leftover }) {
  const usage = useMemo(() => findUsage(engine, config, collection, id), [engine, config, collection, id]);
  const places = useMemo(() => describeUsage(config, usage), [config, usage]);
  return (
    <Modal
      eyebrow="DELETE"
      title={`Delete ${wordOf(collection)} “${id}”?`}
      subtitle="Other parts of the agent still point at it."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <Button
            type="button"
            onClick={() => {
              onDeleteOnly();
              onClose();
            }}
          >
            Delete anyway
          </Button>
          <button
            type="button"
            className="dangerButton"
            onClick={() => {
              onDeleteAll();
              onClose();
            }}
          >
            Delete and remove those references
          </button>
        </>
      }
    >
      <Notice kind="warn" title={`Used in ${places.length} place${places.length === 1 ? '' : 's'}`}>
        <ul className="stPlain stFPlaces">
          {places.map((place) => (
            <li key={place}>{place}</li>
          ))}
        </ul>
      </Notice>
      <p className="stMuted">
        <strong>Delete anyway</strong> leaves those pointers where they are; the validator will flag each one.{' '}
        <strong>Delete and remove those references</strong> takes the ones that can be taken out (list entries and optional fields). A pointer in a field the
        schema requires stays, and is flagged.
      </p>
      {leftover > 0 && (
        <p className="stMuted">
          {leftover} reference{leftover === 1 ? '' : 's'} sit in required fields and would stay.
        </p>
      )}
    </Modal>
  );
}
