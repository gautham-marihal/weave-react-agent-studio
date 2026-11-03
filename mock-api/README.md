# Mock bank services

What the bank database (Ashwin's `TetherfiDbRestApi`) doesn't have yet, as a small JSON API the agents can call. It
covers what the bank's IVR call flows ask for (the SG BBCSC pack and the MY hotlines pack, as mapped in "Business
Banking Phone Agents: Weave Design"): logins besides phone code + TPIN, PIN changes, balance details, incoming funds,
cheques, cheque books and deposits, statements, cards, payees and payments, FPX direct debits, appointments, the VIP
and investigations lines, service codes, the service centre's hours, call-backs, rates, forms, branches, promotions,
caller preferences and surveys. Each rule in `src/app.mjs` names the call-flow page it comes from. **Test data only.**

- Its records belong to the **same test customers and account numbers** as the bank database (`data/customers.json`,
  read from it), so an agent never contradicts itself. No TPIN is kept.
- **Actions answer like a bank would** (a reference, a fee, a date) **but change no balance anywhere**. What an action
  changes (a stopped cheque, a booked slot) is remembered only while the server runs.
- The bank database stays the one source for customers, balances and transactions. The mock never touches it.

## Run it on your machine

You need Node.js 20 or newer. From the project folder:

```
npm run mock
```

It answers on `http://localhost:4400` (set `PORT` to change it). `GET /routes` lists every route; `GET /health` says
it is up. From inside `mock-api/`, `npm start` does the same.

To refresh the test customers from the bank database and rebuild the records: `npm run mock:sync`.

## Publish it (Vercel), so the agents can reach it

The agents run on the Agent Builder server, not on your computer, so they need the mock at a public address. It is
published at **https://weave-mock-api.vercel.app** (Vercel team `weave23`, project `weave-mock-api`). Vercel runs
`server.mjs` as it is: nothing else is needed.

To publish a change, from `mock-api/`:

1. Once per machine: `npx vercel login` (approve in the browser), then `npx vercel link --project weave-mock-api --scope weave23`.
2. `npx vercel deploy --prod --scope weave23`
3. Check it: open `https://weave-mock-api.vercel.app/health`.

**The key (optional).** With `MOCK_API_KEY` set in the Vercel project's environment variables (then deploy again),
every route but `/health` needs the header `x-api-key`. Agents can send it as a plain request header today. Sending it
as a _Secret_ header needs a secret of that name on the Agent Builder server, which only its admin can add.

## Connect it to the agents

In Weave Studio: **Integrations → REST API**, or any integration card, with:

- **Base URL**: the Vercel address (or `http://localhost:4400` for trying the tools locally)
- **Request headers**: `x-api-key`, marked **Secret**, with the name of the secret holding the key on the Agent Builder
  server (the key itself goes there, not in the agents)

Then give the specialists their tools on each agent's Build › Tools page.

## Routes

All bodies are JSON. Dates are `YYYY-MM-DD`. A refusal answers `{ "ok": false, "reason": "…" }` in plain words. With the request header `x-refusals: in-body` (the agents send it, because their tools can't read an error's body) a refusal comes back with status 200, `"refused": true` and the status it would have had.

| Area                      | Route                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer                  | `GET /customers/{customerId}`                                                                                                                                                                                                                                                                                          |
| Logins                    | `POST /login/account` `{accountId, nricLast4}` (SG, then a one-time password) · `POST /login/key-code` `{keyCode}` (MY business) · `POST /login/ic` `{ic}` (MY consumer, iQ)                                                                                                                                           |
| One-time passwords        | `POST /otp/send` `{customerId}` · `POST /otp/verify` `{customerId, otp}` (the test password is always `123456`; 3 tries)                                                                                                                                                                                               |
| Phone PIN                 | `POST /customers/{customerId}/phone-pin` `{newPin, confirmPin}` (6 digits; nothing is kept)                                                                                                                                                                                                                            |
| Balances                  | `GET /accounts/{accountId}/balance` (available balance, hold, cheques pending clearance, overdraft limit) · `GET /accounts/{accountId}/incoming-funds` (last 7 days)                                                                                                                                                   |
| Cheques                   | `GET /accounts/{accountId}/cheques` · `GET /accounts/{accountId}/cheques/{chequeNo}` · `POST /accounts/{accountId}/cheques/{chequeNo}/stop` `{reason, lastChequeNo?}`                                                                                                                                                  |
| Cheque books              | `GET /accounts/{accountId}/cheque-books/last` · `GET /accounts/{accountId}/cheque-books/options` · `POST /accounts/{accountId}/cheque-books` `{delivery: same_day\|express\|normal}`                                                                                                                                   |
| Cheque deposits           | `GET /accounts/{accountId}/cheque-deposits?kind=deposited\|returned`                                                                                                                                                                                                                                                   |
| Statements                | `POST /accounts/{accountId}/statements` `{month: "2026-10"}`                                                                                                                                                                                                                                                           |
| Cards                     | `GET /customers/{customerId}/cards` · `GET /cards/{cardId}/transactions` · `POST /cards/{cardId}/statements` `{month}` · `POST /cards/{cardId}/block` `{reason}` · `/activate` · `/fee-waiver` · `/credit-limit` `{newLimit}` · `/balance-transfer` `{fromBank, amount}`                                               |
| Card applications         | `GET /card-applications/{applicantId}`                                                                                                                                                                                                                                                                                 |
| Payees and payments       | `GET /customers/{customerId}/payees` · `POST /payments` `{fromAccount, payeeId, amount}` · `POST /transfers` `{fromAccount, toAccount, amount}`                                                                                                                                                                        |
| FPX direct debits         | `GET /accounts/{accountId}/fpx-direct-debits` · `POST /fpx-direct-debits/{id}/terminate`                                                                                                                                                                                                                               |
| Appointments              | `GET /appointments/slots?type=account_opening\|velocity_training\|trade_training&place=…&region=…&from=…` · `POST /appointments` `{customerId, slotId, count}` · `GET /customers/{customerId}/appointments` · `POST /appointments/{bookingId}/cancel`                                                                  |
| Service managers          | `GET /service-centre?country=SG` · `GET /accounts/{accountId}/service-manager` · `GET /vip/{mobile}` · `POST /vip/{mobile}/check-account` `{accountId}` · `GET /service-codes/{code}`                                                                                                                                  |
| Call-backs                | `GET /customers/{customerId}/callbacks/open` · `GET /callbacks/open?phone=…` · `POST /callbacks` `{customerId or phone, reason}`                                                                                                                                                                                       |
| Caller preferences        | `GET /callers/{phone}` · `POST /callers/{phone}/choices` `{language?, transaction?}` · `POST /callers/{phone}/reset`                                                                                                                                                                                                   |
| Investigation cases       | `GET /accounts/{accountId}/cases` · `POST /cases` `{accountId, summary, transaction?}`                                                                                                                                                                                                                                 |
| Information (no customer) | `GET /info/rates?country=MY\|SG` · `GET /info/branches?country=…&area=…&region=…` · `GET /info/forms?country=…` · `POST /info/forms/fax` `{formId, faxNumber}` · `GET /info/promotions?country=…` · `POST /info/promotions/{id}/fax` `{faxNumber}` · `GET /info/bank-codes?country=…` · `GET /info/contacts?country=…` |
| Surveys                   | `GET /surveys/questions?survey=ivr\|service_manager` · `POST /surveys` `{survey, profile?, ratings: [1–3, 1–3, 1–3]}` (1 Excellent, 2 Satisfactory, 3 Poor)                                                                                                                                                            |

`/v1/…` works too (the same routes with a version in front).

## Files

| File                  | What it is                                                                         |
| --------------------- | ---------------------------------------------------------------------------------- |
| `src/app.mjs`         | every route, one handler (used by both servers)                                    |
| `server.mjs`          | the server, here and on Vercel                                                     |
| `data/customers.json` | the test customers and accounts, from the bank database (`npm run mock:sync`)      |
| `data/services.json`  | their cheques, cards, payees… (`scripts/build-seed.mjs`; edit by hand if you like) |
