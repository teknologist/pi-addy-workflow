---
name: code-review-and-quality
description: Review changes for correctness, readability, architecture, security, and performance. Use for /addy-review.
---

# Code Review and Quality

Review in severity order:

1. Correctness and spec fit.
2. Test coverage and regressions.
3. Readability and maintainability.
4. Architecture, project conventions, and ADR constraints from the active plan/spec. Treat violations of linked ADRs, missing superseding ADRs, or skipped plan `must not` guardrails as review findings.
5. Security and performance risks.

Use concrete file paths and line numbers. If clean, say `No issues found` and state checked scope.
