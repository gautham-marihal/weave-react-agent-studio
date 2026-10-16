# Checking the Studio with real people

The brief for the Studio is that a customer who does not know the technology can build a basic agent, and a developer can still reach every
detail. Nobody can tell whether that is true from the inside. This is a small study that finds out: **five customers who are not technical and
three developers, each doing the same six tasks while someone watches and writes down what happens.** It takes about 45 minutes a person.

Nothing in it needs the real API: use the demo build (`npm run build -- --mode demo`, or `npm run dev:demo`), which keeps everything in the
browser, or a test workspace on a test server. **Never use real customer data or a real key in a session.**

## Who

| Group      | How many | Who they should be                                                                                                                                |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customers  | 5        | Run a support team, a front desk or a service line. Have never configured a voice agent or written JSON. Different jobs and companies if you can. |
| Developers | 3        | Have built an integration or a chatbot. Know what an API, a JSON file and a webhook are.                                                          |

Do not use anyone who helped build or review the Studio. A person who has seen a screen before tells you nothing about the first minute.

## Before each session

- A clean browser profile (or a private window), the Studio on its sign-in page, a quiet room, the screen and the voice recorded **with the person's
  permission**.
- A sheet to write on (below) and a clock. One person asks, one person writes, or do both with a recording and note times afterwards.
- A test agent with a few calls for task 6: in demo mode, run one conversation from the Test tab first so there is something to find.

## What you say

Read this out, as written, so every person hears the same thing:

> We are testing the product, not you. If something is hard, that is the product's fault and exactly what we want to learn. Please think aloud:
> say what you are looking at, what you expect, what you are unsure of. I will not help unless you are completely stuck, and I will tell you when I
> do. You can stop at any time. There are no right answers.

When they ask "how do I…", answer with a question: "Where would you look?" Note the answer: that is the finding. Help only after two minutes of
being stuck, and write down that you did.

## The six tasks

Give each as a short card, one at a time, in this order. Start the clock when they have read it.

| #   | Task                                                                                                  | Done when                                                                  |
| --- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | **Create a support agent** for a company called “Harbour Plumbing” that answers calls about bookings. | The agent exists and its instructions mention bookings.                    |
| 2   | **Change what it says first**, and **choose a different voice.**                                      | The greeting is changed and a voice is chosen.                             |
| 3   | **Let it look up a booking** in the company's booking system (`https://api.harbour.example`).         | A lookup tool exists, is offered to the agent, and points at that address. |
| 4   | **Try it:** talk to the agent and see it answer.                                                      | They have had a test conversation (chat is fine).                          |
| 5   | **Put it live for testing** (publish it, and deploy it to Development).                               | A version is published and deployed to Development.                        |
| 6   | **Find yesterday's calls** and open one to see what happened.                                         | They open a call and say what the agent did in it.                         |

Developers do the same six, then two more:

| #   | Task                                                                                                                           | Done when                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 7   | **Find the setting that controls how long the agent waits before it asks “are you still there?”** and change it to 12 seconds. | The value is 12, whichever way they got there.                   |
| 8   | **Show the setting's name in the configuration file**, and copy its path.                                                      | They turn on technical names or open the JSON, and name the key. |

## What to write down for every task

| Measure                       | How                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Time**                      | From reading the card to “done”, in seconds. Stop at 5 minutes and mark it **not finished**.                           |
| **Finished?**                 | Yes, yes with help, no.                                                                                                |
| **Wrong turns**               | Each time they open a screen, tab or menu that was not on the way.                                                     |
| **Where did you look first?** | The first place they went, in their words (“the sidebar”, “the Config tab”, “the search box”). Exactly what they said. |
| **Help given**                | When, and what you said.                                                                                               |
| **Words they stumbled on**    | Any label or sentence they read aloud and puzzled over. Copy it exactly.                                               |
| **Surprises**                 | Anything they expected that did not happen, or that happened and they did not expect.                                  |

A one-line recording sheet per person and task is enough:

```
person | group | task | seconds | finished | wrong turns | looked first | help | stumbled on | surprise
```

After the last task ask three things and write the answers down: _What was the easiest part? What was the most confusing part? What did you
expect to find that you did not?_

## What good looks like

These are the targets the review set. They are measured on the five customers:

- **Task 1 in under 3 minutes with no help**, for at least four of the five.
- **No one searches the whole app for a setting.** If a person opens more than three screens looking for one thing, the setting is in the wrong place or
  called the wrong thing.
- **No technical term on the way to the first conversation.** Any word a customer reads aloud and cannot explain is a finding.
- From sign-in to the first test conversation in **8 clicks or fewer** (the click counter in `e2e/firstRun.mjs` measures this without people).

## After the sessions

1. Put every sheet in one table. Group the findings by **screen or word**, not by person.
2. A problem that **two or more** people hit is a fix. One person's problem is a note, unless it was serious (they gave up, or did something that
   would have cost money or exposed data).
3. For each fix, write which of these it is, and do the cheapest first:
   - **Wording**: a label or sentence. Change it in `src/studio/form/plainLanguage.js` (the catalogue of labels and explanations).
   - **Place**: a setting or button where people did not look. Move it (the grouping is in `src/studio/form/layout.js`; the Simple view's cards are in
     `src/studio/simple/SimpleConfig.jsx`).
   - **Missing**: something people wanted that is not there. Add it to the list; do not build it before you have seen it twice.
4. Run the study again with three new customers after the fixes. Compare task 1 time and the number of wrong turns.

## Why these tasks

They are the first hour of a new customer's life with the product: make something, change it, connect it to their system, hear it work, put it where
it can be tested, and see what happened. If any one of them is slow, everything after it is moot. The two developer tasks check that the detail the
customers never see is still one search or one switch away.
