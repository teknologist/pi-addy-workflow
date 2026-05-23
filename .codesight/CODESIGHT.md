# pi-addy-workflow — AI Context Map

> **Stack:** raw-http | none | unknown | typescript

> 0 routes | 0 models | 0 components | 25 lib files | 6 env vars | 0 middleware | 0% test coverage
> **Token savings:** this file is ~3,800 tokens. Without it, AI exploration would cost ~16,400 tokens. **Saves ~12,600 tokens per conversation.**
> **Last scanned:** 2026-05-23 09:14 — re-run after significant changes

---

# Libraries

- `extensions/agent-installer/core.ts`
  - function defaultAgentTargetRoot: (home) => void
  - function isSafeTargetPath: (targetRoot, candidate) => boolean
  - function addGeneratedNotice: (markdown) => string
  - function listMarkdownFiles: (dir, base) => Promise<string[]>
  - function syncAgents: (options) => Promise<AgentSyncResult>
  - function packageAgentSourceRoot: (importMetaUrl) => string
  - _...3 more_
- `extensions/bootstrap/core.ts`
  - function shouldSkipBootstrap: (env, string | undefined>) => boolean
  - function toolAvailable: (tools, name) => boolean
  - function buildAddyBootstrap: (tools?) => string
  - function injectAddyBootstrap: (options) => string | undefined
  - type BootstrapToolAvailability
  - type BootstrapOptions
  - _...1 more_
- `extensions/workflow-monitor/auto-action-keys.ts`
  - function idleUserMessageKey: (ctx, message) => string
  - function autoWorkflowActionKey: (prompt, details) => string
  - function autoWorkflowActionKeyForAction: (state, action) => string | undefined
  - function autoWorkflowActionKeyForPromptState: (prompt, state, target) => string
  - function currentAutoWorkflowActionKey: (state, target?) => string | undefined
- `extensions/workflow-monitor/auto-agent-end.ts` — function finishTextReportsComplete: (text) => boolean, function createAutoAgentEnd: (deps) => void
- `extensions/workflow-monitor/auto-control.ts`
  - function hasLiveAutoControl: (state) => boolean
  - function explicitlyStoppedAuto: (state) => boolean
  - function withProjectAutoControl: (state, projectState) => WorkflowState
  - function sanitizedProjectFallbackAutoControl: (state) => WorkflowState
  - function autoFreshContinuationKey: (prompt, reason, state) => string
  - function validPendingFreshContinuation: (state) => state is WorkflowState &
  - _...11 more_
- `extensions/workflow-monitor/command-dispatch.ts`
  - function stateAfterAutoPrompt: (prompt, state, updates, statsTarget?) => WorkflowState
  - function freshContextReasonForPrompt: (prompt, state, options, freshContext) => AutoFreshReason | undefined
  - function planAutoPromptDispatch: (input) => AutoPromptDispatchPlan
  - function planPendingFreshDispatch: (input) => AutoPromptDispatchPlan
  - function planManualStepDispatch: (input) => void
  - type CommandDispatchOptions
  - _...2 more_
- `extensions/workflow-monitor/command-router.ts`
  - function workflowTextFromInput: (text) => string
  - function commandFromPrompt: (prompt) => string | undefined
  - function commandNameFromText: (text) => string | undefined
  - function phaseForWorkflowCommand: (command) => WorkflowPhase | undefined
  - function phaseFromWorkflowPrompt: (prompt) => WorkflowPhase | undefined
  - function commandForWorkflowPhase: (phase) => string
  - _...6 more_
- `extensions/workflow-monitor/config.ts`
  - function ensureGlobalAddyWorkflowConfig: (ctx, home) => void
  - function loadAddyWorkflowConfig: (ctx, env) => AddyWorkflowConfig
  - type AddyWorkflowConfig
  - const DEFAULT_ADDY_WORKFLOW_CONFIG: AddyWorkflowConfig
- `extensions/workflow-monitor/fresh-continuation.ts`
  - function createFreshContinuationCoordinator: (deps) => void
  - function defaultFreshContinuationDeliveryOptions: () => UserMessageDeliveryOptions
  - type FreshContinuationDispatchOptions
  - type FreshContinuationCoordinator
- `extensions/workflow-monitor/plan-task-lifecycle.ts`
  - function planTasksFromMarkdown: (markdown) => PlanTask[]
  - function workflowTaskCommitKey: (planPath, taskIndex, taskTitle, taskId?) => string
  - function taskMatchesPlanTask: (task, index, candidate) => boolean
  - function taskIsClosed: (committedTasks, planPath, task, index) => boolean
  - function planTaskFrontier: ({...}, planPath, tasks, effectiveMissingStatuses, }, index) => void
  - type PlanTaskStatus
  - _...2 more_
- `extensions/workflow-monitor/prompt-template.ts`
  - function expandPackagedPromptTemplate: (prompt, deps) => string
  - function parseTemplateArgs: (argsString) => string[]
  - function stripFrontmatter: (markdown) => string
  - function substituteTemplateArgs: (content, args) => string
  - type PromptTemplateDeps
- `extensions/workflow-monitor/repository-scope.ts` — function repositoryScopesForPlan: (planPath, baseCwd?) => string[], function repositoryScopeForPlan: (planPath, baseCwd?) => string | undefined
- `extensions/workflow-monitor/review-control.ts`
  - function clearReviewControlUpdates: () => Partial<WorkflowState>
  - function clearReviewControl: (state) => WorkflowState
  - function reviewFixKey: (state) => string
  - function legacyReviewFixKey: (state) => string
  - const REVIEW_CONTROL_FIELDS
- `extensions/workflow-monitor/review-findings.ts`
  - function reviewTextHasActionableFindings: (text) => boolean
  - function reviewFindingsFingerprint: (text) => string
  - function reviewIssueStatsFromText: (text) => WorkflowIssueStats
  - function reviewIssueFindings: (text) => ReviewIssueFinding[]
  - type ReviewIssueSeverity
  - type ReviewIssueFinding
- `extensions/workflow-monitor/task-commit-coordinator.ts`
  - function agentTextReportsCommitComplete: (text) => boolean
  - function commitShaFromAgentText: (text) => string
  - function autoTaskCommitPrompt: (state, taskTitle?, baseCwd?) => string
  - function withPlanTaskId: (target, baseCwd?) => WorkflowStatsTarget | undefined
  - function actionCommitTarget: (state, action) => WorkflowStatsTarget | undefined
  - function createTaskCommitCoordinator: (deps) => void
- `extensions/workflow-monitor/warnings.ts` — function workflowWarningText: (state) => string | undefined
- `extensions/workflow-monitor/workflow-handler.ts`
  - function summarizeWorkflowTasks: (ctx, state) => Promise<WorkflowState>
  - function handleWorkflowEvent: (ctx, event, appendEntry?) => WorkflowState
  - function initializeWorkflowWidget: (ctx) => WorkflowState
  - function resetWorkflow: (ctx, appendEntry?) => WorkflowState
  - function openNextWorkflowPrompt: (ctx, phase, artifact?) => string
- `extensions/workflow-monitor/workflow-plan-path.ts` — function resolveWorkflowPlanPath: (planPath, baseCwd?) => string, function resolveWorkflowPlanPathRelativeTo: (planPath, relativeTo, baseCwd?) => string
- `extensions/workflow-monitor/workflow-runtime.ts`
  - function createWorkflowRuntime: (pi, ctx) => WorkflowRuntime
  - type UserMessageDeliveryOptions
  - type WorkflowRuntime
  - type WorkflowFreshSessionResult
  - type WorkflowTimerRegistry
- `extensions/workflow-monitor/workflow-state-codec.ts`
  - function normalizeWorkflowState: (state) => WorkflowState
  - function serializeWorkflowState: (state) => string
  - function parseWorkflowState: (value) => WorkflowState
  - function parsePersistedWorkflowState: (value) => WorkflowState | undefined
  - function workflowStateFromEntry: (entry) => WorkflowState | undefined
  - type WorkflowStateEntry
  - _...1 more_
- `extensions/workflow-monitor/workflow-state-store.ts`
  - function getContextWorkflowState: (ctx) => WorkflowState
  - function setContextWorkflowState: (ctx, state, appendEntry?) => void
  - type WorkflowContext
  - type AppendEntry
  - const workflowStateStore
- `extensions/workflow-monitor/workflow-stats.ts`
  - function emptyIssueStats: () => WorkflowIssueStats
  - function addIssueStats: (left, right) => WorkflowIssueStats
  - function createEmptyWorkflowStats: () => WorkflowStats
  - function normalizeWorkflowStats: (value) => WorkflowStats
  - function recordWorkflowTaskTurn: (state, target) => WorkflowState
  - function recordWorkflowVerifyRun: (state, target) => WorkflowState
  - _...7 more_
- `extensions/workflow-monitor/workflow-timer-loop.ts` — function runWhenIdle: (options) => boolean, type RunWhenIdleOptions
- `extensions/workflow-monitor/workflow-tracker.ts`
  - function renderWorkflowStrip: (state, theme?, text) => void
  - function workflowArtifactForFooter: (state) => string | undefined
  - function workflowArtifactName: (path) => string
  - function allTasksInCurrentPlanAreClosed: (state, baseCwd?) => boolean
  - function nextUnfinishedSlicePlanPath: (state, baseCwd?) => string | undefined
  - function unfinishedLifecycleStepsFromMarkdown: (markdown) => Array<
  - _...9 more_
- `extensions/workflow-monitor/workflow-transitions.ts`
  - function createInitialWorkflowState: () => WorkflowState
  - function phaseIndex: (phase) => number
  - function resolveTargetPhase: (event, current?) => WorkflowPhase | undefined
  - function transitionWorkflow: (state, event) => WorkflowState
  - type WorkflowPhase
  - type PhaseStatus
  - _...13 more_

---

# Config

## Environment Variables

- `HOME` **required** — extensions/agent-installer/core.ts
- `PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW` **required** — tests/workflow-monitor.test.ts
- `PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS` **required** — tests/workflow-monitor.test.ts
- `PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP` **required** — tests/workflow-monitor.test.ts
- `PI_ADDY_WORKFLOW_STATE_DIR` **required** — extensions/workflow-monitor/workflow-state-store.ts
- `PI_SUBAGENT_CHILD` **required** — extensions/workflow-monitor.ts

## Config Files

- `tsconfig.json`

---

# Dependency Graph

## Most Imported Files (change these carefully)

- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **13** files
- `extensions/workflow-monitor/command-router.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-stats.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-state-store.ts` — imported by **4** files
- `extensions/workflow-monitor/config.ts` — imported by **3** files
- `extensions/workflow-monitor/workflow-tracker.ts` — imported by **3** files
- `extensions/workflow-monitor/workflow-timer-loop.ts` — imported by **3** files
- `extensions/workflow-monitor/workflow-plan-path.ts` — imported by **3** files
- `extensions/workflow-monitor/task-commit-coordinator.ts` — imported by **2** files
- `extensions/workflow-monitor/command-dispatch.ts` — imported by **2** files
- `extensions/workflow-monitor.ts` — imported by **2** files
- `extensions/workflow-monitor/workflow-state-codec.ts` — imported by **2** files
- `tests/helpers.ts` — imported by **2** files
- `extensions/workflow-monitor/workflow-runtime.ts` — imported by **2** files
- `extensions/bootstrap/core.ts` — imported by **1** files
- `extensions/workflow-monitor/review-control.ts` — imported by **1** files
- `extensions/workflow-monitor/auto-control.ts` — imported by **1** files
- `extensions/workflow-monitor/repository-scope.ts` — imported by **1** files
- `extensions/workflow-monitor/plan-task-lifecycle.ts` — imported by **1** files
- `extensions/workflow-monitor/warnings.ts` — imported by **1** files

## Import Map (who imports what)

- `extensions/workflow-monitor/workflow-transitions.ts` ← `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/command-router.ts`, `extensions/workflow-monitor/review-control.ts`, `extensions/workflow-monitor/review-findings.ts` +8 more
- `extensions/workflow-monitor/command-router.ts` ← `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/prompt-template.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`, `extensions/workflow-monitor/workflow-stats.ts`
- `extensions/workflow-monitor/workflow-stats.ts` ← `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`, `extensions/workflow-monitor/workflow-state-codec.ts`, `tests/auto-agent-end.test.ts`
- `extensions/workflow-monitor/workflow-state-store.ts` ← `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/fresh-continuation.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`, `tests/workflow-state-store.test.ts`
- `extensions/workflow-monitor/config.ts` ← `extensions/workflow-monitor/command-dispatch.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`, `tests/workflow-monitor.test.ts`
- `extensions/workflow-monitor/workflow-tracker.ts` ← `extensions/workflow-monitor/command-dispatch.ts`, `tests/auto-action-keys.test.ts`, `tests/workflow-state-codec.test.ts`
- `extensions/workflow-monitor/workflow-timer-loop.ts` ← `extensions/workflow-monitor/fresh-continuation.ts`, `extensions/workflow-monitor.ts`, `tests/workflow-timer-loop.test.ts`
- `extensions/workflow-monitor/workflow-plan-path.ts` ← `extensions/workflow-monitor/task-commit-coordinator.ts`, `extensions/workflow-monitor/workflow-tracker.ts`, `extensions/workflow-monitor.ts`
- `extensions/workflow-monitor/task-commit-coordinator.ts` ← `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor.ts`
- `extensions/workflow-monitor/command-dispatch.ts` ← `extensions/workflow-monitor/fresh-continuation.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`

---

# Test Coverage

> **0%** of routes and models are covered by tests
> 20 test files found

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_