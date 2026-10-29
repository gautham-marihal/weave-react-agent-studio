import { useCallback, useEffect, useRef, useState } from 'react';
import { followChannel, gateway, GatewayError } from '../../api/gateway.ts';
import type { AuthView, CaptureOutcome, CapturePurpose, ChannelEvent, ChannelState, ConfirmationOutcome, Money, ToolResponse } from '../../api/gatewayTypes.ts';

// The caller's device side of a banking conversation: the gateway's channel stream (keypads, confirmations, sign-in
// changes) plus the device actions (identify, resend, restart, reissue, key in, confirm).
//
// What is deliberately NOT kept in React state:
//   - the keypad's one-time token (a ref, cleared the moment it is used);
//   - anything the caller keys in: the keypad reads its own uncontrolled input and passes the value straight to
//     `submitCapture`, which sends it and forgets it;
//   - the room token (the caller passes it in; it is held in a ref for the requests).

export type ChannelConnection = 'idle' | 'connecting' | 'open' | 'retrying' | 'closed';

/** The keypad as the screen may know it: everything but the token. `id` changes with every new keypad. */
export interface KeypadView {
  readonly id: number;
  readonly purpose: CapturePurpose;
  readonly label: string;
  readonly minDigits: number;
  readonly maxDigits: number;
  readonly expiresAt: number;
}

export type ConfirmationPhase = 'ready' | 'processing' | ConfirmationOutcome;

export interface ConfirmationCardState {
  readonly id: string;
  readonly summary: string;
  readonly charge: Money | null;
  readonly expiresAt: number;
  readonly phase: ConfirmationPhase;
  readonly message?: string;
  readonly reference?: string;
}

export interface CaptureFeedback {
  readonly accepted: boolean;
  readonly message: string;
  readonly auth: AuthView | null;
}

export interface BankingChannel {
  readonly connection: ChannelConnection;
  readonly error: GatewayError | null;
  readonly state: ChannelState | null;
  readonly keypad: KeypadView | null;
  readonly feedback: CaptureFeedback | null;
  readonly confirmation: ConfirmationCardState | null;
  /** The last device action's result, when it was refused (identify, resend…). */
  readonly refusal: ToolResponse | null;
  /** The same refusal, readable right after awaiting an action (before the next render). */
  lastRefusal: () => ToolResponse | null;
  readonly busy: boolean;
  identify: (identifier: { phone_code: string } | { account_number: string }) => Promise<boolean>;
  resendOtp: () => Promise<void>;
  restart: () => Promise<void>;
  newKeypad: () => Promise<void>;
  submitCapture: (value: string) => Promise<CaptureOutcome | null>;
  decide: (decision: 'confirm' | 'cancel') => Promise<void>;
  refresh: () => Promise<void>;
  reconnect: () => void;
}

const RETRY_MS = [1_000, 2_000, 5_000, 10_000];
// Not worth retrying: the gateway is not set up, refuses this token, or has no session for this call.
const permanent = (e: GatewayError) => e.kind === 'not_configured' || e.kind === 'unauthorised' || e.kind === 'not_found';

const toError = (e: unknown) => (e instanceof GatewayError ? e : new GatewayError(0, 'server', 'The banking gateway had a problem with this request.'));

export function useBankingChannel(token: string | null): BankingChannel {
  const [connection, setConnection] = useState<ChannelConnection>('idle');
  const [error, setError] = useState<GatewayError | null>(null);
  const [state, setState] = useState<ChannelState | null>(null);
  const [keypad, setKeypad] = useState<KeypadView | null>(null);
  const [feedback, setFeedback] = useState<CaptureFeedback | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationCardState | null>(null);
  const [refusal, setRefusal] = useState<ToolResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;
  const captureTokenRef = useRef<string | null>(null);
  const keypadIdRef = useRef(0);
  const refusalRef = useRef<ToolResponse | null>(null);

  const showKeypad = useCallback(
    (capture: { token: string; purpose: CapturePurpose; label: string; minDigits: number; maxDigits: number; expiresAt: number }) => {
      captureTokenRef.current = capture.token;
      keypadIdRef.current += 1;
      setKeypad({
        id: keypadIdRef.current,
        purpose: capture.purpose,
        label: capture.label,
        minDigits: capture.minDigits,
        maxDigits: capture.maxDigits,
        expiresAt: capture.expiresAt,
      });
    },
    [],
  );

  const clearKeypad = useCallback(() => {
    captureTokenRef.current = null;
    setKeypad(null);
  }, []);

  const adoptState = useCallback(
    (next: ChannelState) => {
      setState(next);
      // A keypad this device never received a token for (opened before it connected) can be reissued on request.
      if (!next.auth.secure_entry) clearKeypad();
      setConfirmation((card) => {
        if (next.confirmation) {
          const c = next.confirmation;
          // The event that opened the card carries no charge; the state view does.
          if (card?.id === c.confirmation_id) return card.charge || !c.charge ? card : { ...card, charge: c.charge };
          return {
            id: c.confirmation_id,
            summary: c.summary,
            charge: c.charge,
            expiresAt: c.expires_at,
            phase: c.state === 'executing' ? 'processing' : 'ready',
          };
        }
        // Keep a finished card (completed, failed…) on screen; drop one that is no longer pending.
        return card && (card.phase === 'ready' || card.phase === 'processing') ? null : card;
      });
    },
    [clearKeypad],
  );

  const refresh = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    try {
      adoptState(await gateway.channel.state(current));
      setError(null);
    } catch (e) {
      setError(toError(e));
    }
  }, [adoptState]);

  const onEvent = useCallback(
    (event: ChannelEvent) => {
      switch (event.type) {
        case 'capture_requested':
          showKeypad(event.capture);
          return;
        case 'capture_result':
          setFeedback({ accepted: event.accepted, message: event.message, auth: event.auth });
          setState((s) => (s ? { ...s, auth: event.auth } : s));
          if (!event.auth.secure_entry) clearKeypad();
          void refresh();
          return;
        case 'auth_changed':
          setState((s) => (s ? { ...s, auth: event.auth } : s));
          if (!event.auth.secure_entry) clearKeypad();
          void refresh();
          return;
        case 'confirmation_requested':
          setConfirmation({ id: event.confirmationId, summary: event.summary, charge: null, expiresAt: event.expiresAt, phase: 'ready' });
          void refresh(); // picks up the charge
          return;
        case 'confirmation_processing':
          setConfirmation((c) => (c && c.id === event.confirmationId ? { ...c, phase: 'processing' } : c));
          return;
        case 'confirmation_closed':
          setConfirmation((c) => (c && c.id === event.confirmationId ? { ...c, phase: event.outcome, message: event.message, reference: event.reference } : c));
          return;
      }
    },
    [showKeypad, clearKeypad, refresh],
  );

  useEffect(() => {
    if (!token) {
      setConnection('idle');
      setState(null);
      setError(null);
      setFeedback(null);
      setConfirmation(null);
      setRefusal(null);
      clearKeypad();
      return;
    }
    const controller = new AbortController();
    let retry = 0;
    let timer: number | undefined;
    const open = () => {
      setConnection(retry === 0 ? 'connecting' : 'retrying');
      followChannel(
        token,
        onEvent,
        () => {
          retry = 0;
          setConnection('open');
          setError(null);
          void refresh();
        },
        controller.signal,
      )
        .then(() => {
          if (controller.signal.aborted) return;
          scheduleRetry();
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          const err = toError(e);
          setError(err);
          if (permanent(err)) setConnection('closed');
          else scheduleRetry();
        });
    };
    const scheduleRetry = () => {
      setConnection('retrying');
      timer = window.setTimeout(open, RETRY_MS[Math.min(retry, RETRY_MS.length - 1)]);
      retry += 1;
    };
    open();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      captureTokenRef.current = null;
    };
  }, [token, attempt, onEvent, refresh, clearKeypad]);

  const act = useCallback(
    async (run: (t: string) => Promise<{ result: ToolResponse; state: ChannelState }>): Promise<boolean> => {
      const current = tokenRef.current;
      if (!current) return false;
      setBusy(true);
      setRefusal(null);
      refusalRef.current = null;
      setFeedback(null);
      try {
        const { result, state: next } = await run(current);
        adoptState(next);
        setError(null);
        if (!result.ok) {
          setRefusal(result);
          refusalRef.current = result;
        }
        return result.ok;
      } catch (e) {
        setError(toError(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [adoptState],
  );

  const identify = useCallback((identifier: { phone_code: string } | { account_number: string }) => act((t) => gateway.channel.identify(t, identifier)), [act]);
  const resendOtp = useCallback(async () => {
    await act((t) => gateway.channel.resendOtp(t));
  }, [act]);
  const restart = useCallback(async () => {
    clearKeypad();
    setConfirmation(null);
    await act((t) => gateway.channel.restart(t));
  }, [act, clearKeypad]);

  const newKeypad = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    setBusy(true);
    try {
      showKeypad(await gateway.channel.reissueCapture(current));
      setFeedback(null);
      setError(null);
    } catch (e) {
      setError(toError(e));
      void refresh();
    } finally {
      setBusy(false);
    }
  }, [showKeypad, refresh]);

  const submitCapture = useCallback(
    async (value: string): Promise<CaptureOutcome | null> => {
      const current = tokenRef.current;
      if (!current) return null;

      let captureToken = captureTokenRef.current;
      if (!captureToken) {
        // If capture token has not arrived over SSE yet, reissue directly from the gateway
        try {
          const reissue = await gateway.channel.reissueCapture(current);
          showKeypad(reissue);
          captureToken = reissue.token;
        } catch (e) {
          setError(toError(e));
          return null;
        }
      }

      // Single use: forget the token before the request, so a double submit cannot reuse it.
      captureTokenRef.current = null;
      const submitted = keypadIdRef.current;
      setFeedback(null);
      setBusy(true);
      try {
        const outcome = await gateway.channel.capture(current, captureToken, value);
        // The gateway's capture_result event carries the structured state; this covers a missed event.
        setFeedback((f) => f ?? { accepted: outcome.accepted, message: outcome.message, auth: null });
        // Close only the keypad that was used: the next step's keypad (NRIC → OTP) may already have arrived.
        if (outcome.accepted) {
          setKeypad((k) => (k && k.id === submitted ? null : k));
          // Refresh state immediately so authenticated state is recognized without waiting for SSE
          void refresh();
        }
        return outcome;
      } catch (e) {
        // The token is spent either way; the screen offers a new keypad instead of a dead one.
        setKeypad((k) => (k && k.id === submitted ? null : k));
        setError(toError(e));
        void refresh();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh, showKeypad],
  );

  const decide = useCallback(
    async (decision: 'confirm' | 'cancel') => {
      const current = tokenRef.current;
      const card = confirmation;
      if (!current || !card || card.phase !== 'ready') return;
      // Processing is shown from the moment the tap is sent; the outcome only from the gateway.
      if (decision === 'confirm') setConfirmation({ ...card, phase: 'processing' });
      try {
        const response = await gateway.channel.confirm(current, card.id, decision);
        // The confirmation_closed event normally arrives first; the response settles it if the stream is down.
        setConfirmation((c) => {
          if (!c || c.id !== card.id || (c.phase !== 'processing' && c.phase !== 'ready')) return c;
          if (response.ok)
            return {
              ...c,
              phase: decision === 'confirm' ? 'confirmed' : 'cancelled',
              message: typeof response.message === 'string' ? response.message : undefined,
            };
          const phase: ConfirmationPhase =
            response.error_code === 'no_pending_confirmation' ? 'expired' : response.error_code === 'outcome_unknown' ? 'unknown' : 'failed';
          return { ...c, phase, message: response.error_message };
        });
      } catch (e) {
        // The request may have reached the gateway: the outcome is unknown, not failed.
        setError(toError(e));
        setConfirmation((c) => (c && c.id === card.id && c.phase === 'processing' ? { ...c, phase: 'unknown' } : c));
      }
    },
    [confirmation],
  );

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);
  const lastRefusal = useCallback(() => refusalRef.current, []);

  return {
    connection,
    error,
    state,
    keypad,
    feedback,
    confirmation,
    refusal,
    lastRefusal,
    busy,
    identify,
    resendOtp,
    restart,
    newKeypad,
    submitCapture,
    decide,
    refresh,
    reconnect,
  };
}
