import React, { useEffect, useState } from 'react';
import { ChevronRightIcon, FileTextIcon, FlagIcon, MailIcon, PhoneForwardedIcon, PlugIcon, type LucideIcon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { AgentConfig } from '../../../../types/studio';
import { EXTRAS, extraInWords, problemsUnder, type ExtraKey } from '../../../../models/toolsExtras';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import { cn } from '../../../../utils/styles';
import type { ExtraEditorProps } from './extras/shared';
import { TransfersEditor } from './extras/TransfersEditor';
import { ConnectionsEditor } from './extras/ConnectionsEditor';
import { FormsEditor } from './extras/FormsEditor';
import { NotificationsEditor } from './extras/NotificationsEditor';
import { TasksEditor } from './extras/TasksEditor';

const ICONS: Record<ExtraKey, LucideIcon> = { telephony: PhoneForwardedIcon, connections: PlugIcon, forms: FileTextIcon, notifications: MailIcon, tasks: FlagIcon };
const EDITORS: Record<ExtraKey, (props: ExtraEditorProps) => React.ReactElement> = {
  telephony: TransfersEditor,
  connections: ConnectionsEditor,
  forms: FormsEditor,
  notifications: NotificationsEditor,
  tasks: TasksEditor,
};
const LEADS: Record<ExtraKey, string> = {
  telephony: 'Where a call can be passed to a person. The “Pass people to a person” tool uses one of these.',
  connections: 'The web services its tools call and the services that send its texts and emails. Sign-in is a secret’s name, never the value.',
  forms: 'Details collected on screen, field by field.',
  notifications: 'Texts and emails it can send during or after a call.',
  tasks: 'Several steps in a row, each answer checked in code, such as checking who the caller is.',
};

/** Something just deleted, offered back until the draft changes again. */
interface Removed {
  label: string;
  previous: AgentConfig;
  after: AgentConfig;
}

/**
 * The Tools page's extras: phone transfers, connections, forms, the messages it sends and multi-step tasks. One row each
 * says what is set; opening it edits every item of that kind. Every change is an ordinary edit of the draft (Save keeps
 * it, Undo takes it back); a deletion is offered back with Undo.
 */
export function ToolExtras({ editor, onOpenJson }: { editor: DraftEditor; onOpenJson: () => void }) {
  const [open, setOpen] = useState<ExtraKey | null>(null);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const config = editor.config;
  useEffect(() => {
    if (removed && config !== removed.after) setRemoved(null);
  }, [config, removed]);
  if (!config) return null;
  const errors = editor.validationView.report?.errors ?? [];
  const disabled = !editor.canEdit;

  const props: ExtraEditorProps = {
    config,
    disabled,
    errors,
    apply: editor.replaceConfig,
    remove: (label, next) => {
      setRemoved({ label, previous: config, after: next });
      editor.replaceConfig(next);
    },
    onOpenJson: () => {
      setOpen(null);
      onOpenJson();
    },
  };
  const notice = removed && (
    <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-subtle px-4 py-2.5 text-[13px] text-ink">
      {removed.label}
      <span className="flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            editor.replaceConfig(removed.previous);
            setRemoved(null);
          }}>
          Undo
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRemoved(null)}>
          Dismiss
        </Button>
      </span>
    </div>
  );
  const current = EXTRAS.find((e) => e.key === open);
  const Editor = open ? EDITORS[open] : null;

  return (
    <section aria-label="Transfers, connections, forms, messages and tasks" className="mt-8">
      <h3 className="mb-1 text-sm font-semibold text-ink">Transfers, connections, forms, messages and tasks</h3>
      <p className="mb-3 text-[13px] text-muted">What its tools reach beyond the conversation. Open one to change it.</p>
      {!open && notice}
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {EXTRAS.map((e) => {
          const Icon = ICONS[e.key];
          const problems = problemsUnder(errors, e.key);
          return (
            <li key={e.key}>
              <button
                type="button"
                onClick={() => setOpen(e.key)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-subtle text-ink-soft">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{e.title}</span>
                  <span className={cn('block text-[13px] text-muted')}>{extraInWords(config, e.key)}</span>
                </span>
                {problems > 0 && (
                  <StatusChip tone="danger" dot>
                    {problems} to fix
                  </StatusChip>
                )}
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={current?.title ?? ''}
        description={open ? LEADS[open] : undefined}
        size="xl"
        footer={
          <Button variant="primary" onClick={() => setOpen(null)}>
            Done
          </Button>
        }>
        {notice}
        {disabled && <p className="mb-3 text-[13px] text-muted">You can look but not change these: your role can’t edit this agent.</p>}
        {Editor && <Editor {...props} />}
      </Dialog>
    </section>
  );
}
