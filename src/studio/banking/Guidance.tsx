import { useId, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import type { HelpEntry } from '../../api/gatewayTypes.ts';
import type { Guidance, GuidanceActionId } from './guidance.ts';
import { cn, toneBox, toneText, type Tone } from './ui.tsx';

const TONE: Record<Guidance['tone'], { tone: Tone; icon: string }> = {
  info: { tone: 'neutral', icon: 'info' },
  success: { tone: 'success', icon: 'done' },
  warning: { tone: 'warning', icon: 'alert' },
  danger: { tone: 'danger', icon: 'alert' },
};

/**
 * One help question from the gateway, as a disclosure next to the step it belongs to. When the bank's procedure is
 * unknown the gateway sends no answer; the fallback (a safe route to a person) is shown and the gap is stated.
 */
export function HelpTopic({ entry, defaultOpen = false, className }: { entry: HelpEntry; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="tw-inline-flex tw-min-h-8 tw-items-center tw-gap-1.5 tw-border-0 tw-bg-transparent tw-p-0 tw-text-left tw-text-sm tw-font-medium tw-text-accent-ink hover:tw-underline"
      >
        <Icon name="help" size={14} />
        {entry.question}
        <Icon name="chevronDown" size={14} className={cn('tw-transition-transform motion-reduce:tw-transition-none', open && 'tw-rotate-180')} />
      </button>
      {open && (
        <div
          id={panelId}
          className="tw-mt-1.5 tw-rounded-control tw-border tw-border-solid tw-border-line tw-bg-subtle tw-px-3 tw-py-2 tw-text-sm tw-leading-relaxed tw-text-ink-soft"
        >
          {entry.answer ? <p className="tw-m-0">{entry.answer}</p> : <p className="tw-m-0 tw-text-ink">We don’t have confirmed instructions for this.</p>}
          <p className={cn('tw-mb-0', entry.answer ? 'tw-mt-1.5' : 'tw-mt-0')}>{entry.fallback}</p>
          {!entry.approved && <p className="tw-mb-0 tw-mt-1.5 tw-text-xs tw-text-muted">Wording awaiting the bank’s approval.</p>}
        </div>
      )}
    </div>
  );
}

/** A guidance message with its next steps. Help actions open the gateway's help entry in place. */
export function GuidanceNotice({
  guidance,
  help,
  onAction,
  busy = false,
}: {
  guidance: Guidance;
  help: Record<string, HelpEntry> | undefined;
  onAction: (id: GuidanceActionId) => void;
  busy?: boolean;
}) {
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const { tone, icon } = TONE[guidance.tone];
  const helpEntry = openHelp ? help?.[openHelp] : undefined;
  return (
    <div role={guidance.announce === 'assertive' ? 'alert' : 'status'} className={cn('tw-rounded-control tw-border tw-border-solid tw-p-3', toneBox[tone])}>
      <div className="tw-flex tw-items-start tw-gap-2">
        <span className={cn('tw-mt-0.5 tw-shrink-0', toneText[tone])}>
          <Icon name={icon} size={16} />
        </span>
        <div className="tw-min-w-0 tw-flex-1">
          <p className="tw-m-0 tw-font-medium tw-text-ink">{guidance.title}</p>
          <p className="tw-mb-0 tw-mt-0.5 tw-text-sm tw-leading-relaxed tw-text-ink-soft">{guidance.body}</p>
          {guidance.actions.length > 0 && (
            <div className="tw-mt-2.5 tw-flex tw-flex-wrap tw-gap-2">
              {guidance.actions.map((action) => {
                if (action.id !== 'show_help' || !action.helpId) {
                  return (
                    <Button key={action.id} type="button" variant="secondary" size="compact" disabled={busy} onClick={() => onAction(action.id)}>
                      {action.label}
                    </Button>
                  );
                }
                const helpId = action.helpId;
                return help?.[helpId] ? (
                  <Button
                    key={`${action.id}-${helpId}`}
                    type="button"
                    size="compact"
                    aria-expanded={openHelp === helpId}
                    onClick={() => setOpenHelp((h) => (h === helpId ? null : helpId))}
                  >
                    {action.label}
                  </Button>
                ) : null;
              })}
            </div>
          )}
          {helpEntry && <HelpTopic key={helpEntry.id} entry={helpEntry} defaultOpen className="tw-mt-2" />}
        </div>
      </div>
    </div>
  );
}
