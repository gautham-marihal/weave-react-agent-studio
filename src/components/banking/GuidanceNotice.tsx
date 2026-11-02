import React, { useState } from 'react';
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { HelpEntry } from '../../api/gatewayTypes';
import type { Guidance, GuidanceActionId } from '../../models/bankingGuidance';
import { Button } from '../ui/Button';
import { cn } from '../../utils/styles';
import { HelpTopic } from './HelpTopic';

const toneStyle: Record<Guidance['tone'], { box: string; icon: typeof InfoIcon; iconClass: string }> = {
  info: { box: 'border-line bg-subtle', icon: InfoIcon, iconClass: 'text-info' },
  success: { box: 'border-success/30 bg-success-soft', icon: CircleCheckIcon, iconClass: 'text-success' },
  warning: { box: 'border-warning/30 bg-warning-soft', icon: TriangleAlertIcon, iconClass: 'text-warning' },
  danger: { box: 'border-danger/30 bg-danger-soft', icon: CircleAlertIcon, iconClass: 'text-danger' },
};

/** A guidance message with its next steps. Help actions open the gateway's help entry in place. */
export function GuidanceNotice({
  guidance,
  help,
  onAction,
  busy = false,
  className,
}: {
  guidance: Guidance;
  help: Record<string, HelpEntry> | undefined;
  onAction: (id: GuidanceActionId) => void;
  busy?: boolean;
  className?: string;
}) {
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const style = toneStyle[guidance.tone];
  const Icon = style.icon;
  const helpEntry = openHelp ? help?.[openHelp] : undefined;
  return (
    <div role={guidance.announce === 'assertive' ? 'alert' : 'status'} className={cn('rounded-lg border p-3 text-sm', style.box, className)}>
      <div className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.iconClass)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{guidance.title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{guidance.body}</p>
          {guidance.actions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {guidance.actions.map((action) =>
                action.id === 'show_help' && action.helpId ? (
                  help?.[action.helpId] ? (
                    <Button key={`${action.id}-${action.helpId}`} size="sm" variant="ghost" aria-expanded={openHelp === action.helpId} onClick={() => setOpenHelp((h) => (h === action.helpId ? null : (action.helpId ?? null)))}>
                      {action.label}
                    </Button>
                  ) : null
                ) : (
                  <Button key={action.id} size="sm" variant="secondary" disabled={busy} onClick={() => onAction(action.id)}>
                    {action.label}
                  </Button>
                )
              )}
            </div>
          )}
          {helpEntry && <HelpTopic key={helpEntry.id} entry={helpEntry} defaultOpen className="mt-2" />}
        </div>
      </div>
    </div>
  );
}
