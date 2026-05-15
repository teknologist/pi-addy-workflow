---
description: "Addy workflow: break work into small verifiable tasks with acceptance criteria and dependency ordering"
thinking: medium
argument-hint: "[spec-path]"
---

# Addy Plan

Pi adaptation of Addy Osmani's `plan` command.

Use the Pi `planning-and-task-breakdown` skill.

Argument: `/addy-plan [spec-path]`.

Supplied spec path argument, if any: `$ARGUMENTS`.

Read the supplied spec path. If no path is supplied, use the active spec from the Addy workflow state. If neither exists, call `ask_user_question` with bounded candidate `docs/specs/YYYY-MM-DD-<meaningful-name>.md` spec paths before writing the plan.

Then read the relevant codebase sections and:

1. Enter plan mode — read only, no code changes
2. Identify the dependency graph between components
3. Slice work vertically (one complete path per task, not horizontal layers)
4. Write tasks with acceptance criteria and verification steps
5. For every slice task, use this exact heading/status layout so workflow commands can keep the plan synchronized:

   ```md
   ## Task N: Short imperative task name

   - [ ] Implemented
   - [ ] Verified
   - [ ] Reviewed

   ### Acceptance criteria

   - ...
   ```

   The task is complete only when all three lifecycle checkboxes are checked:
   - `[ ] Implemented`
   - `[ ] Verified`
   - `[ ] Reviewed`

6. Add checkpoints between phases
7. Present the plan for human review

Save durable plans under `docs/plans/` using the same naming convention as specs: a meaningful, kebab-case filename with a date prefix, `YYYY-MM-DD-<meaningful-name>.md`. Do not save `/addy-plan` output as `tasks/plan.md` or `tasks/todo.md`.

Pi-specific execution notes:

- Keep plans extremely concise.
- Do not use top-level `- [ ] Task name` checkboxes for new slice tasks; that legacy layout is still readable, but new plans must use the heading/status layout above.
- Ask clarifying questions only when ambiguity blocks correctness.
- Do not implement the plan unless the user explicitly orders implementation.
