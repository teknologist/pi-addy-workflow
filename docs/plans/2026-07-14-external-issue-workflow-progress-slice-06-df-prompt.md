# Slice 06 — `/df-implement-issues` publication

## Task 1: Publish serialized aggregate-wave checkpoints

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Slice 02.

### Objective

Instrument the managed DF prompt and its embedded workflow script to publish one aggregate-wave run while leaving issue-level live-agent detail to `pi-dynamic-workflows`.

### Context / files

Required context:

- Spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`
- Steering: global and repository `AGENTS.md`
- Managed source: `/Users/eric/.local/share/chezmoi/dot_pi/agent/prompts/df-implement-issues.md`
- Applied prompt: `/Users/eric/.pi/agent/prompts/df-implement-issues.md`
- Slice 02 CLI contract and verified PATH discovery.

Likely files:

- Managed and applied prompt paths above.

### Implementation steps

1. Run `chezmoi source-path` and confirm the managed source before editing. Replace the prompt's local “workflow script unchanged” instruction only as needed to permit this approved instrumentation; do not change the workflow tool/package.
2. Start/reuse one source `df-implement-issues` run before the workflow call, pass its UUID as an immutable workflow argument, and return it in the workflow result.
3. Add serialized aggregate checkpoints around each dependency wave: `queue`, `implementation`, and an explicit `verification` gate after parallel implementation returns.
4. Keep implementation agents parallel, but make progress publication serialized. During the already-serial review/merge path, publish `review-fix`, reverification, `commit-merge`, and completed-wave counters at the exact owning steps.
5. Return to `queue` between waves; publish brief `pre-loop` and `post-loop` boundaries and terminal `completed`/`failed` outcome.
6. Use only aggregate wave facts already owned by the workflow. Do not parse or mirror dynamic-workflow scripts, journals, results, internal run IDs, or agent states.
7. Warn and continue on start/update errors; retry finish exactly once, then warn. Apply the managed source with chezmoi.

### Acceptance criteria

- The outer prompt and embedded workflow use the same Addy run UUID across background delivery/reconciliation.
- Snapshot unit is `waves` when a wave plan exists, otherwise `issues`; `currentItem` describes only aggregate wave/queue context.
- Parallel issue agents never race to publish competing aggregate state.
- Explicit verification and fix/reverification gates are visible before commit/merge.
- Native `pi-dynamic-workflows` remains the sole source of issue-level live-agent detail and is not modified.
- Existing issue implementation, review, merge, attestation, tracker, and crash-resume behavior remains intact.

### Verification

Run:

```sh
chezmoi diff /Users/eric/.pi/agent/prompts/df-implement-issues.md
chezmoi apply /Users/eric/.pi/agent/prompts/df-implement-issues.md
command -v addy-progress
npm test
npm run typecheck
npm run format:check
```

Expected proof:

- Managed/applied diff shows only prompt-owned publication instrumentation.
- A multi-wave dry run shows one UUID, serialized wave counters/phases, explicit verification/review-fix/commit-merge gates, and no issue-level agent fields.
- Background workflow result returns the same UUID used by outer reconciliation.
- Publisher failures warn without changing workflow outcome.

### Stop conditions

- Stop if truthful aggregate publication would require changing `pi-dynamic-workflows`, its grammar/storage, or reading its internal journals/results.
- Stop if instrumentation changes dependency-wave concurrency, serial merge guarantees, tracker mutation gates, or crash-resume semantics.
