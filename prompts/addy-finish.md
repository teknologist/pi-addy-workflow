---
description: "Addy workflow: choose how to finish this slice"
thinking: medium
argument-hint: "[plan-path]"
---

# Addy Finish

Pi adaptation of Addy Osmani's `finish` workflow step.

Argument: `/addy-finish [plan-path]`.

Supplied plan path argument, if any: `$ARGUMENTS`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available.

Inspect the active/supplied plan before asking the user anything. First reconcile the plan checkboxes with durable evidence from the working tree, recent commits, recorded plan notes, and checks or reviews completed in this or earlier sessions. Do not infer completion from intent; `[x] Implemented`, `[x] Verified`, and `[x] Reviewed` must only be checked when backed by code changes, passing checks, or completed review evidence. Then determine:

1. The current slice.
2. Whether the current slice has unfinished tasks.
3. The next unfinished task in the current slice, when one exists.
4. The next unfinished slice and its plan path, when the current slice is complete.

Before offering commit, next task, next slice, or ship actions, use the new heading/status plan layout to detect skipped lifecycle steps. A task is finish-ready only when all three checkboxes are checked:

- `[x] Implemented`
- `[x] Verified`
- `[x] Reviewed`

If any task in the active/supplied plan has `[x] Implemented` but missing `[x] Verified` or `[x] Reviewed`, warn the user with the task name and missing steps. Then call `ask_user_question` with one single-select question asking whether to run the missing workflow step or intentionally skip it. Include options for the missing step(s), for example:

- `run verify` — run `/addy-verify <current-slice-plan-path>` before finishing.
- `run review` — run `/addy-review <current-slice-plan-path>` before finishing.
- `skip missing steps` — intentionally continue finishing even though the listed task has missing lifecycle steps.

If both verify and review are missing, recommend `run verify`. If only review is missing, recommend `run review`. Only continue with the normal finish decision flow after the user explicitly chooses `skip missing steps`, or after the chosen missing workflow step has run and the plan has been rechecked. The user's `skip missing steps` answer is the required confirmation gate. Never silently skip missing verify or review steps.

Also warn when the Addy workflow state itself shows a phase jump between build and finish, even if the plan is missing or uses a legacy layout. Examples: going directly from build to review skips verify; going from build or verify directly to finish skips verify and/or review. In these cases, call `ask_user_question` before continuing with options to run the skipped step or intentionally skip it. Never silently skip workflow phases between build and finish.

Legacy checklist-only plans remain supported: a checked top-level task is treated as complete, and an unchecked top-level task is treated as unfinished, but there are no per-step skip warnings because those plans do not encode `Implemented`/`Verified`/`Reviewed` separately.

Inline finish commit rule: whenever the selected finish action is `commit first` or `commit`, perform the commit work directly in the current assistant turn. Do not delegate to another commit slash command, do not spawn a child commit workflow, do not search for an external commit prompt, and do not merely print command text for the user to run.

Do not re-run full verification during `/addy-finish`. Full verification belongs only to `/addy-verify`. Before committing, the only checks worth running from `/addy-finish` are formatter and linter commands required to keep the committed diff clean; do not run full test suites, broad regression checks, full build/typecheck gates, browser verification, or Prove-It workflows from finish.

For every finish commit path, use this inline commit procedure:

1. Derive the authoritative repository scope from the active/supplied plan and its index metadata. Include the current/owner repository for plan checkbox changes, every `Repository scope:` entry, `Owner repo`, and `Companion repo`. Do not rely on fresh-session file-touch history.
2. For every scoped repository, inspect staged, unstaged, and untracked changes. Skip scoped repositories with no changes and include them in the preview as skipped for no relevant changes.
3. Identify changes that belong to the completed task or slice plus plan checkbox/status updates. Stage only those relevant paths; leave unrelated user work unstaged.
4. Generate one meaningful conventional commit message for the completed work and use the same message across all scoped repositories with relevant changes.
5. Show a concise multi-repository commit preview listing repositories to commit, relevant staged paths, repositories skipped for no relevant changes, and any dirty unrelated paths that will remain unstaged.
6. Treat the finish choice as the user's commit confirmation. In non-interactive and auto-mode finish paths, commit directly after the preview without asking again.
7. Pass the actual generated message to `git commit -m`; do not rely on unexpanded shell substitution.
8. Stop on the first commit failure and report the failed repository, an error summary, any repositories already committed, and concrete recovery guidance.
9. Report each successful commit hash as `COMMIT: <hash>`.
10. If no relevant changes exist in any scoped repository, say `No changes to commit` and continue or finish according to the selected `/addy-finish` path.

If the current slice has unfinished tasks:

1. Call the `ask_user_question` tool with one single-select question asking whether to commit the current work before moving to the next task.
2. Options must be exactly:
   - `commit first` — commit unstaged files before any more build work.
   - `next task` — implement the next unfinished task in the current slice using the Addy Build workflow.
3. If the user chooses `commit first`, run the inline commit procedure above for the relevant plan/repository scope. Treat this finish answer as the user's commit confirmation; do not call `ask_user_question` again for commit confirmation.
4. If the user chooses `next task`, immediately continue with the Addy Build workflow for `<current-slice-plan-path>` in this same turn. Do not merely print `/addy-build <current-slice-plan-path>` or wait for the user to submit it.

If the current slice is complete and a next unfinished slice exists:

1. If Addy Auto Mode is active, do not call `ask_user_question`. Inspect `git status --short` for the relevant plan/repository scope.
   - If there are unstaged or untracked working-tree changes for the completed slice, run the inline commit procedure above for the completed slice work without asking the user. `/addy-auto` is explicit permission to commit completed, verified, reviewed work. Report each commit hash, then let Addy Auto continue.
   - If there are no unstaged or untracked working-tree changes, do not commit. Continue straight to the first unfinished task in `<next-slice-plan-path>` after a fresh-session continuation. Use the Addy Auto fresh-context handoff (for example, `/addy-auto-continue --fresh between-tasks`) when available; otherwise immediately continue with the Addy Build workflow for `<next-slice-plan-path>` in this same turn. Do not merely print `/addy-build <next-slice-plan-path>` or wait for the user to submit it.
2. If Addy Auto Mode is not active, call the `ask_user_question` tool with one single-select question asking whether to commit the completed slice before moving to the next slice.
3. Options must be exactly:
   - `commit first` — commit unstaged files before starting another slice.
   - `next slice` — start the first unfinished task in the next slice using the Addy Build workflow.
4. If the user chooses `commit first`, run the inline commit procedure above for the relevant plan/repository scope. Treat this finish answer as the user's commit confirmation; do not call `ask_user_question` again for commit confirmation.
5. If the user chooses `next slice`, immediately continue with the Addy Build workflow for `<next-slice-plan-path>` in this same turn. Do not merely print `/addy-build <next-slice-plan-path>` or wait for the user to submit it.

If all slices are complete and Addy Auto Mode is active:

1. Inspect `git status --short` for the relevant plan/repository scope.
2. If there are no unstaged or untracked working-tree changes, say `Finished!`, include cycle completion stats, and stop. Do not ask to commit, do not ask to ship, and do not run another Addy workflow command.
3. If there are unstaged or untracked working-tree changes, run the inline commit procedure above for the completed plan work without asking the user. `/addy-auto` is explicit permission to commit completed, verified, reviewed work.
4. After the inline commit procedure reports each commit hash, include cycle completion stats, then say `Finished!` and stop.
5. Do not call `ask_user_question` for auto-mode finish commits, and do not offer `finish without commit` while Addy Auto Mode is active.

Cycle completion stats cover either the full Addy Auto session or the current single lifecycle cycle (`build → simplify → verify → review → finish`). Show these stats whether or not the user chooses to commit.

Cycle completion stats must include these labels when stats are available:

- `Turns:`
- `Review runs:`
- `Issues:`

Keep completion stats aggregate-only; do not include raw review text, logs, transcripts, or full findings.

If all slices are complete and Addy Auto Mode is not active:

1. Call the `ask_user_question` tool with one single-select question asking whether to commit or ship.
2. Options must be exactly:
   - `commit` — commit unstaged files.
   - `ship` — continue with the Addy Ship workflow.
3. If the user chooses `commit`, run the inline commit procedure above for the relevant plan/repository scope. Treat this finish answer as the user's commit confirmation; do not call `ask_user_question` again for commit confirmation.
4. If the user chooses `ship`, immediately continue with the Addy Ship workflow, passing the active/supplied plan path when available. Do not merely print `/addy-ship` or wait for the user to submit it.

For every answer returned by `ask_user_question`, execute the selected action directly in the current assistant turn. Never respond with only the slash command text for the user to run manually.

Important: the `ask_user_question` tool returns a tool result like `User has answered ... ="commit first"`. When that tool result appears, treat it as permission and immediately perform the mapped action. Do not create or complete only a `todo`, do not stop after writing Addy slash command text, and do not wait for another user message.

If the current slice, next task, or next slice path is ambiguous, call `ask_user_question` with one concise single-select follow-up before running anything. Use bounded options from the candidate slices, tasks, or plan paths you found.

Do not commit, start the next task, start the next slice, or ship until the user chooses one of the options above.
