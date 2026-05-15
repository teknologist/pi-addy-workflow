# Fix `/addy-finish` commit handoff model warning

## Goal

Fix why `/addy-finish` commit output can show:

```text
Warning: No models match pattern "anthropic/claude-opus-4-7"
```

The model is valid and must not be removed from user config. Current evidence also shows direct spawned `/commit --non-interactive` Pi attempts can stall, while the loaded `/commit` workflow can complete non-interactively across the required repository scope. Treat the visible model warning and the stalled spawned commit handoff as the same `/addy-finish` commit-handoff defect unless investigation disproves that link.

## Non-goals

- Do not remove `anthropic/claude-opus-4-7` from `~/.pi/agent/settings.json` or `~/.pi/agent/council.json`.
- Do not hide all model resolver warnings globally.
- Do not weaken `/addy-finish` commit verification.
- Do not replace valid model config with a fallback model just to silence output.
- Do not change Pi core, the global `/commit` prompt, or provider/model registry code for this fix.
- Do not add a `/refine-plan` loop or require another plan-review/refinement pass before implementation.

## Working hypothesis

`/addy-finish` currently delegates commit work by instructing the assistant to run the user's cross-repo-aware `/commit --non-interactive` workflow. In practice, direct spawned slash-command attempts can stall and can surface Pi model resolver output such as the false-positive Anthropic model warning.

The least invasive Addy-side fix is to stop delegating from `/addy-finish` to a spawned `/commit` command and instead inline equivalent non-interactive commit instructions directly in the `/addy-finish` prompt. The inline instructions should preserve the important `/commit` behavior: authoritative repository scope, multi-repository preview, conventional commit message generation, no duplicate confirmation after the user selected a finish commit action, stop-on-failure semantics, and reporting every commit hash.

## Evidence and safety constraints

- First reproduce or document the observed warning/stall path enough to prove the emitter is the spawned commit handoff or a child process surfaced by that handoff.
- Record only safe diagnostics: cwd, argv/command text, process labels, config file paths, and env key presence/differences.
- Do not persist raw env values, API keys, tokens, full settings files, or provider credentials in docs, tests, or artifacts.
- Use temporary fixture config for any invalid-model warning checks; do not mutate the user's real model config.

## Implementation plan

### Task 1: Confirm the failing commit handoff path

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- Capture where `proc_1` appears and the exact `/addy-finish` action that produced it.
- Confirm whether the warning/stall occurs during direct spawned `/commit --non-interactive` handoff, Addy auto task commit, manual finish commit, or another process.
- Record safe cwd, command/argv, process label, and config-path evidence with secrets redacted.
- Confirm `anthropic/claude-opus-4-7` remains valid in the normal Pi session.

### Task 2: Replace `/commit` delegation in `/addy-finish`

- [x] Implemented
- [x] Verified
- [ ] Reviewed

Acceptance criteria:

- `prompts/addy-finish.md` no longer instructs the assistant to run, spawn, print, or search for `/commit` or `/commit --non-interactive`.
- Each finish commit branch uses inline commit instructions directly in the current assistant turn.
- The inline instructions use the active/supplied plan and index metadata as the authoritative repository scope: current/owner repo, `Repository scope:` entries, `Owner repo`, and `Companion repo`.
- Manual finish choices still use `ask_user_question` for the finish decision, but that answer is the commit confirmation; no second commit confirmation is requested.
- Auto-mode finish commits remain non-interactive and do not call `ask_user_question`.

### Task 3: Mirror the important `/commit` behavior inline

- [x] Implemented
- [x] Verified
- [ ] Reviewed

Acceptance criteria:

- For every scoped repo, inspect staged, unstaged, and untracked changes.
- Skip scoped repos with no changes.
- Stage only changes that belong to the completed task/slice plus plan checkbox/status updates; leave unrelated user work unstaged.
- Generate one meaningful conventional commit message and use it consistently across all scoped repos with relevant changes.
- Show a concise multi-repo commit preview before committing, including repositories with relevant changes and repositories skipped for no relevant changes.
- In non-interactive finish paths, commit directly after the preview without asking again.
- Stop on the first commit failure and report:
  - failed repository;
  - error summary;
  - any repositories already committed;
  - concrete recovery guidance.
- Report each successful commit hash as `COMMIT: <hash>`.
- If no relevant changes exist in any scoped repo, say `No changes to commit` and continue/finish according to the selected `/addy-finish` path.
- Avoid shell substitution pitfalls from `/commit.md`: when a commit message is generated separately, pass the actual message to `git commit -m` rather than relying on unexpanded shell substitution.

### Task 4: Remove warning-specific workaround unless still needed

- [x] Implemented
- [x] Verified
- [ ] Reviewed

Acceptance criteria:

- No broad model-warning suppression is added.
- No valid model configuration is changed.
- If the inline finish commit path eliminates the warning, do not add output filtering.
- If the warning still appears after `/commit` delegation is removed, document the new emitter and add only a narrowly scoped Addy-side mitigation for that exact non-interactive finish path.

### Task 5: Add regression coverage

- [x] Implemented
- [x] Verified
- [ ] Reviewed

Acceptance criteria:

- Update existing tests rather than creating new test files unless the existing files become too large or unclear.
- Cover that expanded `/addy-finish` prompt text does not contain instructions to invoke `/commit` or `/commit --non-interactive` for commit execution.
- Cover that finish commit instructions include authoritative repository scope handling, scoped staging, multi-repo preview, stop-on-failure behavior, and `COMMIT: <hash>` reporting.
- Cover auto-mode finish still avoids `ask_user_question` and remains non-interactive.
- Cover that no recursive `/refine-plan` or plan-refinement loop is introduced by this plan or prompt change.

Validation commands:

```bash
node --experimental-strip-types --test tests/validate-assets.test.ts
node --experimental-strip-types --test tests/workflow-monitor.test.ts
npm run typecheck
```

### Task 6: Manual verification

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Run `/addy-finish` on a safe test plan with a scoped repo setup.

Verify:

- the finish commit path does not invoke or spawn `/commit --non-interactive`;
- the required repository scope is honored;
- only relevant completed task/slice files are staged;
- unrelated dirty files remain unstaged;
- commits are created where appropriate and each hash is reported as `COMMIT: <hash>`;
- if no relevant changes exist, `/addy-finish` reports `No changes to commit` without stalling;
- process output does not contain `No models match pattern "anthropic/claude-opus-4-7"`;
- valid model config remains intact;
- unrelated model resolver warnings still appear in isolated fixture checks when intentionally configured with an invalid model.

## Success criteria

- `/addy-finish` no longer delegates commit execution to spawned `/commit --non-interactive`.
- `/addy-finish` performs commit work inline with the same important safety properties as `/commit`: scoped repository detection, scoped staging, multi-repo preview, conventional message generation, stop-on-failure reporting, and commit hash reporting.
- `/addy-finish` no longer stalls during commit handoff.
- `/addy-finish` no longer leaks the false-positive model resolver warning in commit output.
- `anthropic/claude-opus-4-7` remains configured and usable.
- The fix is covered by regression tests or a repeatable verification harness.
