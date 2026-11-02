# Agent config guide

How to read `agent-config.schema.json` and `agent-config.example.json`, what every section means, and how the sections fit together.

> **Status.** This is a design. Nothing executes this config yet: there is no runtime that loads it and builds a live bot. The validator (`validate_config.py`) is real and tested. Wherever this guide says "the runtime does X", read it as "the runtime that will be built must do X".

Line numbers like *(example lines 94-186)* refer to `agent-config.example.json` as it stands when this guide was written. JSON has no comments, so this guide is the commentary.

## Contents

0. [The three files](#0-the-three-files)
1. [The big picture](#1-the-big-picture)
2. [Concepts that are easy to confuse](#2-concepts-that-are-easy-to-confuse)
3. [Walkthrough of the example, top to bottom](#3-walkthrough-of-the-example-top-to-bottom)
4. [One call, start to finish](#4-one-call-start-to-finish)
5. [Reading the schema file itself](#5-reading-the-schema-file-itself)
6. [Validation](#6-validation)
7. [Quick reference](#7-quick-reference)
8. [What is not built, and what is still ambiguous](#8-what-is-not-built-and-what-is-still-ambiguous)

If you only have ten minutes: read section 1, then 2.1 (agent vs task vs tool vs handoff), then section 4.

---

## 0. The three files

| File | What it is | Analogy |
|---|---|---|
| `agent-config.schema.json` | The rulebook: every section, field, allowed value and cross-reference rule. | The blank form with its instructions |
| `agent-config.example.json` | One complete bot (a fictional telecom support bot) that uses every feature once. | A filled-in form |
| `validate_config.py` | Checks a config against the rulebook, plus rules a rulebook can't express. | The clerk who checks the form |

Run the check any time:

```
python validate_config.py                      # checks agent-config.example.json
python validate_config.py my-bot.config.json   # checks another file
```

The UI you are planning would produce a file shaped like the example when someone presses Save, and your backend would call `validate_config()` before accepting it.

---

## 1. The big picture

**One JSON document describes one bot.** It says which models and voice to use, what the bot may say, which agents exist, which tools they may use, how it behaves on a phone call versus a web chat, and what happens when things go wrong.

A generic worker (not built yet) would read this document when a call arrives, and build the live bot from it. The same worker code runs every bot. That is why this is a **config**, not generated code.

```
caller
  |
  v
channel (phone / web-chat)      <- decides greeting, audio vs text, extra rules
  |   identity: who is calling?   state: facts remembered during the call
  v
entry agent "greeter"
  |-- handoff --> billing -------- tool --> verify_caller --> (task: ask account no. + surname)
  |                  |                 \-- tool --> get_bill_summary --> HTTP API
  |                  \-- back_to_menu --> back to greeter
  \-- handoff --> tech_support --- tool --> report_hazard --> (on chat) handoff --> safety_watch

events fire at call start and call end (log the call, save the transcript)
defaults set models and behaviour for everything; channels and agents override only what differs
```

### The five building blocks

| Block | One-line meaning |
|---|---|
| **Agent** | A persona with its own instructions and its own short list of tools. Only one agent talks at a time. |
| **Tool** | One thing the agent can *do* (look something up, send a text, hang up). Instant; returns a result. |
| **Task** | A short sub-conversation with the caller that returns a result (for example "verify who this is"). |
| **Handoff** | Passing the conversation from one agent to another. |
| **State** | Facts remembered for the length of one call (is the caller verified? what do they want?). |

Everything else in the document supports these five: messages (what is said), channels (where the call happens), connections (how to reach other systems), guardrails (limits), events (things to do at call start and end).

---

## 2. Concepts that are easy to confuse

### 2.1 Agent vs task vs tool vs handoff

| | Agent | Task | Tool | Handoff |
|---|---|---|---|---|
| Talks to the caller? | Yes, for as long as it is active | Yes, for a few turns, then gives control back | No (the agent speaks around it) | No |
| Has its own prompt? | Yes | Yes (short, narrow) | No | No |
| Returns | Nothing; it *is* the conversation | A result (verified / failed / declined) | A result the model reads | Nothing; the active agent changes |
| Lives in | `agents.items` | `tasks` | `tools` | inside an agent's `handoffs` |
| Use it when | The job needs its own persona, rules and tool set | One bounded step needs several caller turns and a pass/fail outcome | One lookup or action | The topic changes enough to deserve a different specialist |

How they connect in the example:

- A **handoff** is *seen by the model as a tool* (the model calls `go_to_billing`), but its effect is to change the active agent. That is why handoffs are listed under an agent and not under `tools`.
- A **task** is reached *through a tool*. `verify_caller` is a tool of type `task`. The tool is the door; the task is the room behind it.
- A **tool** can have **effects**: extra steps that run after it succeeds, including a handoff. `report_hazard_chat` is a tool whose entire job is a handoff.

Rules of thumb:

- One lookup or action? Make it a **tool**.
- Several caller turns, with retries and a pass/fail result? Make it a **task**.
- A different persona or a different set of tools? Make it an **agent** and hand off to it. Do not keep growing one agent. The `builder.lint` limits (450 prompt words, 8 tools per agent) exist to push you towards this.

### 2.2 The six kinds of tool

| `type` | What happens when the model calls it | Example in the file |
|---|---|---|
| `builtin` | The runtime does something it already knows how to do | `end_call`, `escalate_to_human`, `back_to_menu`, `send_callback_form`, `report_hazard_chat` |
| `task` | Starts a task (a short sub-conversation) | `verify_caller` |
| `http` | Calls a web API you define, in config | `lookup_account`, `get_bill_summary`, `report_hazard` |
| `mcp` | Exposes some tools from an MCP server | `crm_tools` |
| `knowledge` | Searches a knowledge base | `search_help_center` |
| `code` | Runs a small function you wrote (sandboxed) | not used in the example (the escape hatch) |

Built-in tools available: `end_call`, `transfer_or_callback`, `return_to_entry`, `send_dtmf`, `collect_dtmf`, `send_form`, `noop`.

### 2.3 Defaults and overrides

Settings are set once under `defaults` and then **overridden only where they differ**. The order, most general first:

```
defaults  ->  channel.overrides  ->  agent.overrides        (and a task may override inactivity)
```

Two rules:

1. **Objects merge key by key; arrays replace.** If a channel overrides `inactivity` with a new `nudges` list, the whole list is replaced, but `enabled` and `on_exhausted` are kept from defaults unless also given.
2. **`null` switches a model off.** `"models": { "stt": null, "tts": null }` on the web-chat channel means: no speech-to-text and no text-to-speech on chat.

Only two things can be overridden: `models` and `conversation`. They have the same shape at every level, so one editor in the UI can serve defaults, channels and agents.

### 2.4 State vs constants vs messages vs persona

| | What it holds | Changes during a call? | Referenced as |
|---|---|---|---|
| `state` | Facts about *this call* (verified? intent? customer?) | Yes | `{{state.verified}}` |
| `constants` | Fixed values for the whole bot (a URL, a number of hours) | No | `{{const.payment_url}}` |
| `messages` | Fixed lines the bot says word for word | No | `{ "message": "goodbye" }` |
| `persona` | Name, tone and rules every agent shares in its prompt | No | (injected automatically) |

### 2.5 Connections vs tools

A **connection** says *where* something is and *how to log in* (base URL, auth). A **tool** says *what to ask it*. You define the connection once and many tools use it. Connections are typed, so a tool of type `http` can only name an `http` connection, and a notification can only use a `notifier`. The validator enforces this.

### 2.6 Actions, effects, events

An **action** is one step. The kinds are:

| Action `type` | Does |
|---|---|
| `say` | Speaks fixed text or a message (never the model's own words) |
| `generate` | The model writes the reply from the instructions you give |
| `set_state` | Writes values into state |
| `handoff` | Hands the conversation to another agent |
| `return_to_entry` | Goes back to the entry agent |
| `end_call` | Optionally says something, then hangs up |
| `transfer` | Runs a transfer to a person or queue |
| `notify` | Sends a notification |
| `send_form` | Shows a form in chat |
| `wrapup` | Starts a wrap-up timer |
| `play_sound` | Plays a sound |
| `http` | Calls a web API |
| `log` | Writes a log line |

The same list of actions is used in many places. Where they appear:

| Place | When it runs |
|---|---|
| a tool's `effects` | after that tool succeeds |
| `events[].do` | at call start, call end, handoff, tool error, etc. |
| `defaults.conversation.inactivity.on_exhausted` | when nudges ran out |
| `wrapups[].on_silence` | when no reply came during a wrap-up |
| `forms[].on_submit` | when a form is submitted |
| `telephony.transfers[]` `before`, `closed`, `on_success`, `on_failure` | stages of a transfer |
| `notifications[].on_failure` | when no delivery worked |
| `transfer_or_callback` tool `fallback` | when a transfer could not happen |
| `reliability.on_session_error.do` | as the session dies (only `play_sound`, `http`, `log`) |

**Effects** are "actions attached to a tool". **Events** are "actions attached to a moment in the call".

A **condition** decides whether something applies. Conditions are used in preconditions (`require`), effects (`when`), events (`when`), conditional instructions, and `skip_if`. A condition tests one thing:

```
{ "state": "verified", "equals": false }        a state variable
{ "arg": "assessment", "equals": "worsened" }    an argument the model gave the tool
{ "result": "$.found", "equals": true }          a field in the tool's response
{ "channel": "web-chat" }                        which channel the call is on
{ "schedule": "support_hours", "open": true }    business hours
```

and can be combined with `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": {...} }`. Comparisons are `equals`, `not_equals`, `gte`, `lte`, `in`.

### 2.7 Guardrails vs preconditions vs effects

| | Question it answers | Where |
|---|---|---|
| **Precondition** | "May this tool run right now?" (for example only if verified) | on one tool |
| **Effect** | "What else should happen after this tool?" | on one tool |
| **Guardrail** | "What must always be true across the whole call?" | `guardrails` |

Every guardrail rule has an `enforcement` that says *how* it is applied:

- `prompt` = written into the model's instructions. The model usually obeys, but it is a request.
- `code` = checked by the runtime. The model cannot talk its way past it.
- `both` = instruction plus a code check.

Detectors (prompt injection, personal data, regex block, field firewall) can only be `code` or `both`, because a model cannot reliably police itself. A `statement` rule can only be `prompt`.

### 2.8 Inactivity vs wrap-up

| | Inactivity | Wrap-up |
|---|---|---|
| Runs | The whole call, repeatedly | Once, started at a specific moment |
| Triggered by | A silent caller | An action (`wrapup`) after a natural end point |
| Output | Up to N nudges, then `on_exhausted` | Wait, then `on_silence` if nobody replies |
| Example | "Are you still there?" twice, then hang up | After a callback form is submitted, close if there is no reply in 30 s |

### 2.9 Handoff vs transfer vs escalate vs return

| Word | Means | Moves the caller to |
|---|---|---|
| **handoff** | Switch to another *agent* in the same bot | Another AI persona, same conversation |
| **transfer** | Move the call to a *person or queue* | A human, outside the bot |
| **escalate** (`escalate_to_human`) | A tool that *tries a transfer* and falls back to a callback if it cannot | A human, or a callback request |
| **return** (`return_to_entry`, tool `back_to_menu`) | A specialist hands the caller back to the entry agent | Back to the greeter |

### 2.10 Notification vs `out_of_band`

Both send something to the caller outside the conversation. Use:

- `notifications` for **messages you compose** (a ticket confirmation, an email to your team). They can fall back from email to SMS, and attach the transcript.
- `result.out_of_band` for **a value that came back from an API and must never pass through the model**, such as a payment link or a one-time code. The model sees only `sent: true`. The `secret_firewall` guardrail backs this up by stripping those field names from everything the model sees or says.

### 2.11 Knowledge: `tool` mode vs `inject` mode

| | `tool` | `inject` |
|---|---|---|
| How it works | The model decides when to search, via a knowledge tool | The runtime searches on every caller turn and adds the results to the prompt |
| Needs model tool-calling? | Yes | No |
| How it is attached | A `knowledge` tool in an agent's `tools` | The agent's `knowledge` list |
| In the example | `help_center` (billing and tech support search it) | `product_manual` (attached to `tech_support`) |

### 2.12 How things refer to each other

| Written as | Meaning |
|---|---|
| `"to": "billing"` | Reference to another thing's `id`. The validator checks it exists and is the right kind. |
| `{ "message": "goodbye" }` | Say the catalogue message with that id. Wherever speech is accepted you may instead write literal text. |
| `{ "secret": "OPENAI_API_KEY" }` | A secret's name. The value lives in your secrets vault, never in this file. |
| `{{state.verified}}` | A template placeholder, filled in at run time. |
| `{ "lookup": { "state": "intent", "map": {...} } }` | Pick a value from a map according to a state variable. |
| `{ "$each": "call.transcript", "as": "m", "do": {...} }` | Repeat `do` once per item of a list. |

**Template roots** (what `{{...}}` can read):

| Root | Contains |
|---|---|
| `state` | The call's state variables |
| `args` | The arguments the model passed to the current tool |
| `result` | The current tool's response |
| `const` | `constants` |
| `meta` | `id`, `name`, `version` of the bot |
| `call` | `id`, `room`, `dnis`, `started_at`, `ended_at`, `duration_s`, `transcript`, `summary` |
| `channel` | `id`, `type`, `modality` |
| `caller` | `id` |
| `pbx` | `host`, `port`, `transport` |
| `target` | A transfer's resolved destination |
| `with` | Extra values passed by a `notify` action |
| `form` | A submitted form's fields |

**Filters** (`{{ value | filter }}`): `default('x')`, `or(other.path)`, `truncate(n)`, `upper`, `lower`, `join(', ')`, `urlencode`, `format('%Y-%m-%d', 'Timezone')`, `map('user=IN','assistant=OUT')`.

The validator checks `{{state.x}}`, `{{const.x}}` and `{{args.x}}` placeholders. The other roots and the filters are specified here, but nothing checks or runs them yet.

---

## 3. Walkthrough of the example, top to bottom

### 3.1 The header *(example lines 2-3)*

```json
"$schema": "./agent-config.schema.json",
"schema_version": "1.1",
```

- `$schema` tells editors (VS Code, for instance) which rulebook applies, so you get autocomplete and red underlines. It does nothing at run time.
- `schema_version` must equal `"1.1"`. It lets a runtime refuse a config written for a different version.

### 3.2 `meta`: who this bot is *(lines 5-16)*

```json
"meta": {
  "id": "acme-support",
  "name": "Acme Telecom Support",
  "description": "Inbound support bot: billing and technical faults over phone (SIP) and web chat, with live-video hazard watching on chat.",
  "version": "2.0.0",
  "status": "draft",
  "environment": "staging",
  "tags": ["support", "telecom"],
  "owner": "support-team",
  "created_at": "2026-10-06T09:00:00Z",
  "updated_at": "2026-10-06T09:00:00Z"
}
```

| Field | Meaning |
|---|---|
| `id` | Short permanent name (lowercase, digits, `-`, `_`). Used in references such as `acme-support@published`. |
| `name`, `description` | For people. |
| `version` | Semantic version `major.minor.patch`. Publishing creates an immutable version; the runtime loads `id@version` or `id@published`. |
| `status` | `draft`, `published` or `archived`. |
| `environment` | `development`, `staging` or `production`. |
| `tags`, `owner` | Organisation labels for the UI. |
| `created_at`, `updated_at` | Timestamps. |

### 3.3 `runtime`: how the worker runs it *(lines 18-26)*

```json
"runtime": {
  "engine": "livekit-agents",
  "provider_mode": "plugins",
  "dispatch_name": "acme-support",
  "secrets_vault": "default",
  "timezone": "America/New_York",
  "worker": { "http_port": 8081, "num_idle_processes": 1, "initialize_process_timeout_s": 30 },
  "hangup": { "delete_room_on_close": true, "drain": true }
}
```

| Field | Meaning |
|---|---|
| `engine` | Only `livekit-agents` for now. |
| `provider_mode` | `plugins` = you bring your own provider keys (works on a self-hosted LiveKit server). `inference` = LiveKit Cloud's hosted models. **One config targets one mode**, because model names differ between them. |
| `dispatch_name` | **Deprecated, ignored.** One generic worker pool runs every bot, so a call names its bot in its dispatch metadata, `{"bot": "acme-support", "ref": "production"}`, and `ref` is a version, `latest` or an environment. Omit it in new configs. |
| `secrets_vault` | Which vault the `{ "secret": ... }` references are looked up in. |
| `timezone` | Default timezone for spoken times and date formatting. |
| `worker.http_port` | The worker's health-check port. **Not applied by the generic runtime**: a worker serves many bots, so set it on the worker (`AGENT_RUNTIME_HTTP_PORT`). |
| `worker.num_idle_processes` | How many warm worker processes to keep. **Not applied**: set `AGENT_RUNTIME_IDLE_PROCESSES` on the worker. |
| `worker.initialize_process_timeout_s` | How long a worker gets to start before it is killed. **Not applied** (worker-level setting). |
| `hangup.delete_room_on_close` | Deleting the room hangs up the phone leg or closes the chat when the session ends. |
| `hangup.drain` | Let closing speech finish playing before the line is dropped. |

### 3.4 `constants` *(lines 28-31)*

```json
"constants": {
  "payment_url": "https://pay.acme.example",
  "supervisor_callback_hours": 4
}
```

Fixed values you can use anywhere as `{{const.name}}`. Here, `payment_url` is used in the `send_payment_link` tool and `supervisor_callback_hours` inside the `callback_line` message. Change a number here and every place that uses it follows. Constants are not secrets.

### 3.5 `schedules`: business hours *(lines 33-44)*

```json
"schedules": {
  "support_hours": {
    "description": "When a person can take a transferred call.",
    "timezone": "America/New_York",
    "weekly": [
      { "days": ["mon", "tue", "wed", "thu", "fri"], "start": "08:00", "end": "20:00" },
      { "days": ["sat"], "start": "09:00", "end": "17:00" }
    ],
    "holidays": ["2026-12-25"],
    "overrides": { "2026-12-24": { "start": "09:00", "end": "13:00" } }
  }
}
```

| Field | Meaning |
|---|---|
| key (`support_hours`) | The schedule's id. |
| `timezone` | Hours are read in this timezone. |
| `weekly` | Windows of open hours. `end` is exclusive; `24:00` means end of day. A window of `00:00` to `24:00` on all seven days is 24/7. |
| `holidays` | Dates closed all day. They win over `overrides`. |
| `overrides` | One-off exceptions to the weekly pattern (here, Christmas Eve closes early) or `"closed"`. |

The example uses it in the `human_support` transfer (`"schedule": "support_hours"`). A condition `{ "schedule": "support_hours", "open": true }` can use it anywhere conditions are accepted.

### 3.6 `identity`: who is calling *(lines 46-54)*

```json
"identity": {
  "caller_id": {
    "sources": [
      { "from": "participant_attribute", "name": "sip.phoneNumber" },
      { "from": "participant_identity", "strip": ["^sip[:_]", "@.*$"] }
    ],
    "normalize": { "type": "e164", "default_country": "US" }
  }
}
```

How the runtime finds the caller's phone number:

1. `sources` are tried in order and the first that yields a value wins. First, the SIP attribute `sip.phoneNumber`. If that is missing, use the participant's identity string with the regexes removed: `^sip[:_]` strips a leading `sip:` or `sip_`, and `@.*$` strips everything from the `@`. So `sip_+15550001111@host` becomes `+15550001111`.
2. `normalize` turns whatever was found into international format. `e164` with `default_country: "US"` treats a local number as American.

The result is stored in the state variable whose `source` is `{ "caller_id": true }` (here `caller_phone`). A chat visitor normally has no phone number, so that variable is typically empty for chat. A third source kind, `static`, supplies a fixed fallback (useful for testing).

### 3.7 `telephony`: the phone system and transfers *(lines 56-92)*

```json
"pbx": { "host": "pbx.acme.example", "transport": "tls", "dnis": "+18005550100" },
```

- `pbx` describes your phone exchange. `host` and `transport` feed the URI template below as `{{pbx.host}}`, `{{pbx.transport}}`. `dnis` is the number the bot answers, recorded with call logs as `{{call.dnis}}`.

Now the transfer (a way to hand the call to a person):

```json
{
  "id": "human_support",
  "description": "Blind-transfer the caller's SIP leg to the queue for what they called about.",
  "method": "sip_refer",
  "target": {
    "lookup": {
      "state": "intent",
      "map": { "billing": { "secret": "BILLING_QUEUE_NUMBER" }, "technical": { "secret": "TECH_QUEUE_NUMBER" } },
      "default": { "secret": "TECH_QUEUE_NUMBER" }
    }
  },
  "uri_template": "sip:{{target}}@{{pbx.host}};transport={{pbx.transport}};sip_h_X-Reason={{args.reason | truncate(200) | urlencode}}",
  "play_dialtone": true,
  "headers": {
    "X-Call-Id": "{{state.call_id}}",
    "X-Session-Id": "{{state.sip_session_id | default('unknown')}}"
  },
  "schedule": "support_hours",
  "closed": [{ "type": "say", "text": { "message": "outside_hours" } }],
  "before": [
    {
      "type": "http",
      "connection": "platform_db",
      "method": "POST",
      "path": "/active-calls",
      "body": { "call_id": "{{state.call_id}}", "caller": "{{state.caller_phone}}", "reason": "{{args.reason}}" }
    }
  ],
  "delay_s": 1,
  "on_success": [{ "type": "set_state", "values": { "disposition": "transferred" } }],
  "on_failure": [{ "type": "log", "level": "warning", "message": "transfer failed for call {{state.call_id}}" }]
}
```

| Field | Meaning |
|---|---|
| `id` | Name other places use (`"transfer": "human_support"`). |
| `method` | `sip_refer` = ask the phone system to move the caller's existing line (a "blind transfer"). The alternative, `http_request`, asks an external web service to move the session, for example into a queue. |
| `target` | Where to send the call. Here a **lookup**: if the state variable `intent` is `billing`, use the secret `BILLING_QUEUE_NUMBER`; if `technical`, `TECH_QUEUE_NUMBER`; otherwise the default. |
| `uri_template` | Builds the SIP address from the target. A bare number becomes `sip:+1555...@pbx.acme.example;transport=tls`. It also appends a SIP header parameter carrying the reason (truncated to 200 characters and URL-encoded). A target that already starts with `sip:` or `tel:` is used as is. |
| `play_dialtone` | Play a tone to the caller while the transfer connects. |
| `headers` | Extra SIP headers sent with the transfer. Values are templates. |
| `schedule` | Only transfer while this schedule is open. |
| `closed` | Actions to run when the schedule says closed (here, say the "outside hours" message). |
| `before` | Actions to run before transferring (here, register the call as "being transferred" in a database). |
| `delay_s` | Wait this long after `before` so that registration lands first. |
| `on_success` / `on_failure` | Actions after the transfer works or fails (here, record the outcome in state, or log). |

The tool that triggers it is `escalate_to_human` (section 3.18). Its `fallback` actions run when the transfer cannot happen. When a transfer is closed by schedule, both `closed` and the tool's `fallback` apply; see section 8 for the order.

### 3.8 `defaults.language` *(line 95)*

```json
"language": { "primary": "en-US", "speaks": ["en", "es"], "also_understands": ["en-GB"], "auto_detect": false }
```

| Field | Meaning |
|---|---|
| `primary` | The main language. A message that has per-language text must include this one (the validator checks). |
| `speaks` | Languages the bot can answer in. The validator warns if a message has no text for one of these. |
| `also_understands` | Languages accepted from the caller that the bot will not necessarily answer in. |
| `auto_detect` | Whether to detect the caller's language automatically. |

### 3.9 `defaults.models` *(lines 97-126)*

Speech-to-text (turns the caller's voice into text):

```json
"stt": {
  "provider": "deepgram",
  "model": "nova-3",
  "language": "en",
  "keyterms": ["Acme", "SIM swap", "roaming"],
  "api_key": { "secret": "DEEPGRAM_API_KEY" }
}
```

`keyterms` are words the recogniser should favour (brand names, jargon). `api_key` is a secret reference, never a raw key (a raw string here is a validation error).

The language model (the "brain"):

```json
"llm": {
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "temperature": 0.3,
  "parallel_tool_calls": false,
  "tool_calling": true,
  "vision": true,
  "api_key": { "secret": "OPENAI_API_KEY" },
  "fallbacks": [{ "provider": "openai", "model": "gpt-4o-mini" }]
}
```

| Field | Meaning |
|---|---|
| `temperature` | Lower = more predictable. |
| `parallel_tool_calls: false` | One tool call at a time. This avoids the model firing two handoffs at once. |
| `tool_calling` | Whether the model supports tools. If false, agents cannot have tools or handoffs (the validator checks), and knowledge must use `inject` mode. |
| `vision` | Whether the model accepts images. Required if any channel takes image or video input (the validator checks). |
| `fallbacks` | Tried in order if the primary provider fails. |

Text-to-speech (gives the bot a voice):

```json
"tts": {
  "provider": "elevenlabs",
  "model": "eleven_multilingual_v2",
  "voice_id": "voice_placeholder_id",
  "speed": 1.0,
  "text_transforms": ["filter_markdown", "filter_emoji"],
  "api_key": { "secret": "ELEVEN_API_KEY" }
}
```

`voice_id` is a placeholder; use a voice that really exists on your account. `text_transforms` strip markdown and emoji so the voice does not read "asterisk asterisk".

The rest:

```json
"realtime": null,
"vad": { "provider": "silero" },
"turn_detector": { "provider": "livekit-multilingual" }
```

- `realtime: null` means no speech-to-speech model by default. An agent may override it (see `safety_watch`). A realtime model replaces the `llm` for that agent.
- `vad` is the voice-activity detector (is someone speaking?). `turn_detector` decides when the caller has *finished* a sentence.

### 3.10 `defaults.conversation`: how the conversation behaves *(lines 128-170)*

**Turn handling** (timing of who speaks when):

```json
"turn_handling": {
  "endpointing": { "mode": "fixed", "min_delay": 0.5, "max_delay": 3.0 },
  "interruption": { "enabled": true, "mode": "vad", "min_duration": 0.5, "min_words": 0, "resume_false_interruption": true, "false_interruption_timeout": 2.0 },
  "preemptive_generation": { "enabled": true, "preemptive_tts": false },
  "user_turn_limit": { "max_words": null, "max_duration": null }
}
```

| Field | Meaning |
|---|---|
| `endpointing.min_delay` | Seconds of silence before the caller's turn can end. |
| `endpointing.max_delay` | The longest the bot will wait before taking its turn. |
| `interruption.enabled` | Can the caller talk over the bot? |
| `interruption.mode` | `vad` = simple voice detection (use this when self-hosted). `adaptive` = a smarter model that needs LiveKit Cloud. |
| `interruption.min_duration`, `min_words` | How much speech counts as a real interruption. |
| `resume_false_interruption`, `false_interruption_timeout` | If it was only a cough, resume talking after this many seconds. |
| `preemptive_generation` | Start working out a reply before the caller has quite finished, to cut delay. |
| `user_turn_limit` | Optional cap on how long a caller may hold the floor (null = no limit). |

`"max_tool_steps": 6` caps how many tool calls the model may chain in one turn.

**Inactivity**: what to do when the caller goes quiet *(lines 136-146)*:

```json
"inactivity": {
  "enabled": true,
  "clock": "auto",
  "timeout_s": 12,
  "max_nudges": 2,
  "nudges": [
    { "type": "say", "text": { "message": "still_there" } },
    { "type": "say", "text": { "message": "still_there_final" } }
  ],
  "on_exhausted": { "do": [{ "type": "end_call", "say": { "message": "inactivity_goodbye" } }] }
}
```

Timeline on a phone call:

```
caller goes silent
  12 s   -> nudge 1: "Are you still there?"
  +12 s  -> nudge 2: "I'm still here whenever you're ready..."
  +12 s  -> on_exhausted: say "I haven't heard from you..." then hang up
(if the caller speaks at any point, the count starts again from zero)
```

| Field | Meaning |
|---|---|
| `clock` | What "silent" means. `silence` = both caller and bot quiet, paused while a tool is running. `user_activity` = time since the caller's last message, whatever the bot did. `auto` picks `silence` on audio channels and `user_activity` on text channels. |
| `timeout_s` | How long before each nudge. |
| `max_nudges` | How many nudges before giving up. `0` goes straight to `on_exhausted`. |
| `nudges` | What to say. Nudge *n* uses `nudges[n-1]`; the last one repeats if there are more nudges than entries. |
| `on_exhausted.do` | Actions when nudges run out. Here: say a goodbye, then hang up. |

Use `say` for lines that must be delivered. `generate` asks the model to write them, which costs a model call and fails if the model is the thing that is down. The closing speech plays in full before hanging up.

This block is also *overridden* in two places in the example: the web-chat channel (120 s, user-activity clock) and the `verify_customer` task (30 s, so a caller hunting for an account number is not hurried).

**Sounds** (the typing noise is kept) *(lines 147-156)*:

```json
"sounds": {
  "thinking": {
    "enabled": true,
    "clips": [
      { "source": "keyboard_typing", "volume": 0.3, "probability": 0.5, "fade_out_s": 0.3 },
      { "source": "keyboard_typing2", "volume": 0.3, "probability": 0.5, "fade_out_s": 0.3 }
    ]
  },
  "ambient": { "enabled": false, "clip": { "source": "office_ambience", "volume": 0.1, "loop": true } }
}
```

- `thinking` plays while the bot is working out a reply or running a tool, so a slow turn is not dead air. Each time, one clip is chosen using `probability`, at `volume` (0 to 1), fading out over `fade_out_s`.
- `ambient` is a looping background sound for the whole call. It is off here.
- A source is a bundled clip name (`keyboard_typing`, `keyboard_typing2`, `hold_music`, `office_ambience`, `city_ambience`, `forest_ambience`, `crowded_room`), or `{ "file": "path" }`, or `{ "url": "https://..." }`.
- The web-chat channel switches `thinking` off, since text has no audio.

**Speech rules**: making written text sound right *(lines 157-167)*:

```json
"speech": {
  "pronunciation": [
    { "type": "currency", "symbols": ["$", "USD"], "major_unit": "dollars", "minor_unit": "cents" },
    { "type": "spell", "id": "reference_ids", "pattern": "\\b(TK|INC)-?\\d{4,8}\\b" },
    { "type": "time", "style": "spoken_12h" },
    { "type": "date", "style": "ordinal_month_name" },
    { "type": "digits", "min_length": 6, "group_size": 4, "plus_prefix": "plus " },
    { "type": "replace", "id": "sms", "pattern": "\\bSMS\\b", "replacement": "text message" }
  ],
  "buffer": { "max_hold_chars": 160 }
}
```

These run in order on the text sent to the voice (never on the chat transcript):

| Rule | Turns | Into |
|---|---|---|
| `currency` | `$12.50` | "12 dollars 50 cents" |
| `spell` | `INC-12345` | "I N C 1 2 3 4 5" |
| `time` | `4:30 PM` | "4 30 P M" |
| `date` | `27-Feb-2026` | "27th February 2026" |
| `digits` | `12345678` (6+ digits) | "1 2 3 4, 5 6 7 8" (groups of 4, digit by digit; a leading `+` becomes "plus ") |
| `replace` | `SMS` | "text message" (any regex to any text) |

`buffer.max_hold_chars` is how much text the runtime holds while waiting for a clause boundary (a comma or full stop), so that "4:30" and "PM" arriving in separate chunks are fixed together.

```json
"ivr_detection": false,
"noise_cancellation": { "enabled": false, "model": "auto" }
```

- `ivr_detection`: detect whether the other end is a phone menu rather than a person.
- `noise_cancellation`: `model: auto` means the telephony model for phone callers and the standard model otherwise. It needs LiveKit Cloud. The `phone` channel switches it on.

### 3.11 `defaults.reliability`: when providers fail *(lines 172-185)*

```json
"reliability": {
  "connection": {
    "stt": { "max_retry": 3, "retry_interval_s": 2, "timeout_s": 10 },
    "llm": { "max_retry": 3, "retry_interval_s": 2, "timeout_s": 15 },
    "tts": { "max_retry": 3, "retry_interval_s": 2, "timeout_s": 10 }
  },
  "max_unrecoverable_errors": 3,
  "on_session_error": {
    "do": [
      { "type": "play_sound", "sound": { "file": "sounds/sorry-call-back.wav" } },
      { "type": "log", "level": "error", "message": "session closed after unrecoverable errors, call {{state.call_id}}" }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `connection.stt/llm/tts` | For each component: how many times to retry a failed request, how long to wait between tries, and how long to wait for a response. |
| `max_unrecoverable_errors` | After this many errors in a row that retries could not fix, the session is closed. |
| `on_session_error.do` | What to do as that happens. **Only a pre-recorded sound, a web call or a log line are allowed**, not speech: at that moment the close does not wait for speech to finish, and the voice may be the very thing that failed. The validator rejects `say`/`generate` here. |

### 3.12 `persona` *(lines 188-201)*

```json
"persona": {
  "name": "Sam",
  "company": "Acme Telecom",
  "tone": "warm, concise, plain language",
  "style_rules": [
    "One question at a time.",
    "Short sentences; this is spoken, not written."
  ],
  "shared_rules": [
    "Only state facts returned by a tool; never guess account data.",
    "Stay inside your role; hand over instead of improvising."
  ],
  "disclosures": { "recording_notice": "This call may be recorded to improve our service." }
}
```

What every agent shares. `style_rules` and `shared_rules` are added to **every** agent's prompt, so write them once instead of repeating them per agent. `disclosures.recording_notice` holds required legal wording.

### 3.13 `messages`: everything the bot says word for word *(lines 203-215)*

```json
{ "id": "greeting", "text": { "en": "Thank you for calling Acme Telecom. This call may be recorded. I'm Sam. How can I help?", "es": "Gracias por llamar a Acme Telecom. Esta llamada puede ser grabada. Soy Sam. ¿En qué puedo ayudarle?" }, "allow_interruptions": false },
{ "id": "callback_line", "text": { "en": "A supervisor will call you back within {{const.supervisor_callback_hours}} hours.", "es": "Un supervisor le llamará en un plazo de {{const.supervisor_callback_hours}} horas." } }
```

A catalogue of fixed lines, each with an `id` so many places can reuse them as `{ "message": "greeting" }`.

- `text` is either one string, or an object of language code to text. A multi-language message must include the primary language.
- `allow_interruptions: false` means the caller cannot cut the line off (used for goodbyes and safety instructions).
- A message may contain templates: `callback_line` pulls `supervisor_callback_hours` from `constants`.
- Intended behaviour: the runtime speaks the line in the caller's language if the message has it, otherwise in the primary language.

The example has eleven messages: `greeting`, `chat_greeting`, `goodbye`, `still_there`, `still_there_final`, `inactivity_goodbye`, `outside_hours`, `callback_line`, `hazard_ack`, `hazard_advice`, `move_away`. The validator warns about a message nothing uses.

### 3.14 `state`: what the bot remembers during a call *(lines 217-235)*

```json
"verified": { "type": "boolean", "default": false },
"intent": { "type": "enum", "values": ["billing", "technical"], "nullable": true, "default": null },
"call_id": { "type": "string", "source": { "generate": { "kind": "epoch_hex", "max_length": 16, "uppercase": true } } }
```

| Field | Meaning |
|---|---|
| `type` | `string`, `integer`, `number`, `boolean`, `enum`, `object`, `array`. An `enum` must also list its `values`. |
| `default` | The starting value. |
| `nullable` | May the value be empty (null)? |
| `source` | How the runtime fills it at the start of the call. Omit it for variables that only tools and tasks set. |

The kinds of `source`:

| Source | Meaning |
|---|---|
| `{ "caller_id": true }` | The caller's number (see `identity`) |
| `{ "participant_attribute": "sip.session_id" }` | A value from the connecting participant |
| `{ "channel": "modality" }` | The channel's `id`, `type`, or `modality` (`voice` when it outputs audio, otherwise `chat`) |
| `{ "call": "id" }` | `id`, `room` or `started_at` of the call |
| `{ "generate": { "kind": "epoch_hex", ... } }` | A generated id: `uuid`, or epoch seconds plus 4 random hex characters, capped at `max_length` |
| `{ "constant": "name" }` | Copy of a constant |

Every variable in the example, who sets it and who reads it:

| Variable | Set by | Read by |
|---|---|---|
| `caller_phone` | runtime, from `identity` | notification to the caller; event and tool bodies |
| `channel` | runtime | available to templates and conditions |
| `call_id` | runtime, generated | transfer headers; event paths and bodies |
| `sip_session_id` | runtime, from a SIP attribute | transfer header; `call_ended` event |
| `intent` | the greeter's handoffs (`set_state`) | transfer target lookup; callback email recipient; callback body |
| `customer` | the `call_started` lookup; tool `lookup_account` | tool paths (`{{state.customer.id}}`); the task's `skip_if` |
| `verified` | tool `check_surname`; the task's `on_success` | preconditions; the billing agent's conditional instruction |
| `verify_attempts` | tool `check_surname` (`limits.count_attempts_in`) | the `verify_failed` escalation guardrail |
| `ticket_id` | tools `report_hazard`, `conclude_watch` | available for later use |
| `pending_request` | tool `back_to_menu` | the greeter's conditional instruction |
| `hazard_location`, `hazard_description` | tool `report_hazard_chat` | tool `conclude_watch` |
| `notification_sent_by` | `notify` actions (`result_to_state`) | `tech_support`'s conditional instruction |
| `contact_name` | the callback form (`store_in_state`) | available for later use |
| `disposition` | the transfer's `on_success` | the `call_ended` event |

### 3.15 `channels`: where the call happens *(lines 237-278)*

The `phone` channel:

```json
{
  "id": "phone",
  "type": "sip_voice",
  "enabled": true,
  "match": { "participant_kind": ["sip"] },
  "entry": { "dispatch_rule": "acme-support-inbound", "sip_trunk": "trunk-main", "dnis": "+18005550100" },
  "modalities": { "input": ["audio"], "output": ["audio"] },
  "capabilities": { "dtmf": true, "human_transfer": true },
  "greeting": { "say": { "message": "greeting" }, "allow_interruptions": false },
  "instructions_append": "This is a voice call. The caller has no camera. Never ask them to show or upload anything.",
  "overrides": { "conversation": { "noise_cancellation": { "enabled": true, "model": "auto" } } }
}
```

| Field | Meaning |
|---|---|
| `type` | `sip_voice`, `web_voice`, `web_chat`, `whatsapp`, `sms`, `email` or `custom`. |
| `enabled` | Switch the channel off without deleting it. |
| `match` | How the runtime decides a connecting participant belongs here. Phone callers are SIP participants. If omitted, the type decides. |
| `entry` | How traffic reaches this channel. A `sip_voice` channel must name a `dispatch_rule`; a `web_chat` channel must name a `widget_id`. |
| `modalities` | What it accepts (`input`: audio, text, image, video) and gives back (`output`: audio, text). The validator uses this: audio output needs a text-to-speech model; images need a vision model. |
| `capabilities` | Yes/no flags. `human_transfer: false` means a transfer tool skips straight to its fallback on this channel. |
| `greeting` | What the bot says first, and whether it can be interrupted. |
| `instructions_append` | Extra text added to **every** agent's prompt on this channel. Here: "this is a voice call, never ask for a camera". |
| `overrides` | Settings that differ from `defaults` on this channel. |

The `web-chat` channel adds a few things:

```json
"inputs": {
  "image": { "topic": "image-upload", "on_receive": "reply", "max_bytes": 5242880, "accepted_mime": ["image/jpeg", "image/png"] },
  "video": { "camera": true, "screen_share": false }
},
```

- `inputs.image`: `topic` is the channel the widget sends uploads on; `on_receive: reply` makes the bot start replying as soon as a photo arrives (the alternative, `attach`, waits and attaches it to the caller's next message); `max_bytes` and `accepted_mime` limit what is accepted.
- `inputs.video`: the camera may be used; screen sharing is not.

```json
"overrides": {
  "models": { "stt": null, "tts": null },
  "conversation": {
    "inactivity": {
      "clock": "user_activity",
      "timeout_s": 120,
      "max_nudges": 2,
      "nudges": [{ "type": "generate", "instructions": "The visitor has gone quiet. Check in warmly and briefly, asking if they are still there or need anything else." }],
      "on_exhausted": { "do": [{ "type": "end_call", "say": { "message": "inactivity_goodbye" } }] }
    },
    "sounds": { "thinking": { "enabled": false } }
  }
}
```

This is the override rule in action: no voice models on chat; inactivity waits 120 s and measures from the visitor's last message; the typing sound is off. The `nudges` array **replaces** the default one (one generated nudge, repeated).

### 3.16 `agents`: who can be talking *(lines 280-349)*

```json
"agents": {
  "entry": "greeter",
  "items": [ ... ]
}
```

`entry` is the agent that answers first.

**The anatomy of an agent**, using the greeter *(lines 283-298)*:

```json
{
  "id": "greeter",
  "name": "Front Door",
  "kind": "router",
  "instructions": {
    "role": "You answer, work out what the caller needs and hand over to the right specialist. Do no business yourself.",
    "opening": "Greet briefly if you have not already, then ask how you can help.",
    "rules": ["If the caller has nothing else or says goodbye, call end_call. It says the goodbye itself."],
    "conditional": [{ "when": { "state": "pending_request", "not_equals": null }, "append": "The caller still needs help with: {{state.pending_request}}. Hand over to the right specialist now, without asking anything." }]
  },
  "tools": ["end_call", "escalate_to_human"],
  "handoffs": [
    { "id": "to_billing", "tool": "go_to_billing", "description": "The caller asks about a bill, charges or a payment.", "to": "billing", "carry_context": true, "set_state": { "intent": "billing" } },
    { "id": "to_tech", "tool": "go_to_tech_support", "description": "The caller reports a fault: no signal, slow data, a damaged cable or device problems.", "to": "tech_support", "carry_context": true, "set_state": { "intent": "technical" } }
  ]
}
```

| Field | Meaning |
|---|---|
| `id`, `name` | Reference name and display name. |
| `kind` | `router` (a front door that only hands off), `specialist` (does one job) or `standalone` (a single-agent bot). A label for the UI and for reading; it does not change behaviour. |
| `instructions.role` | The agent's main prompt: what it is for. |
| `instructions.opening` | An extra instruction applied once, when the agent takes over. |
| `instructions.rules` | Further rules, one per line. |
| `instructions.conditional` | Extra instruction added **only while a condition holds**. The greeter gets "the caller still needs help with ..." only if `pending_request` is not null. |
| `tools` | Ids of the tools this agent may use. Handoffs are *not* listed here. |
| `handoffs` | Other agents this one can pass the call to (below). |
| `knowledge` | Knowledge bases in `inject` mode for this agent. |
| `vision` | How this agent uses images. |
| `channels` | Restrict this agent to certain channels. Omit for all. |
| `overrides` | `models`/`conversation` settings for this agent only. |

How the runtime should build an agent's prompt (intended): the persona's style and shared rules, then the channel's `instructions_append`, then the agent's `role` and `rules`, then any `conditional` entries whose condition currently holds; `opening` is applied once on entry.

**Handoff fields:**

| Field | Meaning |
|---|---|
| `id` | Reference name. |
| `tool` | The name the model sees and calls (`go_to_billing`). Must not clash with any tool name. |
| `description` | **Tells the model when to take this handoff.** This is what the model reads. |
| `to` | The agent that takes over. |
| `carry_context` | Give the new agent the conversation so far (default true). |
| `set_state` | State recorded when the handoff is taken. Here the greeter records `intent` for later routing. |
| `announce` | Optional line spoken while the handoff happens. |

The other agents:

- **`billing`** *(lines 299-310)*: tools `verify_caller`, `get_bill_summary`, `send_payment_link`, `search_help_center`, `escalate_to_human`, `back_to_menu`. Its `conditional` says "the caller is not verified yet: call verify_caller" while `verified` is false.
- **`tech_support`** *(lines 311-325)*:
  - `knowledge: ["product_manual"]` attaches the injected knowledge base.
  - `vision: { "mode": "turn_attach", "max_dimension": 1024 }` attaches the latest camera frame or uploaded photo to each caller message, scaled to at most 1024 pixels. Any vision-capable model works.
  - `overrides.models.llm` uses a stronger model (`gpt-4.1`) and lower temperature just for this agent. Everything else inherits.
  - Its tool list holds both variants of the hazard tool (section 3.18).
- **`safety_watch`** *(lines 326-347)*: reachable only on `web-chat` (`"channels": ["web-chat"]`). It watches a hazard live:

```json
"vision": {
  "mode": "continuous",
  "max_dimension": 1024,
  "watch": {
    "sample_interval_s": 1.5,
    "change_threshold": 18,
    "min_seconds_between_prompts": 4,
    "on_change": { "type": "generate", "instructions": "Something just visibly changed in the camera view. Look now. If it is genuinely worse, interrupt and act per your role; if not meaningfully different, say nothing." }
  }
},
"overrides": { "models": { "realtime": { "provider": "openai", "model": "gpt-realtime", "modalities": ["text"], "api_key": { "secret": "OPENAI_API_KEY" } } } }
```

  - `mode: continuous` streams the camera into a realtime model. This requires a realtime model, which the override provides (the validator checks). `modalities: ["text"]` means that model only writes text.
  - A realtime model does not react to new frames by itself. So `watch` has the runtime sample a frame every 1.5 s, compare it cheaply with the last one, and only when the picture changed by more than `change_threshold` (and at least 4 s since the last nudge) send `on_change` to make the model look. That is far cheaper than asking the model every few seconds.

### 3.17 `tasks`: sub-conversations *(lines 351-368)*

```json
{
  "id": "verify_customer",
  "kind": "verification",
  "description": "Confirm who the caller is before account details are shared.",
  "instructions": "You are one short step in a call: confirm identity. Check every answer with the matching tool; never judge an answer yourself and never reveal account details or the right answer. Do not discuss anything else.",
  "use_prior_context": true,
  "steps": [
    { "id": "account", "ask": "Ask for the account number.", "skip_if": { "state": "customer", "not_equals": null }, "validate": { "type": "tool", "tool": "lookup_account" } },
    { "id": "surname", "ask": "Ask for the surname on the account.", "validate": { "type": "tool", "tool": "check_surname" } }
  ],
  "max_attempts": 3,
  "inactivity": { "timeout_s": 30 },
  "on_success": { "set_state": { "verified": true }, "resume": "caller", "silent": true },
  "on_failure": { "outcome": "failed", "resume": "caller", "silent": false },
  "on_decline": { "outcome": "declined", "resume": "caller", "silent": false }
}
```

A task is a small, focused conversation with its own prompt that ends in a result.

| Field | Meaning |
|---|---|
| `kind` | `verification`, `collect_fields`, `confirmation` or `custom`. |
| `instructions` | The task's own short prompt. Note it tells the model the *tools* decide correctness, not the model. |
| `use_prior_context` | Give the task the conversation so far. **This matters:** without it the task re-asks things the caller already said ("what's your account number?" right after they gave it). |
| `steps` | What to ask, in order. Each has an `ask` (what the model asks), an optional `skip_if` (skip when the condition holds, here when the account is already known, such as after the caller-ID lookup), and a `validate` (a tool that checks the answer). |
| `max_attempts` | Failed answers allowed before the task fails. |
| `inactivity` | Override of the silence policy while this task runs. 30 s here, because finding an account number takes time. |
| `on_success` | Mark `verified` true, go `resume: caller` (back to the agent that started the task), and stay `silent` so the agent carries on instead of the task chatting. |
| `on_failure`, `on_decline` | Set a result (`failed`, `declined`) and return, speaking (`silent: false`) so the agent can explain. |

The model never decides whether an answer is correct: the validating *tool* does, in code, so a caller cannot talk the model into accepting a wrong answer.

### 3.18 `tools`: what agents can do *(lines 370-539)*

**The anatomy of an `http` tool**, step by step. When the model calls `get_bill_summary`:

```
model calls the tool (with arguments, if it has any)
  1. preconditions   - may it run? (verified must be true; else the model is told why and nothing is called)
  2. request         - build and send the web request (templates filled from args, state, const)
  3. result          - only listed fields reach the model; some go to state; some go out of band
  4. effects         - extra actions after success
  on error: on_error tells the model what happened
```

```json
{
  "id": "get_bill_summary",
  "type": "http",
  "description": "Latest bill: amount, period, whether it is estimated, due date.",
  "connection": "billing_api",
  "request": { "method": "GET", "path": "/v1/accounts/{{state.customer.id}}/bill" },
  "parameters": { "type": "object", "properties": {} },
  "preconditions": [{ "require": { "state": "verified", "equals": true }, "on_fail": { "tool_error": "The caller is not verified yet. Call verify_caller first." } }],
  "result": { "to_llm": ["amount", "period", "estimated", "due_in_days"] },
  "timeout_s": 8,
  "retries": 1,
  "on_error": { "tool_error": "I could not fetch the bill right now. Apologise and offer a callback." }
}
```

| Field | Meaning |
|---|---|
| `id` | Reference name. Also the name the model sees, unless `name` is set. |
| `description` | **What the model reads to decide when to use the tool.** Write it for the model. |
| `connection` | Which connection to call (must be an `http` connection). |
| `request` | `method`, `path` (appended to the connection's base URL), optional `query`, `headers`, `body`. All can contain templates such as `{{state.customer.id}}`. |
| `parameters` | A JSON Schema of the arguments the *model* supplies. Here none. In `lookup_account` it is `account_number`, then used as `{{args.account_number}}`. |
| `preconditions` | Each has a `require` condition and an `on_fail` message. If a condition is false the tool is not called and the model receives the message. This is how "account tools need verification" is enforced in code, not in the prompt. |
| `result.to_llm` | **A whitelist.** Only these response fields are shown to the model; everything else is dropped. |
| `result.to_state` | Store response fields in state, using a JSONPath such as `"$.account"`. |
| `result.out_of_band` | Send certain fields straight to the caller (see `send_payment_link`). |
| `timeout_s`, `retries` | How long to wait; how many times to retry. |
| `on_error.tool_error` | What the model is told if the call fails. |
| `limits.count_attempts_in` | Add one to this state variable each time the tool is called (used by `check_surname` to count verification attempts). |

**`lookup_account` and `check_surname`: writing results into state**

```json
"result": { "to_llm": ["found"], "to_state": { "customer": "$.account" } }
...
"result": { "to_llm": ["match"], "to_state": { "verified": "$.match" } },
"limits": { "count_attempts_in": "verify_attempts" }
```

`lookup_account` tells the model only `found`, but stores the full account in `state.customer` (so later tools can use `{{state.customer.id}}` without the model ever seeing the account details). `check_surname` stores the yes/no into `verified` and counts the attempt.

**`send_payment_link`: a value the model must never see**

```json
"result": {
  "to_llm": ["sent", "sent_by"],
  "out_of_band": { "fields": ["link"], "via": "sms", "template": "Your Acme payment link: {{link}}" }
}
```

The API returns a link. `out_of_band` sends it by SMS using the `sms` connection, built from the template. The model only learns that it was sent. The `secret_firewall` guardrail additionally removes a field called `link` from anything the model sees or says.

**The built-in tools** *(lines 371-404)*:

```json
{ "id": "end_call", "type": "builtin", "builtin": "end_call", "params": { "say": { "message": "goodbye" } } }
```

`end_call` says the goodbye and then hangs up. The goodbye is done by the runtime, not left to the model, because models sometimes forget to say it. The hangup waits for the speech to finish.

```json
{
  "id": "escalate_to_human",
  "type": "builtin",
  "builtin": "transfer_or_callback",
  "description": "Caller asks for a person, or you cannot help.",
  "params": {
    "transfer": "human_support",
    "fallback": [
      { "type": "say", "text": { "message": "callback_line" } },
      { "type": "http", "connection": "platform_db", "method": "POST", "path": "/callbacks", "body": { "call_id": "{{state.call_id}}", "phone": "{{state.caller_phone}}", "intent": "{{state.intent}}" } }
    ]
  }
}
```

`transfer_or_callback` tries the named transfer; if the transfer cannot happen (outside hours, no target, a channel with `human_transfer: false`, or the transfer failed), it runs the `fallback` actions instead: here say the callback line and file a callback request.

```json
{
  "id": "back_to_menu",
  "type": "builtin",
  "builtin": "return_to_entry",
  "description": "This request is finished, or the caller needs something outside your role.",
  "params": { "pending_request_into": "pending_request", "guard_loops": true }
}
```

`return_to_entry` hands the caller back to the greeter. `pending_request_into` adds an argument where the specialist records what the caller still needs, and stores it in `state.pending_request` for the greeter to pick up (the greeter's conditional instruction reads it). `guard_loops: true` refuses to return unless the caller has spoken since the agent's last tool call, which stops the router and a specialist passing the caller back and forth forever.

```json
{ "id": "send_callback_form", "type": "builtin", "builtin": "send_form", "description": "Show the callback form when nobody is available to talk.", "channels": ["web-chat"], "params": { "form": "callback_request" } }
```

`send_form` shows a form in the chat widget. `channels` makes the tool available only on web-chat, because a phone call cannot show a form.

**`verify_caller`: a tool that is really a task**

```json
{ "id": "verify_caller", "type": "task", "task": "verify_customer", "description": "Verify the caller's identity. Required before any account detail." }
```

This is the door into the `verify_customer` task.

**`search_help_center` and `crm_tools`**

```json
{ "id": "search_help_center", "type": "knowledge", "description": "Search the help centre for how-to and policy answers.", "source": "help_center", "top_k": 3 }
{ "id": "crm_tools", "type": "mcp", "description": "Network status and ticketing from the CRM.", "server": "crm_mcp", "allow": ["network_status", "create_ticket", "ticket_status"] }
```

The knowledge tool searches the `help_center` knowledge base and returns the top 3 chunks. The MCP tool exposes only the three listed tools of the `crm_mcp` server. `allow` must list tools explicitly; an empty list is an error so nothing is exposed by accident.

**Two variants of one tool, by channel**

The model must report a hazard differently on a phone call and a chat. Both tools are shown to the model under the same name, `report_hazard`, but each is only offered on its own channel:

```json
{
  "id": "report_hazard",
  "name": "report_hazard",
  "type": "http",
  "channels": ["phone"],
  "description": "Report a dangerous situation (a fallen or sparking cable or cabinet).",
  "connection": "billing_api",
  "request": { "method": "POST", "path": "/v1/tickets", "body": { "category": "safety", "priority": "emergency", "location": "{{args.location}}", "hazard": "{{args.hazard}}", "caller": "{{state.caller_phone}}" } },
  "parameters": {
    "type": "object",
    "properties": { "location": { "type": "string" }, "hazard": { "type": "string", "description": "What the caller sees, in a few words." } },
    "required": ["location", "hazard"]
  },
  "result": { "to_llm": ["id", "sla_hours"], "to_state": { "ticket_id": "$.id" } },
  "effects": [
    {
      "do": [
        { "type": "say", "text": { "message": "hazard_advice" }, "allow_interruptions": false },
        { "type": "notify", "notification": "ticket_sms", "with": { "ticket_id": "{{result.id}}" }, "result_to_state": { "sent_by": "notification_sent_by" } }
      ]
    }
  ]
}
```

On **phone**: file the ticket immediately. Then two effects run: say a fixed safety line (`hazard_advice`, which cannot be skipped by the model), and send an SMS confirmation. `result_to_state` records *which* delivery worked into `notification_sent_by`, which `tech_support`'s conditional instruction then uses ("the confirmation was sent by sms; say so").

```json
{
  "id": "report_hazard_chat",
  "name": "report_hazard",
  "type": "builtin",
  "builtin": "noop",
  "channels": ["web-chat"],
  "description": "Report a dangerous situation (a fallen or sparking cable or cabinet).",
  "parameters": {
    "type": "object",
    "properties": { "location": { "type": "string" }, "hazard": { "type": "string", "description": "What the caller sees, in a few words." } },
    "required": ["location", "hazard"]
  },
  "effects": [
    {
      "do": [
        { "type": "set_state", "values": { "hazard_location": "{{args.location}}", "hazard_description": "{{args.hazard}}" } },
        { "type": "say", "text": { "message": "hazard_ack" }, "allow_interruptions": false },
        { "type": "handoff", "to": "safety_watch" }
      ]
    }
  ]
}
```

On **chat**: this tool calls no API at all (`noop` = "does nothing itself; only its effects run"). It remembers the location and description in state, says a fixed line, and hands off to `safety_watch`, which will file the ticket at the end with what it actually saw.

How `name` works: `id` is the tool's identity in the config; `name` is what the model sees. Two tools may share a `name` only if their `channels` never overlap. The validator reports an error otherwise. (The prompt-size lint counts what the model sees, so the two variants count once.)

**`conclude_watch`: effects with conditions**

```json
"effects": [
  { "do": [{ "type": "notify", "notification": "ticket_sms", "with": { "ticket_id": "{{result.id}}" }, "result_to_state": { "sent_by": "notification_sent_by" } }] },
  { "when": { "arg": "assessment", "equals": "worsened" }, "do": [{ "type": "say", "text": { "message": "move_away" }, "allow_interruptions": false }, { "type": "end_call" }] }
]
```

Effects run in order. The first has no `when`, so it always runs (send the SMS). The second runs only when the model called the tool with `assessment: worsened`: say the "move away right now" line, then hang up. "Say a fixed line, then hang up for the caller's safety" is therefore config, not custom code.

### 3.19 `connections` *(lines 541-579)*

```json
"billing_api": {
  "type": "http",
  "base_url": "https://api.acme.example",
  "auth": { "type": "bearer", "token": { "secret": "BILLING_API_TOKEN" } },
  "timeout_s": 8
},
"sms": {
  "type": "notifier",
  "kind": "sms",
  "provider": "twilio",
  "from": "+15555550123",
  "auth": { "account_sid": { "secret": "TWILIO_ACCOUNT_SID" }, "auth_token": { "secret": "TWILIO_AUTH_TOKEN" } }
}
```

| Type | Meaning | In the example |
|---|---|---|
| `http` | A web API: `base_url`, `auth`, optional `headers`, `timeout_s`. | `billing_api`, `rag_service`, `platform_db` |
| `mcp` | An MCP server: `transport`, `url`, `auth`. | `crm_mcp` |
| `notifier` | A way to send SMS or email: `kind`, `provider`, `from`, and `auth` as secret references. | `sms` (Twilio), `email` (SendGrid) |

Authentication is one of `none`, `bearer` (a token), `api_key` (a header name plus a key), `basic` (username and password). Every credential is a `{ "secret": ... }` reference.

### 3.20 `knowledge` *(lines 581-603)*

```json
{
  "id": "help_center",
  "type": "vector_store",
  "mode": "tool",
  "top_k": 3,
  "sources": [
    { "type": "url", "url": "https://help.acme.example", "crawl_depth": 2 },
    { "type": "file", "file_id": "tariff-guide.pdf" }
  ],
  "embedding": { "provider": "openai", "model": "text-embedding-3-small" },
  "refresh": "daily"
}
```

A `vector_store` is a searchable index built from sources: web pages (crawled `crawl_depth` links deep) and files. `embedding` is the model that turns text into searchable numbers. `refresh` says how often to rebuild it. `top_k` is how many chunks come back per search.

```json
{
  "id": "product_manual",
  "type": "rag_api",
  "mode": "inject",
  "top_k": 6,
  "connection": "rag_service",
  "collection": "device-manuals",
  "request": { "method": "POST", "path": "/v1/search", "body": { "collection": "{{collection}}", "query": "{{query}}", "top_k": "{{top_k}}" } }
}
```

A `rag_api` asks an existing search service instead of building an index. `mode: inject` means the runtime searches on every caller turn and adds the results to the prompt, so no tool call is needed. `{{query}}` is the search text (normally the caller's latest message), `{{top_k}}` and `{{collection}}` come from the fields above.

### 3.21 `forms` *(lines 605-623)*

```json
{
  "id": "callback_request",
  "title": "Request a callback",
  "description": "Leave your details and we'll call you back.",
  "fields": [
    { "name": "name", "label": "Your name", "type": "text", "required": true },
    { "name": "phone", "label": "Phone number", "type": "phone", "required": true },
    { "name": "email", "label": "Email (optional)", "type": "email" },
    { "name": "topic", "label": "What is it about?", "type": "select", "options": ["billing", "technical"], "required": true }
  ],
  "submit_label": "Send",
  "store_in_state": { "name": "contact_name" },
  "on_submit": [
    { "type": "notify", "notification": "callback_team" },
    { "type": "wrapup", "wrapup": "after_callback" }
  ]
}
```

A structured form shown in a chat widget. Field types: `text`, `email`, `phone`, `number`, `textarea`, `select` (must list `options`), `checkbox`. `store_in_state` copies the submitted `name` into the state variable `contact_name`. `on_submit` lists actions run when it is sent; submitted values are available as `{{form.name}}`, `{{form.phone}}` and so on.

### 3.22 `notifications` *(lines 625-647)*

```json
{
  "id": "callback_team",
  "description": "Tell the team who to call back, with the conversation attached.",
  "strategy": "first_success",
  "deliver": [
    {
      "via": "email",
      "to": { "lookup": { "state": "intent", "map": { "billing": ["billing-team@acme.example"], "technical": ["tech-team@acme.example"] }, "default": ["support@acme.example"] } },
      "subject": "Callback request: {{form.topic}}",
      "body": "{{form.name}} ({{form.phone}}) asked for a callback about {{form.topic}}. Call {{state.call_id}}.",
      "attachments": [{ "kind": "transcript", "filename": "conversation.txt", "format": "text" }]
    }
  ],
  "on_failure": [{ "type": "log", "level": "error", "message": "callback notification failed for {{form.phone}}" }]
}
```

| Field | Meaning |
|---|---|
| `strategy` | `first_success` = try the entries in `deliver` in order and stop at the first that works (for example email, then SMS). `all` = send every one. |
| `deliver[].via` | A `notifier` connection (`email` here). |
| `deliver[].to` | The recipient: a template, a list, a secret, or a **lookup**. Here the callback email goes to the billing team if `intent` is `billing`, the tech team if `technical`, else support. |
| `subject`, `body` | Templates. |
| `attachments` | `kind: transcript` attaches the conversation as a file. |
| `on_failure` | Actions if no delivery worked. |

`ticket_sms` is the simple one: a single SMS to the caller using `{{with.ticket_id}}`, a value the `notify` action passes in with `with`.

### 3.23 `wrapups` *(lines 649-655)*

```json
{ "id": "after_callback", "wait_s": 30, "on_silence": [{ "type": "end_call", "say": { "message": "goodbye" } }] }
```

Started by a `wrapup` action (here, when the callback form is submitted). The bot waits 30 seconds for any reply. If nothing comes, it runs `on_silence`: say goodbye and hang up. If the visitor replies, nothing more happens and the conversation continues normally.

### 3.24 `guardrails` *(lines 657-677)*

```json
"input": [
  { "id": "prompt_injection", "type": "prompt_injection", "enforcement": "code", "on_trigger": { "action": "deflect", "say": "I can only help with Acme services." } },
  { "id": "card_numbers", "type": "pii_detect", "entities": ["card_number", "national_id"], "enforcement": "code", "on_trigger": { "action": "redact_in_logs" } }
],
"output": [
  { "id": "no_promises", "type": "statement", "text": "Never promise a refund, compensation or a repair time.", "enforcement": "prompt" },
  { "id": "secret_firewall", "type": "field_firewall", "fields": ["token", "password", "otp", "link"], "enforcement": "code" },
  { "id": "no_internal_ids", "type": "regex_block", "patterns": ["\\bINT-\\d+\\b"], "enforcement": "code", "on_trigger": { "action": "rewrite" } }
],
```

- **`input`** rules look at what the caller says. `prompt_injection` detects attempts to hijack the bot and replies with the `say` line (`deflect`). `pii_detect` spots card and national-ID numbers and hides them from logs.
- **`output`** rules look at what the bot says. `statement` is a plain-language rule the model is told. `field_firewall` strips named fields (`token`, `password`, `otp`, `link`) from anything the model sees or says. `regex_block` matches a pattern (here internal ticket ids `INT-123`) and rewrites it away.
- **`on_trigger.action`**: `deflect`, `redact_in_logs`, `rewrite`, `block` or `end_call`.

```json
"topics": {
  "blocked": ["legal advice", "medical advice", "competitor pricing"],
  "on_off_topic": { "say": "I can only help with Acme services.", "max_strikes": 2, "then": "escalate_to_human" }
},
```

`blocked` lists topics the bot refuses. `on_off_topic` says what to say each time, and after `max_strikes` off-topic turns runs the named tool (`escalate_to_human`). `allowed` is the inverse list.

```json
"escalation": [
  { "id": "asks_for_human", "when": { "intent": "asks_for_human" }, "action": "tool", "tool": "escalate_to_human" },
  { "id": "verify_failed", "when": { "state": "verify_attempts", "gte": 3 }, "action": "tool", "tool": "escalate_to_human" },
  { "id": "abuse", "when": { "sentiment": "abusive", "consecutive_turns": 2 }, "action": "end_call", "say": "I'm ending this call. Please contact us again when you're ready." }
],
```

Rules that act regardless of what the model decides. The `when` here is a *signal* (what the caller is doing: `intent`, `keywords`, `sentiment` with `consecutive_turns`) or a *state test*. This is a different, smaller thing than the general `condition` described earlier. The `action` is `tool`, `end_call` or `handoff`.

```json
"limits": { "max_call_duration_s": 900, "max_silence_s": 600, "max_tool_calls_per_call": 30, "max_handoffs_per_call": 8 }
```

Hard ceilings. `max_silence_s` is a last-resort backstop above the inactivity nudges. The validator warns if it is *lower* than the time nudging needs (here chat needs 120 s x 3 = 360 s, so 600 s is safe; the earlier value of 60 s would have cut chat calls off first).

### 3.25 `events` *(lines 679-709)*

```json
{
  "on": "call_started",
  "do": [
    { "type": "http", "connection": "billing_api", "method": "GET", "path": "/v1/accounts/by-phone", "query": { "phone": "{{state.caller_phone}}" }, "to_state": { "customer": "$.account" } },
    { "type": "http", "connection": "platform_db", "method": "POST", "path": "/calls", "body": { "call_id": "{{state.call_id}}", "channel": "{{channel.id}}", "caller": "{{state.caller_phone}}", "dnis": "{{call.dnis | default('')}}" } }
  ]
}
```

Event names: `call_started`, `call_ended`, `handoff`, `tool_error`, `session_error`, `escalation`, `inactivity`, `transfer_succeeded`, `transfer_failed`. Each can also have a `when` condition.

On `call_started`, two things happen in order. First the bot looks the caller up by phone number and stores the account in `state.customer` (`to_state`), so by the time the bot speaks it may already know who is calling (this is why the verification task can skip its `account` step). Second it registers the call in a platform database.

```json
{
  "on": "call_ended",
  "do": [
    {
      "type": "http",
      "connection": "platform_db",
      "method": "PUT",
      "path": "/calls/{{state.call_id}}",
      "skip_when_empty": "call.transcript",
      "body": {
        "session": "{{state.sip_session_id | or(call.room)}}",
        "disposition": "{{state.disposition}}",
        "started_at": "{{call.started_at | format('%Y-%m-%dT%H:%M:%S', 'Asia/Singapore')}}",
        "duration_s": "{{call.duration_s}}",
        "summary": "{{call.summary}}",
        "transcript": { "$each": "call.transcript", "as": "m", "do": { "direction": "{{m.role | map('user=IN', 'assistant=OUT')}}", "text": "{{m.text | truncate(4000)}}", "seq": "{{m.index}}", "at": "{{m.at | format('%H%M%S', 'Asia/Singapore')}}" } }
      }
    }
  ]
}
```

The most template-heavy block, piece by piece:

- `skip_when_empty: "call.transcript"`: do not send this at all if the call had no speech.
- `session`: `{{ ... | or(call.room) }}` uses the SIP session id, or if there is none, the room name.
- `started_at`: formats a time in the Singapore timezone (a platform that records in a fixed timezone, whatever the bot's own).
- `transcript`: `$each` loops over every message in the transcript. For each message `m` it builds one object: `direction` maps `user` to `IN` and `assistant` to `OUT`, `text` is cut to 4000 characters, `seq` is its position, `at` is its time. Tool calls are not part of the transcript and empty messages are skipped. The result is an array with one row per message.

The last two events just log (`inactivity`, `transfer_failed`).

### 3.26 `post_call`, `observability`, `tests`, `builder` *(lines 711-758)*

**`post_call`**:

| Field | Meaning |
|---|---|
| `summary` | After the call, use a model with `prompt` to summarise it. |
| `analysis` | Questions answered about each call (`resolved`: boolean; `sentiment`: one of three values). An `enum` must list `values`. |
| `recording` | Whether to keep audio and transcript, and for how many days. |
| `artifacts` | Files written when the session ends, whatever the reason: the transcript and a metrics file, each to a directory. (`sink` may also be an HTTP call.) |

**`observability`**:

| Field | Meaning |
|---|---|
| `log_level`, `log_pii` | How much to log; keep personal data out. |
| `log_llm_requests` | Print full model requests and responses. Shows conversation content; keep off in production. |
| `log_file` | A rotating log file (`path`, `max_bytes`, `backup_count`). |
| `metrics`, `tracing` | Switch on/off. |
| `otel` | Export traces and metrics to an OpenTelemetry collector (for example a self-hosted SigNoz). |

**`tests`**: a scripted conversation plus what must be true afterwards:

```json
{
  "id": "billing_happy_path",
  "channel": "phone",
  "caller": { "phone": "+15550001111", "persona": "Calm customer, knows their account number" },
  "turns": [
    { "say": "I want to check my bill." },
    { "say": "The account number is 1 2 3 4 5 6 7 8." },
    { "say": "Smith." }
  ],
  "expect": [
    { "tool_called": "verify_caller" },
    { "tool_called": "get_bill_summary" },
    { "tool_not_called": "escalate_to_human" },
    { "state_equals": { "state": "verified", "value": true } },
    { "said_matches": "\\bdollars\\b" },
    { "judge": "States the bill amount and due date without reading digits one by one." }
  ]
}
```

`turns` are what the simulated caller says. `expect` items are checks: a tool was or was not called, a state variable ended with a value, some bot message matches a regex, or a model-graded `judge` criterion. A UI can run these as a "Test" tab.

**`builder`**: settings for the builder UI only, ignored by the runtime. `lint` sets the prompt-size warnings (`max_prompt_words_per_agent`, `max_tools_per_agent`). `ui.graph_positions` remembers where each agent box sits on the flow diagram.

### 3.27 Putting a form, a message or a notification wherever you want

A form (`forms[]`) and a notification (`notifications[]`) are standalone definitions. They do nothing until an **action** points at them, and an action can sit in many places. Callback-after-hours is only one use. The same `send_form` / `notify` / `say` actions work in all of these:

| Where | When it runs |
|---|---|
| A tool's `effects` (with a `when`) | After that tool succeeded and the condition holds ("the bill is disputed" -> show the dispute form) |
| An agent's `on_enter` *(new)* | Every time that agent takes over ("billing starts by asking for the account number") |
| An `events` hook | Call start or end, a handoff, a tool error, a transfer result, inactivity, or a **state change** *(new)* |
| A transfer's `closed`, `before`, `on_success`, `on_failure` | Business hours, around the transfer |
| A form's `on_submit`, a notification's `on_failure`, a wrap-up's `on_silence`, inactivity's `on_exhausted` | Chained steps |
| The `send_form` tool *(model decides)* | Only if you give an agent that tool and the model chooses to call it |

**Who decides, you or the model.** Each step is one of four things: `say` (fixed text, yours), `generate` (the model writes it from your instructions), `send_form` (a form you defined), `notify` (a message you defined). The model only decides *when* if you hand it a tool. Put anything that captures data or carries compliance weight in an action you place yourself; leave to the model what is a judgement call.

**What is new in this section** (all optional, existing configs are unaffected):

```json
// 1. An agent that does something scripted when it takes over. If it has on_enter the model stays
//    quiet afterwards unless `opening` is also set.
{ "id": "billing", "on_enter": [ { "type": "say", "text": "Welcome to billing." }, { "type": "send_form", "form": "account_lookup" } ] }

// 2. A hook can test the event that is running it. "event" reads: handoff {from, to},
//    tool_error {tool, error}, state_changed {variable, previous, value}, transfer_* {transfer, target, reason}
{ "on": "handoff", "when": { "event": "to", "equals": "billing" }, "do": [ { "type": "set_state", "values": { "dept": "billing" } } ] }

// 3. Reacting to state: show a form as soon as intent becomes "complaint" and we know no contact details.
{ "on": "state_changed",
  "when": { "all": [ { "event": "variable", "equals": "intent" }, { "state": "intent", "equals": "complaint" }, { "state": "contact_name", "equals": null } ] },
  "do": [ { "type": "send_form", "form": "contact" } ] }

// 4. A tool whose effects already said or showed everything: the model adds nothing after it.
{ "id": "maybe_form", "type": "builtin", "builtin": "noop", "reply": "none", "effects": [ ... ] }

// 5. Channels without a screen. A phone call cannot show a form: say what to do instead.
{ "channels": [ { "id": "phone", "capabilities": { "forms": false } } ],
  "forms":    [ { "id": "contact", "otherwise": [ { "type": "say", "text": "Please tell me your name and number." } ] } ] }
```

`state_changed` runs once per variable that changed, and a hook that itself changes state can set off more hooks, up to a limit of 20 in a row. A notification's `deliver[].content_type` can be `html` for an email.

Two rules protect you: **text a visitor types into a form (or an API returns) is data, never a template**, so `{{...}}` in it is shown as typed; and the runtime **validates every submitted form itself**, so a browser cannot skip a required field.

---

## 4. One call, start to finish

A caller dials from +1 555 000 1111 and says "I want to check my bill". Following the example:

1. **Routing.** The call's dispatch metadata names the bot and version (`{"bot": "acme-support", "ref": "production"}`); the worker loads that config. The caller is a SIP participant, so the `phone` channel matches.
2. **Identity and state.** `identity` reads `sip.phoneNumber` and normalises it. State is created: `caller_phone` is filled in, `call_id` is generated, `verified` starts false, `disposition` starts `disconnected`.
3. **`call_started` event.** The bot looks the number up in the billing system. If an account matches, `state.customer` is set. The call is registered in the platform database.
4. **Greeting.** The `phone` channel speaks the `greeting` message (in the caller's language if available), and the caller cannot interrupt it.
5. **Greeter.** The caller's request goes to the `greeter` agent. Its prompt is the persona rules, the voice-call note from `phone`, and its own role. The model calls `go_to_billing`. The handoff records `intent = billing` and passes the conversation to `billing`.
6. **Billing.** `verified` is false, so the conditional instruction is added: call `verify_caller`.
7. **Verification task.** The `verify_caller` tool starts `verify_customer` with the conversation so far. If step 1 found an account, the `account` step is skipped; otherwise it asks for the account number and `lookup_account` checks it. It then asks for the surname and `check_surname` checks it, counting the attempt in `verify_attempts`. On success, `verified` becomes true and control returns to `billing` silently.
8. **Bill.** `get_bill_summary` runs. Its precondition (`verified` is true) passes, the API is called, and only `amount`, `period`, `estimated` and `due_in_days` reach the model. The speech rules make any amount sound natural.
9. **A pause.** The caller goes quiet. After 12 seconds of silence (and no tool running), nudge 1 plays; after another 12, nudge 2; after another 12, the goodbye plays in full and the call ends. If the caller speaks first, the count resets. (During the verification task, the wait is 30 seconds instead.)
10. **Wants a person.** Suppose the caller says "let me talk to someone". The model calls `escalate_to_human` (or the `asks_for_human` guardrail does). The `human_support` transfer checks `support_hours`:
    - Open: register the call, wait 1 s, send a SIP transfer to the queue chosen by `intent` (the billing queue). On success `disposition` becomes `transferred`.
    - Closed: say `outside_hours`, then run the tool's `fallback` (say the callback line, file a callback request).
11. **End of call.** `call_ended` fires: the transcript rows are posted to the platform database, with the disposition. The transcript and metrics files are saved, the summary and analysis are produced, and the room is deleted so the line drops.

---

## 5. Reading the schema file itself

`agent-config.schema.json` is about 1,800 lines, so a full line-by-line is not useful. What helps is knowing its layout and its handful of keywords.

**Layout.** There are two halves:

- `properties`: one entry per top-level section (`meta`, `runtime`, `constants`, ...). `required` at the top lists the sections that must exist: `schema_version`, `meta`, `runtime`, `defaults`, `persona`, `channels`, `agents`.
- `$defs`: reusable pieces (an `action`, a `condition`, a `tool`, a `transfer`, ...). A property says `{ "$ref": "#/$defs/action" }` to mean "use that definition here".

**The keywords:**

| Keyword | Meaning |
|---|---|
| `type` | The kind of value: `object`, `array`, `string`, `integer`, `number`, `boolean`, `null`. |
| `required` | Fields that must be present. |
| `properties` | The fields an object may have. |
| `additionalProperties: false` | No other fields allowed. This is why a typo is an error instead of being silently ignored. |
| `enum` | The value must be one of a fixed list. |
| `const` | The value must be exactly this. Used as a **discriminator**: every action and tool has a `type` fixed to one value. |
| `oneOf` | Exactly one of several shapes must match. This is how "a tool is `builtin` or `http` or `mcp` ..." is written. |
| `if` / `then` | A conditional requirement. "If `method` is `sip_refer`, then `target` is required." |
| `pattern`, `minLength`, `minimum`, `format` | Limits on strings and numbers. |
| `unevaluatedProperties: false` | Like `additionalProperties`, but it understands fields contributed by shared definitions. |
| `$ref` | Reuse another definition. |
| `description`, `default`, `examples` | Documentation. The validator ignores them; a UI shows them as help text. |
| **`x-ref`** (custom) | "This string must be the id of something declared elsewhere." The value names the collection: `agents`, `tools`, `tasks`, `messages`, `state_vars`, `http_connections`, `notifiers`, ... A UI renders a dropdown of those ids; the validator rejects ids that do not exist or are the wrong kind. |
| **`x-ui`** (custom) | A hint for form builders, for example `"widget": "textarea"` or `"secret-picker"`. |

**A worked example.** Here is the schema text for an agent's `handoffs`, which you have already seen in the example:

```json
"handoffs": {
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "tool", "description", "to"],
    "additionalProperties": false,
    "properties": {
      "id": { "$ref": "#/$defs/id" },
      "tool": { "$ref": "#/$defs/toolName" },
      "description": { "type": "string", "minLength": 1, "description": "Tells the LLM when to take this handoff." },
      "to": { "type": "string", "x-ref": "agents" },
      "carry_context": { "type": "boolean", "default": true },
      "set_state": { "type": "object", "propertyNames": { "x-ref": "state_vars" }, "description": "State recorded when this handoff is taken, e.g. the caller's intent for later routing." },
      "announce": { "oneOf": [{ "$ref": "#/$defs/speech" }, { "type": "null" }], "description": "Spoken while the handoff happens (covers a slow start)." }
    }
  }
}
```

Line by line:

- `"type": "array"`: `handoffs` is a list.
- `"items": { "type": "object", ... }`: each entry in the list is an object.
- `"required": [...]`: every handoff must have `id`, `tool`, `description` and `to`. Leave one out and validation fails.
- `"additionalProperties": false`: a handoff may have no other fields. `"carry_contxt": true` (a typo) is rejected.
- `"id": { "$ref": "#/$defs/id" }`: the id must follow the shared `id` rule, which is defined once under `$defs`:

```json
"id": {
  "type": "string",
  "pattern": "^[a-z][a-z0-9_-]{0,63}$",
  "description": "Lowercase identifier, used for cross-references."
}
```

  That regular expression means: start with a lowercase letter, then up to 63 more lowercase letters, digits, `_` or `-`.
- `"tool": { "$ref": "#/$defs/toolName" }`: the name the model sees, in snake_case (so `go_to_billing`, not `go-to-billing`).
- `"description": { ... "minLength": 1 }`: it must not be empty, because the model needs it to know when to hand off.
- `"to": { "type": "string", "x-ref": "agents" }`: a string that must be one of the declared agent ids. A UI offers the agents as a dropdown; the validator reports `'nobody' is not a declared agents id (declared: billing, greeter, ...)`.
- `"carry_context": { "type": "boolean", "default": true }`: true or false; true if omitted.
- `"set_state": { "type": "object", "propertyNames": { "x-ref": "state_vars" } }`: an object whose **keys** must each be a declared state variable.
- `"announce": { "oneOf": [ speech, null ] }`: either a speech value (literal text or a `{ "message": id }`) or `null`. `oneOf` means exactly one must match; text and null never overlap, so it is unambiguous.

---

## 6. Validation

`validate_config.py` runs three layers:

1. **JSON Schema.** Structure, types, allowed values, "if X then Y is required".
2. **`x-ref` checks.** Every id that points at something must point at something that exists, of the right kind. The error names what exists:
   `agents.items[0].handoffs[0].to: 'nobody' is not a declared agents id (declared: billing, greeter, safety_watch, tech_support)`.
3. **Rules that need code**, which a schema cannot express:

| Rule | Severity |
|---|---|
| Duplicate ids; two tools sharing a model-visible name on overlapping channels; a handoff name clashing with a tool name | error |
| A voice channel with no text-to-speech or speech-to-text | error |
| An image or video channel on a model without `vision` | error |
| An agent with tools on a model with `tool_calling: false` | error |
| `vision.mode: continuous` without a realtime model; `vision.watch` without `continuous` | error |
| `{{state.x}}`, `{{const.x}}` or `{{args.x}}` that refers to something undeclared | error |
| A message missing the primary language | error |
| A schedule window ending before it starts; an impossible date; an unknown timezone | error |
| Inactivity with no `timeout_s`, or `max_nudges` but no nudges | error |
| A knowledge base attached the wrong way for its mode | error |
| A message, tool, task, connection, transfer, notification, form, wrap-up or schedule that nothing uses; a knowledge base no agent or tool reaches | warning |
| An agent nothing hands off to | warning |
| A message missing a language the bot `speaks` | warning |
| `max_silence_s` lower than the nudges need | warning |
| A transfer with a schedule but nothing for `closed`; a transfer tool with no `fallback` | warning |
| An agent over the prompt-size or tool-count limit | warning |

Errors block publishing; warnings do not. The command exits with status 1 when there is an error, so it can run in a build step.

Your backend can use the same logic directly:

```python
from validate_config import validate_config
errors, warnings = validate_config(config, schema)
```

---

## 7. Quick reference

| Section | One-line meaning | Required? |
|---|---|---|
| `schema_version` | Which rulebook version | yes |
| `meta` | Identity and version of the bot | yes |
| `runtime` | How the worker runs it | yes |
| `constants` | Fixed values, `{{const.x}}` | no |
| `schedules` | Business hours | no |
| `identity` | How to find the caller's number | no |
| `telephony` | PBX details and transfers | no |
| `defaults` | Models, conversation behaviour, reliability, language | yes |
| `persona` | Name, tone, rules shared by every agent | yes |
| `messages` | Fixed lines the bot says | no |
| `state` | Per-call variables | no |
| `channels` | Phone, chat and so on | yes |
| `agents` | Who can talk, and the handoffs between them | yes |
| `tasks` | Sub-conversations that return a result | no |
| `tools` | Things agents can do | no |
| `connections` | How to reach other systems | no |
| `knowledge` | Searchable information | no |
| `forms` | Structured input in chat | no |
| `notifications` | Messages sent outside the conversation | no |
| `wrapups` | Close-if-no-reply timers | no |
| `guardrails` | Limits that always apply | no |
| `events` | Actions at call start, end and so on | no |
| `post_call` | Summary, analysis, saved files | no |
| `observability` | Logs, metrics, tracing | no |
| `tests` | Scripted conversations and checks | no |
| `builder` | UI-only settings | no |

---

## 8. What is not built, and what is still ambiguous

**A runtime now exists** (`agent_runtime/`, see its README). The parts of this config it does **not** run yet are listed, for any given config, by `unsupported_features()`; today that is: tasks, knowledge, MCP and code tools, DTMF, the code-enforced guardrails, post-call summary and analysis, sounds, pronunciation rules, noise cancellation, vision, the session-error sound and the continuous-watch frame sampling. The validator checks a config; the runtime runs it.

**Behaviours the schema leaves open** (the runtime has decided most; the schema should be tightened to match):

- **Order of `closed` versus `fallback`. Decided:** when a transfer is closed by its schedule, `closed` runs and the tool's `fallback` does **not** (they normally say the same thing, so running both said it twice). If `closed` is empty, `fallback` runs instead. A transfer that fails for another reason runs `on_failure` and then `fallback`.
- **When the recording notice is spoken. Decided:** once, appended to the first greeting, on channels that output audio.
- **Which language a message is spoken in** when a caller's language is not in the message. The guide assumes it falls back to the primary language.
- **How a prompt is assembled** from persona, channel note, role, rules and conditional lines. The order given in section 3.16 is the intended one but is not in the schema.
- **A pre-recorded sound after a session error.** Whether a sound can still be played as the session closes has not been confirmed against the underlying SDK. Speech definitely cannot.
- **Provider and model names** are free text with examples, not fixed lists. A UI dropdown needs a separate catalogue of providers.
- **The example uses placeholder values** (the voice id, phone numbers, URLs, secret names). They are not real.

If something in this guide and the validator disagree, the validator and the schema are the authority. Please report the difference so the guide can be corrected.
