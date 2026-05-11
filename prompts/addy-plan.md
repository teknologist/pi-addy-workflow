---
description: "Addy workflow: break work into small verifiable tasks with acceptance criteria and dependency ordering"
thinking: medium
---

# Addy Plan

Pi adaptation of Addy Osmani's `plan` command.

Use the Pi `planning-and-task-breakdown` skill.

Argument: `/addy-plan [spec-path]`.

Read the supplied spec path. If no path is supplied, use the active spec from the Addy workflow state. If neither exists, call `ask_user_question` with bounded candidate `docs/specs/YYYY-MM-DD-<meaningful-name>.md` spec paths before writing the plan.

Then read the relevant codebase sections and:

1. Enter plan mode — read only, no code changes
2. Identify the dependency graph between components
3. Slice work vertically (one complete path per task, not horizontal layers)
4. Write tasks with acceptance criteria and verification steps
5. For every slice task, include status checkboxes that can stay synchronized with execution:
   - `[ ] Implemented`
   - `[ ] Verified`
   - `[ ] Reviewed`
6. Add checkpoints between phases
7. Present the plan for human review

Save durable plans under `docs/plans/` using the same naming convention as specs: a meaningful, kebab-case filename with a date prefix, `YYYY-MM-DD-<meaningful-name>.md`. Do not save `/addy-plan` output as `tasks/plan.md` or `tasks/todo.md`.

Pi-specific execution notes:

- Keep plans extremely concise.
- Ask clarifying questions only when ambiguity blocks correctness.
- Do not implement the plan unless the user explicitly orders implementation.
