# Banking gateway

The deterministic half of the Business Banking agent. The Agent Builder runtime handles the conversation
(speech, wording, turn-taking). This gateway enforces everything the model must not decide:

- who the caller is (the authentication state machine),
- what they may do (entitlements),
- what reaches a host system (validated, two-phase, idempotent),
- what the model and the logs may see (whitelists, masking, audit).

Design: [docs/BANKING-AGENT-DESIGN.md](../../docs/BANKING-AGENT-DESIGN.md).

## Run it

Node 24 runs the TypeScript directly; there is no build step and there are no runtime dependencies.

```bash
cd services/banking-gateway
npm run start:mock    # the real gateway on in-memory mock host systems, http://localhost:8790
npm test              # 98 tests: state machine, schema, security, registry, HTTP, device routes, call flows
npm run typecheck
npm run tools:print   # the agent-config `tools` / `connections` generated from the registry
```

`npm run start:mock` prints a generated `GATEWAY_TOKEN`, a channel token for room `dev-room`, and every mock
SMS OTP. Set `GATEWAY_TOKEN`, `LIVEKIT_API_SECRET`, `PORT` and `CHANNEL_ORIGINS` to override.

**Rehearsals (mock only).** `mock/rehearsal.ts` adds `/dev/rehearsals` routes so Weave Studio's Banking page can start a
real gateway session with a channel token and play both sides (caller's screen and agent tool calls), read the mock
SMS outbox for that rehearsal, and make the next host call fail or hang. Studio's Banking assistant uses the same
session, plus `GET /dev/test-logins` (the table below) and `GET /dev/rehearsals/{id}/account-details` (the verified
customer's own full account numbers, for the eye icon; 409 before verification). Founder demo guide:
[docs/BANKING-FOUNDER-DEMO.md](../../docs/BANKING-FOUNDER-DEMO.md). They are off when `LIVEKIT_API_SECRET` is set
(they would mint real room tokens) and need `BANKING_GATEWAY_REHEARSALS=on` on the Studio side.

## On CIMB (the bank's real systems)

`src/main.ts` runs the gateway on CIMB's TetherfiDbRestApi through `src/adapters/cimb.ts` (the CIMB-Bank Postman
collection, kept in docs/evidence, which is not in git). `/health` then reports `hosts: "live"`.

```bash
CIMB_BASE_URL=http://16.79.174.151:3322 CIMB_REGION=DB2 GATEWAY_TOKEN=<32+ random chars> npm start
```

From the repository root, `npm run dev` does this by itself when `.env` has `CIMB_BASE_URL`.

| Gateway | CIMB method (`POST /TetherfiDbRestApi/dboperations`, header `Region: DB2`) |
|---|---|
| Sign-in (Phone Code + PIN) | `customer.getCustomerDetails`: the customer id is the 7-digit Phone Code, the passcode the PIN (4 to 6 digits on the keypad). Compared in the gateway in constant time and never passed on. The only sign-in route on CIMB |
| Accounts | `account.getCustomerAccounts`, plus `account.getAccountDetails` for each currency. CIMB's product name (e.g. "Savings Account-i") is what the caller hears |
| Balance | `account.getAccountDetails`: one balance (no holds, clearing or overdraft on CIMB) |
| Recent activity, incoming funds | `transaction.getTransactionHistory` (incoming = CREDIT rows of the last 7 days) |
| Transfer between own accounts (`prepare_own_transfer`, role `payments`) | `transaction.insertTransaction`: a DEBIT, then a CREDIT. The gateway checks every amount itself, because CIMB accepts negative, zero and three-decimal amounts (a DEBIT of -5.00 *adds* 5.00). A refused credit is undone with a reversal credit. A timeout or network error is never reversed (the credit may have posted) and is reported as outcome unknown |
| Everything else (PIN change, cheques, statements, SMS OTP, account + NRIC sign-in, appointments, service requests, rates, branches, callbacks) | No CIMB method. `cimbPolicy()` marks them unavailable, so they are refused before any host call (`not_offered`: "this service is not available on this line") and left out of every menu. The device offers only the Phone Code sign-in. Nothing is invented |

CIMB answers HTTP 200 even when a call fails. The adapter reads each `responseList` row: a "not found" answer is an
empty result, and any other failure (e.g. a database exception) becomes host error `db_error`. SQL text is never passed on.
CIMB has no holiday calendar, so office hours come from the policy alone.

`STUDIO_TEST_SESSIONS=on` (set by `npm run dev`) adds `src/http/test-sessions.ts`: the same `/dev/rehearsals` paths as
the mock's, so Studio's Live banking rehearsal and "Try a banking tool" run on CIMB. There are no test logins, no
SMS, no staged host faults and no full account numbers. Off when `LIVEKIT_API_SECRET` is set.

Some CIMB customers have 4-digit passcodes, so the sign-in keypad takes 4 to 6 digits (a new PIN, on banks that offer
PIN change, is still 6 digits). Transfers are capped by `policy.ownTransfer.maxMajorUnits` (50,000; an open decision).

## The caller's device

Besides the keypad and confirmation routes, the device can drive sign-in itself, so identifiers never pass through
the model. All are authorised by the call's LiveKit token and reach only that call's session:

| Route | Does |
|---|---|
| `GET /v1/channel/state` | Sign-in state with attempts left and lock reason, methods for this channel (with reveal policy), help entries, masked profile and accounts, pending confirmation, `hosts` (mock or live) |
| `POST /v1/channel/identify` | `{phone_code}` or `{account_number}`: the same `start_authentication` tool, validation and counters |
| `POST /v1/channel/otp/resend` | `resend_otp` within the policy limit |
| `POST /v1/channel/restart` | Start again with another identifier, or sign out (failures are kept) |
| `POST /v1/channel/capture/reissue` | A fresh keypad for the step in progress (expired, or the device reconnected) |

Confirmations now end honestly: `confirmation_processing`, then `confirmation_closed` with `confirmed`, `failed`,
`unknown` (host timeout: it may have run), `cancelled` or `expired`. The timeline is also available by room
(`GET /v1/rooms/{room}/timeline`) for Studio's Test stage.

From the repository root, `npm run check` runs these tests too (`check:gateway`), and `check:no-fake` scans
`src/` here with the same rules as the app.

## Test logins (mock only)

| Who | Identify with | Secret (keyed on the secure keypad) | Exercises |
|---|---|---|---|
| PhoneCode user | phone code `1234567` | PIN `135790` | 3 accounts: positive SGD with hold and pending cheques (A1), overdrawn omnibus SGD (A2), USD/EUR (A3) |
| Authorised Signatory (BizConn, first login) | account `500000000201` | NRIC digits `1234567`, then the OTP printed on the console | OTP route, terms notice, stop cheque, cheque books |
| Authorised Contact | account `500000000301` | NRIC digits `7654321`, then OTP | entitlement refusals (no balance, no stop cheque) |
| Personal-banking customer | phone code `7777777` | PIN `111111` | redirected to the personal line |
| Dormant account | account `500000000501` | NRIC digits `9999999` | "visit your nearest branch" |
| Host-locked PhoneCode | phone code `6666666` | PIN `222222` | host code 62 |

Cheques `100005` (cleared, so it can't be stopped: host code 196), `100006` (returned) and `100007` (already
stopped: 192) drive the cheque error paths. Cheque books cover `100001–100050` and `100051–100100`.

## Folders

```
src/                 production code; never imports mock/
  domain/            money (integer minor units), Singapore time, rates, policy (legacy values, unapproved)
  fsm/               the session state machine: pure, deterministic, fully tested
  schema/            strict argument schemas → TS types, run-time validation, JSON Schema for the model
  ports/             what the gateway needs from AS400, Siebel, CMM and the OTP service
  adapters/          the ports on a real bank: CIMB's TetherfiDbRestApi (cimb.ts)
  security/          secure capture, LiveKit token check, redaction, constant-time compare
  audit/             hash-chained audit log
  session/           session store, real-time event bus
  tools/             the 33 tools, the registry, agent-config generation (tools, connection, session events, state)
  channel/           what the caller's device may see about its own session
  handoff/           escalation contract to another assistant (contract only: no target exists yet)
  executor/          response shaping, host response matrix
  orchestrator/      ties it together: one locked operation per session
  http/              the HTTP API (runtime routes and caller-device routes)
  app.ts, main.ts    composition root; production entry (on CIMB; refuses to start without CIMB_BASE_URL)
mock/                MOCK host systems, fixtures, mock entry point and the tests that need them
```

## Removing the mock

When the real adapters exist:

1. Implement `Ports` (src/ports/ports.ts) in `src/adapters/`, against the SOA/Siebel/CMM contracts.
2. Wire them in `src/main.ts` (the commented block shows how) and start with `npm start`.
3. Move the end-to-end tests you want to keep onto a contract-test environment, then delete `mock/`.
4. Remove `start:mock` from package.json.

Nothing under `src/` imports `mock/`; `src/boundaries.test.ts` fails if that ever changes.
