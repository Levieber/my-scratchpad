---
name: pad-review
description: Check the files you just edited against the user's reference notes (best practices, principles, checklists) in their scratchpad. Use when the Stop hook asks for a review, when the user runs /pad-review, or asks to review changes "against my notes/practices/checklists".
---

# Review edits against reference notes

The user keeps reusable rules as `reference` notes in their scratchpad. They are not loaded at session start; check only the ones that fit what changed, only against what changed.

1. **Scope.** The files edited this turn: the hook lists them. Run by hand, use `git status --short` and `git diff`. Read the diff, not whole files.
2. **Pick notes.** From the reference titles and tags (listed by the hook; otherwise `scratchpad_search` with `kind: "reference"`), keep only those that fit the edited files and this repo. UI code may call for the accessibility or performance checklists, a migration for the SQLite notes, a test for the TDD principles. A note that names another project applies only there. Often none apply: say so in one line and stop.
3. **Read** the chosen notes with `scratchpad_get`. Skip sections unrelated to the change.
4. **Check** the changes against the relevant items. Flag concrete problems in the edited code, not issues elsewhere in the file and not general advice.
5. **Fix** clear, local problems directly. Ask before anything larger or debatable.
6. **Report** in a few lines: the notes you checked, what you fixed, what you'd flag. Don't restate the checklist.

Don't write anything to the scratchpad during the review unless the user asks.
