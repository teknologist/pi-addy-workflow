---
name: planning-and-task-breakdown
description: Break specs into ordered, verifiable tasks. Use for /addy-plan or any implementation plan.
---

# Planning and Task Breakdown

Create implementation-ready plans for `/addy-auto`. A good plan is not just a strategy document: it is an autonomous work order. Each task must be small, vertical, independently verifiable, and specific enough that an agent can implement it without follow-up questions unless a listed stop condition is hit.

Plan read-only:

1. Read spec and relevant code.
2. Slice vertical user-visible increments.
3. Decide plan packaging before writing files:
   - Use one plan file for small/simple work: 1–5 tasks, 1–2 vertical slices, one main subsystem, low risk.
   - Use an index plan plus multiple slice plan files for larger/riskier work: 6+ tasks, 3+ slices, multiple subsystems, migrations, public API or auth/security changes, risky refactors, staged rollout, or checkpoints that should be reviewed independently.
   - If the choice is unclear or user preference matters, call `ask_user_question` with choices for single file, split by slice, or agent decides before writing files.
4. Add acceptance criteria, verification, proof requirements, dependencies, and stop conditions for each task.
5. Add per-task status checkboxes for `[ ] Implemented`, `[ ] Verified`, and `[ ] Reviewed` so later workflow steps can keep the plan in sync with reality.
6. Mark dependencies and risky checkpoints.
7. Keep plan concise and executable.

For every implementation task, use this shape:

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

For behavior-changing tasks, include at least one regression-oriented verification step that would fail before implementation and pass after implementation.

If exact files, symbols, test commands, or implementation surfaces are unknown, do not guess. Add a discovery-only task first. Before marking that task implemented, require the agent to persist findings into the plan or an explicitly linked durable artifact, and require dependent tasks to reference that persisted section or artifact so fresh `/addy-auto` sessions can resume without hidden context.

```md
## Task 1: Map existing implementation surface

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

- Locate current entrypoints, tests, fixtures, and related utilities.
- Persist findings into this plan under `### Discovery findings`, or into a linked durable artifact named here.
- Do not change source behavior.

### Verification

Run the smallest safe discovery commands or code navigation steps needed.

Expected proof:

- Record exact files, symbols, and commands found for later tasks.
- Update dependent tasks so they reference the persisted findings section or artifact.

### Stop conditions

- Stop if no existing implementation surface can be found.
```

End every plan, or the final slice in a split plan, with a non-task completion audit section. Do not give the audit section `Implemented`, `Verified`, or `Reviewed` lifecycle checkboxes, because `/addy-auto` treats those as normal implementation tasks.

```md
## Completion audit

- [ ] Every preceding implementation task has implementation, verification, and review evidence.
- [ ] All specified verification commands pass.
- [ ] No unrelated files changed.
- [ ] Plan checkboxes reflect real completed phases only.
```

The completion audit is checked during finish/review reporting, not run as its own build → verify → review lifecycle task.

For split plans, write a top-level index plan under `docs/plans/` with a markdown table listing each slice file:

```md
| Slice | Plan                                                   | Purpose    |
| ----- | ------------------------------------------------------ | ---------- |
| 01    | `docs/plans/YYYY-MM-DD-feature-slice-01-foundation.md` | Foundation |
```

Then write each slice as its own dated `docs/plans/...slice-NN-...md` file containing only that slice's tasks.

Each slice plan must be independently runnable by `/addy-auto`: include enough context, verification, proof requirements, dependencies, and stop conditions for an autonomous agent to complete that slice without reading unrelated slice files except the index and explicitly linked dependencies.

Avoid vague tasks:

```md
## Task 2: Improve validation
```

Prefer executable tasks:

```md
## Task 2: Reject invalid workflow state payloads

### Verification

Run `npm test -- workflow-state-codec`.

Expected proof:

- A regression test fails before implementation and passes after implementation.
- Invalid payloads return a structured error instead of throwing.
```

Do not implement until user explicitly orders implementation.
