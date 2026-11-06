# Tetherfi Unbound, use case 1: AI onboarding with video

The customer is comparing banks for a large inheritance. The AI shares offers and onboards the customer in about 2 minutes: a form, a photo of the card, and a video check holding the card. Then one of two things happens:

- **Everything verified:** Aria finishes the account herself. The customer chooses the account and signs, the account opens, and the case goes to Tetherfi Quest Desk (TQD), which e-mails the next steps. No person is needed.
- **Any check fails** (names, details, face, deepfake, a different card, an unreadable photo or video): Aria hands over to a human video banking agent through MX. When the agent finishes, a second AI agent opens the TQD case.

The full design (the agents, the hand-overs, what each agent may say, every failure path, data and privacy) is in the doc [Tetherfi Unbound: Use case 1 design](https://claude.ai/artifact/3p93EPY9MbLmXsge3ksAhM). This page covers the files here and how to run them.

**Status (2026-11-05):**

- Both bots are on the real Agent Builder server as **drafts**: valid, with no warnings and nothing unsupported. They are not published yet.
- The end-to-end test passes on the real server for any card: 16 of 16 checks for a verified customer (finished by the AI), and 19 of 19 for each path that goes to a person.
- On web voice, the call record shows every line said in full and in order.

## Like a real account opening

- **The deposit amount reaches the bank.** SGD 500 million starts enhanced due diligence.
- **The Advisor says up front that proof of the inheritance is needed**, and that it can follow after the account is opened.
- **The form asks what a bank's form asks:** name, date of birth, nationality, ID number, e-mail, mobile, address, occupation, source of funds, tax residency, politically exposed person and consent. That's 13 fields.
- **Names typed the other way round are recognised in code**, and the customer hears exactly what the card says.
- **A failed face match, a suspected deepfake, or a different card on video** goes to a person with a neutral line (reason `identity_review`).
- **A busy video desk books a real call-back** and gives its reference.
- **The customer leaves with clear next steps:** their relationship manager calls within one working day; have the grant of probate ready; the login and card arrive by post. The TQD e-mail lists the same steps.

## The flow, and who does each part

| #   | Step                                                                                                                                 | Done by                                               | Where in the config                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Hello, this is Aria from Unbound Bank."                                                                                             | Bot 1, `advisor`                                      | channel `greeting`                                                                                                                                        |
| 2   | Customer: inherited about 500 million, comparing banks for safety and value                                                          |                                                       |                                                                                                                                                           |
| 3   | Best-fitting offer, one alternative, the honest safety point, the proof needed, then "open it now in about 2 minutes?"               | Bot 1, `advisor` (the model)                          | tool `deposit_offers` → `GET /unbound/offers`; its `effects` keep the amount                                                                              |
| 4   | "Oh really, OK, let's see" → hand-over to `onboarding`                                                                               | Bot 1                                                 | `handoffs` `go_to_onboarding`                                                                                                                             |
| 5   | The application form opens on the screen                                                                                             | Bot 1, `onboarding`                                   | `on_enter` → `send_form application`                                                                                                                      |
| 6   | Application saved with the amount; the bank sets the risk level and the proof needed                                                 | code                                                  | form `on_submit` → `POST /unbound/applications`                                                                                                           |
| 7   | Photo of the ID card: quality gate, then read by a vision model (OCR)                                                                | code + `gpt-4.1`                                      | `request_image upload`, `analyze_image`                                                                                                                   |
| 8   | Video check: the customer holds the same card next to their face                                                                     | code + `gpt-4.1`                                      | `request_image camera`, `analyze_image`                                                                                                                   |
| 9   | Face match, liveness, deepfake                                                                                                       | **stand-in** provider                                 | `POST /unbound/verify/face`                                                                                                                               |
| 10  | Form against card: names, whether they are just the other way round, ID number, date of birth, the same card on video                | code (`compare_values`)                               | four comparisons; the name order is found here                                                                                                            |
| 11  | Pictures forgotten                                                                                                                   | code                                                  | `discard_image`                                                                                                                                           |
| 12  | "Your face matches… One thing: your card shows the surname TAN and given names WEI MING, but the form has them the other way round…" | code                                                  | `say` with `when`; the reason (`identity_review`, `name_order`, `name_mismatch`, `details_mismatch`, `ready_for_plan`, `check_incomplete`) by `set_state` |
| 13  | Hand-over to the human video banking agent, with the reason, the risk level, the proof needed and every check                        | Tetherfi MX (**mock bridge**)                         | `telephony.transfers` `video_banking_desk` (`http_request` → `POST /mx/handovers`); if it fails, a call-back is booked (`POST /unbound/callbacks`)        |
| 14  | Human agent: confirms the name on video, co-browses the plans, fills and signs with the customer                                     | Tetherfi MX agent desktop (outside the Agent Builder) | the demo's desktop; the test completes it with `POST /mx/handovers/{id}/complete`                                                                         |
| 15  | MX hands the customer back to the next AI agent                                                                                      | Tetherfi MX (**mock bridge**)                         | Bot 2 `on_enter` → `GET /mx/handbacks/latest`                                                                                                             |
| 16  | "Welcome back, Wei Ming. Your Private Wealth Account is open, account number ending 0528."                                           | Bot 2, `case_desk`                                    | `on_enter` `say`                                                                                                                                          |
| 17  | Case opened in TQD; TQD e-mails the customer                                                                                         | TQD (**mock**)                                        | `POST /tqd/cases`; the e-mail is in `GET /tqd/outbox`                                                                                                     |
| 18  | Next steps: relationship manager, proof of the inheritance, login and card; questions; goodbye                                       | Bot 2                                                 | `on_enter` `say` lines; then the model and `end_call`                                                                                                     |

## Verified, or passed to a person

| After the checks                       | What happens                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything verified (`ready_for_plan`) | "Everything matches, and your identity is verified." Then the form **Choose your account and sign** opens: the account (Private Wealth, Inheritance Holding or Laddered Fixed Deposits) and the e-signature. The account opens (`POST /unbound/accounts`), then the TQD case and e-mail. Aria gives the next steps (relationship manager, proof of the funds, login and card). No transfer. |
| Any failure                            | The specific line, then the transfer to the video banking desk through MX with the reason (`name_order`, `name_mismatch`, `details_mismatch`, `name_unreadable`, `identity_review`, `check_incomplete`, `video_incomplete`). Then the case desk bot after the human agent, as before.                                                                                                       |
| The account can't be opened            | "I couldn't open the account just now, so a video banking colleague will finish it with you." Then the transfer, reason `account_not_opened`.                                                                                                                                                                                                                                               |

**The camera, as the customer sees it** (the studio's Test panel; a widget follows the same protocol):

1. **Get ready.** After "Turn on camera", a large view opens over the page with a private preview and a 5-second countdown. The camera is shared with the agent only when the countdown ends, or when the customer presses "Share now". The agent takes its frames as soon as the camera is shared, so this gives the customer time to get their face and the card in view.
2. **Automatic.** The agent takes the sharpest frame and checks it: the whole face in view, the card beside it, readable.
3. **Take a picture.** If the face and the card weren't recognised, or no frame came, Aria says why and asks for a picture. The customer presses **Take a picture**, gets everything in view, and presses the shutter; the still is sent as the photo.
4. **A colleague.** If that picture fails too, a video banking colleague finishes the video check (`video_incomplete`).

No outlines are drawn over the camera. Every photo request also offers **Take a picture** next to "Choose a photo".

**Time to fill the form.** The agent waits 2.5 minutes of silence before its first nudge, 7.5 minutes in all before it ends the conversation. The form says "you have up to 7" minutes, and the studio's form shows a **Time to finish** countdown worked out from the agent's own silence rule.

## The two bots

**`unbound-onboarding`: "Unbound Bank onboarding"** ([onboarding.config.json](onboarding.config.json))

- **Channels:** `web-voice` (speech plus typing, photo and camera) and `web-chat` (typing, photo and camera). There is no phone channel, because a phone line can't carry pictures or forms (see Limits).
- **Agents:**
  - `advisor`: entry. It has the `deposit_offers` tool and hands over to `onboarding`.
  - `onboarding`: the flow runs by itself from its `on_enter` and the form's `on_submit`. The model only answers short questions in between, including why each form question is asked.
- **Pictures:**
  - Photo gate: sharpness 8. Camera gate: sharpness 25, the guide's numbers for camera noise.
  - Both pictures are read by `gpt-4.1`, while the conversation uses `gpt-4.1-mini` with vision.
  - Card text is treated as data, never as instructions.
- **Privacy:**
  - `id_number`, `card_id_number` and `cam_id_number` are marked `sensitive`.
  - The redaction covers national IDs, birth dates, card numbers and bank accounts.
  - Pictures are discarded after the checks. The call record holds no ID number and no picture (checked).
- **Connections:** `onboarding_service`, `verification_provider` and `mx_bridge`. All three point at the mock today, so in a real build you change only their base URLs.

**`unbound-case-desk`: "Unbound Bank case desk"** ([case-desk.config.json](case-desk.config.json))

- One agent, `case_desk`, on `web-voice` and `web-chat`.
- Its `on_enter`:
  - reads the hand-back from MX;
  - says the plan and the last four digits of the account;
  - opens the TQD case;
  - says the reference and the e-mail address;
  - gives the next steps.
- Connections: `mx_bridge` and `quest_desk`.

## Stand-ins (all at https://weave-mock-api.vercel.app, code in [mock-api/src/unbound.mjs](../../../mock-api/src/unbound.mjs))

| Route                                                   | Stands in for                                            | Notes                                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /unbound/offers?amount=&currency=`                 | the bank's product catalogue                             | Demo figures: Private Wealth 3.10%, Inheritance Holding 2.25%, laddered deposits 2.80–3.10%; from SGD 5 million it adds the proof-of-funds requirement       |
| `POST /unbound/applications`                            | the onboarding and risk systems                          | Keeps only the last 4 characters of the ID number; enhanced due diligence from SGD 5 million or for a politically exposed person; the proof needed by source |
| `POST /unbound/callbacks`                               | the call-back campaign                                   | A CB- reference, within 2 working hours                                                                                                                      |
| `POST /unbound/verify/face`                             | a verification provider (face match, liveness, deepfake) | **No picture is sent.** It answers "passed". An e-mail with `+deepfake` or `+nomatch` before the `@` (or `simulate`) makes it fail                           |
| `POST /mx/handovers`, `GET /mx/handovers?status=queued` | the Tetherfi MX routing bridge and the agent queue       | The reason, the risk level, the proof needed, the differences and the checks                                                                                 |
| `POST /mx/handovers/{id}/complete`                      | the human agent's desktop                                | `plan_id`, `signed: true`, and the names as confirmed (`first_name`, `last_name`)                                                                            |
| `GET /mx/handbacks/latest`                              | MX passing context to the next AI agent                  | Adds the relationship manager (demo names); `source: "mx"`, or `"demo_default"` when no hand-over is found (see Limits)                                      |
| `POST /tqd/cases`, `GET /tqd/outbox`                    | Tetherfi Quest Desk and its e-mail                       | Nothing is really e-mailed; the outbox shows the welcome e-mail with numbered next steps                                                                     |

## Stage script (what the test does)

1. Say or type: "Hi. I recently inherited about 500 million and I want to open an account to manage this sum separately. I am exploring the local banks to see who gives me good safety and value."
2. After the offers: "Oh really, only 2 minutes? OK, let's see how this goes."
3. Fill the form with the names **in the wrong order on purpose**:
   - first name **Tan**, last name **Wei Ming**;
   - date of birth 14/03/1985, Singaporean, ID card number S8512345D;
   - weiming.tan@example.com, +65 9123 4567;
   - 12 Example Garden Road, #08-12, Singapore 000123; Architect;
   - money from Inheritance; tax residence Singapore; politically exposed person: No;
   - tick the consent box.
4. Upload `test-pictures/id-card.png`, a SPECIMEN card (surname TAN, given names WEI MING).
5. Turn on the camera and hold the card next to your face. In the test, Chrome plays `test-pictures/camera.mjpeg`.
6. The agent says the face check passed and that the card has the names the other way round, then hands over. In the MX queue, the human agent completes the hand-over: plan `private_wealth`, signed, names confirmed as Wei Ming / Tan.
7. Open the case desk. It welcomes Wei Ming back, opens the TQD case, says where the e-mail went, and gives the next steps.

To show the identity-review path instead, type the e-mail as `weiming.tan+deepfake@example.com`.

## What card photo and video are accepted

A card is accepted when it shows a **name and a number** that can be read completely and reliably. It can be an ID card or a bank (debit or credit) card, including a card image from a banking app. The rules follow how identity-check apps judge a capture: what matters is the details, not perfect framing.

| Check                    | Done by                  | Accepted                                                                                                                     | Refused (what the customer hears, then one retake)                                                             |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Size, sharpness, light   | code, before any model   | at least 300 px on the shorter side (an app card image is about 506 × 319); sharpness at least 8; brightness 40–235          | the reason on screen (too small, too blurry, too dark)                                                         |
| Name and number          | `gpt-4.1` reads the card | both printed and read in full; placeholders such as "Card Holder Name" don't count                                           | "I can't see a name and a card number on that card…"                                                           |
| Details inside the photo | `gpt-4.1`                | a cut edge, corner, logo or label; what decides is that the name and the number are complete (none cut at the edge)          | "Part of the card's details is cut off at the edge…"                                                           |
| Closeness                | `gpt-4.1`                | a card that doesn't fill the photo, when its details are clearly readable                                                    | "The card is too far away to read…"                                                                            |
| Sharp text               | `gpt-4.1`                | every character of the name and number readable                                                                              | "The writing on the card isn't sharp…"                                                                         |
| Glare                    | `gpt-4.1`                | glare away from the details                                                                                                  | "Glare is covering some of the card's details…"                                                                |
| Tilt                     | `gpt-4.1`                | a little tilt                                                                                                                | "The card is at too steep an angle to read…"                                                                   |
| Video                    | code, then `gpt-4.1`     | sharpness at least 25, 480 px; the whole face in view; the card beside it, not hiding the face; its name and number readable | "I can't see your whole face…", "The card is covering part of your face…", "The card is too far away to read…" |

What decides is what was read. When the name and the number were read in full, a cut edge, the distance or a tilt doesn't matter, since the details were evidently readable; blur or glare over them still sends the customer back, because they make a reading unreliable. When they weren't read, the customer hears the most specific reason. The same card on video is matched by the last four digits of its number, as video checks do.

After a second failed photo, or a failed automatic video and a failed picture taken by the customer, a video banking colleague takes over: reason `check_incomplete` for the photo, `video_incomplete` for the video. A photo of a screen or a photocopy is noted for the colleague, not refused. Nothing in the bots is tied to one card: they compare whatever the card shows with whatever the customer types.

## Run it again

From the project folder:

```bash
CREDENTIALS_FILE=e2e/credentials.txt npx vite --port 5181 --strictPort   # the studio in real mode
node demos/unbound/use-case-1/scripts/make-test-pictures.mjs             # the card photo and the camera video
node demos/unbound/use-case-1/scripts/run-e2e.mjs chat                   # or: voice
UB_FAILURE=deepfake node demos/unbound/use-case-1/scripts/run-e2e.mjs chat   # the identity-review path
```

**Any card.** Give the image and the name the customer types; the test makes the card's photo and camera video itself, and checks whatever the card produces (accepted or refused, the line Aria says, the hand-over reason, the name the case desk uses) for agreement, then runs on to the case desk and TQD every time:

```bash
UB_CARD=path/to/any-card.jpg UB_FIRST_NAME="Wei Ming" UB_LAST_NAME=Tan node demos/unbound/use-case-1/scripts/run-e2e.mjs chat
```

- `UB_FIRST_NAME`, `UB_LAST_NAME`: what the customer types (type the card's name to see "Everything matches"). Optional: `UB_ID_NUMBER`, `UB_DOB` for an ID card.
- `UB_PICTURES=bank` uses the drawn fictional bank card (`make-test-pictures.mjs bank` makes it).
- `UB_FAILURE=deepfake` or `nomatch` makes the stand-in face check fail.

Tested on 2026-11-05, all ending at the case desk and TQD:

| Card                                                   | Customer typed                | Outcome                                                                |
| ------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| A banking app's card image with "Card Holder Name"     | Ravi Kumar                    | refused (no name), retake, colleague (`check_incomplete`)              |
| A named bank card                                      | its own name                  | accepted, "Everything matches" (`ready_for_plan`)                      |
| The same card with an edge cut, name and number intact | its own name                  | accepted, "Everything matches"                                         |
| The same card                                          | a different name              | accepted, "the name in the form doesn't match" (`name_mismatch`)       |
| The same card with its number and name cut             | its own name                  | refused: "Part of the card's details is cut off…" (`check_incomplete`) |
| The specimen ID card                                   | the names the other way round | accepted, "the other way round" (`name_order`)                         |
| The specimen ID card, face check failing               | its own name                  | neutral identity line (`identity_review`)                              |

- Screenshots go to `shots/`.
- On voice, the Test panel shows only the latest caption, so read the full conversation on the agent's Monitor › Calls page.
- To change a bot, edit its JSON here and save it as the draft (Build › JSON in the studio, or `PUT /bots/{id}/draft`).

## The workspace

Workspaces are kept in each browser; the server has none. To see both bots together in your studio:

1. Open the workspace menu (top left) and choose **Create workspace**. Name it **Tetherfi Unbound**.
2. Switch back to your current workspace.
3. On **Agents**, open each bot's **Actions** menu, choose **Move to workspace…**, then **Tetherfi Unbound**.

This was checked in a test browser.

## Limits, and what a real build changes

- **Face match and deepfake are a stand-in.** A real build sends the pictures to a verification provider. A language model reading a photo can't tell a real card from a copy.
- **The case desk is a separate bot.** The runtime doesn't say whether a bot stays in the room after an `http_request` transfer, so the hand-back is a second bot that reads its context from MX. In a real build MX would start it with the hand-over id.
- **The mock's data lives in a private Vercel Blob store** (`weave-mock-unbound`, team weave23), so every copy of the function sees the same hand-overs, hand-backs, cases and e-mails. Locally and in the unit tests it lives in memory. With nothing finished yet, the hand-back falls back to the demo customer and says `source: "demo_default"`.
- **The case desk takes the newest finished hand-over.** That is right for one demo at a time; with two customers at once, MX must start the case desk with the hand-over id.
- **There is no phone channel.** A call that starts on Tetherfi IC would need a phone channel that sends the customer a link to this web session. That needs an SMS or e-mail sender on the server, which isn't set up.
- **Deposit insurance:** the agent says honestly that it covers only up to its legal limit. The offers, thresholds, relationship managers and delivery times are demo figures.
