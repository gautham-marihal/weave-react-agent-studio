import React, { useMemo, useState } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import type { Json, SchemaEngine } from '../../../../models/schemaForm/engine';
import { COLLECTIONS, ID_PATTERN, describeUsage, findUsage } from '../../../../models/schemaForm/references';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';

// What the form shows for keys that other parts of the agent point at (an id, or a map key):
//   IdChip: the key, read-only, with Rename (typing in it would break every pointer)
//   RenameDialog: asks for the new name, says where it is used, and rewrites every pointer
//   DeleteDialog: warns when something still points at what is about to be deleted

const wordOf = (collection: string) => COLLECTIONS[collection]?.word || 'item';

export function IdChip({ id, onRename, disabled }: { id: string; onRename: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-ink">Id</span>
      <code className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[13px] text-ink">{id}</code>
      <span className="text-[12px] text-muted" title="Other parts of the agent point at this name, so it isn’t typed over. Rename changes it everywhere.">
        Other settings point at this name
      </span>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={onRename}>
        Rename…
      </Button>
    </div>
  );
}

function PlacesList({ places }: { places: string[] }) {
  if (!places.length) return <p className="text-[13px] text-muted">Nothing else in the agent uses it.</p>;
  return (
    <div>
      <p className="text-[13px] text-muted">
        Used in {places.length} place{places.length === 1 ? '' : 's'}:
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-ink-soft">
        {places.map((place) => (
          <li key={place}>{place}</li>
        ))}
      </ul>
    </div>
  );
}

interface RenameDialogProps {
  engine: SchemaEngine;
  config: Json;
  collection: string;
  id: string;
  takenIds: string[];
  onClose: () => void;
  onApply: (name: string) => void;
}

export function RenameDialog({ engine, config, collection, id, takenIds, onClose, onApply }: RenameDialogProps) {
  const [name, setName] = useState(id);
  const info = COLLECTIONS[collection];
  const pattern = info?.pattern || ID_PATTERN;
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
          ? `Use lowercase letters, digits and ${info?.pattern ? '_' : '- or _'}, starting with a letter (up to 64 characters).`
          : '';
  const ready = next !== id && !problem;
  const apply = () => {
    if (!ready) return;
    onApply(next);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Rename ${wordOf(collection)} “${id}”`}
      description="The new name is written everywhere the old one is used, so nothing is left pointing at a name that no longer exists."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={apply}>
            Rename{usage.length ? ` and update ${usage.length} place${usage.length === 1 ? '' : 's'}` : ''}
          </Button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <label htmlFor="rename-id" className="text-sm font-medium text-ink">
            New name
          </label>
          <input
            id="rename-id"
            className={cn(inputClass, 'mt-1.5 font-mono', problem && inputErrorClass)}
            value={name}
            spellCheck={false}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
            aria-invalid={!!problem}
          />
          {problem && <p className="mt-1 text-[13px] text-danger">{problem}</p>}
        </div>
        <PlacesList places={places} />
        {(collection === 'state_vars' || collection === 'constants') && usage.some((hit) => hit.type === 'template') && (
          <p className="text-[13px] text-muted">
            Text such as <code className="font-mono">{`{{${collection === 'constants' ? 'const' : 'state'}.${id}}}`}</code> is updated too.
          </p>
        )}
      </div>
    </Dialog>
  );
}

interface DeleteDialogProps {
  engine: SchemaEngine;
  config: Json;
  collection: string;
  id: string;
  leftover: number;
  onClose: () => void;
  onDeleteOnly: () => void;
  onDeleteAll: () => void;
}

/** "Delete anyway" deletes just the item; "Delete and remove those references" also takes out what can be taken out. */
export function DeleteDialog({ engine, config, collection, id, leftover, onClose, onDeleteOnly, onDeleteAll }: DeleteDialogProps) {
  const usage = useMemo(() => findUsage(engine, config, collection, id), [engine, config, collection, id]);
  const places = useMemo(() => describeUsage(config, usage), [config, usage]);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${wordOf(collection)} “${id}”?`}
      description="Other parts of the agent still point at it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onDeleteOnly();
              onClose();
            }}>
            Delete anyway
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onDeleteAll();
              onClose();
            }}>
            Delete and remove those references
          </Button>
        </>
      }>
      <div className="space-y-3">
        <div className="rounded-lg border border-warning/40 bg-warning-soft/40 p-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <TriangleAlertIcon className="h-4 w-4 text-warning" aria-hidden />
            Used in {places.length} place{places.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-ink-soft">
            {places.map((place) => (
              <li key={place}>{place}</li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] text-muted">
          <strong className="font-medium text-ink">Delete anyway</strong> leaves those references where they are; the server’s checks will flag each one.{' '}
          <strong className="font-medium text-ink">Delete and remove those references</strong> takes out the ones that can be taken out (list entries and optional
          settings).
        </p>
        {leftover > 0 && (
          <p className="text-[13px] text-muted">
            {leftover} reference{leftover === 1 ? '' : 's'} {leftover === 1 ? 'is a' : 'are'} required setting{leftover === 1 ? '' : 's'} and would stay.
          </p>
        )}
      </div>
    </Dialog>
  );
}
