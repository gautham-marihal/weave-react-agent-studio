import { useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import type { AccountView, AuthMethodId, HostMode } from '../../api/gatewayTypes.ts';
import type { BankingChannel } from './useBankingChannel.ts';
import { currentSituation, guidanceFor, type GuidanceActionId } from './guidance.ts';
import { methodOfState } from './format.ts';
import { ConfirmationCard } from './ConfirmationCard.tsx';
import { GuidanceNotice } from './Guidance.tsx';
import { ProfilePanel } from './ProfilePanel.tsx';
import { SecureKeypad } from './SecureKeypad.tsx';
import { SignInPanel } from './SignIn.tsx';
import { Chip, type Tone } from './ui.tsx';

const CONNECTION: Record<BankingChannel['connection'], { text: string; tone: Tone }> = {
  idle: { text: 'Starts with the conversation', tone: 'neutral' },
  connecting: { text: 'Connecting…', tone: 'neutral' },
  open: { text: 'Secure channel open', tone: 'success' },
  retrying: { text: 'Reconnecting…', tone: 'warning' },
  closed: { text: 'Not available', tone: 'danger' },
};

/**
 * Which systems answered, stated by the gateway itself: its test environment (simulated bank systems with test logins), or the bank’s systems.
 * Shown beside sign-in and confirmations so a test balance can never be mistaken for a real one.
 */
export function EnvironmentNotice({ hosts, policyApproved }: { hosts: HostMode; policyApproved: boolean }) {
  return (
    <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5" role="group" aria-label="Environment">
      {hosts === 'mock' ? (
        <Chip tone="warning" title="Simulated bank systems with test logins and test data. No real account or money is involved.">
          <Icon name="test" size={12} />
          Test environment
        </Chip>
      ) : (
        <Chip tone="accent" title="The gateway reports live bank systems.">
          <Icon name="bank" size={12} />
          Live bank systems
        </Chip>
      )}
      {!policyApproved && <Chip title="Limits, charges and cut-offs are not yet approved by the business owner.">Rules not yet approved</Chip>}
    </div>
  );
}

/**
 * The caller's banking surfaces for one conversation: environment, sign-in, secure keypad, profile and accounts, and
 * confirmation cards, all driven by the gateway's channel stream. Drawn beside the conversation, never inside it, so
 * nothing the agent writes can imitate them.
 *
 * The callbacks are what the hosting screen can do for the caller; an action without one is not offered.
 */
export default function CallerPanel({
  channel,
  onAskForPerson,
  onRequestCallback,
  onUseAccount,
  heading = 'Caller’s banking screen',
  showProfile = true,
  showEnvironment = true,
  preferredMethod = null,
}: {
  channel: BankingChannel;
  onAskForPerson?: () => void;
  onRequestCallback?: () => void;
  onUseAccount?: (account: AccountView) => void;
  heading?: string;
  /** False when the host shows its own account overview for the verified profile. */
  showProfile?: boolean;
  /** False when the hosting screen already states the environment (test or live bank systems). */
  showEnvironment?: boolean;
  /** The sign-in method the caller already chose in the conversation: the sign-in panel opens on it. */
  preferredMethod?: AuthMethodId | null;
}) {
  const { state, keypad, confirmation, busy, connection } = channel;
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  const authState = state?.auth.state;
  const can = useMemo(() => {
    const set = new Set<GuidanceActionId>(['new_keypad', 'resend_otp', 'use_other_method', 'reconnect', 'show_help']);
    // On the method screen the cards are right there; the action only helps from elsewhere.
    if (authState !== 'not_started') set.add('choose_method');
    if (onAskForPerson) set.add('ask_for_person');
    if (onRequestCallback) set.add('request_callback');
    return set;
  }, [onAskForPerson, onRequestCallback, authState]);

  const situation = currentSituation(channel);
  const guidance = situation ? guidanceFor(situation, can) : null;

  const onAction = (action: GuidanceActionId) => {
    switch (action) {
      case 'choose_method':
      case 'use_other_method':
        if (state && state.auth.state !== 'not_started') void channel.restart();
        return;
      case 'new_keypad':
        void channel.newKeypad();
        return;
      case 'resend_otp':
        void channel.resendOtp();
        return;
      case 'reconnect':
        channel.reconnect();
        return;
      case 'ask_for_person':
        onAskForPerson?.();
        return;
      case 'request_callback':
        onRequestCallback?.();
        return;
      case 'show_help':
        return; // opened inside the notice
    }
  };

  const conn = CONNECTION[connection];
  const needsKeypad = Boolean(keypad || state?.auth.secure_entry);
  const signingIn = state && !state.auth.authenticated && state.auth.state !== 'locked';
  const accounts = state?.profile?.accounts ?? [];

  return (
    <section aria-label={heading} className="tw-space-y-3">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h3 className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-md tw-font-semibold tw-text-ink">
          <Icon name="bank" size={16} />
          {heading}
        </h3>
        <Chip tone={conn.tone} dot>
          {conn.text}
        </Chip>
      </div>
      {connection === 'idle' && (
        <p className="tw-m-0 tw-text-sm tw-text-muted">
          Sign-in, the secure keypad, the caller’s accounts and confirmations appear here once the conversation starts. They talk to the bank directly, never
          through the agent.
        </p>
      )}
      {showEnvironment && state && <EnvironmentNotice hosts={state.hosts} policyApproved={state.policy_approved} />}

      {!state && !channel.error && connection !== 'idle' && (
        <p className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-muted" role="status">
          <Icon name="loader" size={14} className="tw-animate-spin motion-reduce:tw-animate-none" />
          Connecting to the bank’s secure channel…
        </p>
      )}

      {guidance && <GuidanceNotice guidance={guidance} help={state?.help} onAction={onAction} busy={busy} />}

      {channel.feedback?.accepted && (
        // Announced either way; once the profile shows "Verified", the line is for screen readers only.
        <p className={state?.auth.authenticated && !needsKeypad ? 'srOnly' : 'tw-m-0 tw-text-sm tw-text-success'} role="status">
          {channel.feedback.message}
        </p>
      )}

      {signingIn && <SignInPanel state={state} busy={busy} onIdentify={channel.identify} preferred={preferredMethod} />}

      {needsKeypad && (
        <SecureKeypad
          keypad={keypad}
          busy={busy}
          onSubmit={channel.submitCapture}
          onNewKeypad={() => void channel.newKeypad()}
          footer={
            state && methodOfState(state.auth.state) ? (
              <Button type="button" size="compact" className="tw-mt-2" onClick={() => void channel.restart()} disabled={busy}>
                Use a different Phone Code or account
              </Button>
            ) : null
          }
        />
      )}

      {showProfile && state?.profile && (
        <ProfilePanel
          profile={state.profile}
          selected={accounts.length === 1 ? (accounts[0]?.account_ref ?? null) : selectedAccount}
          onSelect={
            onUseAccount
              ? (account) => {
                  setSelectedAccount(account.account_ref);
                  onUseAccount(account);
                }
              : undefined
          }
          onSignOut={() => void channel.restart()}
          busy={busy}
        />
      )}

      {confirmation && <ConfirmationCard card={confirmation} onDecide={(d) => void channel.decide(d)} />}

      {state?.auth.authenticated && state.services.available.length > 0 && (
        <details className="tw-rounded-control tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2 tw-text-sm">
          <summary className="tw-cursor-pointer tw-font-medium tw-text-ink">What the caller can ask about</summary>
          <ul className="tw-mb-0 tw-mt-1.5 tw-pl-5 tw-text-ink-soft">
            {state.services.available.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
