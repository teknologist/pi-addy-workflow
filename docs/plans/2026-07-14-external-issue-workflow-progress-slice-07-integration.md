# Slice 07 — Integration and compatibility proof

## Task 1: Prove the complete external progress flow

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Slices 03, 04, 05, and 06.

### Objective

Run the full automated and manual acceptance matrix, fix only integration defects, and leave durable evidence that regular Addy behavior and immutable boundaries remain unchanged.

### Context / files

Required context:

- Spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Steering: `AGENTS.md`
- Slice plans 01–06 and their implementation/verification/review evidence.

Likely files:

- Existing files touched by slices 01–06.
- Tests named by those slices.
- Do not add a new integration framework or production module for this task.

### Implementation steps

1. Verify every preceding slice has concrete implementation, verification, and review evidence; repair missing proof before proceeding.
2. Run all focused tests and the full package commands.
3. Compare widget output and dashboard state with no external snapshots against pre-feature fixtures.
4. Exercise concurrent start/reuse, worktree identity, blocking/resume, stale derivation, finish retry, retention, invalid files, and malicious display strings.
5. Run `/implement-from-issues` directly and under `/implement-afk-issues`; prove one UUID persists across wake-ups.
6. Run `/df-implement-issues` with more than one wave; prove aggregate serialized phases while the native workflow panel retains issue-level live agents.
7. Review the complete diff against the spec, ADR 0001, global/repository guidance, and non-goals. Fix only concrete findings and rerun affected checks.

### Acceptance criteria

- Every acceptance criterion in the spec has command output, test output, or manual observable proof.
- No external data leaves current widget lines and regular dashboard fields unchanged.
- External data never changes Addy lifecycle state, commands, reset/auto behavior, warnings, statistics, runner locks, fencing, dispatch, or stop intent.
- AFK extension/grammar and `pi-dynamic-workflows` files are untouched.
- Only approved snapshot fields are persisted; no sensitive/raw workflow content appears.
- The working tree contains only intended feature, managed-prompt source, plan/spec, and tool-owned `.codesight` changes.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/external-progress.test.ts tests/dashboard-installer.test.ts tests/workflow-widget-presenter.test.ts tests/dashboard-server.test.ts tests/validate-assets.test.ts
npm test
npm run typecheck
npm run format:check
git diff --check
```

Expected proof:

- All commands pass without skips or hidden failures.
- Manual runs produce the exact project/source/run continuity and presentation behavior specified above.
- Final review reports no actionable correctness, security, compatibility, or overengineering findings.

### Stop conditions

- Stop if any immutable boundary is violated or a required check cannot run in the real prompt environment.
- Stop rather than weakening tests, changing the AFK/dynamic-workflow packages, or broadening scope to unrelated Addy behavior.

## Completion audit

- [ ] Every preceding implementation task has implementation, verification, and review evidence.
- [ ] Every spec acceptance criterion maps to concrete proof.
- [ ] All focused and full verification commands pass without skipped failures.
- [ ] Managed prompt sources were applied through chezmoi and match their intended applied files.
- [ ] No unrelated files changed; tool-owned `.codesight` output was not manually altered or reverted.
- [ ] Plan checkboxes reflect real completed phases only.
