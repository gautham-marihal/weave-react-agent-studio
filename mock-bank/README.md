# Mock bank API and the business-banking agents

A made-up bank for the six OCBC business-banking phone agents in the design document "Business Banking Phone Agents: Weave Design". The agents'
tools call these mock systems, so you can talk to the agents and see them check balances, stop cheques, book appointments and hand callers over,
with nothing real behind them. Every customer, account and number here is invented.

## Run the mock API

```bash
npm run mock:bank          # http://localhost:4300 (PORT to change it)
```

- `GET /` lists the systems and the test customers below.
- `GET /activity` lists what the agents changed: service requests, bookings, call-backs, surveys, hand-overs, payments, faxes.
- Data is kept in memory; restarting starts again from the same data (`data.mjs`).

The agents run on the Agent Builder server, which must be able to reach this API. When that server is on another machine, give the API a public
address (for example a tunnel to port 4300) and build the agents with that address.

To keep a public address private, start the API with a secret key: `MOCK_BANK_KEY=<random text> npm run mock:bank`. It then answers only
under `/<key>` (`https://your-public-address/<key>/`, `…/<key>/activity`), and everything else, `/` included, is a 404. Build the agents with
the key in the address (`MOCK_BANK_URL=https://your-public-address/<key>`), and keep the same key when you restart the API. A random key:
`node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`.

## Build the agents

```bash
MOCK_BANK_URL=https://your-public-address npm run mock:bank:agents
```

This writes the six configurations to `agents/out/<id>.json` and checks each with the server's `POST /validate` (through the studio's dev server,
`API_BASE`, default `http://localhost:5191/api`). Then put them on the server:

```bash
npm run mock:bank:deploy   # creates each agent the first time, saves the draft, publishes and deploys it to Development
```

This writes to the Agent Builder server. When the mock API's public address changes (a new tunnel), build again with the new address and
deploy again: each agent gets the next patch version.

| Agent                 | Line                                     | What it does                                                                                                                           |
| --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `sg-business-banking` | 6538 1111                                | Front desk and 8 specialists: Accounts, Cheques, Business Internet Banking, New Business, Info Desk, Card Loss, Appointments, Feedback |
| `sg-vip-desk`         | 6538 2222                                | VIPs greeted by name, checked by their VIP type, put through to their own service manager                                              |
| `sg-investigations`   | 6586 5292                                | Finds the case by account number and puts the caller through to the service manager handling it                                        |
| `sg-sm-survey`        | internal                                 | Three ratings about the service manager (BI and BC profiles)                                                                           |
| `my-business-banking` | 1300-88-7000, 1300 88 0255, 1300-88-7200 | Front desk and Accounts, Payments, Cheques, Info Desk; Premier desk                                                                    |
| `my-consumer-banking` | 1300 88 5000, 1300 88 0310               | Front desk (with the iQ path) and Cards, Banking, Payments                                                                             |

Each agent has a phone channel (keypad on) and, for trying it from the studio's Test page, a voice and a chat channel in the browser, where codes
are said or typed instead of keyed.

## Try them with these customers

| Who                               | How to log in                                                                 | Try                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Acme Trading (SG)                 | phone code `1234567`, PIN `246810`                                            | balance, recent activity, stop cheque `000232`, cheque book, PIN change |
| Lim & Co Logistics (SG)           | account `502468013579`, NRIC ending `321B`, one-time password `123456`        | statement, deposited cheques                                            |
| Personal customer (SG)            | phone code `1111111`, PIN `111111`                                            | told the personal banking number                                        |
| Dormant account (SG)              | account `503000111222`                                                        | told to visit a branch                                                  |
| VIP (SG, VIP line)                | caller ID `+65 9876 5432`, account `509876543210`                             | put through to Rachel Ng                                                |
| Investigations (SG)               | account `509876543210` (Rachel Ng, free) or `501234567001` (Daniel Lee, busy) | hand-over or call-back                                                  |
| Syarikat Maju Jaya (MY business)  | key code `12345678`, TPIN `123456`                                            | own-account transfer between `3344` and `3355`, loan payment            |
| Aisyah binti Rahman (MY consumer) | phone code `87654321` (or IC `880101145678`), TPIN `654321`                   | activate card `4321`, iQ executive                                      |

No-login questions: rates, promotions, forms by fax, branches, GIRO and SWIFT codes.

## Files

- `server.mjs` the API (plain Node, no packages): one path prefix per bank system (`/sg/as400`, `/sg/soa`, `/sg/siebel`, `/sg/cmm`, `/sg/aacc`,
  `/sg/fax`, `/my/core`, `/my/contact`)
- `data.mjs` the made-up customers, accounts, cheques, cards, rates, branches and contact-centre tables
- `agents/` one file per agent, `common.mjs` and `myShared.mjs` for what they share, `build.mjs` to build and validate them
- `tests/mockBank.test.js` checks the API's answers, and that every request an agent can make reaches a route here
