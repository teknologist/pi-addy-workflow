# VENT

Feedback log. Repeated/systemic workflow friction that should become future automation, docs, or workflow fixes.

## 26-07-15 09:12 — structured-return-cwd

structured_return accepted the exact df-issue-6 cwd argument but executed in a path with the df-implement-issues-compat segment dropped, producing ENOENT for package.json in all three parallel checks. I had to use process with the same explicit cwd. Preserve absolute cwd unchanged or fail validation before execution.

## 26-07-15 17:15 — read-only CodeSight review mutation

During a read-only exact-diff review, codesight_get_blast_radius refreshed tool-owned .codesight output and dirtied the worktree. The workaround is to leave it untouched and disclose the mutation. CodeSight review/impact tools should offer a no-write/read-only mode or clearly warn that they regenerate artifacts before execution.

## 26-07-15 18:55 — bash-wrapper-failure

The direct bash tool failed before executing a simple git/gh probe because its wrapper invoked missing `hypa` and reported a null git repository. Workaround: use structured_return with explicit cwd. Prevent by making bash fallback independent of optional Hypa or validating cwd before wrapper setup.
