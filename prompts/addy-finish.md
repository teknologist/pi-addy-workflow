---
description: "Addy workflow: choose how to finish this slice"
thinking: medium
---

# Addy Finish

Pi adaptation of Addy Osmani's `finish` workflow step.

Argument: `/addy-finish [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available.

Immediately call the `ask_user_question` tool with one single-select question asking how to finish this slice. The options must be exactly:

- `commit` — trigger the `/commit` prompt.
- `commit and push` — trigger the `/commit-push` prompt.
- `next slice` — find the next slice in the active/supplied plan and trigger `/addy-build <next-slice-plan-path>`.
- `ship` — trigger the `/addy-ship` prompt.

After the user chooses:

1. `commit`: run `/commit`.
2. `commit and push`: run `/commit-push`.
3. `next slice`: inspect the active/supplied plan, identify the next unfinished slice, and run `/addy-build` with that slice plan path as the argument. If the next slice path is ambiguous, ask one concise follow-up before running anything.
4. `ship`: run `/addy-ship`, passing the active/supplied plan path when available.

Do not commit, push, start the next slice, or ship until the user chooses one of the options.
