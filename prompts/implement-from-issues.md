---
description: Implement ready repo-local issues produced by /to-issues [LABEL=ready-for-agent]
argument-hint: "[label-or-plan] [label=...] [plan=docs/plans]"
---

# Implement From Issues

Implement repo-local ready issues produced by `/to-issues`, using the current repository as the source of truth for project instructions, issue-tracker setup, verification commands, and optional plan context.

This command is the implementation companion to `/to-issues`: `/to-issues` creates AFK-ready issues; `/implement-from-issues` consumes the ready issues and drives implementation, verification, review, commits, and final validation.

## Continuation contract (read first, overrides everything below)

You are an autonomous AFK runner. You own the entire selected issue queue from start to finish, without human intervention. This contract dominates every other instruction in this file: where any later step, review boundary, or lower-level command implies a pause, this contract wins.

- **The default action is always to continue.** Producing a summary, finishing a phase, converging a subagent, or hitting a failing check is never, by itself, a reason to stop or yield control.
- **You do not yield control until either:** every selected issue is `Done` and final validation is complete, or you hit one of the explicitly enumerated legal stop conditions in "Legal stop conditions" below. Nothing else ends the run.
- **Blocked vs. friction.** Only a state that genuinely requires a human decision is "blocked." A failing test, a red typecheck, a review finding, a stale test expectation, a dirty tree, or a knowable-but-tedious next step is "friction" — normal work in progress, never a stop. See "Recoverable states — never stop."
- **Turn-end self-check (mandatory before ending any turn).** Ask, in order:
  1. Is the queue empty AND is all work committed and moved to `Done` AND is final validation complete? If yes → you may finish.
  2. If no → is the next concrete step knowable without a human decision? If yes → **do it now. Do not summarize, do not report, do not ask.**
  3. Only if the next step is genuinely unknowable without a human, and it matches a "Legal stop condition," may you stop — and then you must state exactly what you need to resume.
- Never end a turn with a clear pending next step. Never stop to "report progress" — progress goes in issue-tracker comments while you keep working.

## AFK loop marker contract

At every assistant yield or final response, the final non-empty line must be exactly one `AFK-LOOP:` marker:

```text
AFK-LOOP: CONTINUE issue=<id-or-none> next="<next concrete action>"
AFK-LOOP: RUN-COMPLETE remaining=0 evidence="<tracker/final-validation evidence>"
AFK-LOOP: LEGAL-STOP condition=<1-8> needs="<human input needed>"
```

Rules:

- Use exactly one marker line, and put it last.
- `RUN-COMPLETE` is only valid after checking the configured tracker queue and verifying no selected labeled issues remain outside `Done`.
- `LEGAL-STOP` is only valid for the closed legal-stop list below.
- `CONTINUE` means work remains or the next step is known.
- If the marker is missing or malformed, an AFK wrapper may treat the stop as accidental and re-wake the run.

## External issue-progress publication

Publish a fail-open external progress run for this invocation. It is an Addy-owned display projection, not workflow state: do not alter Addy lifecycle, auto, reset, dispatch, statistics, warnings, runner-lock state, or the AFK extension.

- At the beginning of the direct run and every AFK wake-up, call `addy-progress start --cwd <absolute current working directory> --source implement-from-issues`. Save its one-line UUID output as the current run. `start` is idempotent for this cwd/source, so it recovers the same running or blocked run without another store or marker field.
- If a previous quoted `RUN-COMPLETE` `evidence` payload is available, extract `addy-run=<uuid>` only from that payload and only if it is a valid UUID. Never extract a token from `next`, `needs`, ordinary response text, tracker text, or any new marker field. A `CONTINUE` or `LEGAL-STOP` marker has no `evidence` payload and therefore resumes through idempotent `start`.
- Preserve the three marker grammars above exactly. Do not add an AFK marker field, and never put a run token in `next` or `needs`. When emitting `RUN-COMPLETE`, append `addy-run=<uuid>` inside its existing quoted `evidence` value.
- After `start`, use `addy-progress update --cwd <absolute current working directory> --source implement-from-issues --run <uuid> --stdin` for only display-safe JSON facts already known to this prompt: `status`, `loopPhase`, `progressUnit`, `completed`, `total`, and a neutral `currentItem` such as `issue #123`. Send JSON through stdin; never shell-interpolate issue titles, tracker comments, prompt text, logs, arguments, raw results, tokens, secrets, or other tracker content.
- Publish `pre-loop` briefly during orientation, `queue` after the selected issue count is known, `implementation` for the current issue, `verification`, `review-fix`, `commit-merge`, and `post-loop` during final validation. Use `progressUnit: "issues"`; set counters only after their values are established and do not invent progress.
- If an existing legal stop requires a human, publish `status: "blocked"` with the known phase and a neutral identifier; after restart, resume the same run with `status: "running"`. A technical terminal failure uses `addy-progress finish --cwd <absolute current working directory> --source implement-from-issues --run <uuid> --stdin` with the same display-safe JSON payload plus `status: "failed"`; successful final validation uses that exact command with `status: "completed"` and `loopPhase: "post-loop"`. Retry the same stdin payload exactly once if `finish` fails.
- Treat every `start` or `update` failure as a warning and continue the existing implementation/legal-stop behavior. For `finish`, retry exactly once; if it still fails, warn and continue. Progress publication must never replace or bypass the legal-stop rules.

## Arguments

Raw argument: `$@`

Interpret arguments leniently:

- Default issue label: `ready-for-agent`.
- Default plan search path: `docs/plans` under the current repo root.
- If the raw argument is empty, use the defaults.
- If an argument is `label=...`, `--label=...`, or `LABEL=...`, use that value as the issue label.
- If an argument is `plan=...`, `--plan=...`, `PLAN=...`, or an existing file/directory path, use that as the plan file/directory or plan search path. Resolve relative paths from the current repo root.
- If a single unkeyed argument is not an existing path, treat the full raw argument string as the issue label. Labels may contain spaces if the user invokes the command with a quoted argument.

## Plan context policy

The plan path is optional context, not the primary work source.

- Primary sources of truth: selected issue text, issue acceptance criteria, issue relationships/dependencies, issue comments, and current repo instructions (`AGENTS.md`, `CLAUDE.md`, etc.).
- Plan docs are supporting context only: use them to recover cross-issue ordering, architecture decisions, smoke-test/benchmark expectations, or dependency rationale that may have been summarized out of individual issues.
- By default, look under `<repo>/docs/plans` for relevant plan docs referenced by the issues or matching the repo/feature. Do not read unrelated plans just because they exist.
- If no relevant plan docs exist under the default path, continue from the issues and repo docs.
- If the user supplied an explicit plan path and it cannot be read, do not silently ignore it: attempt reasonable recovery (correct the path, search the default `docs/plans` location, derive the same context from the issues). Continue if the issues and repo docs are sufficient to proceed correctly. Only if that plan context is genuinely required to implement or order the issues correctly, and cannot be recovered, is this a legal stop (condition 4/5).
- Never import plan context from another repository unless the current repo's issues or instructions explicitly reference it.

## Repository and issue-tracker setup

1. Identify the current repository from the current working directory/git root.
2. Respect the issue tracker setup from the current repo's `AGENTS.md`/`CLAUDE.md`, just as `/to-issues` does. Use the configured tracker, labels, status names, and repo-specific workflow.
3. If the repo does not clearly define its issue tracker or workflow, stop and ask before mutating issues.
4. Use tracker-specific tools correctly:
   - Linear: use the **Linear skill** for every read, comment, issue update, status update, label query, and acceptance-criteria checkbox update. Do not use raw Linear API calls or curl.
   - GitHub: use `gh` and the GitHub CLI skill/workflow.
   - GitLab: use `glab` and the GitLab CLI skill/workflow.

## Critical issue-tracker comment log

This is non-negotiable: keep the issue tracker as the live work log for every issue.

- Add comments throughout the cycle, not only at the end.
- Comment when starting implementation, after each meaningful implementation chunk, after every verification run, after `/code-review` or the repo's equivalent review workflow, after each fix pass, and after committing.
- Comments must say what changed, why it changed, what commands/checks ran, what passed/failed, what review findings were found, what fixes were applied, and the commit hash once committed.
- If a step is too small to deserve its own comment, include it in the next progress comment before moving phases.
- Never move to the next issue with undocumented implementation, review, fix, verification, or commit work.
- If issue-tracker comments cannot be created or updated **after reasonable retries**, this is the log-integrity legal stop (condition 6): stop and report. Do not continue silently. A single transient failure is friction — retry, do not stop.

## Issue completion policy

Do not leave issues in `In Review` after the agent-owned review/fix loop has converged.

- An issue is ready for `Done` when its required implementation is complete, its issue-level verification passes, acceptance criteria are checked/updated where supported, and `/code-review` or the repo's equivalent review workflow reports zero actionable surface findings.
- After that convergence, commit the issue's changes, add the commit/evidence comment, and move the issue to `Done` before starting the next issue.
- Do **not** keep the issue in `In Review` waiting for later human review, CI, final live smoke, or plan-level final validation unless the issue's own acceptance criteria explicitly make that step required for that individual issue.
- If later final validation finds a defect, move/reopen the relevant issue according to the repo's tracker workflow, fix it, rerun verification/review, recommit, and move it back to `Done` once the loop converges again.

## Mandatory review evidence gate (parent-owned, including subagent runs)

Code review is never implicit and a subagent saying “reviewed” is not evidence. For every issue:

1. Run code review as the final implementation phase against that issue's exact diff, acceptance criteria, and repo rules. Self-review by the implementation agent is allowed; a fresh/read-only reviewer may be used but is not required.
2. Preserve the full review output before fixes. Record reviewer/run identity, exact commit or diff range, findings with severity and file/line, and artifact/session path when available.
3. The parent orchestrator must inspect the raw review artifact/output. Never trust only a subagent summary or `green`, `applied`, or `No issues found` field.
4. Immediately post a separate issue-tracker comment after **every** review pass, including clean passes. Include `Review pass N`, reviewer/run identity, exact SHA/diff, all findings or exact `No issues found`, artifact/session path, and fixes/verification from the previous pass.
5. Fix findings, verify, and rerun a fresh review until zero actionable findings. Keep every pass chronological; never replace earlier findings with only the final result.
6. Before commit/`Done`, re-read issue comments and prove the complete trail exists. Missing review comments withhold `Done`; add them only from real artifacts, never reconstructed or invented evidence.

This gate also applies when this command runs inside a Pi subagent. The child owns the final review → fix → review loop and returns raw evidence for every pass; the parent verifies it and owns tracker comments/status.

## Required skills and tools

- Use the current repo's configured issue-tracker tooling.
- Use git and the repo's configured verification commands.
- Use `/code-review` when available; otherwise use the repo's documented review workflow.
- Use specialized subagents for focused work when helpful. Pick agents by task type (for example: scout/researcher for discovery, planner for sequencing, backend/frontend/fullstack implementers for changes, test-engineer for verification, code-reviewer/reviewer for reviews, performance-auditor for benchmarks, security-auditor when the issue touches auth/secrets/data exposure).
- Use existing issue workflow commands where they fit, but this command is an orchestrator that continues across implementation, review, commit, and the next issue. Per the Continuation contract, a lower-level command's one-step STOP boundary never ends this run — absorb its result and keep driving.

## Subagent orchestration

- The parent agent remains the orchestrator and owns issue-tracker comments, status changes, acceptance checkbox updates where supported, final verification decisions, and commits.
- Subagents may implement, investigate, review, test, benchmark, or smoke-test, but they must return concise evidence that can be copied into issue comments: changed files, commands run, results, findings, fixes, risks, and proposed next step.
- Before launching implementation subagents, give each one the relevant issue text, dependency graph context, relevant plan slices if any, repo instructions, acceptance criteria, and required verification commands.
- Use isolated worktrees for parallel implementation when available and when issues are independent. Do not run parallel subagents against the same working tree if they may edit overlapping files.
- If parallel subagent output creates conflicts or overlapping changes, halt *parallel execution* and resolve the conflict deliberately and serially, then continue — do not merge blindly, and do not yield control. This is friction, not a legal stop.
- Use specialist review subagents after implementation when helpful, but still run `/code-review` or the repo's equivalent review workflow as the required surface review loop.

## Legal stop conditions (the only reasons to yield control)

This is a closed list. If the situation is not on this list, you must keep working — see "Recoverable states — never stop." A legal stop is only permitted when the next step genuinely requires a human decision and no issue text, plan doc, or repo instruction resolves it. Before invoking any of these, exhaust the recovery paths described elsewhere in this file.

1. The current repository cannot be identified.
2. The repo's issue tracker or issue workflow cannot be identified.
3. The labeled issue set cannot be fetched at all.
4. After reading the full issue set and relevant plan references, you still cannot identify which repo-local issues are in scope, **and** guessing could implement the wrong thing.
5. The dependency/order among selected issues remains genuinely ambiguous after reading issues, relationships, comments, and relevant plan docs — such that a wrong order could corrupt work.
6. A required issue-tracker mutation (checkbox, status, `Done` transition, or progress comment) still fails after reasonable retries (the log-integrity gate).
7. An action would be destructive or irreversible (e.g. force-push, history rewrite, data loss) and has no safe default.
8. A required final smoke test or benchmark is specified by the issues/plan/repo docs, but its instructions cannot be derived without guessing.

When you stop under this list, state exactly what is blocking you and what input would let you resume.

## Recoverable states — never stop, keep working

The following are normal work in progress. None of them is a legal stop condition. Treat each as "the loop continues," not "the run ends":

- **Failing test, typecheck, lint, or build.** Fix it — including updating tests whose expectations lag a deliberate API/lifecycle change — then re-verify. A red check is the signal to keep going, not to stop.
- **`/code-review` (or equivalent) findings, or non-convergence.** Fix actionable findings, re-verify, and re-review; repeat until zero actionable surface findings. Non-convergence only becomes a stop after multiple genuine, documented fix attempts with the reasoning recorded in issue comments — and even then only if resolution requires a human decision.
- **Dirty working tree mid-issue.** Resolve it (finish, commit, or deliberately revert) and continue.
- **A knowable next step that is merely tedious or large.** Do it.

Explicitly forbidden stopping points: stopping to summarize progress; stopping after a verification failure whose fix is knowable; stopping because a subagent or lower-level command returned and "normally has a one-step STOP boundary"; ending a turn with a clear pending next step; pausing to await confirmation between issues.

## Overall workflow

### 1. Orient and select issues

1. Identify the current repo root and repository name.
2. Read repo instructions (`AGENTS.md`, `CLAUDE.md`, and equivalent local context files) to confirm issue-tracker workflow, statuses, labels, verification commands, and commit conventions.
3. Resolve the optional plan context:
   - use an explicit `plan=...` path if provided;
   - otherwise inspect only relevant docs under `docs/plans` when issues reference a plan or when issue ordering/validation is underspecified;
   - continue without plan docs when the default path is absent or irrelevant.
4. Fetch **all** issues with the selected label — in every status. Do not add a status filter to the label query. You need the full labeled set to build the dependency graph; status-based narrowing comes after reading.
   - When selecting which issues to implement, consider only non-terminal statuses (e.g. Todo, Backlog, In Progress, In Review). Issues in terminal states (Done, Canceled, Closed) are not implementation candidates — their dependency edges may still inform ordering for sibling issues.
   - For Linear, filter by label **and project** in the initial query (`labels: { some: { name: { eq: "<label>" } } }, project: { id: { eq: "<projectId>" } }`, or the Linear skill's `listIssues({ projectId, labels: [...] })`). Do not list a large page and call `readIssue()` for every issue just to test labels.
   - **For Linear, you MUST pass `projectId` to `listIssues`** — `teamKey` filters by team, not project, so a label-only query returns issues from every project in the team. Resolve `projectId` in this order:
     1. **Check existing config**: `docs/agents/issue-tracker.md` (the standard tracker config location per `setup-matt-pocock-skills`), then `.sandcastle/sandcastle.config.json` (`linear.projectId`) if the repo uses Sandcastle, or any other tracker config file.
     2. **Auto-resolve from repo name**: if not found, derive the repo name from `basename "$(git rev-parse --show-toplevel)"`. Use the Linear skill's project APIs; if scripting against the skill package, follow its `SKILL.md` import reference and call: `import { getDefaultProfile, listProjects } from './src/index.js'; const projects = await listProjects(getDefaultProfile());`. Find projects whose `name` matches the repo name (case-insensitive, exact match first; then `name.toLowerCase().includes(repoName.toLowerCase())`). If exactly one match, use its `id`.
     3. **Ask if ambiguous**: if multiple matches, use the `ask_user_question` tool to ask the user which Linear project this repo maps to — present the top 2–4 matches as options with name, id, and description. If zero matches, ask them to provide a project name/id to search (the tool's custom-answer row is acceptable) or stop. Do not guess.
     4. **Store the resolution**: once resolved, persist `projectId` and `projectName` back into `docs/agents/issue-tracker.md` (append a `Linear project: <name> (id: <id>)` line under the conventions section), or into `.sandcastle/sandcastle.config.json` under a `linear` key if the repo uses Sandcastle — so future runs skip resolution. Use those same values in the current query's `listIssues({ projectId, labels: [...] })` call.
     5. **Bail out if unresolved**: if no `projectId` is resolved after these steps, this is a legal stop (condition 2/4) — do not proceed with `teamKey` alone, do not fetch all team issues and try to manually filter by repo name.
5. Read the full issue set before choosing work: issue bodies, relationships, explicit blockers, blocked-by links, parent/child links, comments that mention dependencies, and plan references.
6. Build a dependency graph for the full labeled set, including any blocking issues that are not themselves labeled.
7. Select the ready issues related to the current repository. If the label spans multiple repos and the in-scope subset is ambiguous, stop and ask.
8. Determine the correct implementation sequence from the graph, issue dependencies, acceptance criteria, and relevant plan docs.
9. If independent issues can safely be parallelized without git/file conflicts, note the batch opportunity; otherwise process serially to preserve clean commits and reliable verification.
10. Add an issue-tracker comment to each selected issue noting that `/implement-from-issues` selected it, its order/batch, dependencies, and why it is in scope.

### 2. Implement selected issues in graph order

Process selected issues according to the dependency graph. Prefer serial execution when it keeps commits and verification clearer. Use parallel specialized subagents only for issues in the same independent batch when isolated worktrees are available and file/edit conflicts are unlikely.

For each selected issue, or for each issue inside a safe independent batch:

1. Require a clean working tree before starting the issue. If the tree is dirty from **this run's own work** (e.g. the previous issue), resolve it (commit or deliberately revert) and continue — this is friction, not a stop. Only if the tree contains **unexpected pre-existing changes that this run did not create** (risking clobbering a human's uncommitted work) is this a legal stop; report the dirty files and what you need to proceed.
2. Read the full issue: title, description, comments, acceptance criteria, dependencies, linked docs, and linked PR/MR references.
3. Move the issue to an appropriate in-progress status if it is not already there.
4. Add a start comment with:
   - selected issue order,
   - implementation intent,
   - expected verification commands,
   - any assumptions from repo docs or relevant plan docs.
5. Implement only the issue's required scope. Keep the change surgical.
6. Verify at the end of the issue with the repo's relevant tests, typechecks, linters, and any issue-specific checks.
7. For every acceptance criterion that has been met **and verified**, update the issue checkbox/acceptance marker if the tracker supports it. Do not check criteria that were only implemented but not verified.
8. Add a verification comment summarizing commands run, relevant outputs, and checked criteria.
9. Run `/code-review` or the repo's equivalent on the uncommitted changes under the Mandatory review evidence gate; save and inspect its concrete output/artifact.
10. Immediately post the required review-pass comment. Fix findings, verify, and post fix evidence without erasing the original findings.
11. Repeat review → comment → fix → verify until a fresh final review is clean; post its clean-pass comment and re-read the issue comments to confirm the trail.
12. Commit the issue's changes before moving on. Prefer the existing repo/issue-specific commit workflow if compatible; otherwise make a normal signed git commit that clearly references the issue.
13. Add an issue commit comment containing the commit hash, summary, verification evidence, review convergence evidence, and remaining risks if any.
14. Move the issue to `Done` now that implementation, verification, review/fix, and commit evidence are complete. Do not leave it in `In Review` for later human/CI/live-smoke acceptance unless that is explicitly an issue-level acceptance criterion.
15. Ensure the working tree is clean, then **immediately select and begin the next ready issue in graph order**. Do not pause, summarize, or await confirmation between issues. Only when the queue is exhausted proceed to Final validation.

### 3. Final validation

After all selected issues are implemented, committed, and moved to `Done`:

1. Derive final validation from the selected issues, relevant plan docs, and repo docs.
2. If an end-to-end smoke test is required or documented, run the most realistic one available, including any required containers/services using the repo's documented startup path.
3. If a benchmark or path comparison is required or documented, derive the exact scenario, metrics, and commands from the issues/plan/repo docs, then run and record comparable evidence.
4. If no plan-level smoke test or benchmark is specified, run the repo's standard post-change verification and explicitly report that no additional plan-level final validation was found.
5. Capture exact scenario, commands, inputs, outputs, and pass/fail evidence for any final validation performed.
6. If final validation exposes a defect, map it back to the relevant issue, move/reopen it according to the repo workflow, fix it, re-run verification and review, commit the fix, and move it back to `Done` once the loop converges again.
7. Add a final summary comment to all selected issues with final validation results.

## Final response

When done, report:

- selected label,
- selected plan context, or `none` if no relevant plan docs were used,
- implemented issue IDs in order,
- commits created,
- per-issue verification summary,
- review loop outcome,
- final validation evidence,
- any risks or follow-up work.

Do not claim completion if any acceptance criterion, verification, issue-tracker update, commit, required final validation, or required benchmark step is missing.
