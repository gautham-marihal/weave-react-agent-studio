# Weave Studio

<p align="center">
  <img src="public/icon.png" alt="Weave Studio" width="64" height="64" />
</p>

Weave Studio is the web studio for building, testing, releasing and monitoring voice and chat AI agents that run on the
**Agent Builder** server. An agent is one JSON configuration; the studio edits it with plain-language forms (and a JSON
editor), tests it, publishes versions, deploys them to environments and shows how it does on real calls. Banking agents
get a full banking workflow through the bundled **banking gateway**.

## What it does

- **Build** — every part of an agent: what it says and how it sounds, channels, tools, knowledge, guardrails, after-call
  work, a workflow canvas, all settings from the server's schema, a JSON editor, and "Describe it" (an AI model proposes
  changes; you apply them).
- **Test** — talk to the draft by voice or chat, scenarios with checks and mocks, scripted callers, readiness checks.
- **Release** — publish numbered versions, deploy to Development / Staging / Production, roll back, release checks.
- **Monitor** — calls with transcripts and traces, the live board, analytics, speed, alerts, replay a call, fix a call.
- **Workspace** — agents list, library (voices, providers, integrations, phone numbers), knowledge, telephony, team,
  settings, search (Ctrl/⌘ K).
- **Banking** — any agent can be made a banking agent (Build › Tools › Banking); testing it runs sign-in on the secure
  keypad, accounts, balances, transactions, cheques, rates, appointments, confirmations and hand-off.
  See [docs/BANKING-FOUNDER-DEMO.md](docs/BANKING-FOUNDER-DEMO.md).

### Live and Sandbox

The switch at the start of the top bar chooses where the data comes from:

- **Live** (default) — real agents on the Agent Builder API; nothing about agents or calls is made up. Banking agents
  work end to end here too: on the bank's real systems when a gateway on them is connected, otherwise on the **mock
  bank** (the bundled gateway's test data), labelled "Mock bank · test data" on every screen. A banking agent's Test
  opens on the real agent (its own greeting and voice) and offers a banking rehearsal on the mock bank ("Played by"); Studio's own test sessions (rehearsals,
  Try a banking tool, test logins) always use the mock bank. Rehearsals are not added to Calls, which lists real calls.
- **Sandbox** — sample agents, calls and banking data kept in the browser, with no server needed. Every made-up thing is
  labelled. Sample data and simulations live in `src/sandbox/` and are loaded with `import()` (the mock bank also by
  Live's banking, as above); `npm run check:no-fake` enforces that for the rest of the code.

## Getting started

Requirements: **Node.js 22.18 or later** (the banking gateway runs its TypeScript directly) and npm. The browser tests
also need Google Chrome.

```bash
cp .env.example .env      # then fill in AGENT_BUILDER_URL and, if needed, AGENT_BUILDER_API_KEY
npm install
npm run dev               # Studio on http://localhost:5173, plus the banking gateway on its mock bank (port 8790)
```

`.env` needs only `AGENT_BUILDER_URL` (and `AGENT_BUILDER_API_KEY` if the server wants one). `npm run dev` hands the
local gateway's address and token to Studio directly and never writes them into `.env`; the token is kept in
`node_modules/.cache/weave-dev/`. `npm run dev:vite` starts Studio alone: banking still works, on the mock bank in the
browser. The `BANKING_GATEWAY_*` settings below are only for a gateway you run yourself.

### Configuration (`.env`)

| Variable | What it is |
|---|---|
| `AGENT_BUILDER_URL` | The Agent Builder API. The dev server proxies `/api` to it. |
| `AGENT_BUILDER_API_KEY` | Bearer key for that API; added by the dev server, never sent to the browser. |
| `AGENT_BUILDER_USER` | Optional name recorded as who saved, published or deployed. |
| `BANKING_GATEWAY_URL`, `BANKING_GATEWAY_TOKEN` | The banking gateway and its runtime token (proxied at `/gateway`). |
| `BANKING_GATEWAY_RUNTIME_URL` | Optional: the gateway address the agent runtime uses, when not the one above. Studio fills it (or `BANKING_GATEWAY_URL`) into banking agents itself. |
| `BANKING_GATEWAY_REHEARSALS` | `on` lets Studio start test sessions on a mock gateway server (rehearsals, Try a banking tool); without it they run on the gateway in the browser. |
| `ANTHROPIC_API_KEY`, `LLM_MODELS`, `LLM_MODEL` | Optional: the AI model behind "Describe it", called from the dev server. |
| `VITE_SANDBOX` | `true` builds a studio that runs on sample data only. |

Secrets stay on the server side: agent configurations refer to secrets by name (`{"secret": "NAME"}`), and `.env` is
never committed.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Studio and the mock banking gateway together |
| `npm run dev:vite` | Studio's dev server only |
| `npm run build` / `npm run preview` | Production build / serve it locally |
| `npm run typecheck` | TypeScript, app and config |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run check:no-fake` | No sample or simulated code outside `src/sandbox/` |
| `npm run check:gateway` | The banking gateway's typecheck and tests |
| `npm run check` | Lint, typecheck, unit tests, build, no-fake and the gateway checks, in one go |
| `npm run e2e` | Every browser test (`e2e/`); each suite starts its own stand-in API and dev server |
| `npm run sandbox:gateway` | Rebuilds Sandbox's in-browser copy of the banking gateway from `services/banking-gateway` |
| `npm run schema:snapshot` | Refreshes the agent configuration schema snapshot from the server |

## Project layout

```text
src/
  api/          typed clients: Agent Builder API (client.ts, with response checks in schemas.ts), banking gateway (gateway.ts)
  pages/        one file per route
  components/   UI by area (agent/, banking/, calls/, layout/, ui/ …); ui/ is the shared kit
  hooks/        data and behaviour hooks
  models/       pure logic, each with a *.test.ts beside it
  contexts/     auth, studio data, theme
  sandbox/      sample API, simulations and the mock bank (in-browser banking gateway, banking rehearsal), loaded on use
  data/ types/ utils/ styles/
services/banking-gateway/   the banking gateway service (state machine, tools, mock bank); see its README
e2e/            browser tests (Playwright) and their stand-in API
scripts/        dev orchestration, checks, the Sandbox gateway build
docs/           design notes and guides (start with docs/PORT.md)
```

## Documentation

- [docs/PORT.md](docs/PORT.md) — what the studio contains and how it was put together
- [docs/BANKING-AGENT-DESIGN.md](docs/BANKING-AGENT-DESIGN.md), [docs/BANKING-FOUNDER-DEMO.md](docs/BANKING-FOUNDER-DEMO.md) — banking
- [docs/FRONTEND_GUIDE-1-1.md](docs/FRONTEND_GUIDE-1-1.md) — the Agent Builder API contract
- [docs/agent-config-guide-1.md](docs/agent-config-guide-1.md) — the agent configuration

## License

Proprietary. All rights reserved.
