# A cheaper model builds, you check

The skill itself is for one agent on any model. Use this only when both are true: you
run on an expensive model or deep in a long conversation, and your harness can start a
subagent or a thread on a cheaper model. Then let the cheaper one build:

1. `node scripts/demo.mjs brief <folder>` writes `brief.json`. Fill it in: the product, the language, the
   surface, the real files to draw the mock from, and for each candidate what it is, what to
   press and which variants to compare.
2. Run `brief` again and give the printed text to the builder, with nothing added.
3. Do not take the builder's word. Run `check` yourself: it holds the page to the brief. Then
   open the pictures yourself. What you send back for rework is the PROBLEM lines and what
   you saw, not a rewrite.

You stay the one who shows the page to the owner and reads the answers.
