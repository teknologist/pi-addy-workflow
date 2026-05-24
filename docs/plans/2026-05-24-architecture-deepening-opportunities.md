# Architecture Deepening Opportunities

Assumptions:

- This is an architecture-candidate pass only; no code changes.
- No `docs/adr/` directory exists, so there are no ADR conflicts to flag.
- Suggestions use `CONTEXT.md` names and the Module/Interface/Seam vocabulary from the Improve Codebase Architecture skill.

Implementation status: implemented in the 2026-05-24 refactor by adding dedicated Modules for Auto Recovery Prompt Policy, Plan Task Reader, Slice Plan Repository, Auto Workflow Decision, Fresh Continuation runtime effects, Auto Loop Dispatch Port, and package-facing command/event aliases.

## Deepening opportunities

### 1. Deepen Fresh Continuation around Runtime Shell effects

**Files**

- `extensions/workflow-monitor/fresh-continuation.ts`
- `extensions/workflow-monitor/fresh-continuation-state.ts`
- `extensions/workflow-monitor/fresh-continuation-plan.ts`

**Problem**

`Fresh Continuation` still mixes pending-state decisions with Runtime Shell effects: `ctx.sendMessage` casts, `createWorkflowRuntime`, timer scheduling, fresh-session start, current-session fallback, and delivery retries. The Module is named well, but its Interface is still large because tests/callers must understand both continuation policy and host transport behavior.

**Solution**

Split the host/runtime side of Fresh Continuation from the decision side so the main Module plans continuation outcomes and a smaller Adapter applies notices, timers, and fresh-session delivery.

**Benefits**

- **Locality**: stale pending prompt cleanup, fallback, and consumed-key decisions stay in one decision Module.
- **Leverage**: tests can exercise fresh-session behavior through a smaller Interface instead of simulating host contexts and timers.
- Better AI-navigability: “why did auto continue here?” becomes separate from “how was the prompt delivered?”

### 2. Extract Addy Auto recovery prompt policy from Workflow Delivery

**Files**

- `extensions/workflow-monitor/workflow-delivery.ts`
- `docs/addy-auto-unblock-flow.md`

**Problem**

`Workflow Delivery` is described as a Runtime Shell Adapter Module, but it embeds Addy Auto Mode recovery wording and `/addy-fix-all` handoff rules in `appendAutoUnblockGuidance`. That makes a transport Module own domain policy.

**Solution**

Move Addy Auto recovery guidance selection into a dedicated policy Module consumed by Workflow Delivery.

**Benefits**

- **Locality**: recovery wording and fix-all rules live near Addy Auto Mode policy, not message transport.
- **Leverage**: any auto-dispatch path can reuse the same guidance rules.
- Tests can verify recovery prompt policy without constructing delivery/runtime scenarios.

### 3. Make Auto Workflow Orchestrator a policy planner plus thin effect Adapter

**Files**

- `extensions/workflow-monitor/auto-workflow-orchestrator.ts`
- `extensions/workflow-monitor/auto-lifecycle.ts`
- `extensions/workflow-monitor/task-commit-coordinator.ts`

**Problem**

`Auto Workflow Orchestrator` is a large effectful control path. It refreshes state, handles completed-plan continuation, chooses commit prompts, syncs lifecycle phases, enforces retry limits, selects recovery prompts, and dispatches delivery. The Seam exists, but the Interface still exposes too much policy through an imperative host-facing Module.

**Solution**

Introduce a pure decision Module behind the orchestrator that chooses the next auto outcome. The current orchestrator would mostly apply effects: set state, notify, dispatch prompt, or dispatch commit.

**Benefits**

- **Locality**: retry, commit, pause, and next-prompt decisions become inspectable in one place.
- **Leverage**: tests can cover Addy Auto Mode sequencing without host `pi`/`ctx`.
- The deletion test suggests this Module would earn its keep: deleting it would spread orchestration policy back across auto end/watchdog/command paths.

### 4. Consolidate Slice Plan task resolution and completion reads

**Files**

- `extensions/workflow-monitor/auto-lifecycle.ts`
- `extensions/workflow-monitor/task-commit-coordinator.ts`
- `extensions/workflow-monitor/slice-plan-progress.ts`
- `extensions/workflow-monitor/plan-task-resolution.ts`

**Problem**

`Plan Task Resolution` exists, but callers still repeat `readFileSync + resolveWorkflowPlanPath + planTasksFromMarkdown` to answer “is this task complete?” or “what is the canonical target?” That leaks Slice Plan storage details across Modules.

**Solution**

Deepen the Slice Plan read Interface so callers ask for task resolution/completion facts rather than reading markdown themselves.

**Benefits**

- **Locality**: Stable Task ID fallback, markdown parsing, and completion checks concentrate in one Module.
- **Leverage**: commit, lifecycle, and progress code all get consistent task identity behavior.
- Tests improve because one Slice Plan fixture path can validate the shared read Interface instead of duplicating filesystem setup.

### 5. Separate Slice Plan Series heuristics from filesystem access

**Files**

- `extensions/workflow-monitor/slice-plan-series.ts`
- `extensions/workflow-monitor/slice-plan-progress.ts`

**Problem**

`Slice Plan Series` owns useful suite heuristics, but it also directly performs `statSync`, `readFileSync`, `readdirSync`, path display conversion, and numbered-slice discovery. That makes alternate plan layouts and failure modes harder to test without real files.

**Solution**

Keep suite/index/numbered-slice decisions in Slice Plan Series, but move raw filesystem facts behind a small repository Adapter.

**Benefits**

- **Locality**: suite heuristics stay pure and focused.
- **Leverage**: Auto Lifecycle and Slice Plan Progress can reuse the same plan-reading behavior.
- Tests can cover unreadable plans, sibling discovery, and index-plan references without temp-directory-heavy setup.

### 6. Narrow Command Registry’s dependency Interface

**Files**

- `extensions/workflow-monitor/command-registry.ts`
- `extensions/workflow-monitor/addy-auto-command.ts`
- `extensions/workflow-monitor/command-intake.ts`

**Problem**

`Command Registry` is a host Adapter for slash-command registration, but its dependency Interface is very wide: fresh continuation, manual guard, task commit, state mutation, watchdog, workflow events, stats, notifications, and message delivery all enter through one shape. That makes command registration a broad Seam where policy can leak back in.

**Solution**

Split the dependency shape by command family: fresh-step commands, auto command, stats command, workflow-next/reset commands.

**Benefits**

- **Locality**: each command family declares only what it can actually do.
- **Leverage**: tests for one command no longer need irrelevant dependencies.
- Accidental policy coupling becomes visible because adding a dependency requires choosing the command family where it belongs.

### 7. Untangle composition-root cycles with a clearer continuation Seam

**Files**

- `extensions/workflow-monitor/composition.ts`
- `extensions/workflow-monitor/auto-prompt-dispatcher.ts`
- `extensions/workflow-monitor/fresh-continuation.ts`
- `extensions/workflow-monitor/task-commit-coordinator.ts`
- `extensions/workflow-monitor/auto-workflow-orchestrator.ts`

**Problem**

`Workflow Monitor Composition` is intentionally the wiring surface, but it currently encodes cycles using hoisted functions and a mutable `let autoWorkflowOrchestrator`. The dependency direction between Auto Prompt Dispatcher, Fresh Continuation, Task Commit Coordinator, and Auto Workflow Orchestrator is hard to reason about.

**Solution**

Create a small continuation/dispatch Seam that these Modules depend on, then wire the Adapter once in composition.

**Benefits**

- **Locality**: composition remains wiring, not temporal coupling management.
- **Leverage**: each Module depends on a stable dispatch capability instead of closures that are initialized later.
- Tests and future readers get clearer dependency direction.
