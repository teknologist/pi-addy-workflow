---
description: "Addy workflow: choose how to finish this slice"
thinking: medium
---

# Addy Finish

Pi adaptation of Addy Osmani's `finish` workflow step.

Argument: `/addy-finish [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available.

Inspect the active/supplied plan before asking the user anything. First reconcile the plan checkboxes with durable evidence from the working tree, recent commits, recorded plan notes, and checks or reviews completed in this or earlier sessions. Do not infer completion from intent; `[x] Implemented`, `[x] Verified`, and `[x] Reviewed` must only be checked when backed by code changes, passing checks, or completed review evidence. Then determine:

1. The current slice.
2. Whether the current slice has unfinished tasks.
3. The next unfinished task in the current slice, when one exists.
4. The next unfinished slice and its plan path, when the current slice is complete.

If the current slice has unfinished tasks:

1. Call the `ask_user_question` tool with one single-select question asking whether to commit the current work before moving to the next task.
2. Options must be exactly:
   - `commit first` — trigger the `/commit` prompt for unstaged files before any more build work.
   - `next task` — trigger `/addy-build <current-slice-plan-path>` to implement the next unfinished task in the current slice.
3. If the user chooses `commit first`, run `/commit`.
4. If the user chooses `next task`, run `/addy-build <current-slice-plan-path>`.

If the current slice is complete and a next unfinished slice exists:

1. Call the `ask_user_question` tool with one single-select question asking whether to commit the completed slice before moving to the next slice.
2. Options must be exactly:
   - `commit first` — trigger the `/commit` prompt for unstaged files before starting another slice.
   - `next slice` — trigger `/addy-build <next-slice-plan-path>` to start the first unfinished task in the next slice.
3. If the user chooses `commit first`, run `/commit`.
4. If the user chooses `next slice`, run `/addy-build <next-slice-plan-path>`.

If all slices are complete:

1. Call the `ask_user_question` tool with one single-select question asking whether to commit or ship.
2. Options must be exactly:
   - `commit` — trigger the `/commit` prompt.
   - `ship` — trigger the `/addy-ship` prompt.
3. If the user chooses `commit`, run `/commit`.
4. If the user chooses `ship`, run `/addy-ship`, passing the active/supplied plan path when available.

If the current slice, next task, or next slice path is ambiguous, call `ask_user_question` with one concise single-select follow-up before running anything. Use bounded options from the candidate slices, tasks, or plan paths you found.

Do not commit, start the next task, start the next slice, or ship until the user chooses one of the options above.
