import type { AuthView } from '../channel/views.ts';
import type { CaptureRequest } from '../security/capture.ts';

// Real-time events per session. Two audiences:
//   - the channel client (chat widget, mobile app, Studio test console): needs capture requests and confirmations;
//   - observability (Studio Monitor/Test timeline): needs tool calls and state changes.
// Nothing here carries a PIN, OTP, NRIC or full account number; capture tokens go only to the channel audience.

/** How a prepared write ended. `unknown`: the host did not answer in time, so it may or may not have run. */
export type ConfirmationOutcome = 'confirmed' | 'cancelled' | 'expired' | 'failed' | 'unknown';

export type ChannelEvent =
  | { readonly type: 'capture_requested'; readonly capture: CaptureRequest }
  | { readonly type: 'capture_result'; readonly purpose: string; readonly accepted: boolean; readonly message: string; readonly auth: AuthView }
  | { readonly type: 'auth_changed'; readonly auth: AuthView }
  | { readonly type: 'confirmation_requested'; readonly confirmationId: string; readonly summary: string; readonly expiresAt: number }
  | { readonly type: 'confirmation_processing'; readonly confirmationId: string }
  | { readonly type: 'confirmation_closed'; readonly confirmationId: string; readonly outcome: ConfirmationOutcome; readonly message?: string; readonly reference?: string };

export type TimelineEvent =
  | { readonly type: 'tool'; readonly tool: string; readonly outcome: 'ok' | 'refused' | 'failed'; readonly ms: number; readonly code?: string; readonly origin: 'runtime' | 'channel' }
  | { readonly type: 'auth'; readonly state: string; readonly failures: number }
  | { readonly type: 'transaction'; readonly service: string; readonly state: 'pending' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'cancelled' | 'expired' }
  | { readonly type: 'session'; readonly state: 'started' | 'ended' };

export type GatewayEvent =
  | ({ readonly audience: 'channel'; readonly sessionId: string; readonly at: number } & ChannelEvent)
  | ({ readonly audience: 'timeline'; readonly sessionId: string; readonly at: number } & TimelineEvent);

type Listener = (event: GatewayEvent) => void;

export class EventBus {
  readonly #listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    const set = this.#listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.#listeners.set(sessionId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(sessionId);
    };
  }

  publish(event: GatewayEvent): void {
    for (const listener of this.#listeners.get(event.sessionId) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not break the call.
      }
    }
  }
}
