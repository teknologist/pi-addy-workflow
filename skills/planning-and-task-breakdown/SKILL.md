---
name: planning-and-task-breakdown
description: Break specs into ordered, verifiable tasks. Use for /addy-plan or any implementation plan.
---

# Planning and Task Breakdown

Plan read-only:

1. Read spec and relevant code.
2. Slice vertical user-visible increments.
3. Decide plan packaging before writing files:
   - Use one plan file for small/simple work: 1–5 tasks, 1–2 vertical slices, one main subsystem, low risk.
   - Use an index plan plus multiple slice plan files for larger/riskier work: 6+ tasks, 3+ slices, multiple subsystems, migrations, public API or auth/security changes, risky refactors, staged rollout, or checkpoints that should be reviewed independently.
   - If the choice is unclear or user preference matters, call `ask_user_question` with choices for single file, split by slice, or agent decides before writing files.
4. Add acceptance criteria and verification for each task.
5. Add per-task status checkboxes for `[ ] Implemented`, `[ ] Verified`, and `[ ] Reviewed` so later workflow steps can keep the plan in sync with reality.
6. Mark dependencies and risky checkpoints.
7. Keep plan concise.

For split plans, write a top-level index plan under `docs/plans/` with a markdown table listing each slice file:

```md
| Slice | Plan                                                   | Purpose    |
| ----- | ------------------------------------------------------ | ---------- |
| 01    | `docs/plans/YYYY-MM-DD-feature-slice-01-foundation.md` | Foundation |
```

Then write each slice as its own dated `docs/plans/...slice-NN-...md` file containing only that slice's tasks.

Do not implement until user explicitly orders implementation.
