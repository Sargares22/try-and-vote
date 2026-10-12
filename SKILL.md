---
name: try-and-vote
description: Build one touchable HTML page where a product owner tries candidate features inside a mock of their real product and answers "take / later / don't take" with a comment on each, then read those answers back and act on them. Works in any agent harness with Node. Use whenever features, behaviours or design variants have to be proposed to an owner who judges by look and feel and does not read code or long documents - "what should we build next", "show me the options", "как сейчас / новый", comparing two or three ways to do one thing, collecting decisions on a backlog of ideas - and again when the owner says they have marked the page. Use it instead of writing a proposal document, a slide deck or a list of ideas in chat.
---

# Try and vote

The script does the work and tells you the next step each time. `D` is the full path of
`scripts/demo.mjs` beside this file. It needs Node 18+ and, for `check`, Chrome, Chromium or
Edge on the machine (inside WSL it uses the Windows one). No other dependencies, any harness.

```
node D init <folder> [--lang ru|en]  start: writes <folder>/demo.html, a working example
node D check <folder>/demo.html      build, check the rules, take pictures -> out/page.html, out/shots
node D serve <folder>/demo.html      show it to the owner; exits with the answers when they press "done"
node D mark <folder>/demo.html       after the owner has seen it: remember what was shown
node D verdicts <answers> --page <folder>/demo.html     answers from elsewhere, in piles
```

Write the page in the language the owner talks to you in and set `lang` to it (`ru` or `en`;
for another language set `lang:'en'` and translate the frame's few texts through `text:{...}`).
`init --lang en` starts from the English example.

Any kind of product: `surface` says what the mock lives in (`phone`, `tablet`, `window`,
`browser`, `bare` for a single component, `fill`), for the page or per tab. The frame draws
the device or the window, you fill the inside.

You write one file, `demo.html`: a mock of the product and a list of tabs. Its comments say
what each field is. Write it with your file-editing tool, not through a shell heredoc: command
guards reject large scripts pasted into a command. The frame around it (tabs, brief, switches, verdict, storage, layout,
themes) is added by the script and is not yours to edit or restyle.

`check` tries every tab at desktop width and at phone width (400 px): a wide mock
shrinks, stacks or scrolls inside its surface there, it never widens the page. Show the
page only after `check` prints no PROBLEM lines and you have opened the pictures.

The pictures show every tab and every switch position. A state reached another way (a gesture,
several presses, a timer that ran out) goes into `shots.json` beside `demo.html`:
`[{"name": "...", "tab": "id", "set": {"switch": "value"}, "js": "script run in the page", "kind": "phone"}]`.

- **Any harness:** start `serve` as a background command and give the owner the address
  (`--lan` for their tablet or phone). It ends when they press "done" and prints the piles.
- **Claude with artifacts, as an extra:** publish `out/page.html` with
  `capabilities: {"db": {}}`, read with `ArtifactData` (`list`, collection `verdicts`,
  `out_dir`), pass that folder to `verdicts`. The artifact store needs a paid Claude plan;
  do not make it the only way.
- **No server possible:** send `out/standalone.html`; the owner presses "copy answers".

What no script can check, so it is on you:

- The mock is the owner's real product, recognisable at once: its screen, its colours, its type.
- "As now" is drawn from the code, not from plans or memory.
- The feature works in the mock and is touched, not described.
- The demo shows the mechanism, not a special case the owner could mistake for the rule.
- `caveat` says what the demo shows that is not verified on the real thing.
- You looked at every picture `check` wrote, icons included.
