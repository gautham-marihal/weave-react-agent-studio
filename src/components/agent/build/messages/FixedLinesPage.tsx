import React from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { addMessage, languageHint, messageUses, messagesOf, moveMessage, removeMessage, setMessageField, setMessageText, placeWords } from '../../../../models/messages';
import { fieldId } from '../../../../utils/path';
import { Button } from '../../../ui/Button';
import { Toggle } from '../../../ui/Toggle';
import { StatusChip } from '../../../ui/StatusChip';
import { inputClass, cn } from '../../../../utils/styles';
import { Card } from './parts';
import { useDeleted } from './useDeleted';
import { SortableList } from './SortableList';
import { MessageTextEditor } from './MessageTextEditor';
import { PronunciationCard } from './PronunciationCard';

/**
 * The agent's fixed lines (`messages`): what it says word for word wherever a line is referenced (greetings, goodbyes,
 * nudges), each with its text per language, in an order that can be changed by drag or keyboard. Below them, how written
 * text is said aloud, with "Try a line".
 */
export function FixedLinesPage({ editor }: { editor: DraftEditor; onOpenJson: () => void }) {
  const config = editor.config;
  const { notice, remember } = useDeleted(editor);
  if (!config) return null;
  const disabled = !editor.canEdit;
  const lines = messagesOf(config);
  const all = Array.isArray(config.messages) ? (config.messages as unknown[]) : [];
  // the list's own place for each line (anything that is not a line keeps its place)
  const indexOf = (id: string) => all.findIndex((m) => typeof m === 'object' && m !== null && (m as { id?: unknown }).id === id);
  const errors = editor.validationView.report?.errors ?? [];

  return (
    <div className="mt-8 space-y-8">
      <Card
        title="Fixed lines"
        text="What it says word for word, wherever a line is used: greetings, goodbyes, nudges. Drag a line by its handle, or use Space and the arrow keys, to change the order.">
        <div id={fieldId(['messages'])} className="space-y-3 scroll-mt-28">
          {notice}
          {lines.length === 0 ?
          <p className="rounded-lg bg-subtle px-4 py-3 text-[13px] text-muted">No fixed lines yet. Lines the agent says are typed where they are used until you make one a fixed line here.</p> :

          <SortableList
            ids={lines.map((m) => m.id)}
            nameOf={(i) => lines[i]?.id ?? ''}
            disabled={disabled}
            onMove={(from, to) => editor.replaceConfig(moveMessage(config, indexOf(lines[from].id), indexOf(lines[to].id)))}>
              {(i, handle) => {
              const m = lines[i];
              const at = indexOf(m.id);
              const uses = messageUses(config, m.id);
              const hint = languageHint(m, config);
              const problems = errors.filter((e) => e.path?.[0] === 'messages' && e.path?.[1] === at).length;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-3" data-line={m.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      {handle}
                      <code className="font-mono text-[13px] font-medium text-ink">{m.id}</code>
                      {hint && <span className="text-xs text-muted">{hint}</span>}
                      {problems > 0 && <StatusChip tone="danger" dot>{problems} to fix</StatusChip>}
                      {uses.length === 0 && <StatusChip>Not used</StatusChip>}
                      <span className="ml-auto" />
                      <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Delete ${m.id}`}
                      onClick={() => {
                        remember(`Fixed line “${m.id}” deleted.${uses.length ? ' Places that used it now need another line.' : ''}`, config);
                        editor.replaceConfig(removeMessage(config, at));
                      }}>
                        <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted">{uses.length ? `Used by ${Array.from(new Set(uses.map((p) => placeWords(p, config)))).join(', ')}.` : 'Nothing uses it yet.'}</p>
                    <div className="mt-2">
                      <MessageTextEditor
                      id={`${fieldId(['messages', at, 'text'])}-input`}
                      name={m.id}
                      value={m.text}
                      config={config}
                      disabled={disabled}
                      onChange={(v) => editor.replaceConfig(setMessageText(config, at, v))} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                      <label className="flex min-w-[240px] flex-1 items-center gap-2 text-[13px] text-muted">
                        Note for your team
                        <input
                        className={cn(inputClass, 'h-8 flex-1 py-1 text-[13px]')}
                        value={typeof m.description === 'string' ? m.description : ''}
                        disabled={disabled}
                        onChange={(e) => editor.replaceConfig(setMessageField(config, at, 'description', e.target.value))} />
                      </label>
                      <span className="flex items-center gap-2 text-[13px] text-ink-soft">
                        <Toggle
                        checked={m.allow_interruptions !== false}
                        disabled={disabled}
                        label={`Callers can talk over ${m.id}`}
                        onChange={(v) => editor.replaceConfig(setMessageField(config, at, 'allow_interruptions', v))} />
                        Callers can talk over it
                      </span>
                    </div>
                  </div>);

            }}
            </SortableList>
          }
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              const made = addMessage(config);
              editor.replaceConfig(made.config);
              window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-line="${made.id}"] textarea`)?.focus(), 60);
            }}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add a fixed line
          </Button>
        </div>
      </Card>
      <PronunciationCard editor={editor} />
    </div>);

}
