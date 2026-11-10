# OCBC journey: from onboarding to everyday banking

One OCBC agent takes a person from "I'd like to open an account" to "what's my balance?" on the same call, handing them
between six agents. Design doc: https://claude.ai/artifact/XnBHPMSAW3EgUip2qQ3P96

| Agent (in `ocbc-personal-banking`) | From             | Does                                                                                       |
| ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| Front desk (entry)                 | new              | Asks what the caller needs: new customers to the Advisor, existing ones to the specialists |
| Advisor                            | use case 1       | The offers this deposit qualifies for (offers API)                                         |
| Onboarding                         | use case 1       | Form, ID photo, video check, signing; a human video banker when a check fails              |
| Banking                            | MY consumer team | Phone banking number + TPIN once, balances, transactions, statements, TPIN change          |
| Cards                              | MY consumer team | Card list, block, activate, fee waiver, limit                                              |
| Payments                           | MY consumer team | Own-account transfers, payments to registered payees                                       |

`ocbc-case-desk` is use case 1's case desk for OCBC: after a human video banker opens the account, MX hands the customer
to it; it logs the case in TQD, which e-mails the customer.

## Nothing is typed in twice

`scripts/build-configs.mjs` makes both configs from their sources, so a fix in either source carries over:

- `../unbound/use-case-1/onboarding.config.json` and `case-desk.config.json`: use case 1, word for word;
- `source/my-consumer-banking.config.json`: the MY consumer team's draft as read from the server (2026-11-07).

What changes in the copies, and only there:

- **The bank:** `constants.bank_name` is `OCBC`, plus the persona, meta and widget ids. The calls that open the account,
  hand over to a human and log the case send `bank`, so the mock makes the new account a bank customer.
- **Hand-overs:** a new Front desk (entry); Onboarding → Banking once the account is open; Banking → Cards / Payments.
- **No gaps between the agents:**
  - **A deposit for an unnamed account** ("I want to deposit 1 million dollars") gets one question first: an
    account they already have (Banking, which says how to pay in) or a new one (the Advisor)?
  - **"Dollars"** means SGD.
  - **An amount below every account** gets a plain answer and a call-back, not a form.
  - **An existing customer** can open a new account the same way.
  - **A new fixed deposit** goes to the Advisor, not to a call-back.
  - **Every agent** knows the full list of what the team helps with.
  - **The case desk** says how to sign in later.
- **One line after the account opens:** where the phone banking number (the e-mail) and the temporary PIN (an SMS)
  come from.
- **The specialists, for Singapore:** the Malaysian parts are left out (IC login, iQ, Velocity, MYR fees, the 8 pm
  cut-off, Malay and Mandarin). Their bank tools read the mock's DB2 stand-in and `/ocbc` routes, with the same
  request and the same answer shape, so their rules are unchanged.
- **Verified once per call:** a `caller_verified` marker, called once the TPIN matches, keeps the caller verified
  across hand-overs (the MY team pointed at a `verify_phone_code` tool that doesn't exist).
- **Models:** the specialists run on gpt-4.1 at temperature 0. The Front desk, Advisor and Onboarding keep use case 1's
  model, so its flow behaves as tested.

```
node demos/ocbc-journey/scripts/build-configs.mjs           # write both configs
node demos/ocbc-journey/scripts/build-configs.mjs --check   # are they up to date? (the unit tests run it)
```

## The bank's systems (mock API)

`mock-api/src/ocbc.mjs` serves the copied specialists. It keeps what changes (a blocked card stays blocked, a transfer
moves both balances and shows in the history, a new TPIN is the TPIN) in the same Blob store as the Unbound routes:

| Route                                                                           | For                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /ocbc/dboperations`                                                       | DB2 stand-in: `getCustomerDetails`, `getCustomerAccounts`, `getAccountDetails`, `getTransactionHistory` |
| `GET /ocbc/accounts/:id/balance`, `POST …/statements`                           | balance details; statements (none from before the account opened)                                       |
| `GET /ocbc/customers/:id/cards`, `POST /ocbc/cards/:id/block`, `…/activate`     | cards                                                                                                   |
| `GET /ocbc/customers/:id/payees`, `POST /ocbc/payments`, `POST /ocbc/transfers` | moving money                                                                                            |
| `POST /ocbc/customers/:id/phone-pin`, `POST /ocbc/callbacks`                    | TPIN change, call-back                                                                                  |
| `POST /ocbc/demo/reset`                                                         | a customer back as they were, before a demo                                                             |

- **Existing customers:** the 15 test customers (`data/customers.json`), with TPINs, balances and recent transactions in
  `data/bank.json` (`npm run bank` in `mock-api/` rewrites it). Tan Wei Ming: phone banking number **5409881**, TPIN
  **1234**.
- **A new customer:** when onboarding opens an account with `bank`, the mock adds a phone banking number, a temporary
  6-digit TPIN, the account with SGD 0.00 awaiting its first deposit (the relationship manager arranges it, as Aria
  says), and a debit card on its way. The welcome e-mail in `/tqd/outbox` gives the phone banking number; the TPIN goes
  only by SMS (the outbox entry with `channel: "sms"`).
- **Use case 1** sends no `bank`, so it behaves exactly as before.
- **Account endings:** transfers, payments and statements take an account's full number, or its last four digits with
  `customerId`. A hand-over carries the conversation but not the last specialist's tool results, so an agent just handed
  the caller knows the endings it heard and the phone banking number, not the full numbers.

## On the server

Drafts only: `ocbc-personal-banking` and `ocbc-case-desk`. Nothing is published without the user's word "publish".
After changing a source, rebuild, check with `POST /validate`, then save the drafts.

## Test

```
npm test                                                     # tests/ocbcJourney.test.js, tests/mockOcbc.test.js
# real agent, through the studio on 5181 (CREDENTIALS_FILE=e2e/credentials.txt npx vite --port 5181 --strictPort):
UB_JOURNEY=ocbc UB_FIRST_NAME="Wei Ming" UB_LAST_NAME="Tan" node demos/unbound/use-case-1/scripts/run-e2e.mjs chat
node demos/ocbc-journey/scripts/run-banking-e2e.mjs main chat   # also: wrong-pin, unknown, cancel, new, no-pin,
                                                                 # deposit-new, deposit-existing, small; voice
```

## Demo script

1. **A new customer (chat with the camera):**
   - "I'd like to open an account for an inheritance of SGD 300,000." The Front desk hands over to the Advisor, who
     gives the offers.
   - "Let's open it now." Onboarding runs the form, ID photo and video check, then "Everything matches".
   - The customer names an account and signs. Aria gives the account ending, the TQD reference and the next steps, and
     says where the phone banking details come from.
   - "Can I check my new account?" Hand-over to Banking. Sign in with the number from the e-mail and the PIN from the
     SMS (open `/tqd/outbox`). Banking says: SGD 0.00, with the deposit arranged by the relationship manager.
   - "I'd like to change my temporary PIN." Banking reads it back, then changes it.
   - "When will my debit card arrive?" Hand-over to Cards, with the date and no second sign-in.
2. **An existing customer (voice):**
   - Tan Wei Ming, 5409881 and 1234. Banking gives both balances.
   - "Move SGD 500 to my savings." Payments reads it back; after "yes", the transfer gets a TRF reference.
   - "I lost my debit card." Cards reads it back; after "yes", the card is blocked with a BLK reference.
3. **A failed check (optional):** the video and the photo both fail, so the customer goes to the human video banker. The
   colleague completes the case, and `ocbc-case-desk` logs it.

Before a demo: `POST /ocbc/demo/reset {"customerId":"5409881"}` on the mock.
