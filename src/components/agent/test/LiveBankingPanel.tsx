import React from 'react';
import { LandmarkIcon, LoaderCircleIcon } from 'lucide-react';
import { bankingSourceLabel, isMockBank } from '../../../api/gateway';
import { useBankingSource } from '../../../hooks/useBankingSource';
import type { TestSession } from '../../../hooks/useTestSession';
import { CustomerChannelPanel } from '../../banking/CustomerChannelPanel';

/**
 * The banking side of a Live conversation with the real agent, for a draft wired to the banking gateway. It shows only
 * what is true (bankingSource): with a gateway server (the bank's real systems, or the mock bank's test data, said
 * plainly), the customer's device bound to the conversation's room token while it runs; with only the mock bank in
 * this browser, which the agent runtime cannot reach, why the agent's banking tools get no answers here, and that the
 * banking rehearsal ("Played by") runs the whole banking flow on the mock bank instead.
 */
export function LiveBankingPanel({ session }: { session: TestSession }) {
  const source = useBankingSource();

  if (!source) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-[13px] text-muted">
        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Checking the banking gateway…
      </p>
    );
  }
  if (source.kind === 'browser') {
    return (
      <div role="note" aria-label="Banking" data-banking-source="browser" className="rounded-xl border border-warning/40 bg-warning-soft/60 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <LandmarkIcon className="h-4 w-4 text-warning" aria-hidden />
          The real agent can’t reach the mock bank here
        </p>
        <p className="mt-1 text-[13px] text-ink-soft">
          No banking gateway server is connected to this Studio; the mock bank runs in this browser, which the agent runtime can’t reach. The agent’s banking tools answer only from the gateway at its
          banking_gateway_url. To try the whole banking flow (sign-in, keypad, accounts, confirmations) choose “Banking rehearsal (mock bank)” under Played by.
        </p>
      </div>
    );
  }
  const mock = isMockBank(source);
  return (
    <div className="rounded-xl border border-line bg-surface p-4" data-banking-source={source.kind}>
      {session.roomToken ? (
        <CustomerChannelPanel
          token={session.roomToken}
          heading="Customer’s device"
          onAskForPerson={() => void session.send('I would like to speak to a Service Manager.')}
          onRequestCallback={() => void session.send('Please arrange a call back.')}
          onUseAccount={(account) => void session.send(`Please use my ${account.type.toLowerCase()} ending ${account.ending.replace(/\D/g, '')}.`)}
        />
      ) : (
        <>
          <h2 className="text-sm font-semibold text-ink">Customer’s device</h2>
          <p className="mt-1 text-[13px] text-ink-soft">Sign-in, the secure keypad, accounts and confirmations appear here once the conversation starts.</p>
        </>
      )}
      {mock && (
        <p className="mt-3 rounded-md bg-warning-soft/60 px-2 py-1.5 text-[12px] text-ink-soft">
          Mock bank: test data only. The device follows this conversation when the agent runtime reaches this gateway at its banking_gateway_url.
        </p>
      )}
      <p className="mt-3 flex items-center gap-1 border-t border-line pt-2 text-[11px] text-muted">
        <LandmarkIcon className="h-3 w-3 shrink-0" aria-hidden />
        <span>Banking answers: {bankingSourceLabel(source)}</span>
      </p>
    </div>
  );
}
