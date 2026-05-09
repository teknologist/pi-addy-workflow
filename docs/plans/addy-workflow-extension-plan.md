# pi-addy-workflow implementation plan

## Objective

Build `pi-addy-workflow` in `~/Dev/pi-addy-workflow`: a self-contained Pi package that installs Addy Osmani's agent-skills workflow into Pi.

Workflow:

```text
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
```

Packaged slash prompts:

```text
/addy-spec
/addy-plan
/addy-build
/addy-test
/addy-review
/addy-code-simplify
/addy-ship
```

Source patterns:

- Use `casualjim/pi-superpowers` for package shape, bootstrap injection, workflow tracking, and status widget patterns.
- Use `addyosmani/agent-skills` lifecycle semantics.
- Copy already-ported Pi prompts, skills, and agents from `~/.pi/agent` into this package so install is self-contained.

## Fixed decisions

- Slash commands stay `addy-*`; do not add `/spec`, `/plan`, `/build`, `/test`, `/review`, or `/ship` aliases in MVP.
- `/addy-code-simplify` is cross-cutting; it must not advance the lifecycle phase.
- Companion tools `todo` and `subagent` are optional; bootstrap warns when missing but does not block.
- Use `ctx.ui.setWidget`, not `ctx.ui.setFooter`, for the workflow strip. This follows Pi TUI widget docs, preserves Pi's normal footer, and avoids global footer conflicts.
- Package only referenced skills and agents first. Do not copy every local skill/agent.
- Soft workflow warnings only. Do not hard-block user actions in MVP.
- Pi docs natively package extensions, skills, prompts, and themes. Agents are not a native Pi package resource.
- Install bundled agents with a dedicated extension that syncs package `agents/` into `~/.pi/agent/agents/pi-addy-workflow/` for pi-subagents discovery.
- Local package prompts/skills are canonical after install; synced user-level agents are generated install artifacts.
- GitHub remote is `github.com/teknologist/pi-addy-workflow`; push with GitHub CLI `gh` using the `teknologist` account.
- Published install source is `git:github.com/teknologist/pi-addy-workflow`.

## Current findings

- Target repo exists and is empty except `.git`.
- Pi packages support `extensions`, `skills`, `prompts`, and `themes` in `package.json` `pi` manifest or conventional dirs.
- Pi package docs do not support `agents` as a package resource key.
- pi-subagents discovers agents recursively from `~/.pi/agent/agents`, `~/.agents`, and project agent dirs. Package agents must be synced into a discovered dir.
- `pi-superpowers` exposes:
  - `extensions/bootstrap.ts`
  - `extensions/workflow-monitor.ts`
  - `skills/`
  - `agents/` included in package files
- `pi-superpowers` status UI is a widget above the editor via `ctx.ui.setWidget("pi-superpowers-workflow", ...)`.
- Addy prompts exist under `~/.pi/agent/prompts/addy-*.md`.
- Addy-compatible skills and agents exist under `~/.pi/agent/skills` and `~/.pi/agent/agents`.

## Target package layout

```text
pi-addy-workflow/
├── package.json
├── README.md
├── LICENSE
├── extensions/
│   ├── bootstrap.ts
│   ├── agent-installer.ts
│   ├── workflow-monitor.ts
│   └── workflow-monitor/
│       ├── workflow-handler.ts
│       ├── workflow-tracker.ts
│       ├── workflow-transitions.ts
│       └── warnings.ts
├── prompts/
│   ├── addy-spec.md
│   ├── addy-plan.md
│   ├── addy-build.md
│   ├── addy-test.md
│   ├── addy-review.md
│   ├── addy-code-simplify.md
│   └── addy-ship.md
├── skills/
│   ├── using-addy-workflow/
│   ├── spec-driven-development/
│   ├── planning-and-task-breakdown/
│   ├── incremental-implementation/
│   ├── debugging-and-error-recovery/
│   ├── code-review-and-quality/
│   ├── code-simplification/
│   ├── shipping-and-launch/
│   └── <prompt-referenced supporting skills>/
├── agents/
│   ├── addy-planner.md
│   ├── addy-implementer.md
│   ├── addy-reviewer.md
│   └── <other addy-prefixed referenced agents>.md
└── tests/
    ├── agent-installer.test.ts
    ├── bootstrap.test.ts
    ├── validate-assets.test.ts
    └── workflow-tracker.test.ts
```

## GitHub distribution

Required behavior:

- Repository remote must point to `github.com/teknologist/pi-addy-workflow`.
- Verify GitHub CLI auth before publishing:

```bash
gh auth status
gh api user --jq .login
```

- `gh api user --jq .login` must print `teknologist` before publishing.
- Use `gh` for GitHub auth/repository verification before pushing; push to the GitHub remote authenticated as `teknologist`.
- README install command must be:

```bash
pi install git:github.com/teknologist/pi-addy-workflow
```

- Smoke-test install from the GitHub source after pushing:

```bash
pi install git:github.com/teknologist/pi-addy-workflow
```

## Package manifest

Use this initial manifest; adjust import package names only if tests prove the installed Pi runtime requires a different peer package name.

```json
{
  "name": "pi-addy-workflow",
  "version": "0.1.0",
  "description": "Addy Osmani agent-skills workflow for Pi coding agent",
  "type": "module",
  "license": "MIT",
  "keywords": ["pi-package", "pi", "addy", "agent-skills", "workflow"],
  "files": ["extensions/", "skills/", "prompts/", "agents/", "README.md", "LICENSE"],
  "engines": {
    "node": ">=22.6.0"
  },
  "scripts": {
    "test": "node --experimental-strip-types --test tests/*.test.ts"
  },
  "pi": {
    "extensions": ["extensions/bootstrap.ts", "extensions/agent-installer.ts", "extensions/workflow-monitor.ts"],
    "skills": ["skills"],
    "prompts": ["prompts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  }
}
```

Notes:

- Do not add `pi.agents`; Pi package docs list only extensions, skills, prompts, and themes.
- Keep `agents/` in `files` so package installation includes source agent definitions.
- `extensions/agent-installer.ts` is responsible for syncing bundled agents into a pi-subagents discovery directory.
- Agent discovery must be proven in the smoke test after sync.

## Lifecycle mapping

| Stage | Prompt | Required primary skill | Widget phase |
|---|---|---|---|
| DEFINE | `/addy-spec` | `spec-driven-development` | `define` |
| PLAN | `/addy-plan` | `planning-and-task-breakdown` | `plan` |
| BUILD | `/addy-build` | `incremental-implementation` | `build` |
| VERIFY | `/addy-test` | `debugging-and-error-recovery` | `verify` |
| REVIEW | `/addy-review` | `code-review-and-quality` | `review` |
| SHIP | `/addy-ship` | `shipping-and-launch` | `ship` |
| Cross-cutting | `/addy-code-simplify` | `code-simplification` | unchanged |

Supporting skills and agents are copied only when referenced by prompts, primary skills, or included agent configs.

## Agent naming

Use short, collision-resistant runtime names without `package:` frontmatter.

Required behavior:

- All packaged agent filenames and frontmatter names must start with `addy-`.
- Do not add `package: pi-addy-workflow` to agent frontmatter in MVP.
- Prompts and skills must reference the exact `addy-*` runtime names.
- If a source agent has a generic name like `planner`, copy it as `agents/addy-planner.md` and update frontmatter `name: addy-planner`.
- If a source prompt/skill references a generic agent name, rewrite it to the corresponding `addy-*` name.
- Reject implementation if any packaged prompt/skill references a non-`addy-*` packaged agent name.

Canonical MVP agent names:

- `addy-planner`
- `addy-implementer`
- `addy-reviewer`
- `addy-spec-reviewer`
- `addy-release-manager`

## Bootstrap behavior

Adapt `pi-superpowers/extensions/bootstrap.ts`.

Required behavior:

- Marker: `<!-- pi-addy-workflow-bootstrap -->`.
- Inject `using-addy-workflow` once per system prompt.
- Include concise lifecycle guidance:
  - spec before code
  - plan before build
  - build incrementally
  - tests prove behavior
  - review before ship
  - ship with rollback/verification notes
- Explain Pi tool mappings only when useful:
  - task tracking → `todo`
  - delegated agents → `subagent`
  - file reads/writes → Pi file tools
- If `todo` or `subagent` is unavailable, append a warning with install guidance.
- Never block session start because a companion tool is missing.
- Skip bootstrap injection when `PI_SUBAGENT_DEPTH > 0`, matching the superpowers recursion guard.

## Agent installer behavior

Pi docs do not define `agents` as package resources. The package must therefore install agents through an extension.

Required behavior:

- Register sync with exact Pi hooks:
  - `pi.on("session_start", async (_event, ctx) => syncAgents(ctx))`
  - `pi.on("resources_discover", async (_event, ctx) => { await syncAgents(ctx); return {}; })`
- Copy bundled `agents/**/*.md` to `~/.pi/agent/agents/pi-addy-workflow/`.
- Create the target directory if missing.
- Preserve nested directories.
- Write only when content differs.
- Remove stale generated files that no longer exist in bundled `agents/`.
- Never delete files outside `~/.pi/agent/agents/pi-addy-workflow/`.
- Add this exact generated-file notice without breaking YAML frontmatter: `<!-- generated by pi-addy-workflow agent-installer; edit package source instead -->`.
- If an agent starts with `---`, keep frontmatter first and place the notice immediately after the closing `---`.
- If sync fails, show `ctx.ui.notify` warning and keep the session usable.
- Do not require `subagent` to be installed for sync; discovery is verified only when `subagent` exists.

## Workflow monitor behavior

Adapt `pi-superpowers/extensions/workflow-monitor.ts` and tracker files.

Required behavior:

- Widget key: `pi-addy-workflow`.
- State entry type: `pi-addy-workflow-state`.
- Register `/addy-workflow-reset` with `pi.registerCommand("addy-workflow-reset", ...)`; do not create a prompt file for it.
- Register `/addy-workflow-next <define|plan|build|verify|review|ship> [artifact]` with `pi.registerCommand("addy-workflow-next", ...)`; do not create a prompt file for it.
- Phase strip rendering:
  - current: accent `[phase]`
  - complete: success `✓phase`
  - skipped/pending: dim
  - separator: dim ` → `
- Phases:

```ts
export const WORKFLOW_PHASES = ["define", "plan", "build", "verify", "review", "ship"] as const;
```

Prompt transitions:

```text
/addy-spec   -> define
/addy-plan   -> plan
/addy-build  -> build
/addy-test   -> verify
/addy-review -> review
/addy-ship   -> ship
```

No phase transition:

```text
/addy-code-simplify
```

Transition algorithm:

- Every trigger resolves to either one target phase or no phase.
- If there is no current phase, set target phase `active`; earlier phases remain `pending` and a soft warning names the first missing earlier phase.
- If target phase is after current phase, mark the current active phase `complete`, set target `active`, leave skipped intermediate phases `pending`, and warn about the first pending intermediate phase.
- If target phase equals current phase, no state change.
- If target phase is before current phase, reset workflow state, then set target phase `active`.
- `/addy-code-simplify` records no workflow state and never changes current phase.
- Warnings never block tool calls or prompts in MVP.

Trigger table:

| Event source | Exact trigger | Target phase | Extra behavior |
|---|---|---|---|
| user input | contains `/addy-spec` | `define` | prompt trigger wins over artifact triggers in same event |
| user input | contains `/addy-plan` | `plan` | completes current active phase if moving forward |
| user input | contains `/addy-build` | `build` | completes current active phase if moving forward |
| user input | contains `/addy-test` | `verify` | completes current active phase if moving forward |
| user input | contains `/addy-review` | `review` | completes current active phase if moving forward |
| user input | contains `/addy-ship` | `ship` | completes current active phase if moving forward |
| user input | contains `/addy-code-simplify` | none | no phase change |
| file write | `SPEC.md`, `spec.md`, `docs/specs/**`, `docs/prd/**` | `define` | record artifact path |
| file write | `tasks/plan.md`, `tasks/todo.md`, `docs/plans/**` | `plan` | record artifact path |
| file write | source file outside `tests/**`, `docs/**`, `tasks/**`, `agents/**`, `skills/**`, `prompts/**`, `extensions/**` | `build` | ignored if current phase is after `build` |
| file write | `**/*.test.*`, `**/*.spec.*`, `tests/**` | `verify` | ignored if current phase is after `verify` |
| tool result | successful test command detected by command text matching `test`, `vitest`, `jest`, `node --test`, `npm test`, or `pnpm test` | `verify` | record test status if available |
| subagent call | agent name `addy-reviewer` or `addy-spec-reviewer` | `review` | requires `subagent` tool availability |
| file write | `CHANGELOG*`, `RELEASE*`, `docs/releases/**`, `docs/deploy/**` | `ship` | record artifact path |
| command | `/addy-workflow-reset` | none | clear all state and remove widget |
| command | `/addy-workflow-next <phase> [artifact]` | requested phase | open new session prefilled for requested phase |

Warning behavior:

- Warn if a later phase starts before prior phases are complete.
- Warn text must name the missing prior phase and the current requested phase.
- Do not return `{ block: true }` for Addy workflow warnings in MVP.
- Branch/worktree safety reminder appears on first write only.

## Asset-copy rules

Prompts:

- Copy exactly these files from `~/.pi/agent/prompts`:
  - `addy-spec.md`
  - `addy-plan.md`
  - `addy-build.md`
  - `addy-test.md`
  - `addy-review.md`
  - `addy-code-simplify.md`
  - `addy-ship.md`
- Preserve frontmatter.
- Remove or rewrite stale references to Claude plugin installation, absolute local paths, or non-Pi tooling.

Skills:

- Copy each primary skill listed in lifecycle mapping.
- Copy supporting skills only when referenced by included prompts/skills.
- Add `skills/using-addy-workflow/SKILL.md` if no equivalent exists.
- Include nested assets/scripts for each copied skill.

Agents:

- Copy agents referenced by included prompts/skills into package `agents/`.
- Do not copy duplicate `team-package` agent copies.
- Rename copied agents to `addy-*` filenames and frontmatter names.
- Do not add `package: pi-addy-workflow` frontmatter; it would make runtime names `pi-addy-workflow.<name>` in pi-subagents.
- Rewrite all packaged prompt/skill references to the chosen `addy-*` runtime names.
- Remove all hardcoded model/provider defaults from copied agent frontmatter.
- Package is not acceptable until `agent-installer.ts` syncs copied agents into `~/.pi/agent/agents/pi-addy-workflow/` and `subagent({ action: "list", agentScope: "user" })` discovers the `addy-*` names in a clean local install test with `pi-subagents` installed.

## Implementation steps

1. Scaffold package.
   - Create `package.json`, `README.md`, `LICENSE`, `extensions/`, `prompts/`, `skills/`, `agents/`, `tests/`.
2. Port bootstrap.
   - Copy superpowers bootstrap pattern.
   - Rename marker, warning copy, and included workflow skill.
3. Add agent installer.
   - Sync package `agents/` to `~/.pi/agent/agents/pi-addy-workflow/` because Pi package docs do not support native agent resources.
4. Port workflow monitor.
   - Copy superpowers monitor/tracker pattern.
   - Replace phases, prompt mappings, commands, widget keys, state type, warning text.
5. Copy prompts.
   - Copy seven `addy-*` prompt files.
   - Audit and fix stale references.
6. Build dependency inventory.
   - Grep copied prompts/skills for skill and agent names.
   - Produce the minimal copy list before copying broad assets.
   - Build an agent rename map from source names to canonical `addy-*` names.
7. Copy skills and agents.
   - Copy primary skills first.
   - Copy referenced supporting skills/agents.
   - Preserve relative file structure inside each skill.
   - Apply the agent rename map to filenames, frontmatter, prompt references, and skill references.
8. Add tests.
   - Unit-test bootstrap idempotence and companion warnings.
   - Unit-test agent sync path safety, idempotence, frontmatter preservation, generated notice placement, and stale-file cleanup.
   - Unit-test every row in the workflow trigger table.
   - Unit-test asset validation: prompt references, skill relative links/scripts, agent names, and forbidden frontmatter.
   - Unit-test extension entrypoints can import their submodules.
9. Smoke-test package.
   - Install from local path into a clean Pi test environment.
   - Verify prompts, skills, synced agents, and widget behavior.
10. Polish README.
   - Include install command, lifecycle table, prompt table, optional companion notes, and troubleshooting.

## Acceptance criteria

Package structure:

- `package.json` exists and includes `pi-package` keyword.
- `package.json` includes extension, skill, and prompt resources.
- `npm test` script exists.
- Package tarball or local install includes `extensions/`, `skills/`, `prompts/`, `agents/`, `README.md`, and `LICENSE`.

Prompts:

- All seven `prompts/addy-*.md` files exist.
- Each prompt appears in Pi slash command autocomplete after local install.
- Each prompt expands without referencing missing local files.
- No prompt contains `~/.pi/agent`, `.claude`, `/plugin`, or `pi-superpowers`.
- `validate-assets.test.ts` verifies every relative file reference in prompts resolves inside the package.

Skills:

- `using-addy-workflow` exists and describes the lifecycle.
- All primary lifecycle skills exist under `skills/`.
- Referenced supporting skills exist or references are removed.
- `validate-assets.test.ts` verifies skill links/scripts resolve relative to their copied skill directory.

Agents:

- Every agent referenced by packaged prompts/skills exists under `agents/`.
- Every packaged agent filename starts with `addy-`.
- Every packaged agent frontmatter has exactly one `name:` field and it starts with `addy-`.
- No packaged agent has `package: pi-addy-workflow` frontmatter.
- No packaged prompt or skill uses generic packaged agent names in a subagent/tool-call context.
- Packaged prompts/skills reference canonical `addy-*` agent names consistently.
- No packaged agent has a hardcoded model override in frontmatter.
- Synced agents preserve valid YAML frontmatter and include the exact generated-file notice after frontmatter.
- With `pi-subagents` installed, `subagent({ action: "list", agentScope: "user" })` shows packaged `addy-*` agents.
- Without `pi-subagents`, package install still succeeds and only the companion warning is shown.

Bootstrap:

- Bootstrap injects once and only once.
- Bootstrap skips nested subagent sessions using `PI_SUBAGENT_DEPTH`.
- Missing `todo` or `subagent` produces a warning, not a crash.
- Installed package works when both optional companion tools are present.

Workflow monitor:

- Every row in the trigger table has a unit test.
- `/addy-spec` sets current phase to `define`.
- `/addy-plan` moves from active `define` to complete `define` plus active `plan`.
- `/addy-build` moves from active `plan` to complete `plan` plus active `build`.
- `/addy-test` moves from active `build` to complete `build` plus active `verify`.
- `/addy-review` moves from active `verify` to complete `verify` plus active `review`.
- `/addy-ship` moves from active `review` to complete `review` plus active `ship`.
- `/addy-review` from fresh state sets active `review`, leaves earlier phases pending, warns about `define`, and does not block.
- `/addy-code-simplify` does not change current phase.
- Artifact transitions follow the trigger table exactly.
- Backward transitions reset workflow state before activating the earlier phase.
- `/addy-workflow-reset` clears state and removes the widget.
- `/addy-workflow-next` is registered as an extension command and opens a prefilled new session.
- Widget never replaces Pi's normal footer.

Docs:

- README documents install, update, uninstall, prompts, lifecycle, companion tools, GitHub install source, and known soft-warning behavior.
- README states that implementation must only start after explicit user approval when using `/addy-plan` outputs.

## Verification commands

Run from `~/Dev/pi-addy-workflow`.

```bash
npm test
npm pack --dry-run
```

Package content check:

```bash
npm pack --dry-run | grep -E 'extensions/|skills/|prompts/|agents/|README.md|LICENSE'
```

Static smoke checks:

```bash
! rg -n "~/.pi/agent|\.claude|/plugin|pi-superpowers" prompts skills agents extensions
! rg -n "package:\s*pi-addy-workflow" agents
rg -n "^name:\s*addy-" agents
```

Asset validation is enforced by `tests/validate-assets.test.ts`, not broad prose grep. That test must fail when:

- an agent file lacks exactly one `name: addy-*` frontmatter field
- an agent has forbidden `package:` frontmatter
- an agent has frontmatter `model:`
- a prompt/skill uses generic packaged agent names in subagent/tool-call context
- prompt relative references do not resolve inside the package
- skill links/scripts do not resolve relative to their copied skill directory

Local install smoke:

```bash
pi install ~/Dev/pi-addy-workflow
```

GitHub publish/install smoke:

```bash
gh auth status
gh repo view teknologist/pi-addy-workflow
pi install git:github.com/teknologist/pi-addy-workflow
```

Manual Pi checks after install:

- Slash autocomplete shows all seven `addy-*` prompts.
- `subagent({ action: "list", agentScope: "user" })` shows packaged `addy-*` agents.
- New session with `/addy-spec` shows Addy widget at `define`.
- `/addy-plan`, `/addy-build`, `/addy-test`, `/addy-review`, `/addy-ship` advance phases in order.
- `/addy-review` from a fresh session warns about missing prior phases and continues.
- `/addy-code-simplify` leaves current phase unchanged.
- `/addy-workflow-reset` clears widget.

Clean-environment proof:

- Run smoke tests in an isolated OS user, container, or Pi config/home that has no preexisting Addy prompts, Addy skills, or Addy agents.
- Do not rely on the developer's existing `~/.pi/agent/prompts`, `~/.pi/agent/skills`, or `~/.pi/agent/agents` during package verification.
- Package still provides prompts, skills, and agents.
- Repeat clean-environment proof using `pi install git:github.com/teknologist/pi-addy-workflow` after the repo is pushed.

## Non-goals

- No hard workflow gates.
- No `/spec`/`/plan` aliases.
- No full footer replacement.
- No analytics dashboard.
- No marketplace publishing work beyond pushing to `teknologist/pi-addy-workflow` and verifying git-source install.
- No copying every local skill or agent.
- No uninstall cleanup hook; synced agents under `~/.pi/agent/agents/pi-addy-workflow/` may remain after package removal and should be documented in README troubleshooting.
- No implementation beyond this plan unless explicitly requested.

## Ready-to-implement checklist

- [x] No unresolved questions remain in this plan.
- [x] All lifecycle decisions are fixed above.
- [x] Acceptance criteria are explicit and testable.
- [x] Verification commands are listed.
- [x] Agent can implement without asking clarification; any runtime mismatch is handled by the acceptance criteria and smoke tests above.
