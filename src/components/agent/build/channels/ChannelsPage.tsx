import React, { useEffect, useState } from 'react';
import { ChevronRightIcon, MailIcon, MessageCircleIcon, MessageSquareIcon, MicIcon, PhoneIcon, PlugIcon, PlusIcon, SmartphoneIcon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { AgentConfig } from '../../../../types/studio';
import { useChannelTypes } from '../../../../hooks/useChannelTypes';
import { useBotNumbers, type BotNumbersState } from '../../../../hooks/useBotNumbers';
import { useProviders } from '../../../../hooks/useProviders';
import { addChannel, channelHint, channelTitle, phoneLineWords, presetChannel, presetChoices, removeChannel, setRecordingNotice } from '../../../../models/channels';
import { NOT_RUNNING, notRunningYet, type ChannelKind } from '../../../../models/channelTypes';
import { RECORDING_NOTICE } from '../../../../models/setup';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { StatusChip } from '../../../ui/StatusChip';
import { ChannelDialog } from './ChannelDialog';
import { HoursCard } from './HoursCard';
import { IdentityCard } from './IdentityCard';
import { fieldId } from '../../../../utils/path';
import { cn } from '../../../../utils/styles';

const ICONS: Record<string, React.ElementType> = { sip_voice: PhoneIcon, web_voice: MicIcon, web_chat: MessageSquareIcon, whatsapp: MessageCircleIcon, sms: SmartphoneIcon, email: MailIcon };

/**
 * The Channels page below the reach switches: every channel as a row (its kind, what it says first, a phone line's
 * numbers, problems), "Add a channel" from the kinds GET /channel-types lists, each channel's settings, delete with
 * Undo, the recording-notice question when a voice channel is added, then business hours and caller identity.
 */
export function ChannelsPage({ editor, onOpenJson }: { editor: DraftEditor; onOpenJson: () => void }) {
  const { types, error: typesError, reload: reloadTypes } = useChannelTypes();
  const { answer: providers } = useProviders();
  const [open, setOpen] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [offerNotice, setOfferNotice] = useState(false);
  const [added, setAdded] = useState('');
  const [removed, setRemoved] = useState<{ label: string; previous: AgentConfig; after: AgentConfig } | null>(null);
  const config = editor.config;
  const agentId = editor.agent?.id ?? '';
  const channels = config?.channels ?? [];
  const hasPhone = channels.some((c) => c?.type === 'sip_voice');
  const { state: numbers } = useBotNumbers(agentId, hasPhone);

  // The Undo offer stays until the draft changes again.
  useEffect(() => {
    if (removed && config !== removed.after) setRemoved(null);
  }, [config, removed]);
  // A notice written elsewhere answers the question.
  const notice = String(config?.persona?.disclosures?.recording_notice ?? '').trim();
  useEffect(() => {
    if (notice) setOfferNotice(false);
  }, [notice]);

  if (!config) return null;
  const disabled = !editor.canEdit;
  const errors = editor.validationView.report?.errors ?? [];
  const problemsAt = (i: number) => errors.filter((e) => e.path?.[0] === 'channels' && e.path?.[1] === i).length;

  const pick = (presetId: string) => {
    const channel = presetChannel(presetId, { taken: channels.map((c) => c.id), botId: agentId });
    const result = addChannel(config, channel, { providers, types });
    editor.replaceConfig(result.config);
    setPicking(false);
    setOfferNotice(result.offerNotice);
    setAdded(result.added.length ? `Added, with ${result.added.join(' and ')}. Nothing is saved until you press Save.` : '');
    setOpen((result.config.channels ?? []).length - 1);
  };
  const remove = (index: number) => {
    const after = removeChannel(config, index);
    editor.replaceConfig(after);
    setRemoved({ label: `Channel “${channelTitle(config, index)}” deleted.`, previous: config, after });
    setOpen(null);
  };
  const onRemoved = (label: string, previous: AgentConfig, after: AgentConfig) => setRemoved({ label, previous, after });

  return (
    <div className="space-y-8">
      {removed &&
      <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-info-soft px-4 py-3 text-[13px] text-ink">
          <span>{removed.label}</span>
          <span className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={() => {
            editor.replaceConfig(removed.previous);
            setRemoved(null);
          }}>Undo</Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoved(null)}>Dismiss</Button>
          </span>
        </div>
      }

      {offerNotice && !notice &&
      <div role="group" aria-label="Recording notice" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="min-w-0 text-[13px] text-ink-soft">
            <strong className="font-medium text-ink">Tell callers they may be recorded?</strong> This channel talks by voice, and the agent keeps a record of its calls. Many places require callers to be told.
          </p>
          <span className="flex gap-1">
            <Button size="sm" variant="primary" disabled={disabled} onClick={() => {
            editor.replaceConfig(setRecordingNotice(config, RECORDING_NOTICE));
            setOfferNotice(false);
          }}>Add a notice</Button>
            <Button size="sm" variant="ghost" onClick={() => setOfferNotice(false)}>Not now</Button>
          </span>
        </div>
      }

      <section aria-label="All channels">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">All channels</h3>
            <p className="text-[13px] text-muted">Each place it can be reached, and what it says first there. Open one for its details.</p>
          </div>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setPicking(true)}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add a channel
          </Button>
        </div>
        {typesError &&
        <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink" role="note">
            The kinds of channel could not be read from the server ({typesError}), so every choice is offered and the server checks them when you save.{' '}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => void reloadTypes()}>Try again</button>
          </p>
        }
        {added && <p role="status" className="mb-3 rounded-md bg-info-soft px-3 py-2 text-[13px] text-ink-soft">{added}</p>}
        {channels.length === 0 ?
        <p className="rounded-lg border border-dashed border-line-strong px-5 py-5 text-[13px] text-muted">No channels yet. A channel is where people reach the agent: a phone line, a chat on your website.</p> :

        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {channels.map((ch, i) => {
            const Icon = ICONS[ch.type] ?? PlugIcon;
            const problems = problemsAt(i);
            const sub = [channelHint(config, ch), ch.type === 'sip_voice' ? numbersWords(numbers) : ''].filter(Boolean).join(' · ');
            return (
              <li key={`${ch.id}-${i}`} id={fieldId(['channels', i])} className="scroll-mt-28">
                  <button
                  type="button"
                  onClick={() => setOpen(i)}
                  data-channel={ch.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-subtle text-ink-soft"><Icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{channelTitle(config, i)}</span>
                      <span className="block truncate text-xs text-muted">{sub}</span>
                    </span>
                    {problems > 0 ?
                  <StatusChip tone="danger" dot>{problems} to fix</StatusChip> :
                  ch.enabled === false ?
                  <StatusChip>Off</StatusChip> :
                  notRunningYet(types, ch.type) ?
                  <StatusChip tone="warning">{NOT_RUNNING}</StatusChip> :
                  null}
                    <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  </button>
                </li>);

          })}
          </ul>
        }
      </section>

      <section aria-label="Hours and callers" className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-ink">Business hours</h3>
          <p className="mb-3 text-[13px] text-muted">Opening hours a phone transfer or a rule can follow. On their own they change nothing.</p>
          <HoursCard editor={editor} onRemoved={onRemoved} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink">Caller identity</h3>
          <p className="mb-3 text-[13px] text-muted">How the agent knows who is calling, for lookups and the call record.</p>
          <IdentityCard editor={editor} />
        </div>
      </section>

      <AddChannelDialog open={picking} onClose={() => setPicking(false)} config={config} types={types} onPick={pick} />
      {open !== null && open < channels.length &&
      <ChannelDialog editor={editor} index={open} types={types} numbers={numbers} onClose={() => setOpen(null)} onDelete={remove} onOpenJson={() => {
        setOpen(null);
        onOpenJson();
      }} />
      }
    </div>);

}

function numbersWords(numbers: BotNumbersState): string {
  if (numbers.status === 'ready') return phoneLineWords(numbers.numbers);
  if (numbers.status === 'unavailable') return 'Phone numbers are not available on this server';
  if (numbers.status === 'error') return 'Its numbers could not be read';
  return '';
}

function AddChannelDialog({ open, onClose, config, types, onPick }: { open: boolean; onClose: () => void; config: AgentConfig; types: ChannelKind[] | null; onPick: (presetId: string) => void }) {
  const cards = presetChoices(config, types);
  return (
    <Dialog open={open} onClose={onClose} title="Add a channel" description="Pick where people will reach it. Its details come next." size="lg">
      {(['Voice', 'Text'] as const).map((group) => {
        const mine = cards.filter((c) => c.group === group);
        if (!mine.length) return null;
        return (
          <div key={group} className="mb-5 last:mb-0">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{group}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {mine.map((c) => {
                const Icon = ICONS[c.type] ?? PlugIcon;
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-preset={c.id}
                    onClick={() => onPick(c.id)}
                    className={cn('flex items-start gap-3 rounded-lg border border-line px-3 py-3 text-left transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40')}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-subtle text-ink-soft"><Icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        {c.label}
                        {c.badge && <StatusChip tone={c.badge === NOT_RUNNING ? 'warning' : 'neutral'}>{c.badge}</StatusChip>}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{c.help}{c.note ? ` ${c.note}` : ''}</span>
                    </span>
                  </button>);

              })}
            </div>
          </div>);

      })}
    </Dialog>);

}
