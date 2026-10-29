import { useEffect, useRef, useState } from 'react';
import { followRoomTimeline, GatewayError } from '../../api/gateway.ts';
import { gatewayNote, recordFromGateway, type GatewayRecord } from './gatewayRecords.ts';

const RETRY_MS = 3_000;
const MAX_RETRIES = 5;

/**
 * Follows the banking gateway's timeline for a conversation's room, as trace records, while `enabled` (a draft wired
 * to the gateway, during the conversation). The records stay when it ends and go when another room starts. If the
 * gateway has no session for the room after a few tries, that is said once as a record: it means the runtime never
 * started a gateway session for this conversation.
 */
export function useGatewayRecords(room: string | null | undefined, startedAt: number | null | undefined, enabled: boolean): GatewayRecord[] {
  const [records, setRecords] = useState<GatewayRecord[]>([]);
  const countRef = useRef(0);

  useEffect(() => {
    setRecords([]);
    countRef.current = 0;
  }, [room]);

  useEffect(() => {
    if (!enabled || !room || !startedAt) return;
    const controller = new AbortController();
    const next = () => (countRef.current += 1);
    let retries = 0;
    let timer: number | undefined;
    const add = (record: GatewayRecord) => setRecords((old) => [...old, record]);

    const open = () => {
      followRoomTimeline(
        room,
        (event) => add(recordFromGateway(event, startedAt, next())),
        () => {
          retries = 0;
        },
        controller.signal,
      ).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const kind = error instanceof GatewayError ? error.kind : null;
        // The runtime may not have opened the gateway session yet; give it a few seconds before saying so.
        if (kind === 'not_found' && retries < MAX_RETRIES) {
          retries += 1;
          timer = window.setTimeout(open, RETRY_MS);
          return;
        }
        if (kind === 'not_found')
          add(gatewayNote('The runtime started no banking-gateway session for this conversation, or cannot reach the gateway.', true, startedAt, next()));
        else if (kind === 'not_configured') add(gatewayNote('No banking gateway is set up for this studio.', false, startedAt, next()));
        else add(gatewayNote(error instanceof Error ? error.message : 'The banking gateway did not answer.', true, startedAt, next()));
      });
    };
    open();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [room, startedAt, enabled]);

  return records;
}
