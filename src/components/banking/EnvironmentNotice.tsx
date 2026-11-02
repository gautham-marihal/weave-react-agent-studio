import React from 'react';
import { FlaskConicalIcon, LandmarkIcon } from 'lucide-react';
import type { HostMode } from '../../api/gatewayTypes';
import { StatusChip } from '../ui/StatusChip';

/**
 * Which systems answered, stated by the gateway itself: mock host systems with test logins, or the bank's hosts.
 * Shown on sign-in and confirmation surfaces so a mock balance can never be mistaken for a real one.
 */
export function EnvironmentNotice({ hosts, policyApproved }: { hosts: HostMode; policyApproved: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Environment">
      {hosts === 'mock' ? (
        <StatusChip tone="warning" title="The gateway runs on its in-memory mock host systems. Test logins and data only; no real accounts.">
          <FlaskConicalIcon className="h-3 w-3" aria-hidden />
          Mock bank systems · test data only
        </StatusChip>
      ) : (
        <StatusChip tone="info" title="The gateway reports live host systems.">
          <LandmarkIcon className="h-3 w-3" aria-hidden />
          Live bank systems
        </StatusChip>
      )}
      {!policyApproved && (
        <StatusChip tone="neutral" title="Limits, charges and cut-offs come from the 2015 IVR deck and are not approved by the business owner.">
          Rules not yet approved
        </StatusChip>
      )}
    </div>
  );
}
