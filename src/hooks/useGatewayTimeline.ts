import { useEffect, useState } from 'react';
import { followRoomTimeline, GatewayError } from '../api/gateway';
import type { TraceEvent } from '../types/testConsole';
import { traceFromGateway } from '../utils/gatewayTrace';

const RETRY_MS = 3_000;
const MAX_RETRIES = 5;

/**
 * Follows the banking gateway's timeline for a conversation's room and returns it as trace rows. Only for drafts
 * wired to the gateway (`enabled`); the room says which gateway (a rehearsal's room is the mock bank's, see
 * src/api/gateway.ts). If the gateway has no session for the room,
 * that is reported once as a trace row: it means the runtime never started a gateway session for this conversation.
 */
export function useGatewayTimeline(room: string | null, startedAt: number | null, enabled: boolean): TraceEvent[] {
  const [rows, setRows] = useState<TraceEvent[]>([]);

  useEffect(() => {
    setRows([]);
    if (!enabled || !room || startedAt === null) return;
    const controller = new AbortController();
    let n = 0;
    let retries = 0;
    let timer: number | undefined;
    const note = (label: string, detail: string, status: TraceEvent['status']) =>
      setRows((prev) => [...prev, { id: `gw_note_${(n += 1)}`, at_ms: Math.max(0, Date.now() - startedAt), kind: 'session', label, detail, status }]);

    const open = () => {
      followRoomTimeline(
        room,
        (event) => setRows((prev) => [...prev, traceFromGateway(event, startedAt, `gw_${(n += 1)}`)]),
        () => {
          retries = 0;
        },
        controller.signal
      ).catch((e: unknown) => {
        if (controller.signal.aborted) return;
        const err = e instanceof GatewayError ? e : null;
        // The runtime may not have opened the session yet; give it a few seconds before saying so.
        if (err?.kind === 'not_found' && retries < MAX_RETRIES) {
          retries += 1;
          timer = window.setTimeout(open, RETRY_MS);
          return;
        }
        if (err?.kind === 'not_found') note('Gateway · no session for this conversation', 'The runtime did not start a banking-gateway session (call_started event), or cannot reach the gateway.', 'error');
        else if (err?.kind === 'not_configured') note('Gateway · not set up', 'BANKING_GATEWAY_URL is not set for this Studio.', 'info');
        else note('Gateway timeline unavailable', err?.message ?? 'The banking gateway did not answer.', 'error');
      });
    };
    open();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [room, startedAt, enabled]);

  return rows;
}
