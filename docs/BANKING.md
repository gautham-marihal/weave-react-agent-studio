# Banking in Weave Studio: handover

Status on 29 October 2026. What is verified, how it fits together, how to run and test it, and what is still needed for a
real bank. **The banking gateway currently runs only in its test environment: simulated bank systems with test logins
and test data.** It has no adapters for a real bank's systems yet (see §14 and §15).

---

## 1. Overview

A banking agent is an ordinary Weave agent whose banking tools call the **banking gateway**
([`services/banking-gateway/`](../services/banking-gateway/), design: [BANKING-AGENT-DESIGN.md](BANKING-AGENT-DESIGN.md)). The
gateway, not the language model, decides who the caller is, what they may do and what reaches the bank: the sign-in state
machine, entitlements, secure capture of PINs and one-time passwords, two-phase (confirmed) requests, masking and audit.

In the studio, banking lives on the pages that already exist, with no separate section and no second builder or runtime:

| Where                                                          | What                                                                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Build → Banking** (second in the Build menu, after Agent)    | The bank's name, the agent's voice, the banking gateway's tools, and a button to test it                                               |
| **Tests → Try it → Banking** (beside Real agent and Simulated) | Talk to the banking assistant by **web chat or web voice**, with the caller's secure banking screen, scenarios and the trace beside it |
| **Tests → Try it → Real agent**                                | For a banking agent, the caller's banking screen beside a real (runtime) conversation, and the gateway's decisions in its trace        |

## 2. Architecture and data flow

```
Browser (studio)                         Studio dev/preview server (vite.config.js)          Banking gateway (Node)
────────────────                         ─────────────────────────────────────────          ─────────────────────
Build → Banking ── edits the draft ─────► /api  → Agent Builder API (draft, publish, deploy)
Tests → Banking:                                                                              services/banking-gateway
  conversation (rule-based assistant) ─► /gateway/dev/rehearsals, /v1/tools/* (test only) ─► orchestrator, state machine,
  secure banking screen ───────────────► /gateway/v1/channel/* (+ the call's room token) ──► secure capture, tools, audit
  trace ◄───────────────────────────────  /gateway/v1/rooms/{room}/timeline (SSE)        ◄── on its test bank systems (mock/)
Tests → Real agent:
  LiveKit conversation with the runtime ─ the runtime calls the gateway's tools (http connection banking_gateway)
  secure banking screen ───────────────► /gateway/v1/channel/* with the conversation's LiveKit join token
```

- The **gateway token** (`BANKING_GATEWAY_TOKEN`) is added by the studio's server, only to the routes the studio needs; the
  browser never holds it. Route rules: [`src/studio/banking/gatewayRoute.ts`](../src/studio/banking/gatewayRoute.ts).
- The **caller's screen** proves which call it belongs to with that call's LiveKit join token (real conversations) or the
  test session's channel token (Tests → Banking); the gateway verifies it.
- **Tests → Banking** has no runtime and no language model: a rule-based assistant
  ([`assistantModel.ts`](../src/studio/banking/assistantModel.ts)) chooses the next gateway tool from what the caller says and
  words its result. Every fact it states comes from a gateway tool result.

## 3. Navigation and configuration

- `src/studio/agent/pages.js`: `banking` is the second page of the Build group (after `agent`) and part of the Build stage;
  its address is `#/bots/{id}/banking`. Its menu entry, active state, status line (`buildSections.js` → `bankingPart`),
  colour (`look.js`), guided-view section (`GuidedBuild.jsx`) and search entry come from that one definition.
- `src/studio/agent/AgentLayout.jsx` draws the page (`BankingPage.tsx`) inside the usual page shell. The gateway tools card
  moved here from the Tools page, so it is in one place only.
- The Build status line says: not a banking agent yet (no gateway tools), still to choose the bank's name, or
  "{name} · N banking tools".

## 4. Banking name and Agent voice

**Banking name** ([`bankingProfile.ts`](../src/studio/banking/bankingProfile.ts), field on `BankingPage.tsx`)

- Kept in the agent's draft as the constant `constants.banking_name` (spaces collapsed, at most 60 characters; empty removes
  it). It is saved, versioned and published with the draft like every other setting, so it survives refreshes and sessions;
  the runtime can use it as `{{const.banking_name}}` in instructions or messages.
- Used wherever the bank is named: the assistant's greeting and goodbye, the Tests → Banking heading, the Build status line.
  When it is empty, the agent's persona name, else its name, is used.

**Agent voice**

- The Banking page shows the **same voice picker and setting as the Agent page** (`defaults.models.tts`: provider, model,
  voice id), so there is one voice, not a second configuration. Real conversations (the runtime) speak with exactly this
  voice.
- Tests → Banking speaks through the browser's own speech service, which cannot play provider voices. It uses the browser
  voice closest to the agent's voice: the same language (locale) and gender, else pitched towards it
  (`pickBrowserVoice` from `src/pages/browserVoice.js`, also used for voice previews). Verified: with Sarah (ElevenLabs,
  en-US, female) chosen, the greeting is spoken with an en-US voice.
- An agent that only types (no voice channel) needs no voice; the page says so and points to Channels.

## 5. Chat layout, scrolling and conversation lifecycle

**Causes found** (measured at 1366 × 768): the studio pins its top bar (56 px) and the agent header with the stage tabs
(108 px) at the top of the window. The banking console was a fixed 720 px tall, but only about 600 px are free under the pinned
bars, so its top or its message box was always hidden. Its side panel was a second scroll area of the same fixed height
with `overscroll-behavior: contain`, which stopped the wheel from reaching the page at the panel's ends, so the page felt
stuck. A segmented control's class (`.pvModes`, `order: 1` from the preview's stylesheet, loaded later) also pushed the
side panel's tabs to its bottom.

**Fixes** (`RehearsalConsole.tsx`, `useStickyTop.ts`, `ui.tsx`):

- `useStickyTop` measures the pinned bars (their CSS `top` plus height; updated on resize). The console is exactly the free
  height (`100dvh − bars − 24px`, at least 480 px on desktop), and a conversation starting scrolls it into view just under
  the bars (`scroll-margin-top`).
- Desktop: one grid row of that height (`minmax(0, 1fr)`); the transcript and the side panel each scroll inside it, and the
  message box stays in view. The side panel has no overscroll containment, so the wheel moves on to the page at its ends,
  and it can take keyboard focus to scroll with the keys. Narrow screens: one column; the conversation is the window's
  free height and the side panel follows in the page (no nested scrolling).
- Long words and numbers wrap inside a bubble (`overflow-wrap: anywhere`).
- The transcript follows the newest message only while the reader is at its end; someone reading further up stays where
  they are and gets a "New messages" button. What the caller sends always comes into view. Each bubble shows its time.

**Voice call** (`VoiceCall.tsx`, WhatsApp style): by voice the conversation is a call in the same panel, never an overlay.
A compact call header (the assistant's round avatar, the bank's name, what it is doing, the call time) sits above the
transcript, and the bottom bar holds the message box (or the secure field) and the call controls: Mute, End call, Switch
to chat; after the call, Call again. The state comes from real signals only (`callStateOf`): the microphone and speech
recognition (Connecting, Listening, Muted, error), speech synthesis (Speaking), the gateway tool running
(`activeTool` from `useBankingAssistant.ts`: "Checking your balance…") and an open sign-in step (Verification needed). The
avatar's ring follows the real microphone level while listening. Switching to chat and back keeps the same session and
conversation; End call ends the conversation, and Call again starts a new one (the gateway session that ended cannot be
resumed). The banking voice is the browser's speech service (`useBrowserVoice.ts`), not LiveKit.

**Conversation lifecycle** (`useBankingAssistant.ts`, `useRehearsalSession.ts`):

- **A choice is answered once.** Clicks on choices, accounts and currencies go through `fromScreen`, which refuses new
  work from the screen while earlier work is still running (a double click, or a second option before the first is
  answered). The reply's choices are then marked answered: the chosen one shows a tick, and the card closes.
- **The pending question is resolved by the answer** (`awaiting` state): the selection resumes the request that asked
  for it (for example the balance waiting for an account) and nothing else.
- **No stale replies.** A tool answer that arrives after the conversation ended or another started is dropped.
- **The method chosen in the chat is chosen on the banking screen too**, so the caller is not asked twice.
- **Ending is explicit.** A goodbye ("Thanks, goodbye" counts as goodbye), or the gateway handing the caller to a person
  (`next: transfer_now`: Service Manager transfer, lost card), ends the conversation after the last reply has been said; the
  console says why ("The caller said goodbye…", "…handed to a Service Manager…"). Completing a banking request (a balance,
  a confirmed stop-cheque) does not end the conversation; it returns to listening.
- Sign-in, PIN, OTP, confirmation, success, failure and cancellation states come from the gateway's own state and events
  (`useBankingChannel.ts`); the confirmation card shows _Completed_ only when the bank reported success, and a timeout as
  _Outcome unknown_.

## 6. Files

New (studio): `src/api/gateway.ts`, `src/api/gatewayTypes.ts`, and in `src/studio/banking/`:

| File                                                                                                                                                   | Role                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `BankingPage.tsx`                                                                                                                                      | Build → Banking: name, voice, gateway tools, Test Banking                                                                    |
| `bankingProfile.ts`                                                                                                                                    | the banking name in the draft, the name callers hear, the Build status line                                                  |
| `GatewayToolsCard.tsx`, `gatewayConfig.ts`                                                                                                             | add or refresh the gateway's generated tools, connection, events and `call_id` in the draft (idempotent; refuses on a clash) |
| `RehearsalConsole.tsx`                                                                                                                                 | Tests → Banking: conversation (chat / voice), side panel (Banking, Scenarios, Trace)                                         |
| `VoiceCall.tsx`                                                                                                                                        | the voice call: its state from real signals, the avatar, the call header and the call buttons                                |
| `useRehearsalSession.ts`                                                                                                                               | the Banking test session: gateway session, assistant, voice, scenario results, ending                                        |
| `useBankingAssistant.ts`, `assistantModel.ts`, `digits.ts`                                                                                             | the rule-based assistant                                                                                                     |
| `useBrowserVoice.ts`                                                                                                                                   | browser speech recognition and speech (with the agent's voice)                                                               |
| `useBankingChannel.ts`, `CallerPanel.tsx`, `SignIn.tsx`, `SecureKeypad.tsx`, `ProfilePanel.tsx`, `ConfirmationCard.tsx`, `Guidance.tsx`, `guidance.ts` | the caller's secure banking screen                                                                                           |
| `AccountOverview.tsx`, `ReplyCard.tsx`, `ScenarioPanel.tsx`, `scenarios.ts`, `RehearsalTools.tsx`                                                      | accounts, reply cards, the 12 scenarios and test logins, SMS codes, tool runner, host faults                                 |
| `gatewayRecords.ts`, `useGatewayRecords.ts`                                                                                                            | the gateway's timeline as trace records                                                                                      |
| `gatewayRoute.ts`                                                                                                                                      | which `/gateway` requests the studio's server forwards, with which credential                                                |
| `useStickyTop.ts`, `ui.tsx`, `format.ts`                                                                                                               | layout and small shared pieces                                                                                               |

Changed (studio): `vite.config.js` (`/gateway` proxy and guard), `src/studio/agent/{pages.js, buildSections.js, AgentLayout.jsx}`,
`src/studio/agent/workspace/{GuidedBuild.jsx, look.js}`, `src/studio/AgentWorkspace.jsx` (the Banking test session and its
profile), `src/studio/test/{TestTab.jsx, useLiveSession.js}`, `src/studio/trace/{records.js, useTrace.js}`, `src/ui/icons.js`,
`tailwind.config.js`, `eslint.config.js`, `package.json` (scripts only), `.env.example`, `README.md`.

New elsewhere: `services/banking-gateway/` (its own package), `docs/BANKING.md`, `docs/BANKING-AGENT-DESIGN.md`,
`e2e/banking.mjs`, `tests/banking-{gateway,profile,rehearsal,scenarios}.test.js`; updated tests:
`tests/{agentPages.component, buildSections, settingsSearch}.test.js` (the new Build page).

## 7. Integration details

- **Agent Builder API (`/api`)**: unchanged. The banking name, voice and gateway tools are fields of the draft, saved with
  the existing save; nothing else is stored.
- **Generated tools**: `GET /gateway/v1/agent-config` gives the tools (connection `banking_gateway`), the connection, the
  session start/end actions and `call_id`; `applyGatewayConfig` merges them, keeping everything the owner wrote.
- **Studio → gateway routes** (`gatewayRoute.ts`): runtime token on `GET /health`, `/v1/tools`, `/v1/agent-config`,
  `/v1/{rooms|sessions}/{id}/timeline`; channel routes `/v1/channel/*` carry the caller's token; with
  `BANKING_GATEWAY_REHEARSALS=on`, the test-environment routes `/dev/rehearsals…`, `/dev/test-logins` and tool calls for
  `rehearsal_…` call ids. Everything else is refused with 403 before forwarding.
- **Runtime → gateway**: the agent's tools call the gateway over the `banking_gateway` http connection at the address in
  the constant `banking_gateway_url` (entered on the Banking page; it must be reachable from the runtime).

## 8. Environment variables

Studio server (`.env.local`, never sent to the browser):

| Variable                     | Meaning                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `BANKING_GATEWAY_URL`        | where the gateway runs (e.g. `http://localhost:8790`); without it the banking parts say it is not set up |
| `BANKING_GATEWAY_TOKEN`      | the gateway's runtime token (its `GATEWAY_TOKEN`)                                                        |
| `BANKING_GATEWAY_REHEARSALS` | `on` enables Tests → Banking against the gateway's test environment                                      |

Gateway (test environment, `npm run gateway:mock`): `GATEWAY_TOKEN` (32+ characters; generated and printed if not set),
`PORT` (8790), `HOST`, `CHANNEL_ORIGINS` (the studio's address), `LIVEKIT_API_SECRET` (set it to the runtime's LiveKit secret
for real conversations; it turns the test-session routes off).

## 9. Installation

```bash
npm install                                   # the studio (no new root dependencies)
npm --prefix services/banking-gateway install # only to run the gateway's own tests and type check
```

Node 22.18+ (the gateway runs its TypeScript directly).

## 10. Starting the services

```bash
# 1. the gateway, in its test environment (prints its address, GATEWAY_TOKEN, and every SMS code)
GATEWAY_TOKEN=<32+ random characters> npm run gateway:mock

# 2. the studio, with .env.local containing:
#    BANKING_GATEWAY_URL=http://localhost:8790
#    BANKING_GATEWAY_TOKEN=<the same token>
#    BANKING_GATEWAY_REHEARSALS=on
npm run dev
```

PowerShell: `$env:GATEWAY_TOKEN='<token>'; npm run gateway:mock`.

## 11. Testing the workflow by hand

1. Open an agent → **Build → Banking** (second in the menu).
2. **Banking gateway**: enter the address the runtime uses → **Add banking tools**.
3. **Banking name**: e.g. "Acme Business Banking". **Agent voice**: pick a voice (agents that talk). **Save** (Ctrl+S);
   reload the page: both are still there.
4. **Test Banking** → Tests → Banking. Choose **Web chat** or **Web voice** (Chrome or Edge; allow the microphone) →
   **Start**. The greeting names the bank (and, by voice, is spoken with the agent's voice's language).
5. Ask "What's my balance?" → tap **Phone Code and PIN** (once; it shows a tick) → type `1234567` → the keypad opens in the
   Banking panel and the message box becomes a masked field → enter `135790` → choose **Current account ••••0101** → the
   balance card appears once.
6. Try others from **Scenarios → Test logins**: `500000000201` with NRIC `1234567` then the SMS code (Phone panel) for an
   OTP sign-in and "Stop cheque 100060" (confirm on the card); a wrong PIN three times locks sign-in; _Break the next host
   call_ for honest failures.
7. Say "Thanks, goodbye": the conversation ends and says why. **Trace** shows what the gateway did.

Automated: `npm run e2e:banking` (with both services running; 25 steps, on a 1366 × 768 window).

## 12. Security

- The gateway token never reaches the browser; the proxy forwards only the routes listed in §7 and refuses path tricks.
- PINs, NRIC digits and one-time passwords go only to the gateway's secure entry: the keypad (uncontrolled, masked
  input; its one-time token kept in a ref and dropped when used) or the masked secure field the message box becomes while a
  secret is asked. Spoken digits show as dots (they pass through the browser's speech service; _PIN and OTP entry → Keypad
  only_ turns typed and spoken entry off). The transcript records only that something was entered; Phone Codes and account
  numbers are masked; full account numbers show only on request, from the test environment, on this screen.
- Verification, entitlements, attempt limits and lockout, and confirmations are enforced by the gateway; the screens show
  its state. Nothing sensitive is kept in browser storage, logs or source code.
- The screens say **Test environment** whenever the gateway reports its simulated bank systems, so a test balance can never
  be taken for a real one.
- As with `/api`, the `/gateway` proxy is a development convenience; production needs real sign-in in front of the studio
  ([PRODUCTION.md](PRODUCTION.md)).

## 13. Verification (29 October 2026)

| Check                                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`, `npm run lint`                                                             | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm test`                                                                                      | all pass (3 skipped, as before)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run build`                                                                                 | builds (the existing chunk-size warning only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Gateway: `npm run gateway:test`, its type check                                                 | 100 / 100, clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run e2e:banking` (Chrome, 1366 × 768, test environment, e2e mock of the Agent Builder API) | all steps pass: Banking second in Build; name and voice saved and read back after a reload; Test Banking; greeting with the bank's name; console fits under the pinned bars and stays in view; two quick clicks answer a choice once; answered choice closed; method chosen on both screens; keypad and masked field; one balance per account choice; no PIN or Phone Code in the transcript; no demo wording; side panel scrolls then hands over to the page; trace; goodbye ends the conversation; voice greeting spoken in the voice's language; voice call header, transcript and controls stacked with nothing covering the transcript, a live status, Mute pressed and released, chat and back to voice keeping the conversation, End call leaving the conversation on screen with Call again; no console errors |

Not verified here: a real conversation with the Agent Builder runtime calling the gateway (needs a runtime that can
reach the gateway and the shared LiveKit secret), and real speech recognition of a person's voice (the test uses Chrome's
fake microphone).

## 14. Known limitations

- **The gateway has only its test environment.** `src/main.ts` refuses to start without production adapters; all host
  systems (accounts, cheques, OTP SMS, CRM) are simulated in `services/banking-gateway/mock/`. Its business rules from the
  2015 IVR deck are marked unapproved (the screens show "Rules not yet approved").
- **Tests → Banking is not the agent.** It is a rule-based assistant on the real gateway (no language model, no runtime),
  so it exercises the gateway, the secure screens and the flows, not the agent's instructions. Real-agent testing is
  Tests → Real agent.
- Browser voice is approximate (the browser's voices, matched by language and gender); speech recognition needs Chrome or
  Edge and sends audio to the browser's speech service.
- The assistant understands English banking phrasings only.

## 15. Connecting a real bank and going to production

1. **Gateway adapters** for the bank's systems behind the ports in `services/banking-gateway/src/ports/ports.ts` (core
   banking / AS400, CRM / Siebel, the OTP SMS service, the content service), wired in `src/main.ts`; the mock adapters
   stay for tests.
2. **Approved policy**: limits, charges and cut-offs in `src/domain/policy.ts` signed off by the business owner.
3. **Secrets**: `GATEWAY_TOKEN` and `LIVEKIT_API_SECRET` from a secrets manager; the runtime's `BANKING_GATEWAY_TOKEN`
   secret for the `banking_gateway` connection.
4. **Network**: the gateway reachable from the agent runtime at the `banking_gateway_url` address over TLS;
   `CHANNEL_ORIGINS` set to the production channel's origins.
5. **Studio**: a production proxy in front of the studio with real sign-in, forwarding `/gateway` with the same rules as
   `gatewayRoute.ts`, and **without** `BANKING_GATEWAY_REHEARSALS` (the test-session routes exist only on the test gateway).
6. **Durable stores**: the session store and audit log moved from memory to shared, persistent storage (several gateway
   instances; see BANKING-AGENT-DESIGN.md §2.5 and §6.7).
7. **End-to-end tests with the runtime**: a deployed agent calling the gateway, the caller's screen on the real channel,
   and the confirmation and transfer paths.
