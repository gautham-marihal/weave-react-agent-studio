import { useId } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import type { AccountView, ProfileView } from '../../api/gatewayTypes.ts';
import { Chip, cn, panelClass } from './ui.tsx';

const METHOD: Record<ProfileView['method'], string> = {
  phonecode_pin: 'Phone Code and Phone PIN',
  account_nric_otp: 'Account, NRIC and SMS code',
};
// AS / AC are the CRM's codes. Their meaning is an open decision, so the code is shown as received.
const ROLE: Record<'AS' | 'AC', string> = { AS: 'Role AS (as reported by the bank)', AC: 'Role AC (as reported by the bank)' };
const NOT_PROVIDED = 'Not provided by the service';

/**
 * Who the bank verified, and which accounts it allows in this conversation. Everything comes from the gateway's own
 * state view: masked, never a full account number. The gateway checks entitlement on every request anyway; this
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
    <section aria-labelledby={`${id}-title`} className={panelClass}>
      <div className="tw-flex tw-items-start tw-gap-3">
        <span className="tw-flex tw-h-9 tw-w-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-accent-soft tw-text-accent-ink">
          <Icon name="user" size={16} />
        </span>
        <div className="tw-min-w-0 tw-flex-1">
          <h3 id={`${id}-title`} className="tw-m-0 tw-truncate tw-text-md tw-font-semibold tw-text-ink" title="Masked on screen">
            {profile.business_name_masked || NOT_PROVIDED}
          </h3>
          <p className="tw-m-0 tw-text-xs tw-text-muted">Customer {profile.customer_ref_ending || NOT_PROVIDED}</p>
        </div>
        <Chip tone="success">
          <Icon name="shield" size={12} />
          Verified
        </Chip>
      </div>

      <dl className="tw-mb-0 tw-mt-3 tw-grid tw-grid-cols-[auto_1fr] tw-gap-x-3 tw-gap-y-1 tw-text-sm">
        <dt className="tw-text-muted">Verified with</dt>
        <dd className="tw-m-0 tw-text-ink">{METHOD[profile.method]}</dd>
        <dt className="tw-text-muted">Access</dt>
        <dd className="tw-m-0 tw-text-ink">{profile.role ? ROLE[profile.role] : 'Phone banking user'}</dd>
        <dt className="tw-text-muted">Language</dt>
        <dd className="tw-m-0 tw-text-ink">{profile.language === 'zh' ? 'Mandarin' : 'English'}</dd>
      </dl>

      <div className="tw-mt-4">
        {accounts.length === 0 ? (
          <p className="tw-m-0 tw-text-sm tw-text-ink-soft">No accounts can be used in this conversation. A Service Manager can help.</p>
        ) : accounts.length === 1 || !onSelect ? (
          <>
            <p className="tw-m-0 tw-text-sm tw-font-medium tw-text-ink">{accounts.length === 1 ? 'Your account' : 'Your accounts'}</p>
            <ul className="tw-m-0 tw-mt-1.5 tw-list-none tw-space-y-1.5 tw-p-0">
              {accounts.map((a) => (
                <li key={a.account_ref}>
                  <AccountLine account={a} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <fieldset className="tw-m-0 tw-border-0 tw-p-0">
            <legend className="tw-p-0 tw-text-sm tw-font-medium tw-text-ink">Which account are we talking about?</legend>
            <div className="tw-mt-1.5 tw-space-y-1.5">
              {accounts.map((a) => (
                <label
                  key={a.account_ref}
                  className={cn(
                    'tw-flex tw-min-h-[44px] tw-cursor-pointer tw-items-center tw-gap-3 tw-rounded-control tw-border tw-border-solid tw-px-3 tw-py-2 tw-transition-colors motion-reduce:tw-transition-none',
                    selected === a.account_ref ? 'tw-border-accent tw-bg-accent-soft' : 'tw-border-line hover:tw-bg-subtle',
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-account`}
                    className="tw-h-4 tw-w-4 tw-shrink-0"
                    checked={selected === a.account_ref}
                    disabled={busy}
                    onChange={() => onSelect(a)}
                  />
                  <AccountLine account={a} />
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      <Button type="button" size="compact" className="tw-mt-3" onClick={onSignOut} disabled={busy}>
        <Icon name="signOut" size={14} />
        Sign out of banking
      </Button>
    </section>
  );
}

function AccountLine({ account }: { account: AccountView }) {
  return (
    <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-wrap tw-items-baseline tw-justify-between tw-gap-x-3 tw-text-sm">
      <span className="tw-text-ink">
        {account.type} <span className="tw-font-mono">{account.ending}</span>
      </span>
      <span className="tw-text-muted">{account.currencies.length ? account.currencies.join(' · ') : NOT_PROVIDED}</span>
    </span>
  );
}
