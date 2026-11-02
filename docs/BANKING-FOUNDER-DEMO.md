# Banking agent: founder demo guide

| | |
|---|---|
| Document | WS-BANK-003, updated 2 November 2026 |
| Companion to | [BANKING-AGENT-DESIGN.md](BANKING-AGENT-DESIGN.md) (WS-BANK-001), [BANKING-REQUIREMENTS-TRACE.md](BANKING-REQUIREMENTS-TRACE.md) (WS-BANK-002) |
| Where | Weave Studio, top bar set to **Sandbox** → **Agents** → **Weave Bank assistant** (or any agent made a banking agent) → **Test**. In **Live**, any banking agent → **Test** → Played by **Banking rehearsal (mock bank)** runs the same demo on test data |
| What runs | The real banking gateway (state machine, secure capture, entitlements, two-phase confirmations, audit) on its **mock bank systems** — the gateway server when one is running, otherwise the same gateway code inside the browser — driven by the agent's test conversation, with the browser's own speech for voice |
| What does not run | The Agent Builder voice runtime (LiveKit), a language model, any real bank system or real customer data |

---

## 1. Banking lives inside the agents

There is no separate Banking page. A banking agent is an ordinary agent whose draft holds the gateway's tools:

- **Any agent:** Build › Tools › **Banking** → **Make this a banking agent** adds the gateway's generated tools, the six
  specialist roles (greeter, sign-in, accounts, cheques, information, appointments) with their instructions and
  hand-offs, and the call events. **Remove banking** puts the draft back as it was.
- **A new agent:** Create agent → **Banking assistant**.
- **Sandbox** starts with a sample, **Weave Bank assistant**.

In **Live**, banking agents have the same features and workflows as in Sandbox. With a gateway on the bank's real
systems connected, banking answers come from it. None exists yet (the gateway's real host adapters need the bank's
system contracts), so Live uses the **mock bank** — the same gateway on its test data — and every screen says so
("Mock bank · test data": Build › Tools, Settings, the Create dialog, the device, each answer, the trace, the release
checks). On a banking agent's **Test**, **Played by** chooses:

- **Banking rehearsal (mock bank)** — chosen by you (the real agent is always the default): the same rehearsal as Sandbox, greeting as the agent being tested (rule-based
  turns, secure keypad, accounts, confirmations, SMS, voice through the browser's speech), on test data. It is not
  added to Calls, which in Live lists real calls only.
- **The real agent** — the agent on the Agent Builder runtime. Its banking tools answer only from the gateway at its
  `banking_gateway_url`, which the runtime must reach (see §5); the panel beside it says when that cannot be the case.

Studio's own test sessions (rehearsals, Try a banking tool, the test logins) always run on the mock bank, even when a
gateway on real systems is connected. Deploying a banking agent from Live while on the mock bank shows a warning in the
release checks (it does not block), naming the address a deployed agent will reach.

---

## 2. Start it (Windows PowerShell)

From the repository root:

```powershell
npm run dev
```

Open **http://localhost:5173** in **Chrome or Edge** (voice needs browser speech recognition), switch the top bar to
**Sandbox**, then open **Agents → Weave Bank assistant → Test**.

`npm run dev` also starts the gateway on its mock bank systems; Sandbox uses it, and if it is not running Sandbox uses
the same gateway built into the page (`npm run sandbox:gateway` rebuilds that copy from `services/banking-gateway`).
Every banking answer says which one answered. The gateway token stays in the Studio server process; the browser never
receives it.

---

## 3. Test logins (mock only)

Also shown beside the test conversation in Sandbox (served by the gateway itself).

| Who | Identify with | Then key in | Shows |
|---|---|---|---|
| Phone Code user, 3 accounts | Phone Code `1234567` | PIN `135790` | SGD account with hold and pending cheques; overdrawn SGD omnibus account; USD/EUR account |
| Authorised Signatory | Account `500000000201` | NRIC digits `1234567`, then the OTP | OTP route, stop cheque, statements, cheque books |
| Authorised Contact | Account `500000000301` | NRIC digits `7654321`, then the OTP | Entitlement refusal (no balance) |
| Personal-banking customer | Phone Code `7777777` | PIN `111111` | Redirected to the personal line |
| Dormant account | Account `500000000501` | NRIC digits `9999999` | "Visit your nearest branch" |
| Host-locked Phone Code | Phone Code `6666666` | PIN `222222` | Bank system lock (host code 62) |

**One-time passwords:** the **phone** beside the test conversation shows the SMS for the current session.

Cheques for error paths: `100005` (already cleared: cannot be stopped), `100007` (already stopped). `100060` stops successfully.

---

## 4. Demo script (about 8 minutes)

1. **Open** Weave Bank assistant → **Test** in Sandbox. Point out the labels: replies are marked as the Sandbox agent,
   and every banking answer says where it came from (*mock bank systems*).
2. **Start** a web voice conversation (allow the microphone), or web chat. The agent greets first.
3. Ask **"What's my balance?"** The agent asks how to sign in. Say **"Phone Code"**, then the seven digits.
4. The secure keypad opens on the customer's device beside the conversation. Key the PIN there. PINs, NRICs and
   one-time passwords are never typed or spoken into the conversation: if they are, they are refused and shown hidden.
5. After the gateway accepts it, choose an account on the device: the balance is read in the bank's wording.
6. Ask for **incoming funds** and **recent transactions**.
7. Sign out, then sign in as the **Authorised Signatory** (account `500000000201`, NRIC `1234567`, OTP from the phone).
   Ask to **stop cheque 100060** → a summary and charge on a confirmation card → confirm → *completed* with a reference.
   Ask for **a statement for last month** → cancel → nothing is sent.
8. Ask for **rates**, **branches**, and **book an appointment** (book, list, cancel with a confirmation).
9. Ask for **a call back**, **a person**, or report **a lost card**.
10. Show failure honesty: three wrong PINs → *Sign-in is locked* in the gateway's wording. In Build › Tools › Banking ›
    **Try a banking tool**, *Break the next host call* makes the next answer fail the way a bank system would.
11. End the conversation: it is kept as a call, and its trace holds the gateway's timeline and every tool call.

---

## 5. What is real and what is not

| Real | Not real / not verified |
|---|---|
| Gateway state machine, attempts and lockout, entitlements, two-phase confirmations, host-error matrix, audit and timeline | Bank systems: mock hosts and test data |
| Every balance, list, summary, charge and refusal comes from a gateway tool result | In a rehearsal (Sandbox, or Live's "Banking rehearsal") the agent's turns come from a rule-based banking engine (`src/sandbox/banking/`), not a language model |
| Secure entry: PIN/NRIC/OTP sent once to the gateway's single-use capture; never in the transcript, storage or trace | Voice uses the browser's speech service. Not the Agent Builder LiveKit runtime |

### Remaining blockers for banking on the bank's real systems

Banking works in Live today on the mock bank. For a real agent on real bank systems:

- A gateway on the bank's real systems (`services/banking-gateway/src/main.ts` exits until the host adapters exist).
- The Agent Builder runtime must reach the deployed gateway with `BANKING_GATEWAY_TOKEN` as a runtime secret, and
  fill `{{call.room}}` so the caller's device binds to the call.
- The gateway must verify real LiveKit tokens (LiveKit API secret, O4) for the Test console's keypad and confirmation card.
- DTMF or masked capture on SIP calls (O2); spoken PINs on a real phone line are not allowed by the policy.

---

## 6. Checks

```powershell
npm run check          # lint, typecheck, app tests, build, no-fake scan, gateway typecheck and tests
node e2e/banking-agent.mjs; node e2e/banking-build.mjs   # the banking agent and its Build, in Live and Sandbox
```
