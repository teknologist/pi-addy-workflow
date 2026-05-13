---
description: "Addy workflow: pre-launch checklist via parallel fan-out and go/no-go decision"
thinking: high
argument-hint: "[plan-path]"
---

# Addy Ship

Pi adaptation of Addy Osmani's `ship` command.

Use the Pi `shipping-and-launch` skill.

Argument: `/addy-ship [plan-path]`.

Supplied plan path argument, if any: `$ARGUMENTS`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, then evaluate the current change against that plan.

`addy-ship` is a **fan-out orchestrator**. It runs three specialist personas in parallel against the current change, then merges their reports into a single go/no-go decision with a rollback plan. The personas operate independently — no shared state, no ordering — which is what makes parallel execution safe and useful here.

## Phase A — Parallel fan-out

Spawn three subagents concurrently with the Pi `subagent` tool in parallel mode. Before spawning, call `subagent({ action: "list", agentScope: "user" })` and use available user-scoped agents. Do not pass explicit model overrides.

Preferred personas:

1. **`addy-reviewer`** — Run a five-axis review (correctness, readability, architecture, security, performance) on the staged changes, unstaged changes, or recent commits. Output the standard review template.
2. **`addy-security-auditor`** — Run a vulnerability and threat-model pass. Check OWASP Top 10, secrets handling, auth/authz, dependency CVEs. Output the standard audit report.
3. **`addy-test-engineer`** — Analyze test coverage for the change. Identify gaps in happy path, edge cases, error paths, and concurrency scenarios. Output the standard coverage analysis.

If one of these exact agents is unavailable, use the closest available user-scoped addy-prefixed reviewer/security/test agent. If no good fallback exists, perform that persona's review in the main context and clearly mark it as main-context review.

Constraints:

- Subagents should not spawn other subagents.
- Each subagent gets its own context and returns only its report to this main session.
- The main agent merges the reports in Phase B.

## Phase B — Merge in main context

Once all three reports are back, the main agent synthesizes them:

1. **Code Quality** — Aggregate Critical/Important findings from `addy-reviewer` and any failing tests, lint, or build output. Resolve duplicates between reviewers.
2. **Security** — Promote any Critical/High `addy-security-auditor` findings to launch blockers. Cross-reference with `addy-reviewer`'s security axis.
3. **Performance** — Pull from `addy-reviewer`'s performance axis; cross-check Core Web Vitals if applicable.
4. **Accessibility** — Verify keyboard nav, screen reader support, contrast (not covered by the three personas — handle directly here, or invoke the accessibility checklist).
5. **Infrastructure** — Env vars, migrations, monitoring, feature flags. Verify directly.
6. **Documentation** — README, ADRs, changelog. Verify directly.

## Phase C — Decision and rollback

Produce a single output:

```markdown
## Ship Decision: GO | NO-GO

### Blockers (must fix before ship)
- [Source persona: Critical finding + file:line]

### Recommended fixes (should fix before ship)
- [Source persona: Important finding + file:line]

### Acknowledged risks (shipping anyway)
- [Risk + mitigation]

### Rollback plan
- Trigger conditions: [what signals would prompt rollback]
- Rollback procedure: [exact steps]
- Recovery time objective: [target]

### Specialist reports (full)
- [addy-reviewer report]
- [addy-security-auditor report]
- [addy-test-engineer report]
```

## Rules

1. The three Phase A personas run in parallel — never sequentially when suitable subagents are available.
2. Personas do not call each other. The main agent merges in Phase B.
3. The rollback plan is mandatory before any GO decision.
4. If any persona returns a Critical finding, the default verdict is NO-GO unless the user explicitly accepts the risk.
5. Skip the fan-out only if all of the following are true: the change touches 2 files or fewer, the diff is under 50 lines, and it does not touch auth, payments, data access, or config/env. Otherwise, default to fan-out.
6. Do not deploy, commit, or push unless the user explicitly asks.
