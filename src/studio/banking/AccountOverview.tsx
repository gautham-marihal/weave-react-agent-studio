import { useCallback, useId, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import Tip from '../../ui/Tip.tsx';
import { Modal } from '../ui.jsx';
import { gateway, GatewayError } from '../../api/gateway.ts';
import type { AccountDetails, AccountView, ProfileView } from '../../api/gatewayTypes.ts';
import type { BalanceSnapshot } from './assistantModel.ts';
import type { RunEvent } from './scenarios.ts';
import { BalanceCard } from './ReplyCard.tsx';
import { Chip, cn, panelClass } from './ui.tsx';

const METHOD: Record<ProfileView['method'], string> = { phonecode_pin: 'Phone Code and Phone PIN', account_nric_otp: 'Account number, NRIC and SMS code' };
const ROLE: Record<'AS' | 'AC', string> = { AS: 'Role AS (as reported by the bank)', AC: 'Role AC (as reported by the bank)' };

/** "500000000101" → "5000 0000 0101". */
const grouped = (n: string) => n.replace(/(\d{4})(?=\d)/g, '$1 ');
const ending = (a: AccountView) => a.ending.replace(/\D/g, '');

/**
 * Full account details for the eye icon and the Account details view. They come from the rehearsal's mock bank
 * systems for the verified customer only, are fetched when first asked for, and are dropped on sign-out (the overview
 * is only mounted while verified).
 */
function useAccountDetails(callId: string) {
  const [details, setDetails] = useState<AccountDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (): Promise<AccountDetails | null> => {
    if (details) return details;
    setLoading(true);
    setError(null);
    try {
      const d = await gateway.rehearsal.accountDetails(callId);
      setDetails(d);
      return d;
    } catch (e) {
      setError(e instanceof GatewayError ? e.message : 'The account details could not be loaded.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [callId, details]);
  return { details, error, loading, load };
}

function RevealButton({ shown, label, onToggle, disabled }: { shown: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  const text = shown ? `Hide ${label}` : `Show ${label}`;
  return (
    <Tip label={text}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={shown}
        aria-label={text}
        className="tw-inline-flex tw-h-7 tw-w-7 tw-items-center tw-justify-center tw-rounded-control tw-border-0 tw-bg-transparent tw-text-muted hover:tw-bg-subtle hover:tw-text-ink disabled:tw-opacity-50"
      >
        <Icon name={shown ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </Tip>
  );
}

/** The verified customer's accounts: tap one for its balance; the eye shows its full number on this screen only. */
export default function AccountOverview({
  callId,
  profile,
  selected,
  balances,
  busy,
  onSelect,
  onCurrency,
  onSignOut,
  record,
}: {
  callId: string;
  profile: ProfileView;
  selected: string | null;
  balances: Record<string, BalanceSnapshot>;
  busy: boolean;
  onSelect: (account: AccountView) => void;
  onCurrency: (accountRef: string, currency: string) => void;
  onSignOut: () => void;
  record: (event: RunEvent) => void;
}) {
  const id = useId();
  const { details, error, loading, load } = useAccountDetails(callId);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);

  const toggle = async (ref: string) => {
    if (revealed.has(ref)) {
      setRevealed((s) => new Set([...s].filter((r) => r !== ref)));
      record({ type: 'hide' });
      return;
    }
    if (await load()) {
      setRevealed((s) => new Set([...s, ref]));
      record({ type: 'reveal' });
    }
  };

  const numberOf = (ref: string) => details?.accounts.find((a) => a.account_ref === ref)?.number ?? null;
  const selectedBalance = selected ? balances[selected] : undefined;
  const selectedRef = selectedBalance?.accountRef;

  return (
    <section aria-labelledby={`${id}-title`} className="tw-space-y-3">
      <div className={panelClass}>
        <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
          <div className="tw-min-w-0">
            <h3 id={`${id}-title`} className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-md tw-font-semibold tw-text-ink">
              <Icon name="bank" size={16} />
              Your accounts
            </h3>
            <p className="tw-m-0 tw-mt-0.5 tw-truncate tw-text-xs tw-text-muted">
              {profile.business_name_masked} · customer {profile.customer_ref_ending}
            </p>
          </div>
          <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
            <Chip tone="success">
              <Icon name="shield" size={12} />
              Verified
            </Chip>
            <Tip label="Account details">
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                aria-label="Account details and settings"
                className="tw-inline-flex tw-h-8 tw-w-8 tw-items-center tw-justify-center tw-rounded-control tw-border-0 tw-bg-transparent tw-text-muted hover:tw-bg-subtle hover:tw-text-ink"
              >
                <Icon name="sliders" size={16} />
              </button>
            </Tip>
          </div>
        </div>

        {profile.accounts.length === 0 ? (
          <p className="tw-mb-0 tw-mt-3 tw-text-sm tw-text-ink-soft">No accounts can be used in this conversation. A Service Manager can help.</p>
        ) : (
          <ul className="tw-m-0 tw-mt-3 tw-list-none tw-space-y-2 tw-p-0" aria-label="Accounts">
            {profile.accounts.map((a) => {
              const isSelected = selected === a.account_ref;
              const shown = revealed.has(a.account_ref) ? numberOf(a.account_ref) : null;
              const snapshot = balances[a.account_ref];
              return (
                <li key={a.account_ref}>
                  <div
                    className={cn(
                      'tw-flex tw-items-center tw-gap-3 tw-rounded-control tw-border tw-border-solid tw-px-3 tw-py-2.5',
                      isSelected ? 'tw-border-accent tw-bg-accent-soft' : 'tw-border-line hover:tw-bg-subtle',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(a)}
                      disabled={busy}
                      aria-pressed={isSelected}
                      aria-label={`${a.type} ending ${ending(a)}${isSelected ? ', selected' : ''}. Check its balance.`}
                      className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-items-start tw-border-0 tw-bg-transparent tw-p-0 tw-text-left disabled:tw-cursor-wait"
                    >
                      <span className="tw-flex tw-items-center tw-gap-1.5 tw-text-sm tw-font-medium tw-text-ink">
                        {a.type}
                        {isSelected && <Icon name="check" size={14} />}
                      </span>
                      <span className="tw-font-mono tw-text-sm tw-text-ink-soft" aria-live="polite">
                        {shown ? grouped(shown) : `•••• ${ending(a)}`}
                      </span>
                    </button>
                    <div className="tw-flex tw-shrink-0 tw-flex-col tw-items-end tw-gap-0.5">
                      <span className="tw-font-mono tw-text-xs tw-text-muted">{a.currencies.join(' · ')}</span>
                      {snapshot && (
                        <span className={cn('tw-font-mono tw-text-xs', snapshot.inDebit ? 'tw-text-danger' : 'tw-text-ink')}>
                          {snapshot.current.replace(/^-/, '−')}
                        </span>
                      )}
                    </div>
                    <RevealButton shown={Boolean(shown)} label="account number" onToggle={() => void toggle(a.account_ref)} disabled={loading} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p role="alert" className="tw-mb-0 tw-mt-2 tw-text-xs tw-text-danger">
            {error}
          </p>
        )}
        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
          <p className="tw-m-0 tw-text-xs tw-text-muted">Tap an account to check its balance. Account numbers are masked until you choose to show them.</p>
          <Button type="button" size="compact" onClick={onSignOut} disabled={busy}>
            <Icon name="signOut" size={14} />
            Sign out
          </Button>
        </div>
      </div>

      {selectedBalance && selectedRef && (
        <BalanceCard
          balance={selectedBalance}
          busy={busy}
          onCurrency={(c) => onCurrency(selectedRef, c)}
          onRefresh={() => onCurrency(selectedRef, selectedBalance.currency)}
        />
      )}

      {detailsOpen && (
        <AccountDetailsDialog
          onClose={() => setDetailsOpen(false)}
          profile={profile}
          details={details}
          load={load}
          loading={loading}
          error={error}
          record={record}
        />
      )}
    </section>
  );
}

function AccountDetailsDialog({
  onClose,
  profile,
  details,
  load,
  loading,
  error,
  record,
}: {
  onClose: () => void;
  profile: ProfileView;
  details: AccountDetails | null;
  load: () => Promise<AccountDetails | null>;
  loading: boolean;
  error: string | null;
  record: (event: RunEvent) => void;
}) {
  // Opening starts masked; closing hides everything again (the dialog is unmounted).
  const [show, setShow] = useState(false);

  const toggle = async () => {
    if (show) {
      setShow(false);
      record({ type: 'hide' });
    } else if (await load()) {
      setShow(true);
      record({ type: 'reveal' });
    }
  };

  const full = show && details ? details : null;
  return (
    <Modal
      eyebrow="Banking"
      title="Account details"
      subtitle="What the bank verified in this conversation. Identifiers are masked by default."
      onClose={onClose}
      footer={null}
      wide
    >
      <div className="tw-space-y-5 tw-text-sm">
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2 tw-rounded-control tw-border tw-border-solid tw-border-line tw-bg-subtle tw-px-3 tw-py-2">
          <span className="tw-text-ink-soft">{show ? 'Full details are showing on this screen.' : 'Business name and account numbers are masked.'}</span>
          <Button type="button" variant="secondary" size="compact" onClick={() => void toggle()} disabled={loading} aria-pressed={show}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={14} />
            {show ? 'Hide details' : 'Show details'}
          </Button>
        </div>
        {error && (
          <p role="alert" className="tw-m-0 tw-text-danger">
            {error}
          </p>
        )}

        <section>
          <h4 className="tw-m-0 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted">Customer</h4>
          <dl className="tw-m-0 tw-mt-2 tw-grid tw-grid-cols-[minmax(120px,auto)_1fr] tw-gap-x-4 tw-gap-y-1.5">
            <dt className="tw-text-muted">Business name</dt>
            <dd className="tw-m-0 tw-text-ink">{full ? full.display_name : profile.business_name_masked}</dd>
            <dt className="tw-text-muted">Customer reference</dt>
            <dd className="tw-m-0 tw-font-mono tw-text-ink">{full ? full.customer_id : profile.customer_ref_ending}</dd>
            <dt className="tw-text-muted">Verified with</dt>
            <dd className="tw-m-0 tw-text-ink">{METHOD[profile.method]}</dd>
            <dt className="tw-text-muted">Access</dt>
            <dd className="tw-m-0 tw-text-ink">{profile.role ? ROLE[profile.role] : 'Phone banking user'}</dd>
            <dt className="tw-text-muted">Language</dt>
            <dd className="tw-m-0 tw-text-ink">{profile.language === 'zh' ? 'Mandarin' : 'English'}</dd>
          </dl>
        </section>

        <section>
          <h4 className="tw-m-0 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted">Accounts</h4>
          <div className="tw-mt-2 tw-overflow-x-auto tw-rounded-control tw-border tw-border-solid tw-border-line">
            <table className="tw-w-full tw-min-w-[440px] tw-border-collapse tw-text-left">
              <thead className="tw-bg-subtle tw-text-xs tw-text-muted">
                <tr>
                  <th className="tw-px-3 tw-py-2 tw-font-medium">Account</th>
                  <th className="tw-px-3 tw-py-2 tw-font-medium">Number</th>
                  <th className="tw-px-3 tw-py-2 tw-font-medium">Currencies</th>
                  <th className="tw-px-3 tw-py-2 tw-font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {profile.accounts.map((a) => {
                  const d = details?.accounts.find((x) => x.account_ref === a.account_ref);
                  return (
                    <tr key={a.account_ref} className="tw-border-0 tw-border-t tw-border-solid tw-border-line">
                      <td className="tw-px-3 tw-py-2 tw-text-ink">{a.type}</td>
                      <td className="tw-whitespace-nowrap tw-px-3 tw-py-2 tw-font-mono tw-text-ink">{full && d ? grouped(d.number) : `•••• ${ending(a)}`}</td>
                      <td className="tw-px-3 tw-py-2 tw-font-mono tw-text-ink-soft">{a.currencies.join(' · ')}</td>
                      <td className="tw-px-3 tw-py-2 tw-text-ink-soft">{d?.omnibus ? 'Omnibus / shared facility' : d?.dormant ? 'Dormant' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="tw-m-0 tw-rounded-control tw-bg-subtle tw-px-3 tw-py-2 tw-text-xs tw-text-ink-soft">
          Masked by default: business name (first letters only), customer reference and account numbers (last four digits). Showing them affects this screen
          only. The assistant never reads a full account number aloud, and PIN, NRIC and one-time passwords are never shown anywhere. Full details here come
          from the banking gateway’s test environment.
        </p>
      </div>
    </Modal>
  );
}
