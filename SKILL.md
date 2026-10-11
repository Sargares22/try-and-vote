---
name: feature-verdicts
description: Build one touchable HTML page where a product owner tries candidate features inside a mock of their real product and answers "take / later / don't take" with a comment on each, then read those answers back and act on them. Works in any agent harness with Node. Use whenever features, behaviours or design variants have to be proposed to an owner who judges by look and feel and does not read code or long documents - "what should we build next", "show me the options", "как сейчас / новый", comparing two or three ways to do one thing, collecting decisions on a backlog of ideas - and again when the owner says they have marked the page. Use it instead of writing a proposal document, a slide deck or a list of ideas in chat.
---

# Feature verdicts

The script does the work and tells you the next step each time. `D` is `scripts/demo.mjs` in
this folder (Node 18+, no dependencies, any harness).

```
node D init <folder>                 start: writes <folder>/demo.html, a working example
node D check <folder>/demo.html      build, check the rules, take pictures -> out/page.html, out/shots
node D serve <folder>/demo.html      show it to the owner; exits with the answers when they press "done"
node D mark <folder>/demo.html       after the owner has seen it: remember what was shown
node D verdicts <answers> --page <folder>/demo.html     answers from elsewhere, in piles
```

You write one file, `demo.html`: a mock of the product and a list of tabs. Its comments say
what each field is. The frame around it (tabs, brief, switches, verdict, storage, layout,
themes) is added by the script and is not yours to edit or restyle.

Show the page only after `check` prints no PROBLEM lines and you have opened the pictures.

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
