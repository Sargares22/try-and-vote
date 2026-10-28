---
name: try-and-vote
description: Build one touchable HTML page where a product owner tries candidate features inside a mock of their real product and answers "take / later / don't take" with a comment on each; the agent reads those answers back and acts on them. Works in any agent harness with Node. Use whenever features, behaviours or design variants have to be proposed to an owner who judges by look and feel and does not read code or long documents - "what should we build next", "show me the options", "как сейчас / новый", comparing two or three ways to do one thing, collecting decisions on a backlog of ideas - and again when the owner says they have marked the page. Use it instead of writing a proposal document, a slide deck or a list of ideas in chat. Do NOT use for building a feature the owner has already chosen, for code review, or for a spec the owner asked to have as a written document.
---

# Try and vote

The script does the work and tells you the next step each time. `D` is the full path of
`scripts/demo.mjs` beside this file. It needs Node 18+ and, for `check`, Chrome, Chromium or
Edge on the machine (inside WSL it uses the Windows one). No other dependencies, any harness.

```
node D init <folder> [--lang ru|en]  start: writes <folder>/demo.html, a working example
node D check <folder>/demo.html      build, check the rules, take pictures -> out/page.html, out/shots
                                     (--tab <id> after changing one tab, --full for full-size pictures)
node D serve <folder>/demo.html      show it to the owner; exits with the answers when they press "done"
node D mark <folder>/demo.html       the owner has answered: remember the page the answers are about
node D verdicts <answers> --page <folder>/demo.html     answers from elsewhere, in piles
node D stop                          end the servers this skill started
```

## Build the page

Write the page in the language the owner talks to you in and set `lang` to it (`ru` or `en`;
for another language set `lang:'en'` and translate the frame's few texts through `text:{...}`).
`init --lang en` starts from the English example.

Any kind of product: `surface` says what the mock lives in (`phone`, `tablet`, `window`,
`browser`, `bare` for a single component, `fill`), for the page or per tab. The frame draws
the device or the window, you fill the inside.

A tab is one decision: the owner presses take, later or skip on it. Two or three ways to do
the same thing are positions of one switch in one tab, "as now" first: the owner leaves the
switch on the way they want and answers, and the answer records where the switch stood.
Spread over several tabs, they could take all of them. Unrelated features are separate tabs.

The page lives in the owner's project, in `<project>/try-and-vote/` beside the product files:
the answers land in `verdicts.json` there, and the next session finds the page and the answers.

You write one file, `demo.html`: a mock of the product and a list of tabs. Its comments say
what each field is. Write it with your file-editing tool, not through a shell heredoc: command
guards reject large scripts pasted into a command. The frame around it (tabs, brief, switches, verdict, storage, layout,
themes) is added by the script and is not yours to edit or restyle.

`check` tries every tab at desktop width and at phone width (400 px): a wide mock
shrinks, stacks or scrolls inside its surface there, it never widens the page. Show the
page only after `check` prints no PROBLEM lines and you have opened the pictures.

The pictures show every tab and every switch position, at desktop and at phone width. A state reached another way (a gesture,
several presses, a timer that ran out) goes into `shots.json` beside `demo.html`:
`[{"name": "...", "tab": "id", "set": {"switch": "value"}, "js": "script run in the page", "kind": "phone"}]`.

## Show it and collect the answers

The owner can also mark a spot in the mock and write a note on it. The answers then give each note
with what was pressed and where (pixels of the mock), and `out/notes/<tab>.png`: the mock as the
owner saw it, the spot ringed and numbered. Open those pictures before you answer.

Show the page with `serve`, in every harness that runs commands. Start it as a background
command, give the owner the address (`--lan` for their tablet or phone) and end your turn: you
do not wait for the owner. Every answer is written to `verdicts.json` beside the page when it
is pressed. When the owner presses "done", the server prints the piles and exits, which wakes an
agent that started it in the background; otherwise the owner tells you later and you read the
file. The server ends by itself 20 minutes after the page was closed; `stop` ends it by hand.

Other ways only when no local server can reach the owner. A Claude artifact: publish
`out/page.html` with `capabilities: {"db": {}}` (paid plan), read the answers with `ArtifactData`
(`list`, collection `verdicts`, `out_dir`) and pass that folder to `verdicts --page`. Or send
`out/standalone.html`: the owner presses "copy answers" and pastes them to you.

## When the owner has answered

The answers are about the page as the owner saw it. Keep this order:

1. `mark` before you change anything: it records the page the answers are about. From then
   on `check` asks for `upd:true` on exactly the tabs you change. Bump `rev` as well: the owner
   then starts from the first tab.
2. `verdicts <folder>/verdicts.json --page <folder>/demo.html`, not the raw file: it sorts the
   piles, marks each QUESTION and draws the noted spots. Open those pictures.
3. TAKE is a decision to build it: change the product itself and check that change with the
   product's own tests or run command. Do not start a browser of your own for it: on Windows a
   headless browser with its profile in a temp folder shows the owner error windows. With no tests,
   tell the owner what you did not check. A comment, a question or a note:
   rework that tab and answer in its `reply`. An untouched tab stays as it is.
4. `check`, the pictures, then `serve` again for what changed.

## What no script can check, so it is on you


- The mock is the owner's real product, recognisable at once: its screen, its colours, its type.
- "As now" is drawn from the code, not from plans or memory.
- The feature works in the mock and is touched, not described.
- The demo shows the mechanism, not a special case the owner could mistake for the rule.
- `caveat` says what the demo shows that is not verified on the real thing.
- You looked at every picture `check` wrote, icons included.

On an expensive model or deep in a long conversation, with a harness that can start a subagent on a
cheaper model: `references/cheaper-builder.md` says how to let that one build while you check.
