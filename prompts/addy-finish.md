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
   - `commit first` — commit unstaged files before any more build work.
   - `next task` — implement the next unfinished task in the current slice using the Addy Build workflow.
3. If the user chooses `commit first`, perform the commit workflow directly: inspect `git status`, stage the relevant unstaged files, generate an appropriate commit message, run `git commit`, and report the commit hash. Do not merely print `/commit`.
4. If the user chooses `next task`, immediately continue with the Addy Build workflow for `<current-slice-plan-path>` in this same turn. Do not merely print `/addy-build <current-slice-plan-path>` or wait for the user to submit it.

If the current slice is complete and a next unfinished slice exists:

1. Call the `ask_user_question` tool with one single-select question asking whether to commit the completed slice before moving to the next slice.
2. Options must be exactly:
   - `commit first` — commit unstaged files before starting another slice.
   - `next slice` — start the first unfinished task in the next slice using the Addy Build workflow.
3. If the user chooses `commit first`, perform the commit workflow directly: inspect `git status`, stage the relevant unstaged files, generate an appropriate commit message, run `git commit`, and report the commit hash. Do not merely print `/commit`.
4. If the user chooses `next slice`, immediately continue with the Addy Build workflow for `<next-slice-plan-path>` in this same turn. Do not merely print `/addy-build <next-slice-plan-path>` or wait for the user to submit it.

If all slices are complete:

1. Call the `ask_user_question` tool with one single-select question asking whether to commit or ship.
2. Options must be exactly:
   - `commit` — commit unstaged files.
   - `ship` — continue with the Addy Ship workflow.
3. If the user chooses `commit`, perform the commit workflow directly: inspect `git status`, stage the relevant unstaged files, generate an appropriate commit message, run `git commit`, and report the commit hash. Do not merely print `/commit`.
4. If the user chooses `ship`, immediately continue with the Addy Ship workflow, passing the active/supplied plan path when available. Do not merely print `/addy-ship` or wait for the user to submit it.

For every answer returned by `ask_user_question`, execute the selected action directly in the current assistant turn. Never respond with only the slash command text for the user to run manually.

Important: the `ask_user_question` tool returns a tool result like `User has answered ... ="commit first"`. When that tool result appears, treat it as permission and immediately perform the mapped action. Do not create or complete only a `todo`, do not stop after writing `/commit`, `/addy-build`, or `/addy-ship`, and do not wait for another user message.

If the current slice, next task, or next slice path is ambiguous, call `ask_user_question` with one concise single-select follow-up before running anything. Use bounded options from the candidate slices, tasks, or plan paths you found.

Do not commit, start the next task, start the next slice, or ship until the user chooses one of the options above.
