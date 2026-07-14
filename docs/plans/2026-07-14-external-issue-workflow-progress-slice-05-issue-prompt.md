# Slice 05 — `/implement-from-issues` publication

## Task 1: Publish one issue run across direct and AFK invocation

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Slice 02.

### Objective

Instrument the managed `/implement-from-issues` prompt so direct and `/implement-afk-issues`-supervised execution publish one fail-open external progress run.

### Context / files

Required context:

- Spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`
- Steering: global and repository `AGENTS.md`
- Managed source: `/Users/eric/.local/share/chezmoi/dot_pi/agent/prompts/implement-from-issues.md`
- Applied prompt: `/Users/eric/.pi/agent/prompts/implement-from-issues.md`
- Slice 02 CLI contract and verified PATH discovery.

Likely files:

- Managed and applied prompt paths above.
- `tests/external-progress.test.ts` only if a portable prompt-contract fixture already exists; do not make the package suite depend on one user's home path.

### Implementation steps

1. Run `chezmoi source-path` and confirm the managed source above before editing.
2. Add startup instructions that recover a valid `addy-run=<uuid>` only from the existing quoted AFK `evidence` payload; otherwise call idempotent `start` with the current cwd/source.
3. Publish issue-level `pre-loop`, `queue`, `implementation`, `verification`, `review-fix`, `commit-merge`, and `post-loop` checkpoints from facts the prompt already owns.
4. Publish `blocked` only for an existing human-required legal stop; resume the same run to `running`. Finish technical termination as `failed` and success as `completed`.
5. Send JSON over stdin without shell-interpolating tracker text. Warn and continue on start/update failure; retry finish exactly once, then warn and continue.
6. Ensure every yielded AFK marker retains its original grammar and includes literal `addy-run=<uuid>` inside the quoted `evidence` text. Apply the managed source with chezmoi.

### Acceptance criteria

- Direct and supervised execution reuse one run ID across turns/wake-ups.
- No new AFK marker field is introduced; `next` and `needs` are not used for the token; the AFK extension is untouched.
- Updates use source `implement-from-issues`, current cwd, and only issue-tracker facts already established.
- Publisher failures never stop implementation or bypass the prompt's existing legal-stop rules.
- No prompt text, tracker comments, logs, arguments, secrets, or raw results enter snapshots.

### Verification

Run:

```sh
chezmoi diff /Users/eric/.pi/agent/prompts/implement-from-issues.md
chezmoi apply /Users/eric/.pi/agent/prompts/implement-from-issues.md
command -v addy-progress
npm test
npm run typecheck
npm run format:check
```

Expected proof:

- Inspect the managed/applied diff and show the unchanged AFK marker grammar plus literal token extraction from `evidence` only.
- Direct invocation persists one run through multiple turns.
- `/implement-afk-issues` wake-up reuses that UUID and does not create a second active run.
- Simulated CLI errors produce warnings while prompt execution continues.

### Stop conditions

- Stop if the applied prompt is not chezmoi-managed as expected.
- Stop if preserving the run requires changing the AFK extension/grammar or placing the token outside existing quoted evidence.
