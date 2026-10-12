# Try and vote

Coding agents usually propose features as a wall of text. The product owner has to read proposals, imagine interfaces and guess trade-offs. With try-and-vote the agent builds one interactive page instead. You touch each candidate feature inside a mock of your real product, switch between variants, and answer take, later or skip with a comment. The agent reads your answers back and acts on them.

## What the owner sees

- A tab for each candidate feature, marked once it is decided.
- A brief: what the feature is, how much it complicates the product, and what to press.
- A switch between variants, or between "as now" and the new behaviour.
- A working mock on a phone, a tablet, a desktop window, a browser, a single component or the full stage.
- Three verdict buttons: take, later, skip.
- A comment box. Dictation works.
- A "done" button that hands the answers to the agent.

## How it works for the agent

1. **Init.** `node scripts/demo.mjs init <folder>` writes a starter `demo.html`.
2. **Write one file.** Fill `demo.html` with the product mock and the tabs. The frame around it comes from the script.
3. **Check.** `node scripts/demo.mjs check <folder>/demo.html` checks the rules and takes pictures.
4. **Serve.** `node scripts/demo.mjs serve <folder>/demo.html` in the background; give the owner the address.
5. **Read answers.** When the owner presses "done", the server prints the answers in piles and exits.

The server also exits by itself 20 minutes after the page was closed, and runs once per page.

## What the script enforces

- Text limits on titles and descriptions, so the owner tries features instead of reading essays.
- Something to press in every tab, and a visible answer to the press.
- No sideways scroll at phone width (400 px).
- One language across the page.
- Tabs changed since the owner last looked are marked as updated.
- One sheet of pictures per tab, every state side by side, for the agent to look at before showing the page.

## Requirements

- Node.js 18 or newer.
- Chrome, Chromium or Edge. Inside WSL the Windows browser is used.
- No dependencies.
- Any agent harness: Claude Code, Codex, Cursor, Antigravity. Claude artifacts are optional, not required.

## Install

```sh
npx skills add Sargares22/try-and-vote
```

## Measured

Fifteen builds by three Claude models (Opus 5.5, Sonnet 5.5, Haiku 5.5), five each. Every build ran in a fresh thread; the three models got the same three briefs.

- All 15 passed the script's rules and a grader that presses the built page itself.
- Mean time was 3.7 to 4.5 minutes per page.
- In a blind look at the pictures of one task, the larger models adapted the mock to phone width better than the smallest. The script did not see that difference; eyes did.
- Not measured: other vendors' models, and real products with real source files.

## Limits

The mock is drawn by the agent and is only as faithful as the files it was given. The script checks that controls respond; taste is still judged by eyes.

## Developing the skill

`node tests/run.mjs` tests the rules and the server. `node scripts/demo.mjs eval --prepare <dir>` and `eval <dir>` check whether a given model can build pages by this skill; the grader's steps are in `evals/`.

## License

MIT
