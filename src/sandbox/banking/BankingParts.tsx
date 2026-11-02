// What a Sandbox banking conversation draws around the Test console's transcript: under a reply its card and where
// the answer came from; beside the conversation the customer's device (the one channel panel, keypad and confirmation
// cards, bound to the session's channel token), the phone that receives the SMS one-time password, and the test logins.
import React from 'react';
import { KeyRoundIcon, LandmarkIcon, ShieldCheckIcon } from 'lucide-react';
import type { AccountView } from '../../api/gatewayTypes';
import type { BankingChannel } from '../../hooks/useBankingChannel';
import { CustomerChannelPanel } from '../../components/banking/CustomerChannelPanel';
import { MockPhone } from '../../components/banking/RehearsalConsole';
import type { ChoicePurpose } from './bankingAssistant';
import type { BankingLine } from './useBankingAssistant';
import { MessageCard } from './MessageCard';
import { TestLogins } from './TestLogins';

/** Under an agent reply: its card, then where a banking answer came from. */
export function ReplyExtras({
  line,
  latest,
  busy,
  source,
  onChoose,
  onCurrency,
}: {
  line: BankingLine;
  latest: boolean;
  busy: boolean;
  source: string;
  onChoose: (purpose: ChoicePurpose, id: string, label: string) => void;
  onCurrency: (accountRef: string, currency: string) => void;
}) {
  if (!line.card && !line.fromBank) return null;
  return (
    <div className="mt-2 w-full max-w-md space-y-1.5">
      {line.card && <MessageCard card={line.card} latest={latest} busy={busy} onChoose={onChoose} onCurrency={onCurrency} />}
      {line.fromBank && (
        <p className="flex items-center gap-1 text-[11px] text-muted" data-banking-source>
          <LandmarkIcon className="h-3 w-3 shrink-0" aria-hidden />
          <span>From: {source}</span>
        </p>
      )}
    </div>
  );
}

/** Over the message box while a secret is being keyed: the keypad takes it, never the conversation. */
export function SecureEntryNote({ label }: { label: string }) {
  return (
    <p role="status" className="mb-2 flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2 text-[12px] text-ink-soft">
      <KeyRoundIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
      <span>
        Key the {label} on the secure keypad on the customer’s device. It is never typed or said in the conversation; digits typed here are not sent.
      </span>
    </p>
  );
}

/** The customer's device beside the conversation. */
export function CustomerDevice({
  token,
  channel,
  sms,
  source,
  onUseAccount,
  onAskForPerson,
  onRequestCallback,
}: {
  token: string | null;
  channel: BankingChannel;
  sms: string[];
  source: string;
  onUseAccount: (account: AccountView) => void;
  onAskForPerson: () => void;
  onRequestCallback: () => void;
}) {
  return (
    <div className="space-y-3" data-customer-device>
      <div className="rounded-xl border border-line bg-surface p-4">
        {token ? (
          <CustomerChannelPanel
            token={token}
            channel={channel}
            heading="Customer’s device"
            showEnvironment={false}
            onUseAccount={onUseAccount}
            onAskForPerson={onAskForPerson}
            onRequestCallback={onRequestCallback}
          />
        ) : (
          <>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldCheckIcon className="h-4 w-4 text-success" aria-hidden />
              Customer’s device
            </h2>
            <p className="mt-1 text-[13px] text-ink-soft">Sign-in, the secure keypad, accounts and confirmations appear here once the conversation starts.</p>
          </>
        )}
        <p className="mt-3 flex items-center gap-1 border-t border-line pt-2 text-[11px] text-muted">
          <LandmarkIcon className="h-3 w-3 shrink-0" aria-hidden />
          <span>Banking answers: {source}</span>
        </p>
      </div>
      {token && <MockPhone messages={sms} />}
      <TestLogins />
    </div>
  );
}
