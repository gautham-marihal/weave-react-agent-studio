import React, { useId } from 'react';
import { LogOutIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react';
import type { AccountView, ProfileView } from '../../api/gatewayTypes';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/StatusChip';
import { cn } from '../../utils/styles';

const METHOD: Record<ProfileView['method'], string> = {
  phonecode_pin: 'Phone Code and Phone PIN',
  account_nric_otp: 'Account, NRIC and SMS code',
};
// AS / AC are the CRM's codes. Their meaning is an open decision (O3), so the code is shown as received.
const ROLE: Record<'AS' | 'AC', string> = { AS: 'Role AS (as reported by the bank)', AC: 'Role AC (as reported by the bank)' };

const NOT_PROVIDED = 'Not provided by the service';

/**
 * Who the bank verified, and which accounts it allows in this conversation. Everything comes from the gateway's
 * own state view: masked, never a full account number. The gateway checks entitlement on every request anyway; this
 * panel decides nothing.
 */
export function ProfilePanel({
  profile,
  selected,
  onSelect,
  onSignOut,
  busy,
}: {
  profile: ProfileView;
  selected: string | null;
  /** Omitted when the screen cannot pass a choice on (the conversation decides). */
  onSelect?: (account: AccountView) => void;
  onSignOut: () => void;
  busy: boolean;
}) {
  const id = useId();
  const { accounts } = profile;
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <UserRoundIcon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="truncate text-sm font-semibold text-ink" title="Masked on screen">
            {profile.business_name_masked || NOT_PROVIDED}
          </h3>
          <p className="text-[12px] text-muted">Customer {profile.customer_ref_ending || NOT_PROVIDED}</p>
        </div>
        <StatusChip tone="success">
          <ShieldCheckIcon className="h-3 w-3" aria-hidden />
          Verified
        </StatusChip>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">Verified with</dt>
        <dd className="text-ink">{METHOD[profile.method]}</dd>
        <dt className="text-muted">Access</dt>
        <dd className="text-ink">{profile.role ? ROLE[profile.role] : 'Phone banking user'}</dd>
        <dt className="text-muted">Language</dt>
        <dd className="text-ink">{profile.language === 'zh' ? 'Mandarin' : 'English'}</dd>
      </dl>

      <div className="mt-4">
        {accounts.length === 0 ? (
          <p className="text-[13px] text-ink-soft">No accounts can be used in this conversation. A Service Manager can help.</p>
        ) : accounts.length === 1 || !onSelect ? (
          <>
            <p className="text-[13px] font-medium text-ink">{accounts.length === 1 ? 'Your account' : 'Your accounts'}</p>
            <ul className="mt-1.5 space-y-1.5">
              {accounts.map((a) => (
                <li key={a.account_ref}>
                  <AccountLine account={a} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <fieldset>
            <legend className="text-[13px] font-medium text-ink">Which account are we talking about?</legend>
            <div className="mt-1.5 space-y-1.5">
              {accounts.map((a) => (
                <label
                  key={a.account_ref}
                  className={cn(
                    'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors motion-reduce:transition-none',
                    selected === a.account_ref ? 'border-accent bg-accent-soft' : 'border-line hover:bg-subtle'
                  )}
                >
                  <input type="radio" name={`${id}-account`} className="h-4 w-4 shrink-0" checked={selected === a.account_ref} disabled={busy} onChange={() => onSelect(a)} />
                  <AccountLine account={a} />
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      <Button variant="ghost" size="sm" className="mt-3" onClick={onSignOut} disabled={busy}>
        <LogOutIcon className="h-3.5 w-3.5" aria-hidden />
        Sign out of banking
      </Button>
    </section>
  );
}

function AccountLine({ account }: { account: AccountView }) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
      <span className="text-ink">
        {account.type} <span className="font-mono">{account.ending}</span>
      </span>
      <span className="text-muted">{account.currencies.length ? account.currencies.join(' · ') : NOT_PROVIDED}</span>
    </span>
  );
}
