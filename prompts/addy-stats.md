---
description: "Addy workflow: show current workflow stats"
thinking: low
argument-hint: "[plan-path]"
---

# Addy Stats

Pi adaptation of Addy workflow stats inspection.

Argument: `/addy-stats [plan-path]`.

Supplied plan path argument, if any: `$ARGUMENTS`.

Use the supplied plan path when present; otherwise use the active Addy workflow plan from workflow state when available.

This command is read-only:

- Do not edit source files.
- Do not edit plan checkboxes.
- Do not run build, verify, review, fix, finish, commit, ship, or reset workflows.
- Do not clear, archive, or mutate Addy workflow stats.

Report the current task/slice totals for the active or supplied plan, including:

- Turns
- Review runs
- Issues by Critical, Important, Suggestion, and Unknown buckets

If no stats exist for the selected scope, say `No Addy stats recorded yet`.
