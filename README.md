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
- `/addy-auto [plan-path]` — autonomously build, verify, review, and commit tasks from a slice plan
- `/addy-finish` — commit current work, continue the next task or slice, or ship when all slices are complete

### Ticket Slices

Addy can run the same lifecycle against GitHub Issues, Linear issues, or local `/to-tickets` markdown configured by `docs/agents/issue-tracker.md`:

```text
/addy-build --ticket <ticket-ref>
/addy-code-simplify --ticket <ticket-ref>
/addy-verify --ticket <ticket-ref>
/addy-review --ticket <ticket-ref>
/addy-fix-all --ticket <ticket-ref>
/addy-finish --ticket <ticket-ref>
/addy-auto --tickets
/addy-auto --tickets --label <label>
/addy-auto --tickets --status <status>
/addy-stats --ticket <ticket-ref>
/addy-ticket status <ticket-ref>
/addy-ticket release <ticket-ref>
/addy-ticket reclaim <ticket-ref>
/addy-ticket add-repository <ticket-ref> <repository>
```

BUILD may create the Ticket claim. Every later lifecycle command requires the same live claim owned by the current Addy run. While a live or possibly corrupt claim exists, Addy refuses switching to another Ticket or Slice Plan, DEFINE, PLAN, reset, or ship; inspect it with `status` and use `release` when safe. `SIMPLIFY` is optional, manual-only, and does not change lifecycle status. Queue Auto runs mandatory BUILD → VERIFY → REVIEW → FINISH and never inserts SIMPLIFY.

External `/implement-from-issues` progress stays read-only presentation data outside Addy Workflow State and cannot create a Ticket claim, action, lifecycle transition, or runner ownership.

See [Tracker contract coverage and authenticated smoke procedures](docs/ticket-tracker-smoke.md).

## Dashboard

Start a read-only web dashboard for the current project's Addy auto state:

```bash
addy-dashboard
```

By default it serves `http://127.0.0.1:3848` and reads the project-scoped state from `$PI_ADDY_WORKFLOW_STATE_DIR` or `<cwd>/.pi/addy-workflow/state`.

On Pi startup, the package installs a lightweight `addy-dashboard` shim at `~/.pi/agent/bin/addy-dashboard` if needed. The installer runs in the background and does not block startup. To launch from any terminal, add `~/.pi/agent/bin` to your shell `PATH`, then run `addy-dashboard --project-path "$PWD"` from the project you want to inspect.

Options:

```bash
addy-dashboard --port 8080
addy-dashboard --host 0.0.0.0
addy-dashboard --public
addy-dashboard --project-path /path/to/another/project
addy-dashboard --state-dir /path/to/custom/state-dir
```

Inside Pi, run `/addy-dashboard` to start the dashboard for the current project and open `http://127.0.0.1:3848`. Use `/addy-dashboard --public` to bind the server to `0.0.0.0` while still opening the local URL.

The dashboard shows the same core information as the Addy footer: active plan, current phase, current and next task, slice/task/total-task progress, phase status, plus active and completed task stats with time spent per workflow step. `GET /api/state` returns the same snapshot as JSON.

## Runtime behavior

- Bootstrap injects concise `using-addy-workflow` guidance once per session.
- Workflow monitor renders the phase strip with `ctx.ui.setWidget`.
- Slice plans track `[ ] Implemented`, `[ ] Verified`, and `[ ] Reviewed`; workflow prompts keep those checkboxes synchronized with real evidence.
- `/addy-auto` appends scoped recovery guidance to auto-dispatched prompts so routine blockers are investigated with `addy-auto-unblock` before pausing. See [Addy Auto Unblock Flow](docs/addy-auto-unblock-flow.md).
- `/addy-auto` starts from the first unfinished slice when given a slice index plan. By default, auto-dispatched `/addy-*` workflow steps start in fresh Pi sessions when configured; manual `/addy-*` commands run in the current session to avoid replacing the interactive terminal while a command handler is active. The extension creates `~/.pi/agent/addy-workflow.json` with defaults on startup; override per project with `.pi/addy-workflow.json`. Environment overrides include `PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP`, `PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS`, and `PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW`.
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
