// Sandbox's Telephony page body (Weave React's TelephonyWorkspace): the four parts as tabs, each with sample records
// kept in this browser. Loaded by src/pages/Telephony.tsx only while the studio runs in Sandbox.

import React, { useMemo, useState } from 'react';
import { RotateCcwIcon } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { toast } from '../../components/ui/Toast';
import { TelephonyTabs } from '../../components/telephony/TelephonyTabs';
import { useStudio } from '../../contexts/StudioContext';
import { useSetBreadcrumbTitle } from '../../contexts/BreadcrumbContext';
import { TELEPHONY_SECTIONS, telephonyHref, type TelephonySection } from '../../models/telephony';
import { CallsSection } from './CallsSection';
import { DispatchSection } from './DispatchSection';
import { NumbersSection } from './NumbersSection';
import { TrunksSection } from './TrunksSection';
import { telAgent } from './model';
import { resetTelephony, useSandboxTelephony } from './store';

export default function SandboxTelephony({ section, onSection }: { section: TelephonySection; onSection: (s: TelephonySection) => void }) {
  const data = useSandboxTelephony();
  const { agents: studioAgents, loading } = useStudio();
  const agents = useMemo(() => studioAgents.map(telAgent), [studioAgents]);
  const [resetting, setResetting] = useState(false);
  const label = section === 'calls' ? 'Simulated calls' : TELEPHONY_SECTIONS.find((s) => s.id === section)?.label;
  useSetBreadcrumbTitle(label, telephonyHref(section));
  return (
    <>
      <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">
          Test phone numbers, the rules that send a call to an agent, and SIP trunks; and calls simulated through them. All of it is sample data kept in this
          browser.
        </p>
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setResetting(true)}>
          <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
          Start again
        </Button>
      </div>
      <TelephonyTabs section={section} onChange={onSection} labels={{ calls: 'Simulated calls' }} />
      <div role="tabpanel" aria-label={label} className="mt-6" data-telephony-section={section}>
        {loading && !studioAgents.length ? (
          <p className="text-sm text-muted" role="status">
            Reading the sample agents…
          </p>
        ) : section === 'calls' ? (
          <CallsSection data={data} agents={agents} onSection={onSection} />
        ) : section === 'dispatch' ? (
          <DispatchSection data={data} agents={agents} onSection={onSection} />
        ) : section === 'numbers' ? (
          <NumbersSection data={data} agents={agents} onSection={onSection} />
        ) : (
          <TrunksSection data={data} />
        )}
      </div>
      <Dialog
        open={resetting}
        onClose={() => setResetting(false)}
        title="Start Sandbox telephony again?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetting(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                resetTelephony();
                setResetting(false);
                toast.success('Sandbox telephony started again', { description: 'The sample numbers, rules and trunks are back; the simulated calls are cleared.' });
              }}
            >
              Start again
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          Your test numbers, dispatch rules, trunks and simulated calls in this browser are replaced by the sample setup. The sample agents and their calls are not
          touched.
        </p>
      </Dialog>
    </>
  );
}
