# pi-addy-workflow

Addy Osmani agent-skills workflow for Pi coding agent.

## Install

```bash
pi install git:github.com/teknologist/pi-addy-workflow
```

## Workflow

```text
[DEFINE] → [PLAN] → BUILD → [SIMPLIFY] → VERIFY → REVIEW → [FIX → VERIFY → REVIEW] → [FINISH]
```

Only `BUILD → VERIFY → REVIEW` is enforced. `DEFINE`, `PLAN`, `SIMPLIFY`, `FIX`, and `FINISH` are optional aids; users can run many build/verify/review slices or fix/verify/review loops before finishing.

Prompts:

- `/addy-define [spec-path|"build idea"]` — clarify requirements and write a timestamped spec
- `/addy-plan` — break spec into small verifiable tasks
- `/addy-build` — implement incrementally with tests
- `/addy-code-simplify` — simplify code without changing behavior
- `/addy-verify` — run TDD or Prove-It bug workflow
- `/addy-review` — review correctness, quality, security, performance
- `/addy-fix-all` — fix surfaced review issues and suggestions, then rerun review
- `/addy-finish` — commit current work, continue the next task or slice, or ship when all slices are complete

## Runtime behavior

- Bootstrap injects concise `using-addy-workflow` guidance once per session.
- Workflow monitor renders the phase strip with `ctx.ui.setWidget`.
- Slice plans track `[ ] Implemented`, `[ ] Verified`, and `[ ] Reviewed`; workflow prompts keep those checkboxes synchronized with real evidence.
- Agent installer syncs bundled agents into `~/.pi/agent/agents/pi-addy-workflow/` for pi-subagents discovery.

`todo` and `subagent` are optional companion tools. Missing tools warn but do not block session start.

## Commands

- `/addy-workflow-reset` clears workflow state and widget.
- `/addy-workflow-next <define|plan|build|simplify|verify|review|finish> [artifact]` opens the matching Addy prompt.
- `/addy-fix-all` is an optional post-review loop prompt; invoke it directly rather than through `/addy-workflow-next`.

## Uninstall note

Pi package removal may not remove synced generated agents. Delete this directory manually if needed:

```bash
rm -rf ~/.pi/agent/agents/pi-addy-workflow
```

## Development

```bash
npm test
npm pack --dry-run
```

Do not deploy, push, or publish unless explicitly requested. Before publishing, verify GitHub CLI auth:

```bash
gh auth status
gh api user --jq .login
```

The login must be `teknologist`.
