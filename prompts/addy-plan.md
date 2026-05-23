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
   - Optimize the plan for `/addy-auto` execution: every task must be small, autonomous, independently verifiable, and specific enough for an agent to implement without extra interpretation unless a listed stop condition is hit.
4. Decide how to package the plan before writing files:
   - Use one plan file for small/simple work: 1–5 tasks, 1–2 vertical slices, one main subsystem, low risk, and likely reviewable as one coherent unit.
   - Use an index plan plus multiple slice plan files for larger or riskier work: 6+ tasks, 3+ vertical slices, multiple subsystems, migrations, public API or auth/security changes, risky refactors, staged rollout, or checkpoints that should be reviewed independently.
   - If this choice is borderline or user preference could materially affect execution, call `ask_user_question` before writing files. Ask how to package the plan with choices for single file, split by slice, or agent decides.

5. Write tasks with acceptance criteria, verification steps, proof requirements, dependencies, and stop conditions.
   - For behavior-changing tasks, include at least one regression-oriented verification step that would fail before implementation and pass after implementation.
   - If exact files, symbols, commands, or implementation surfaces are unknown, create an initial discovery-only task that locates them without changing behavior. Before checking that discovery task as implemented, persist its findings into the plan or an explicitly linked durable artifact, and make dependent tasks reference that persisted section or artifact.
6. For every slice task, use this exact heading/status layout so workflow commands can keep the plan synchronized:

   ````md
   ## Task N: Short imperative task name

   - [ ] Implemented
   - [ ] Verified
   - [ ] Reviewed

   Depends on:

   - ...

   ### Objective

   - ...

   ### Context / files

   - Likely files:
     - `path/to/file.ts`
   - Relevant symbols:
     - `symbolName`
   - If these are wrong, first locate the equivalent existing files before editing.

   ### Implementation steps

   1. ...
   2. ...

   ### Acceptance criteria

   - ...

   ### Verification

   Run:

   ```sh
   ...
   ```

   Expected proof:

   - ...

   ### Stop conditions

   - Stop if ...
   ````

   The task is complete only when all three lifecycle checkboxes are checked:
   - `[ ] Implemented`
   - `[ ] Verified`
   - `[ ] Reviewed`

7. Add checkpoints between phases
8. End every plan or final split-plan slice with a non-task `## Completion audit` section, not a lifecycle task and not a heading with `Implemented`/`Verified`/`Reviewed` checkboxes. The audit checklist must verify all preceding implementation tasks have implementation, verification, and review evidence; all required commands pass; no unrelated files changed; and lifecycle checkboxes reflect real completed phases only.
9. Present the plan for human review

Save durable plans under `docs/plans/` using the same naming convention as specs: a meaningful, kebab-case filename with a date prefix, `YYYY-MM-DD-<meaningful-name>.md`. Do not save `/addy-plan` output as `tasks/plan.md` or `tasks/todo.md`.

For split plans, save the top-level artifact as an index plan in `docs/plans/` and save each slice as its own dated slice plan file. The index plan must list slice files in a markdown table that workflow commands can read:

```md
| Slice | Plan                                                   | Purpose    |
| ----- | ------------------------------------------------------ | ---------- |
| 01    | `docs/plans/YYYY-MM-DD-feature-slice-01-foundation.md` | Foundation |
| 02    | `docs/plans/YYYY-MM-DD-feature-slice-02-core-flow.md`  | Core flow  |
```

Each slice plan file must contain only the tasks for that slice using the required task heading/status layout above.

When writing split plans, each slice plan must be independently runnable by `/addy-auto`: it must include enough context, verification, proof requirements, and stop conditions for an autonomous agent to complete that slice without reading unrelated slice files except the index and explicitly linked dependencies.

Pi-specific execution notes:

- Keep plans extremely concise.
- Prefer concrete executable instructions over narrative. Bad: `Improve validation`. Good: `Reject invalid workflow state payloads`, with exact likely files, acceptance criteria, a regression test command, expected passing output, and stop conditions.
- Do not use top-level `- [ ] Task name` checkboxes for new slice tasks; that legacy layout is still readable, but new plans must use the heading/status layout above.
- Ask clarifying questions only when ambiguity blocks correctness.
- Do not implement the plan unless the user explicitly orders implementation.
