import React from 'react';
import { ArrowRightLeftIcon, CableIcon, HashIcon, PhoneIncomingIcon } from 'lucide-react';
import { TELEPHONY_SECTIONS, type TelephonySection } from '../../models/telephony';
import { cn } from '../../utils/styles';

const ICONS: Record<TelephonySection, React.ComponentType<{ className?: string }>> = {
  calls: PhoneIncomingIcon,
  dispatch: ArrowRightLeftIcon,
  numbers: HashIcon,
  trunks: CableIcon,
};

interface TelephonyTabsProps {
  section: TelephonySection;
  onChange: (section: TelephonySection) => void;
  /** A part named otherwise (Sandbox names the first one after what it holds). */
  labels?: Partial<Record<TelephonySection, string>>;
  /** A small mark after a part's name (Live marks the parts the API does not offer). */
  marks?: Partial<Record<TelephonySection, string>>;
}

/** The Telephony page's parts, as the tabs under its title (Library's style). */
export function TelephonyTabs({ section, onChange, labels, marks }: TelephonyTabsProps) {
  return (
    <div className="-mx-4 mt-6 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div role="tablist" aria-label="Telephony sections" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
        {TELEPHONY_SECTIONS.map((s) => {
          const active = s.id === section;
          const Icon = ICONS[s.id];
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-section={s.id}
              onClick={() => onChange(s.id)}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', active && 'text-accent')} aria-hidden />
              {labels?.[s.id] ?? s.label}
              {marks?.[s.id] && <span className="rounded-full bg-surface/70 px-1.5 text-[11px] font-normal text-muted">{marks[s.id]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
