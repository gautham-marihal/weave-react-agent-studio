import React, { useMemo, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { AccountView } from '../../api/gatewayTypes';
import { useBankingChannel, type BankingChannel } from '../../hooks/useBankingChannel';
import { currentSituation, guidanceFor, type GuidanceActionId } from '../../models/bankingGuidance';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/StatusChip';
import { ConfirmationCard } from './ConfirmationCard';
import { EnvironmentNotice } from './EnvironmentNotice';
import { GuidanceNotice } from './GuidanceNotice';
import { ProfilePanel } from './ProfilePanel';
import { SecureKeypad } from './SecureKeypad';
import { SignInPanel } from './SignInPanel';
import { methodOfState } from '../../utils/bankingFormat';

const CONNECTION_LABEL: Record<BankingChannel['connection'], { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  idle: { text: 'Not connected', tone: 'neutral' },
  connecting: { text: 'Connecting…', tone: 'neutral' },
  open: { text: 'Secure channel open', tone: 'success' },
  retrying: { text: 'Reconnecting…', tone: 'warning' },
  closed: { text: 'Not available', tone: 'danger' },
};

/**
 * The caller's banking surfaces for one conversation: environment, sign-in, secure keypad, profile and accounts, and
 * confirmation cards, all driven by the gateway's channel stream. Rendered beside the transcript, never inside it.
 *
 * `token` is the conversation's LiveKit room token (Test console) or a rehearsal's channel token. The callbacks are
 * what the hosting screen can do on the caller's behalf; actions without one are not offered.
 */
export function CustomerChannelPanel({
  token,
  onAskForPerson,
  onRequestCallback,
  onUseAccount,
  channel: external,
  showProfile = true,
  showEnvironment = true,
  heading = 'Banking',
}: {
  token: string | null;
  onAskForPerson?: () => void;
  onRequestCallback?: () => void;
  onUseAccount?: (account: AccountView) => void;
  /** A channel the host already opened (to share it with other panels); otherwise this panel opens its own. */
  channel?: BankingChannel;
  /** False when the host shows its own account overview for the verified profile. */
  showProfile?: boolean;
  /** False when the hosting page already states the environment (mock or live bank systems). */
  showEnvironment?: boolean;
  heading?: string;
}) {
  const own = useBankingChannel(external ? null : token);
  const channel = external ?? own;
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

  const conn = CONNECTION_LABEL[connection];
  // A keypad step in progress keeps the keypad on screen, even between keypads (after a wrong entry the gateway may
  // wait for a new one): it then offers "Open a new keypad" and another Phone Code or account.
  const needsKeypad = Boolean(keypad || state?.auth.secure_entry || (state && !state.auth.authenticated && methodOfState(state.auth.state)));
  const signingIn = state && !state.auth.authenticated && state.auth.state !== 'locked';

  return (
    <section aria-label="Banking" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{heading}</h2>
        <StatusChip tone={conn.tone} dot>
          {conn.text}
        </StatusChip>
      </div>
      {showEnvironment && state && <EnvironmentNotice hosts={state.hosts} policyApproved={state.policy_approved} />}

      {!state && !channel.error && connection !== 'idle' && (
        <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
          <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Connecting to the bank&apos;s secure channel…
        </p>
      )}

      {guidance && <GuidanceNotice guidance={guidance} help={state?.help} onAction={onAction} busy={busy} />}

      {channel.feedback?.accepted && (
        // Announced either way; once the profile shows "Verified", the line is for screen readers only.
        <p className={state?.auth.authenticated && !needsKeypad ? 'sr-only' : 'text-[13px] text-success'} role="status">
          {channel.feedback.message}
        </p>
      )}

      {signingIn && <SignInPanel state={state} busy={busy} onIdentify={channel.identify} />}

      {needsKeypad && (
        <SecureKeypad
          keypad={keypad}
          busy={busy}
          onSubmit={channel.submitCapture}
          onNewKeypad={() => void channel.newKeypad()}
          footer={
            state && methodOfState(state.auth.state) ? (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => void channel.restart()} disabled={busy}>
                Use a different Phone Code or account
              </Button>
            ) : null
          }
        />
      )}

      {showProfile && state?.profile && (
        <ProfilePanel
          profile={state.profile}
          selected={state.profile.accounts.length === 1 ? (state.profile.accounts[0]?.account_ref ?? null) : selectedAccount}
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
        <details className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">What you can ask about</summary>
          <ul className="mt-1.5 list-inside list-disc text-ink-soft">
            {state.services.available.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

