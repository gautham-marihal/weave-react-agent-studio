// Test harness: a real orchestrator on the mock adapters, with a controllable clock and captured audit records.
// It plays the parts of the agent runtime (tool calls) and the caller's device (secure keypad), so call flows can be
// tested end to end without a language model.

import type { AuditRecord } from '../src/audit/audit.ts';
import { createGateway } from '../src/app.ts';
import type { CaptureRequest } from '../src/security/capture.ts';
import type { GatewayEvent } from '../src/session/events.ts';
import type { Channel } from '../src/domain/types.ts';
import { createMockPorts } from './adapters.ts';

/** Tuesday 27 Oct 2026, 09:30 in Singapore: inside office hours and before the same-day cheque book cut-off. */
export const TUESDAY_0930_SGT = Date.parse('2026-10-27T01:30:00Z');

export function createHarness(start = TUESDAY_0930_SGT) {
  let now = start;
  const clock = () => now;
  const audit: AuditRecord[] = [];
  const { ports, controls } = createMockPorts(clock);
  const { orchestrator, registry } = createGateway({ ports, clock, auditSinks: [(r) => audit.push(r)], hosts: 'mock' });
  return {
    orchestrator,
    registry,
    controls,
    audit,
    advance(ms: number) {
      now += ms;
    },
    startCall(callId = 'call-1', channel: Channel = 'web_chat', callerId: string | null = '+6591234567') {
      const session = orchestrator.startSession({ callId, room: `room-${callId}`, channel, callerId, language: 'en' });
      const channelEvents: GatewayEvent[] = [];
      orchestrator.subscribe(session.id, 'channel', (e) => channelEvents.push(e));
      const call = {
        sessionId: session.id,
        channelEvents,
        tool: (name: string, args: Record<string, unknown> = {}) => orchestrator.executeTool(callId, name, args),
        /** The keypad the device is currently showing. */
        keypad(): CaptureRequest {
          const last = [...channelEvents].reverse().find((e) => e.type === 'capture_requested');
          if (!last || last.type !== 'capture_requested') throw new Error('no keypad open');
          return last.capture;
        },
        /** The caller keys a value into the open keypad. */
        key: (value: string) => orchestrator.submitCapture(session.id, call.keypad().token, value),
        lastOtp: () => controls.otpOutbox[controls.otpOutbox.length - 1]?.otp ?? '',
        async loginWithPhoneCode(phoneCode = '1234567', pin = '135790') {
          await call.tool('start_authentication', { phone_code: phoneCode });
          return call.key(pin);
        },
        async loginWithAccount(account = '500000000201', nric = '1234567') {
          await call.tool('start_authentication', { account_number: account });
          await call.key(nric);
          return call.key(call.lastOtp());
        },
      };
      return call;
    },
  };
}
