# `/addy-auto` autonomous slice-plan loop spec

## Objective

Add a slash command, `/addy-auto [plan-path]`, that autonomously works through every unfinished task in a slice plan from first task to last task.

Primary users are developers and coding agents using `pi-addy-workflow` who want the exact Addy workflow to run without repeated manual prompt invocations.

The command should preserve the existing lifecycle discipline:

```text
BUILD → VERIFY → REVIEW → COMMIT → next task/slice
```

Success means a user can start `/addy-auto docs/plans/<slice>.md`, walk away, and return to completed plan tasks, passing checks, completed reviews, and one or more commits that reflect the completed work.

### Acceptance criteria

- `/addy-auto [plan-path]` is available as a packaged prompt.
- `/addy-auto stop` is available as a graceful stop command that disables auto mode and prevents the autonomous loop from starting or continuing on the next turn.
- When a `plan-path` is supplied, it becomes the active plan, matching existing Addy prompt behavior.
- When no path is supplied, the command uses the active workflow plan when one exists.
- The command reads the active plan and repeatedly chooses the next unfinished task.
- For each task, the command runs the equivalent of:
  1. `/addy-build <plan-path>`
  2. `/addy-verify <plan-path>`
  3. `/addy-review <plan-path>`
  4. commit completed changes
- The command advances through unambiguous next slice plans using the same rules as `/addy-build` and workflow tracker slice detection.
- The command minimizes user input and blocking. It should keep working autonomously whenever a safe, evidence-backed next action exists.
- The command attempts autonomous recovery before stopping: fix failed checks, address blocking review findings, inspect and cleanly handle expected git changes, and infer the next slice from available evidence.
- The command stops only when all reachable tasks are complete, recovery attempts are exhausted, or the remaining decision is unsafe/destructive/externally dependent and truly requires user input.
- While `/addy-auto` is active, the workflow footer shows auto mode with a loop prefix: `🔁 Addy Workflow:`. Manual Addy workflow mode keeps the existing footer label with no emoji: `Addy Workflow:`.
- Plan checkboxes remain owned by their lifecycle phases: build updates only `Implemented`, verify updates only `Verified`, review updates only `Reviewed`.
- Commits are created only after a task or slice has passed build, verify, and review.
- The final response reports completed tasks, commit hashes, checks run, any skipped optional phases, and remaining blockers if stopped early.

## Commands

### New command

```text
/addy-auto [plan-path]
/addy-auto stop
```

Behavior:

1. Resolve the active plan from the supplied argument or workflow state.
2. Read the plan and find the next unfinished task.
3. Execute one autonomous lifecycle cycle for that task:
   - build the minimum implementation;
   - verify behavior with tests/checks;
   - review current changes against the plan;
   - commit the completed, verified, reviewed work.
4. Re-read the plan and continue with the next unfinished task.
5. If the current slice is complete, move to the next unambiguous slice plan and continue.
6. Stop with a concise status report when no work remains or when blocked.

`/addy-auto stop` behavior:

1. Disable auto mode in workflow state.
2. Restore the manual footer label with no emoji.
3. Leave the active plan, spec, and current task progress intact.
4. Report where the autonomous loop stopped and what task remains next.

If Pi cannot deliver `/addy-auto stop` while a long assistant turn is already running, the command still acts as the durable stop/reset mechanism for the next turn after the user interrupts or the current cycle yields.

### Existing command compatibility

- Do not change the behavior of `/addy-build`, `/addy-verify`, `/addy-review`, `/addy-finish`, or `/addy-ship` except where minimal shared helpers are needed.
- `/addy-auto` should reuse the same plan-selection and lifecycle rules where practical instead of defining conflicting semantics.
- `/addy-auto` may document that it intentionally commits, unlike `/addy-build`, `/addy-verify`, and `/addy-review`.

## Project structure

Expected files to add or update:

```text
prompts/
└── addy-auto.md                  # new slash prompt

skills/
└── using-addy-workflow/
    └── SKILL.md                  # mention AUTO if lifecycle guidance needs updating

extensions/workflow-monitor/
├── workflow-transitions.ts       # add auto phase/command support only if needed
├── workflow-tracker.ts           # expose active plan/task state if needed
└── workflow-handler.ts           # update widget/event handling only if needed

tests/
├── validate-assets.test.ts       # ensure prompt is packaged and references valid skills
└── workflow-*.test.ts            # add coverage only for changed workflow logic
```

The preferred implementation is prompt-first for the lifecycle loop, plus minimal workflow-monitor state for auto-mode display and stop handling. Add a boolean such as `autoMode` to workflow state only if needed to render `🔁 Addy Workflow:` while auto mode is active.

## Code style

- Keep the implementation surgical and consistent with existing prompts.
- Prefer concise Markdown prompt instructions over new runtime machinery unless runtime state changes are required.
- Use TypeScript only for extension behavior that must be enforced by the workflow monitor.
- Preserve ES module conventions and existing formatting.
- Do not introduce new dependencies unless absolutely required.
- Reuse existing terms: active plan, active spec, slice plan, task, lifecycle status, workflow footer.
- Keep autonomous behavior explicit: the prompt must say when it may continue without asking and when it must stop.

## Testing strategy

Run these checks before claiming the feature is complete:

```bash
npm test
npm run typecheck
```

Add or update tests so they verify:

- `prompts/addy-auto.md` is included in packaged prompt validation.
- The new prompt references only available packaged skills/commands.
- Workflow command detection recognizes `/addy-auto` if the workflow monitor needs to display or track it.
- Auto mode renders `🔁 Addy Workflow:` in the footer, while manual mode continues to render `Addy Workflow:` with no emoji.
- `/addy-auto stop` clears auto mode without clearing the active plan or task progress.
- Any changed plan/slice helper behavior preserves existing `/addy-build`, `/addy-verify`, `/addy-review`, and `/addy-finish` behavior.

Manual verification:

- Create or use a small slice plan with at least two unfinished lifecycle tasks.
- Run `/addy-auto <plan-path>` in a test session.
- Confirm it completes one task at a time through build, verify, review, and commit.
- Confirm it stops instead of guessing when the active plan or next slice is ambiguous.

## Boundaries

Always do:

- Follow the exact Addy lifecycle order for every task.
- Prefer autonomous continuation over asking when the next safe action is clear.
- Show the loop footer prefix only while auto mode is active.
- Support `/addy-auto stop` as the explicit user escape hatch from autonomous mode.
- Try hard to fix failed tests, failed typecheck, unresolved blocking review findings, unsafe git state, or ambiguous next plan selection autonomously before stopping. Stop loudly only when the issue remains after reasonable autonomous recovery attempts or requires user judgment.
- Report concrete evidence: files changed, checks run, review result, commits created, and remaining tasks.

Ask first only when autonomy would be unsafe or impossible:

- When continuing could overwrite, revert, rebase, delete, push, publish, deploy, or otherwise affect user work outside the current task.
- When there are multiple materially different product or architecture choices and no existing spec, plan, code pattern, or test can decide between them.
- When credentials, external services, money, production data, or destructive operations are required.

Do not ask first merely because:

- Tests or typecheck fail; attempt an autonomous fix loop first.
- Review finds blocking issues; fix them, re-verify, and re-review first.
- The git state has expected task changes; inspect, stage only relevant files, and commit after the lifecycle passes.
- The next plan/slice is inferable from active workflow state, plan links, index files, or ordered slice filenames.

Never do:

- Never skip verify or review silently.
- Never mark lifecycle checkboxes without matching evidence from that phase.
- Never commit failing tests, unresolved blocking review issues, or partial task work as complete.
- Never push, deploy, publish, or ship automatically.
- Never broaden the feature into a general scheduler, background daemon, or separate task-runner framework unless separately specified.
