# Business Banking agent: requirements trace and readiness

| | |
|---|---|
| Document | WS-BANK-002, 27 October 2026 |
| Companion to | [BANKING-AGENT-DESIGN.md](BANKING-AGENT-DESIGN.md) (WS-BANK-001) |
| Sources | `BBCSC-IVR-CallFlow-2015Jul15-v47` (48 pages) and its revHEAD copy; `SGBB-MYCFS & BB IVR Call Flows` (56 pages; 49–56 are Malaysian) |
| Status | **Mock-backed and not production-ready.** The gateway, the customer banking surfaces and the Studio integration work end to end against the gateway's mock bank systems. They have not run with the Agent Builder runtime, a real LiveKit call, voice, or any real bank system. Every 2015 business rule is still unapproved. |

Status words used below: **Done** (built and tested at the level stated), **Partial** (some of it built; the gap is named),
**Blocked** (needs something outside this repository; the dependency is named), **Out of scope** (decided, with owner).

---

## 1. What was verified, and how

| Level | What | Evidence |
|---|---|---|
| Unit | Gateway: state machine, schema, money, security, registry, handoff boundary | `npm --prefix services/banking-gateway test`: 98 tests, 10 files |
| Unit | Studio: proxy route rules, guidance engine, tool insertion, timeline mapping, SSE parsing | `npm test`: 281 tests (27 new), 26 files |
| Integration (HTTP, real sockets) | Runtime routes, device routes, rehearsal routes, auth on each | `mock/http.test.ts`, `mock/rehearsal.test.ts` |
| Integration (call flows) | Every one of the 33 tools, through the real orchestrator on mock hosts | `mock/scenarios.test.ts`, `mock/channel.test.ts`, `mock/coverage.test.ts` |
| Integration (Studio proxy) | Runtime token added server-side to read routes only; sessions and real-call tool runs refused (403) before the gateway | curl against Vite + mock gateway (§8) |
| Live validator (read-only) | Generated config inserted into a real draft passes `POST /validate` on the shared Agent Builder API, with and without the six specialist agents | `validate-check.mjs` (session scratchpad); no write was sent (the driver blocks every other `/api` write) |
| Browser | 41-step customer and staff walkthrough (both sign-in routes, eye toggle, wrong PIN, lockout, profile, account picker, confirmation, host hang → outcome unknown, sign-out, storage scan, 390 px width) | Headless Chrome over CDP, `/api` writes blocked; 4 consecutive clean runs; screenshots 01–14 |
| Not verified | The runtime calling the gateway; the Test console's banking panel in a live conversation; a real LiveKit token at the gateway; any voice call; any real host; load, failover, penetration | §4 |

### Customer journey as demonstrated in the browser (rehearsal on mock bank systems)

1. **Login.** The caller sees two method cards (Phone Code + PIN; business account + NRIC + SMS code), each saying what it needs.
   Choosing Phone Code opens a masked 7-digit field with an eye button (allowed by policy) and help ("Where do I find my
   Phone Code?" says honestly that the bank's procedure is not confirmed and offers a Service Manager).
2. **Secure entry.** The PIN keypad opens outside the transcript: masked, no eye button, on-screen keys of 44 px, countdown
   with "I need more time". A wrong PIN shows the gateway's own message, "You have 2 attempts left", and a fresh keypad.
3. **Profile.** After verification: masked business name, customer ending, method, access, language, three accounts by
   type, masked ending and currency, with a picker because there is more than one; a single-account caller is not asked.
4. **Enquiry.** The agent (staff, in rehearsal) runs `get_balance`; the gateway returns the deck-worded `say` text.
5. **Write with confirmation.** `prepare_stop_cheque` puts a card on the caller's screen with the server's summary and
   charge (SGD 15.00) and a countdown. Confirm → Processing → **Completed** only after the host reported success.
6. **Error recovery.** With the next host call set to hang, Confirm → Processing → **Outcome unknown** ("do not repeat
   it; a Service Manager can check"). Three wrong PINs lock sign-in with the deck's PIN-reset wording.
7. **Escalation.** Guidance offers "Speak to a Service Manager" / "Ask for a call back" where the hosting screen can act
   (in the Test console these send the request to the real agent). In rehearsal there is no agent, so they are not offered.

### Banking assistant (added 28 October 2026)

Banking → **Banking assistant** runs a customer conversation (typed, or spoken through the browser's speech service)
on a rehearsal session of the real gateway: a rule-based assistant (`src/models/bankingAssistant.ts`, no language
model) picks the gateway tool, and every fact it states comes from the tool result. Sign-in, entitlements and
confirmations stay with the gateway; PIN/NRIC/OTP typed or spoken in the conversation go straight to the secure capture
(a rehearsal switch, *Keypad only* matches production). Adds an account overview with eye-icon reveal and an Account
details view (full numbers from the mock host via a mock-only route), balance cards with current / available / pending
clearance / hold / overdraft (new structured fields on `get_balance`), and 12 scenarios judged from gateway events.
Verified: 61-step chat walkthrough and 19-step voice-path walkthrough in headless Chrome (speech engine scripted; real
microphone is a manual check). Why the earlier voice test said "Tess from Acme Water": the shared `voice-test` bot's
persona, with no banking tools. Guide and run steps: [BANKING-FOUNDER-DEMO.md](BANKING-FOUNDER-DEMO.md).

---

## 2. IVR reference trace

| Deck pages | Area | Gateway (tools, rules) | Customer surface | Tests | Status |
|---|---|---|---|---|---|
| p1 | Time-of-day greeting; English/Mandarin; preferred language after 5 calls | `get_caller_context`, `record_language_choice`; `ContentPort.preferredLanguage` | Profile shows language | `coverage.test.ts` | **Partial**: Mandarin wording for regulated `say` strings undecided (O11) |
| p2 | Main menu, speech with DTMF fallback, 3-digit service code, "0 for a Service Manager" | `list_services` (role-aware); `prepare_agent_transfer` | "What you can ask about" after sign-in | `coverage.test.ts` | **Partial**: DTMF fallback and service codes blocked (O2, O8) |
| p3–p8, p42–p43 | Balances, available balance, holds, overdraft, incoming funds, activity, statements; single vs multiple accounts; currency choice | `list_accounts`, `get_balance`, `get_incoming_funds`, `get_recent_transactions`, `prepare_statement_request` | Account picker; confirmation card for statements | `scenarios.test.ts` (account services) | **Done** on mock hosts |
| p9 | Phone PIN change, once per call | `start_pin_change` + keypad steps | Secure keypad (current / new / re-enter) | `scenarios.test.ts` (PIN change) | **Done** on mock hosts; chat only (voice blocked by O2) |
| p10–p16 | Deposited/returned cheques, issued status, cheque book status/request with cut-offs and charges, stop payment single/range, host codes 192/196/343 | `get_deposited_cheques`, `get_issued_cheque_status`, `get_chequebook_status`, `prepare_chequebook_request`, `prepare_stop_cheque` | Confirmation card | `scenarios.test.ts`, `coverage.test.ts`, `channel.test.ts` | **Done** on mock hosts; charges and cut-offs unapproved (O1) |
| p17 | Velocity (internet banking) help, forms, training | Training appointments only | — | `coverage.test.ts` | **Partial**: forms/technical support routed to a person |
| p18, p29 | New account, trade, loans, service code 328 | `prepare_agent_transfer` routes; `fd_loan` entitlement | Guidance → Service Manager | `scenarios.test.ts` (transfers) | **Done** as routing |
| p19, p45, p47, p48 | Branch appointments: 2 days ahead, party limits, cancellation ≥ 2 days | `find_appointment_slots`, `prepare_appointment_booking`, `list_appointments`, `prepare_appointment_cancellation` | Confirmation card | `coverage.test.ts` | **Done** on mock hosts; **no real appointment API** identified (adapter blocker) |
| p20–p26, p44 | FX (9 currencies), prime, SGD time deposits, promotions, GIRO/SWIFT, branch locator | `get_fx_rate`, `get_prime_rate`, `get_time_deposit_rates`, `get_announcements`, `find_branch` | — (spoken by the agent) | `scenarios.test.ts`, `coverage.test.ts` | **Done** on mock hosts |
| p27–p28 | Forms by fax | — | — | — | **Out of scope** (no fax channel; O8) |
| p30 | Lost card: office hours → account → priority transfer; after hours → card operations | `report_lost_card` | — | `scenarios.test.ts` | **Done** as routing; the transfer itself is runtime config |
| p31–p32 | VIP / investigation lines, last Service Manager | — | — | — | **Blocked**: contact-centre agent affinity (O8) |
| p33–p34, p46 | Authentication: PhoneCode + T-PIN, or account + NRIC + SMS OTP; host codes 50/53/62/83; cumulative 3 tries; dormant; personal-customer redirect | `start_authentication`, `get_auth_status`, `resend_otp`, `restart_authentication`; FSM; **device routes** `identify`, `otp/resend`, `restart`, `capture/reissue`, `state` | Method cards, identifier field with eye toggle, secure keypad, progress, guidance, help | `scenarios.test.ts`, `channel.test.ts`, browser | **Done** for chat on mock hosts; **voice blocked** (O2) |
| p35–p36, p40 | Timeout and invalid input (1/2/3 strikes); host error matrix | Response matrix; outcome-unknown entry; keypad format errors | Guidance engine (typed) | `scenarios.test.ts`, `channel.test.ts`, `bankingGuidance.test.ts` | **Partial**: silence/no-match strikes are runtime `inactivity` config, untested here |
| p37–p38 | Surveys | — | — | — | **Blocked**: runtime `post_call` (not run by the runtime, guide §8) |
| p39 | Callback manager: 5–15 digits, one per number per day | `request_callback` | "Ask for a call back" action | `scenarios.test.ts` | **Done** on mock hosts |
| p41 | Transfer with CTI screen pop | `prepare_agent_transfer` returns route + SR number | "Speak to a Service Manager" action | `scenarios.test.ts` | **Partial**: the transfer runs in runtime `telephony.transfers`, unverified |
| p49–p56 | Malaysian credit-card and business-banking menus ("subject to change") | — | — | — | **Out of scope** for Singapore; separate MY business and compliance approval (O12) |

---

## 3. Brief requirements checklist

| § | Requirement | Status | Where |
|---|---|---|---|
| 4A | Method cards with what each needs; unsupported methods not offered | **Done** | `SignInPanel.tsx`; gateway `authMethods()` marks both unavailable on SIP voice with the reason |
| 4B | PhoneCode + PIN guided steps, progress, real attempts | **Done** | `IdentifierField`, `SecureKeypad`, `SignInPanel` progress; attempts from `AuthView` |
| 4C | Account + NRIC + OTP, honest waiting, lockout, dormant, personal redirect | **Done** (chat) | Same; mock phone in rehearsal stands in for SMS |
| 4D | Eye icon for permitted identifiers; secrets masked, uncontrolled, cleared, never in state/storage/URL/model | **Done** | Reveal list is gateway policy (`policy.channel.revealableIdentifiers`, unapproved); browser storage scan passes |
| 4E | Contextual help: what / where / what if not | **Done**, wording unapproved | `src/domain/help.ts` with `source` and `approved: false`; unknown procedures say so |
| 5 | Profile/context panel: masked identity, status, role, accounts, language, sign-out, help | **Done** | `ProfilePanel.tsx`, gateway `profileView()` |
| 5 | Account selector only for several accounts; server decides access | **Done** | Picker sends the choice to the agent (Test console) or the runner (rehearsal); gateway checks entitlement per call |
| 6 | One session for voice and text | **Done (existing)** | `useTestSession` already joins one LiveKit room for both; the banking panel uses the same room token |
| 6 | Listening / speaking / muted / disconnected states | **Done (existing)** | `VoiceBubble` |
| 6 | Credentials never spoken; DTMF masking | **Blocked (voice)** | Runtime does not run DTMF (O2); on SIP the methods are shown as unavailable with a safe alternative |
| 7 | Typed error → guidance mapping, no ad hoc strings | **Done** | `models/bankingGuidance.ts` (+10 tests) |
| 8 | All IVR flows traced | **Done** | §2 above |
| 9 | Two-phase writes; Ready / Processing / Completed / Failed / Outcome unknown | **Done** | Gateway `#settle` + `OUTCOME_UNKNOWN_ENTRY`; `ConfirmationCard.tsx`; chat confirm is now time-boxed |
| 10 | Six specialist agents within schema limits | **Partial** | Tool lists generated and assigned to existing roles; the roles' instructions are not written; validator accepts all six with greeter at 7 tools + 5 handoffs |
| 11 | Escalation to the Voice AI Banking Assistant | **Blocked** | Contract only: `src/handoff/handoff.ts` (`NO_HANDOFF` default). That repository has no endpoint that accepts a conversation from another runtime |
| 12 | Calm, accessible UI; keyboard; focus; live regions; reduced motion; touch targets | **Done**, not audited | Labels, `aria-live`, `role=alert` for errors, `motion-reduce:`, 44 px keys; no formal WCAG audit yet |
| 13 | Security controls | **Done in gateway**, see §5 | |
| 14 | Mock only in the gateway's mock folder; environment shown | **Done** | Rehearsal routes in `mock/rehearsal.ts`; "Mock bank systems · test data only" from the gateway's own `hosts` |
| 15 | Journey tests | **Done** for chat on mock hosts | §1 |
| — | Studio: manifest, generated tools inserted idempotently, conflicts refused, read-only respected, timeline | **Done** | `BankingToolsSection.tsx`, `models/bankingTools.ts`, `useGatewayTimeline.ts`, `models/bankingAgent.ts` (Make this a banking agent), the Test stage |

---

## 4. Not implemented, and exactly why

| Capability | Blocker | Needed from |
|---|---|---|
| The live runtime calling the gateway | The gateway runs on this machine; the shared runtime cannot reach `localhost`. Needs the gateway deployed where the runtime can reach it, and `BANKING_GATEWAY_TOKEN` as a runtime secret | Platform |
| Device binding in a real conversation | The gateway verifies LiveKit tokens with the LiveKit API secret, which only the platform holds (O4). Until then the Test console's banking panel shows "Secure entry is not connected to this conversation" | Platform / Security |
| `{{call.room}}`, `{{channel.type}}` in the session-start event | The agent-config guide lists `call.*` and `channel.*` as specified but "nothing checks or runs them yet". Studio shows these as unverified dependencies when inserting the tools | Runtime owner |
| Voice authentication and voice PIN change | No DTMF in the runtime (O2) | Runtime owner or contact-centre DTMF masking |
| Voice confirmation checked against the real transcript | `confirm_transaction` checks the words the model passes; a runtime hook should supply the transcript turn (O5) | Runtime owner |
| Handoff to the Voice AI Banking Assistant | It exposes no inbound-handoff API; its `escalate_to_human` only flags its own call record. Its domain is Indian retail lending (EMIs, payment promises), not Singapore business banking | That repository's owner |
| Human transfer and callback execution | Runtime `telephony.transfers` with a lookup on `state.transfer_route`; not configured or tested here | Agent owner + contact centre |
| "Outcome unknown" follow-up (look the request up) | No host status query port exists for stop payments, statements or cheque books | Bank integration team (SOA contracts) |
| Real host adapters | SOA/ESB, Siebel, CMM and OTP contracts (design §8.5) | Bank integration team |
| Multi-instance gateway | In-memory session store and lock (O6) | Platform |
| HTTP/2 or connection budgeting for the Studio proxy | Each banking screen holds two event streams; browsers allow six HTTP/1.1 connections per host | Platform (serve Studio over HTTP/2) |
| Production Studio proxy | `/gateway` rules exist for the Vite dev/preview server only (`src/utils/gatewayProxy.ts`); the production front door needs the same allowlist | Platform |
| Specialist agent instructions | Not written; they are business-owned wording (§4.2 of the design gives roles) | Agent owner |
| Formal WCAG 2.2 audit | Not done | Accessibility reviewer |

---

## 5. Security and privacy review summary

| Control | State |
|---|---|
| Secrets never reach the model, transcript, logs or browser state | PIN/NRIC/OTP only through single-use, session-bound, 120 s capture tokens; values never in React state (uncontrolled inputs, cleared on submit/unmount); the capture token lives in a ref; storage/URL scan clean in the browser run; audit test asserts no secret in any record |
| Identifiers | Phone Code / account number typed into the device go to the gateway, not the model (new `identify` route), masked in audit |
| Model-facing data | Whitelisted fields, opaque `A1` references, leak check; profile is masked on screen too |
| Authorisation | Server-side on every call (`#gate`); the React layer decides nothing; sign-out drops the profile, account refs and any pending confirmation |
| Confirmation | Bound to session and prepared operation, single use, expiring; chat confirm bypasses the model; host failure → failed, host timeout → outcome unknown (never "expired", never success) |
| Studio proxy | Runtime token added server-side to `GET /v1/tools`, `/v1/agent-config`, timelines only; `POST /v1/sessions`, `/v1/sessions/end` and tool calls for real calls refused; rehearsal routes need `BANKING_GATEWAY_REHEARSALS=on` and reach `rehearsal_` sessions only |
| Rate limits | Device identify, resend, reissue and capture share the 10/min per-session limiter |
| Mock containment | Rehearsal routes live in `mock/`; refuse to mint tokens if a real LiveKit secret is configured; mock entry refuses `NODE_ENV=production`; `check:no-fake` scans gateway `src/` |
| Handoff context | Built from server state; strips digit runs from free text; never carries name, CIF, account numbers or secrets |
| Residual risks | Free-text intent may still contain sensitive words without digits; LiveKit token TTL governs device-route exposure; no penetration test; no SIEM integration |

---

## 6. Business decisions still requiring approval

Carried from design §10 (O1–O12), plus these from this increment:

| # | Decision | Owner |
|---|---|---|
| O13 | May callers unmask their Phone Code and account number on screen (eye icon)? Currently allowed, unapproved | Security + business owner |
| O14 | Help wording (`src/domain/help.ts`), including where customers find their Phone Code (unknown today) | Business owner + Compliance |
| O15 | How much of the business name to show in the profile (first letter of each word today) | Business owner + Privacy |
| O16 | Runtime support for `{{call.room}}` / `{{channel.type}}`, or another way to pass the room at session start | Runtime owner |
| O17 | Escalation target and contract for the Voice AI Banking Assistant, if it is to take over conversations | Product owner |
| O18 | What to tell a caller when a write's outcome is unknown, and who follows it up | Operations |

---

## 7. Manual checks (cannot be automated here)

Run these with the agent owner on a **new test bot** (never a shared bot), after the blockers in §4 for the runtime are cleared:

1. Build → Tools → *Add banking tools* with the deployed gateway address → save → `POST /validate` clean.
2. Test → web chat: "I need to check my balance". Expect a hand-off to verification; the Banking panel shows the method
   cards; sign in with a mock login; the agent then reads the balance (`say` text, as written).
3. Same in web voice: speak the request, sign in on the panel, then switch to typing mid-call. One session, one profile.
4. "Stop cheque 100060": card on screen; tap Confirm; agent says it is done only after the card says Completed.
5. Say "yes" to a read-back in voice: `confirm_transaction` succeeds only for an explicit yes ("yes, but cancel" fails).
6. "I want to speak to a person": transfer within hours; callback offered after 18:00 SGT.
7. Microphone denied, then allowed; network dropped mid-keypad (the keypad offers a new one; nothing was sent).
8. Screen reader (NVDA) pass over sign-in, keypad, card; keyboard-only pass; 200 % zoom; prefers-reduced-motion.

---

## 8. Running it locally

```bash
# 1. The gateway on its mock bank systems (prints GATEWAY_TOKEN; test logins in services/banking-gateway/README.md)
GATEWAY_TOKEN=<32+ chars> PORT=8790 npm --prefix services/banking-gateway run start:mock

# 2. Studio, pointed at it (add to .env or the shell)
BANKING_GATEWAY_URL=http://localhost:8790
BANKING_GATEWAY_TOKEN=<the same token>
BANKING_GATEWAY_REHEARSALS=on          # Sandbox test sessions and Try a banking tool (mock gateway only)
npm run dev
```

Checks: `npm run check` (lint, typecheck, app tests, build, no-fake, gateway typecheck and tests).
