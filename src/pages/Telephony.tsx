import React, { Suspense, lazy } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FlaskConicalIcon, PhoneOffIcon } from 'lucide-react';
import { NumbersPanel } from '../components/library/NumbersPanel';
import { TelephonyTabs } from '../components/telephony/TelephonyTabs';
import { StatusChip } from '../components/ui/StatusChip';
import { LIVE_NOT_OFFERED, TELEPHONY_SECTIONS, TRY_IN_SANDBOX, telephonyHref, telephonySection, type TelephonySection } from '../models/telephony';
import { isSandbox } from '../sandbox/mode';
import { useSetBreadcrumbTitle } from '../contexts/BreadcrumbContext';
import { pageClass } from '../utils/styles';

// Sandbox's numbers, rules, trunks and calls (sample data kept in this browser), loaded only while Sandbox is on.
const SandboxTelephony = lazy(() => import('../sandbox/telephony/SandboxTelephony'));

/**
 * Telephony: phone numbers, the rules that send a call to an agent, SIP trunks, and test calls through them, each part
 * at its own address (/telephony/dispatch). Live shows the real phone numbers and says plainly which parts the Agent
 * Builder API does not offer yet; Sandbox has every part, on sample data.
 */
export function Telephony() {
  const { section: param } = useParams();
  const navigate = useNavigate();
  const sandbox = isSandbox();
  const section = telephonySection(param, sandbox);
  const go = (next: TelephonySection) => navigate(telephonyHref(next));
  // the part's name in the breadcrumbs (Sandbox names its own)
  useSetBreadcrumbTitle(sandbox ? null : TELEPHONY_SECTIONS.find((s) => s.id === section)?.label, telephonyHref(section));

  return (
    <div className={pageClass}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Telephony</h1>
        {sandbox && (
          <StatusChip tone="warning" className="gap-1">
            <FlaskConicalIcon className="h-3 w-3" aria-hidden />
            Sandbox
          </StatusChip>
        )}
      </div>
      {sandbox ? (
        <Suspense
          fallback={
            <p className="mt-6 text-sm text-muted" role="status">
              Opening Sandbox telephony…
            </p>
          }
        >
          <SandboxTelephony section={section} onSection={go} />
        </Suspense>
      ) : (
        <LiveTelephony section={section} onSection={go} />
      )}
    </div>
  );
}

const NOT_YET = { calls: 'Not yet', dispatch: 'Not yet', trunks: 'Not yet' };

/** Live: the real phone numbers; the other parts say the API does not offer them yet, with nothing made up shown. */
function LiveTelephony({ section, onSection }: { section: TelephonySection; onSection: (s: TelephonySection) => void }) {
  const label = TELEPHONY_SECTIONS.find((s) => s.id === section)?.label;
  return (
    <>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        The phone numbers callers dial to reach your agents. Dispatch rules, SIP trunks and test calls through them aren’t offered by the Agent Builder API yet.
      </p>
      <TelephonyTabs section={section} onChange={onSection} marks={NOT_YET} />
      <div role="tabpanel" aria-label={label} data-telephony-section={section}>
        {section === 'numbers' ? <NumbersPanel /> : <NotOfferedYet section={section} onSection={onSection} />}
      </div>
    </>
  );
}

function NotOfferedYet({ section, onSection }: { section: Exclude<TelephonySection, 'numbers'>; onSection: (s: TelephonySection) => void }) {
  const words = LIVE_NOT_OFFERED[section];
  return (
    <div className="mt-6 rounded-xl border border-line bg-surface px-6 py-12 text-center" role="status" data-testid="telephony-not-offered">
      <PhoneOffIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
      <p className="mt-2 text-sm font-medium text-ink">{words.title}</p>
      <p className="mx-auto mt-1 max-w-xl text-[13px] leading-relaxed text-muted">{words.body}</p>
      <p className="mx-auto mt-3 max-w-xl text-[13px] leading-relaxed text-muted">{TRY_IN_SANDBOX}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-3 text-[13px]">
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => onSection('numbers')}>
          See the phone numbers
        </button>
        {section === 'calls' && (
          <Link to="/calls" className="font-medium text-accent hover:underline">
            Open Calls
          </Link>
        )}
      </div>
    </div>
  );
}
