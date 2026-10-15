import test from 'node:test';
import assert from 'node:assert/strict';
import { countsLine } from '../src/studio/calls/callModel.js';

test('a call’s records are tallied in words, with the kinds the studio knows named, and nothing is said when there are none', () => {
  assert.equal(countsLine(undefined), '');
  assert.equal(countsLine({}), '');
  assert.equal(countsLine({ user_said: 0 }), '');
  assert.equal(countsLine({ user_said: 3, agent_said: 4, tool_called: 1, http_request: 2, error: 1 }), '11 records: 3 from the caller, 4 from the agent, 1 tool call, 2 API requests, 1 error');
  assert.equal(countsLine({ call_started: 1 }), '1 record', 'a kind the studio does not name still counts');
  assert.equal(countsLine({ user_said: 1, sentiment_scored: 2 }), '3 records: 1 from the caller');
});
