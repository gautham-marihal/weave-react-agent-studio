import { describe, expect, it } from 'vitest';
import { parseSse } from '../api/gateway';
import { traceFromGateway } from './gatewayTrace';

describe('traceFromGateway', () => {
  it('maps tool calls with origin, outcome and code, relative to the conversation start', () => {
    const row = traceFromGateway({ type: 'tool', at: 1_500, tool: 'start_authentication', outcome: 'refused', ms: 12, code: 'locked', origin: 'channel' }, 1_000, 'x');
    expect(row).toMatchObject({ at_ms: 500, kind: 'tool', label: 'Gateway · start_authentication', status: 'info' });
    expect(row.detail).toBe('refused · locked · 12 ms · from the caller\'s screen');
  });

  it('shows an unknown transaction outcome as an error, never as success', () => {
    expect(traceFromGateway({ type: 'transaction', at: 0, service: 'stop_cheque', state: 'unknown' }, 0, 'x')).toMatchObject({ label: 'Gateway · stop cheque outcome unknown', status: 'error' });
  });

  it('describes sign-in states in words', () => {
    expect(traceFromGateway({ type: 'auth', at: 0, state: 'awaiting_otp', failures: 1 }, 0, 'x')).toMatchObject({ label: 'Gateway · sign-in waiting for the SMS code', detail: 'failed attempts: 1' });
  });
});

describe('parseSse', () => {
  it('reads complete events, skips comments and keeps the unfinished tail', () => {
    const { events, rest } = parseSse(': connected\n\nevent: tool\ndata: {"a":1}\n\nevent: auth\ndata: {"b"');
    expect(events).toEqual([{ event: 'tool', data: '{"a":1}' }]);
    expect(rest).toBe('event: auth\ndata: {"b"');
  });
});
