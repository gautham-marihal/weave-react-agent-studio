import { createContext, useContext } from 'react';
import type { Path } from '../../../../types/studio';
import type { Json, RawSchema, RefOptions, SchemaEngine } from '../../../../models/schemaForm/engine';
import type { DescribedIssue, IssueFix, IssueInput } from '../../../../models/validationIssues';

/** A problem the server found, with how serious it is. */
export type FormIssue = IssueInput & { severity: 'error' | 'warning' };

/** What every part of the settings form shares: the schema, the draft, problems by place, and the form's actions. */
export interface FormContextValue {
  engine: SchemaEngine;
  schema: RawSchema;
  config: Json;
  refOptions: RefOptions;
  secretNames: string[];
  /** Problems by the exact place they are about (keyOf(path)). */
  exact: Map<string, FormIssue[]>;
  countUnder: (key: string) => { errors: number; warnings: number };
  issuesUnder: (key: string) => FormIssue[];
  describe: (issue: FormIssue) => DescribedIssue;
  applyFix: (fix: IssueFix) => void;
  technical: boolean;
  /** Set by the server, shown but never edited ('meta.id'). */
  readOnly: Set<string>;
  /** Asked elsewhere on the page, so left out here ('a.b.c'). */
  hidden: Set<string>;
  /** The place being shown: what holds it opens. */
  focus: { key: string; nonce: number } | null;
  /** Show the screen that holds a section or a path. */
  goTo: (target: Path) => void;
  /** Show a place: its screen, what holds it, and flash it. */
  reveal: (path: Path) => void;
  /** Name what the next change deletes, so the Undo bar can say it. */
  markDelete: (label: string) => void;
  requestRename: (collection: string, id: string) => void;
  /** Delete something others point at: asks first when something does. */
  requestDelete: (collection: string, id: string, proceed: () => void) => void;
  renameDirect: (collection: string, from: string, to: string) => void;
  /** Replace the whole draft (one undoable change) and say what changed. */
  applyConfig: (next: Json, message: string) => void;
  openInJson: ((path: Path) => void) | null;
  disabled: boolean;
  /** The screen is for expert settings: nothing is folded under "Advanced". */
  expertHome: boolean;
}

export const FormContext = createContext<FormContextValue | null>(null);

export function useForm(): FormContextValue {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error('useForm is used outside the settings form');
  return ctx;
}

/** The schema property whose object a setting is inside ('inactivity' for `timeout_s`): plain labels depend on it. */
export const OwnerContext = createContext('');
export const useOwner = () => useContext(OwnerContext);

/** How deep a group is: the first level folds on the screen, deeper ones are indented under it. */
export const DepthContext = createContext(0);
