# pi-addy-workflow — AI Context Map

> **Stack:** raw-http | none | unknown | typescript

> 0 routes | 0 models | 0 components | 84 lib files | 6 env vars | 2 middleware | 0% test coverage
> **Token savings:** this file is ~8,000 tokens. Without it, AI exploration would cost ~32,200 tokens. **Saves ~24,300 tokens per conversation.**
> **Last scanned:** 2026-05-24 20:29 — re-run after significant changes

---

# Libraries

- `extensions/agent-installer/core.ts`
  - function defaultAgentTargetRoot: (home) => void
  - function addGeneratedNotice: (markdown) => string
  - function listMarkdownFiles: (dir, base) => Promise<string[]>
  - function syncAgents: (options) => Promise<AgentSyncResult>
  - function packageAgentSourceRoot: (importMetaUrl) => string
  - function relativeAgentSyncSummary: (result, targetRoot) => string
  - _...2 more_
- `extensions/bootstrap/core.ts`
  - function shouldSkipBootstrap: (env, string | undefined>) => boolean
  - function toolAvailable: (tools, name) => boolean
  - function buildAddyBootstrap: (tools?) => string
  - function injectAddyBootstrap: (options) => string | undefined
  - type BootstrapToolAvailability
  - type BootstrapOptions
  - _...1 more_
- `extensions/workflow-monitor/addy-auto-command.ts` — function handleAddyAutoCommand: (pi, event, ctx, deps) => Promise<ContinueResult>, type AddyAutoCommandDeps
- `extensions/workflow-monitor/agent-end-event.ts`
  - function textFromMessage: (message) => string
  - function latestAssistantMessage: (event) => AgentMessage | undefined
  - function latestAssistantText: (event) => string
  - function agentEndedWithProviderTransportFailure: (event) => boolean
  - type AgentEndEvent
  - type AgentMessage
- `extensions/workflow-monitor/agent-end-handler.ts` — function createAgentEndHandler: (deps) => void
- `extensions/workflow-monitor/agent-end-review-stats.ts` — function stateWithAgentEndReviewIssues: (state, event, reviewText) => WorkflowState
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
  - _...8 more_
- `extensions/workflow-monitor/auto-lifecycle.ts`
  - function reviewedTaskWasCompleted: (previousState, state) => boolean
  - function planTaskIsComplete: (planPath, baseCwd, target) => boolean
  - function actionTargetsCompletePlanTask: (state, action, baseCwd?) => boolean
  - function completedPlanAutoContinuation: (state, action, baseCwd?) => |
  - function latestCompletedActiveStatsTarget: (state, baseCwd?) => WorkflowStatsTarget | undefined
  - function autoPauseWarning: (prompt, action) => string
  - _...3 more_
- `extensions/workflow-monitor/auto-prompt-dispatcher.ts` — function createAutoPromptDispatcher: (deps) => void
- `extensions/workflow-monitor/auto-watchdog.ts` — function createAutoWatchdog: (deps) => void
- `extensions/workflow-monitor/auto-workflow-orchestrator.ts` — function createAutoWorkflowOrchestrator: (deps) => void
- `extensions/workflow-monitor/command-dispatch.ts`
  - function stateAfterAutoPrompt: (prompt, state, updates, statsTarget?) => WorkflowState
  - function freshContextReasonForPrompt: (prompt, state, options, freshContext) => AutoFreshReason | undefined
  - function planAutoPromptDispatch: (input) => AutoPromptDispatchPlan
  - function planPendingFreshDispatch: (input) => AutoPromptDispatchPlan
  - function planManualStepDispatch: (input) => void
  - type CommandDispatchOptions
  - _...2 more_
- `extensions/workflow-monitor/command-intake.ts`
  - function registeredFreshStepCommandNames: () => string[]
  - function planFreshStepCommand: (command, event) => void
  - function planAutoContinueCommand: (event) => |
  - function planStatsCommand: (event) => void
  - function planWorkflowNextCommand: (event) => |
  - const AUTO_CONTINUE_USAGE
  - _...1 more_
- `extensions/workflow-monitor/command-registry.ts` — function registerWorkflowCommands: (pi, deps) => void
- `extensions/workflow-monitor/command-router.ts`
  - function workflowTextFromInput: (text) => string
  - function commandFromPrompt: (prompt) => string | undefined
  - function commandNameFromText: (text) => string | undefined
  - function phaseForWorkflowCommand: (command) => WorkflowPhase | undefined
  - function phaseFromWorkflowPrompt: (prompt) => WorkflowPhase | undefined
  - function commandForWorkflowPhase: (phase) => string
  - _...6 more_
- `extensions/workflow-monitor/commit-result.ts` — function agentTextReportsCommitComplete: (text) => boolean, function commitShaFromAgentText: (text) => string
- `extensions/workflow-monitor/composition-adapter.ts`
  - function hostContext: (ctx) => HostContext
  - function baseCwd: (ctx) => string | undefined
  - function getWorkflowStateFromContext: (ctx) => WorkflowState
  - function setWorkflowStateFromContext: (ctx, state, appendEntry?) => void
  - function loadWorkflowConfig: (ctx) => AddyWorkflowConfig
  - function freshContextConfig: (ctx) => AddyWorkflowConfig['auto']['freshContext']
  - _...7 more_
- `extensions/workflow-monitor/composition.ts` — function registerAddyWorkflowMonitor: (pi) => void
- `extensions/workflow-monitor/config.ts`
  - function ensureGlobalAddyWorkflowConfig: (ctx, home) => void
  - function loadAddyWorkflowConfig: (ctx, env) => AddyWorkflowConfig
  - type AddyWorkflowConfig
  - const DEFAULT_ADDY_WORKFLOW_CONFIG: AddyWorkflowConfig
- `extensions/workflow-monitor/event-intake.ts`
  - function planToolResultEvent: (event) => PlannedWorkflowEvent
  - function planToolCallEvent: (event) => PlannedWorkflowEvent | undefined
  - function planSubagentStartEvent: (event) => PlannedWorkflowEvent
  - type PlannedWorkflowEvent
- `extensions/workflow-monitor/event-registry.ts` — function registerWorkflowEvents: (pi, deps) => void
- `extensions/workflow-monitor/fresh-continuation-pending-state.ts` — function pendingAutoFreshUpdates: (prompt, reason, state, updates, expandedPrompt) => Partial<WorkflowState>, function stateWithPendingFreshPrompt: (prompt, reason, state, updates, expandedPrompt) => WorkflowState
- `extensions/workflow-monitor/fresh-continuation-plan.ts` — function planFreshContinuationStart: (input) => FreshContinuationStartPlan, type FreshContinuationStartPlan
- `extensions/workflow-monitor/fresh-continuation-state.ts`
  - function consumeAutoFreshPromptUpdates: (state) => Partial<WorkflowState>
  - function consumedPendingFreshPromptState: (state) => WorkflowState | undefined
  - function pendingFreshInputMatches: (input, state) => boolean
  - function currentSessionFallbackOptions: (options, hasIdleSignal) => WorkflowDispatchOptions
- `extensions/workflow-monitor/fresh-continuation.ts`
  - function createFreshContinuationCoordinator: (deps) => void
  - function defaultFreshContinuationDeliveryOptions: () => UserMessageDeliveryOptions
  - type FreshContinuationDispatchOptions
  - type FreshContinuationCoordinator
- `extensions/workflow-monitor/input-handler.ts` — function createInputHandler: (deps) => void
- `extensions/workflow-monitor/manual-fresh-step.ts` — function createManualFreshStepDispatcher: (deps) => void
- `extensions/workflow-monitor/manual-frontier-guard.ts` — function createManualFrontierGuard: (deps) => void
- `extensions/workflow-monitor/plan-task-lifecycle.ts`
  - function planTasksFromMarkdown: (markdown) => PlanTask[]
  - function workflowTaskCommitKey: (planPath, taskIndex, taskTitle, taskId?) => string
  - function taskMatchesPlanTask: (task, index, candidate) => boolean
  - function taskIsClosed: (committedTasks, planPath, task, index) => boolean
  - function planTaskFrontier: ({...}, planPath, tasks, effectiveMissingStatuses, }, index) => void
  - type PlanTaskStatus
  - _...2 more_
- `extensions/workflow-monitor/plan-task-resolution.ts`
  - function resolvePlanTaskTarget: (tasks, target) => ResolvedPlanTaskTarget | undefined
  - function resolvedPlanTaskMatchesTarget: (resolved, target) => boolean
  - type ResolvedPlanTaskTarget
- `extensions/workflow-monitor/prompt-template.ts`
  - function expandPackagedPromptTemplate: (prompt, deps) => string
  - function parseTemplateArgs: (argsString) => string[]
  - function stripFrontmatter: (markdown) => string
  - function substituteTemplateArgs: (content, args) => string
  - type PromptTemplateDeps
- `extensions/workflow-monitor/provider-transport-retry.ts` — function createProviderTransportRetryHandler: (deps) => void
- `extensions/workflow-monitor/renderers.ts` — function registerWorkflowRenderers: (pi) => void, function showWorkflowStats: (pi, ctx, state, options, notify, message, level?) => void
- `extensions/workflow-monitor/repository-scope.ts` — function repositoryScopesForPlan: (planPath, baseCwd?) => string[], function repositoryScopeForPlan: (planPath, baseCwd?) => string | undefined
- `extensions/workflow-monitor/review-control.ts` — function reviewFixKey: (state) => string, function legacyReviewFixKey: (state) => string
- `extensions/workflow-monitor/review-findings.ts`
  - function reviewTextHasActionableFindings: (text) => boolean
  - function reviewFindingsFingerprint: (text) => string
  - function reviewIssueStatsFromText: (text) => WorkflowIssueStats
  - function reviewIssueFindings: (text) => ReviewIssueFinding[]
  - type ReviewIssueSeverity
  - type ReviewIssueFinding
- `extensions/workflow-monitor/session-start-handler.ts` — function createSessionStartHandler: (deps) => void
- `extensions/workflow-monitor/slice-plan-progress.ts`
  - function allTasksInCurrentPlanAreClosed: (state, baseCwd?) => boolean
  - function unfinishedLifecycleStepsFromMarkdown: (markdown) => Array<
  - function refreshWorkflowTasksFromPlan: (state, baseCwd?) => WorkflowState
  - function nextPromptForPhase: (phase, artifact?) => string
  - function nextPromptForActivePlanLifecycle: (state, baseCwd?) => string | undefined
  - function nextWorkflowActionForActivePlanLifecycle: (state, baseCwd?) => |
  - _...4 more_
- `extensions/workflow-monitor/slice-plan-series.ts`
  - function readPlanMarkdown: (planPath, baseCwd?) => string | undefined
  - function currentSlicePlanPathFromIndex: (planPath, markdown, baseCwd?, state?) => string | undefined
  - function nextUnfinishedSlicePlanPath: (state, baseCwd?) => string | undefined
  - function sliceProgressForPlanPath: (planPath, baseCwd?) => void
  - function isValidProgress: (index, count) => index is number
  - function totalTaskProgressForSlice: (planPath, currentTaskIndex, baseCwd?) => void
- `extensions/workflow-monitor/task-closure-continuation.ts` — function planTaskClosureContinuation: (input) => void, type TaskClosureContinuationPlan
- `extensions/workflow-monitor/task-commit-coordinator.ts`
  - function autoTaskCommitPrompt: (state, taskTitle?, baseCwd?) => string
  - function withPlanTaskId: (target, baseCwd?) => WorkflowStatsTarget | undefined
  - function actionCommitTarget: (state, action) => WorkflowStatsTarget | undefined
  - function createTaskCommitCoordinator: (deps) => void
- `extensions/workflow-monitor/workflow-core.ts`
  - function createInitialWorkflowState: () => WorkflowState
  - type WorkflowIssueStats
  - type WorkflowTaskStats
  - type WorkflowTaskCommitRecord
  - type WorkflowStatsSession
  - type WorkflowStats
  - _...6 more_
- `extensions/workflow-monitor/workflow-delivery.ts` — function createWorkflowDelivery: (deps) => void, type WorkflowDeliveryOptions
- `extensions/workflow-monitor/workflow-handler.ts`
  - function handleWorkflowEvent: (ctx, event, appendEntry?) => WorkflowState
  - function initializeWorkflowWidget: (ctx) => WorkflowState
  - function resetWorkflow: (ctx, appendEntry?) => WorkflowState
  - function openNextWorkflowPrompt: (ctx, phase, artifact?) => string
- `extensions/workflow-monitor/workflow-host-events.ts`
  - function parseCommandArgs: (event) => string[]
  - function inputTextFromEvent: (event) => string
  - function parseAutoFreshReason: (event) => AutoFreshReason | undefined
  - function isSubagentChildSession: () => boolean
  - function extractWriteArtifact: (event) => string | undefined
  - function subagentNameFromEvent: (event) => string | undefined
  - _...6 more_
- `extensions/workflow-monitor/workflow-phases.ts`
  - function phaseIndex: (phase) => number
  - type WorkflowPhase
  - type PhaseStatus
  - const WORKFLOW_PHASES
  - const ENFORCED_WORKFLOW_PHASES
- `extensions/workflow-monitor/workflow-plan-continuation.ts` — function stateForNextSlicePlan: (state, nextSlicePlan, options) => WorkflowState
- `extensions/workflow-monitor/workflow-plan-path.ts` — function resolveWorkflowPlanPath: (planPath, baseCwd?) => string, function resolveWorkflowPlanPathRelativeTo: (planPath, relativeTo, baseCwd?) => string
- `extensions/workflow-monitor/workflow-runtime-adapter.ts`
  - function appendWorkflowEntry: (pi) => void
  - function appendWorkflowEntryFromContext: (ctx) => void
  - function extensionApiFromContext: (ctx) => ExtensionAPI
  - function notifyWorkflow: (ctx, message, level?) => void
  - function notifyWorkflowWarning: (ctx, message) => void
- `extensions/workflow-monitor/workflow-runtime.ts`
  - function createWorkflowRuntime: (pi, ctx) => WorkflowRuntime
  - type UserMessageDeliveryOptions
  - type WorkflowPromptRuntime
  - type WorkflowIdleRuntime
  - type WorkflowTimerRuntime
  - type WorkflowFreshSessionRuntime
  - _...3 more_
- `extensions/workflow-monitor/workflow-state-codec-auto-control.ts` — function coerceWorkflowAutoControl: (candidate) => WorkflowAutoControlFields | undefined
- `extensions/workflow-monitor/workflow-state-codec-auto.ts` — function isAutoPendingActionReason: (value) => value is WorkflowAutoPendingAction['reason'], function coerceAutoPendingAction: (value) => WorkflowAutoPendingAction | undefined
- `extensions/workflow-monitor/workflow-state-codec-commits.ts`
  - function isWorkflowTaskCommitRecord: (value) => value is WorkflowTaskCommitRecord
  - function coerceCommittedTasks: (value) => Record<string, WorkflowTaskCommitRecord> | undefined
  - function backfillCommittedTasksFromStats: (value) => Record<string, WorkflowTaskCommitRecord> | undefined
- `extensions/workflow-monitor/workflow-state-codec-domains.ts`
  - function isAutoFreshReason: (value) => value is AutoFreshReason
  - function isAutoPausedReason: (value) => value is WorkflowAutoPausedReason
  - function isWorkflowTestStatus: (value) => value is NonNullable<WorkflowState['testStatus']>
- `extensions/workflow-monitor/workflow-state-codec-metadata.ts`
  - function sanitizePlanArtifact: (planPath) => string | undefined
  - function sanitizeWorkflowArtifacts: (state) => WorkflowState
  - function coerceWorkflowMetadata: (candidate) => WorkflowMetadataFields | undefined
  - type WorkflowMetadataFields
- `extensions/workflow-monitor/workflow-state-codec-phases.ts` — function isPhaseStatus: (value) => value is PhaseStatus, function coerceWorkflowPhases: (value) => Record<WorkflowPhase, PhaseStatus> | undefined
- `extensions/workflow-monitor/workflow-state-codec-primitives.ts`
  - function isPositiveSafeInteger: (value) => value is number
  - function isNonNegativeSafeInteger: (value) => value is number
  - function isOptionalString: (value) => value is string | undefined
  - function isOptionalBoolean: (value) => value is boolean | undefined
  - function isStringArray: (value) => value is string[]
- `extensions/workflow-monitor/workflow-state-codec-review.ts` — function coerceWorkflowReviewControl: (candidate) => WorkflowReviewControlFields | undefined
- `extensions/workflow-monitor/workflow-state-codec-shape.ts`
  - function hasWorkflowStateShape: (value) => value is WorkflowStateShape
  - function coerceWorkflowCurrent: (value) => WorkflowPhase | undefined
  - type WorkflowStateShape
  - type PersistedWorkflowCurrent
- `extensions/workflow-monitor/workflow-state-codec-tasks.ts` — function coerceWorkflowTaskProgress: (candidate) => WorkflowTaskProgressFields | undefined
- `extensions/workflow-monitor/workflow-state-coercer.ts` — function coerceWorkflowState: (value) => WorkflowState | undefined
- `extensions/workflow-monitor/workflow-state-control.ts`
  - function clearReviewControlUpdates: () => Partial<WorkflowState>
  - function clearReviewControl: (state) => WorkflowState
  - function stopAutoModeControlUpdates: () => Partial<WorkflowState>
  - function exitAutoModeControlUpdates: () => Partial<WorkflowState>
  - function enterAutoModeControlUpdates: (state) => Partial<WorkflowState>
  - function preserveWorkflowControlState: (target, source) => WorkflowState
  - _...3 more_
- `extensions/workflow-monitor/workflow-state-entry-codec.ts`
  - function serializeWorkflowState: (state) => string
  - function parsePersistedWorkflowState: (value) => WorkflowState | undefined
  - function workflowStateFromEntry: (entry) => WorkflowState | undefined
  - type WorkflowStateEntry
  - const WORKFLOW_STATE_ENTRY_TYPE
- `extensions/workflow-monitor/workflow-state-memory-store.ts`
  - function readWorkflowMemoryState: (key) => WorkflowState | undefined
  - function writeWorkflowMemoryState: (key, state) => void
  - function writeWorkflowMemoryStates: (keys, state) => void
- `extensions/workflow-monitor/workflow-state-normalizer.ts` — function normalizeWorkflowState: (state) => WorkflowState
- `extensions/workflow-monitor/workflow-state-parser.ts` — function parseWorkflowState: (value) => WorkflowState
- `extensions/workflow-monitor/workflow-state-store-commit.ts`
  - function commitWorkflowState: (ctx, state, appendEntry?) => void
  - type WorkflowStateCommitContext
  - type AppendEntry
- `extensions/workflow-monitor/workflow-state-store-effects.ts`
  - function applyWorkflowStateUiEffects: (ctx, state) => void
  - function clearWorkflowStateWidget: (ctx) => void
  - type WorkflowStateEffectsContext
- `extensions/workflow-monitor/workflow-state-store-persistence.ts` — function readStoredWorkflowState: (key, ctx?) => WorkflowState | undefined, function writeStoredWorkflowState: (key, state, ctx?) => void
- `extensions/workflow-monitor/workflow-state-store-project-control.ts` — function sanitizedProjectFallbackWorkflowState: (state) => WorkflowState | undefined, function resolveWorkflowStateWithProjectControl: (state, projectState) => WorkflowState
- `extensions/workflow-monitor/workflow-state-store-scope.ts`
  - function workflowStateKey: (ctx) => string
  - function projectWorkflowStateKey: (ctx) => string
  - function workflowStateDir: (ctx?) => string
  - function workflowStatePath: (key, ctx?) => string
  - type WorkflowStateScopeContext
- `extensions/workflow-monitor/workflow-state-store.ts`
  - function getContextWorkflowState: (ctx) => WorkflowState
  - function setContextWorkflowState: (ctx, state, appendEntry?) => void
  - type WorkflowContext
  - const workflowStateStore
- `extensions/workflow-monitor/workflow-stats-presenter.ts`
  - function statsMarkdownWithHeading: (state, options) => string
  - function showWorkflowStats: (pi, ctx, state, options, notify) => void
  - function renderWorkflowStatsMessage: (message) => Markdown
  - const ADDY_STATS_MESSAGE_TYPE
- `extensions/workflow-monitor/workflow-stats-report.ts` — function renderWorkflowStatsText: (state, planPath?) => string, function renderWorkflowStatsMarkdown: (state, planPath?) => string
- `extensions/workflow-monitor/workflow-stats-target.ts` — function statsTargetFromTask: (task) => WorkflowStatsTarget, function latestActiveStatsTarget: (state) => WorkflowStatsTarget | undefined
- `extensions/workflow-monitor/workflow-stats.ts`
  - function emptyIssueStats: () => WorkflowIssueStats
  - function addIssueStats: (left, right) => WorkflowIssueStats
  - function createEmptyWorkflowStats: () => WorkflowStats
  - function normalizeWorkflowStats: (value) => WorkflowStats
  - function recordWorkflowTaskTurn: (state, target) => WorkflowState
  - function recordWorkflowVerifyRun: (state, target) => WorkflowState
  - _...5 more_
- `extensions/workflow-monitor/workflow-task-identity.ts`
  - function hasLegacyTaskIdentity: (identity) => boolean
  - function legacyTaskIdentityMatches: (identity, candidate) => boolean
  - function taskIdForIdentity: (identity, candidates) => string | undefined
  - function taskIdentityKeyParts: (identity) => string[]
  - function workflowTaskIdentityKey: (identity, options) => string
  - type WorkflowTaskIdentity
- `extensions/workflow-monitor/workflow-task-summary.ts`
  - function parseWorkflowTaskSummaryResponse: (text, state) => Pick<WorkflowState, 'currentTaskSummary' | 'nextTaskSummary'>
  - function summarizeWorkflowTasks: (ctx, state) => Promise<WorkflowState>
  - function scheduleWorkflowTaskSummary: (ctx, state, appendEntry?) => void
- `extensions/workflow-monitor/workflow-timer-loop.ts` — function runWhenIdle: (options) => boolean, type RunWhenIdleOptions
- `extensions/workflow-monitor/workflow-tracker.ts` — function promptArtifactForPhase: (state, phase) => string | undefined
- `extensions/workflow-monitor/workflow-transitions.ts` — function resolveTargetPhase: (event, current?) => WorkflowPhase | undefined, function transitionWorkflow: (state, event) => WorkflowState
- `extensions/workflow-monitor/workflow-widget-presenter.ts`
  - function renderWorkflowStrip: (state, theme?, text) => void
  - function workflowArtifactForFooter: (state) => string | undefined
  - function workflowArtifactName: (path) => string
  - function workflowTaskFooterLine: (planPath, baseCwd?, theme?, text) => void
  - function renderWorkflowWidget: (state, baseCwd?) => void
  - const WORKFLOW_WIDGET_KEY

---

# Config

## Environment Variables

- `HOME` **required** — extensions/agent-installer/core.ts
- `PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW` **required** — tests/workflow-monitor.test.ts
- `PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS` **required** — tests/workflow-monitor.test.ts
- `PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP` **required** — tests/workflow-monitor.test.ts
- `PI_ADDY_WORKFLOW_STATE_DIR` **required** — extensions/workflow-monitor/workflow-state-store-scope.ts
- `PI_SUBAGENT_CHILD` **required** — extensions/workflow-monitor/workflow-host-events.ts

## Config Files

- `tsconfig.json`

---

# Middleware

## auth
- manual-frontier-guard — `extensions/workflow-monitor/manual-frontier-guard.ts`

## custom
- manual-frontier-guard.test — `tests/manual-frontier-guard.test.ts`

---

# Dependency Graph

## Most Imported Files (change these carefully)

- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **59** files
- `extensions/workflow-monitor/command-router.ts` — imported by **15** files
- `extensions/workflow-monitor/workflow-state-store.ts` — imported by **15** files
- `extensions/workflow-monitor/workflow-stats.ts` — imported by **15** files
- `extensions/workflow-monitor/workflow-core.ts` — imported by **14** files
- `extensions/workflow-monitor/workflow-stats-target.ts` — imported by **7** files
- `extensions/workflow-monitor/workflow-dispatch-options.ts` — imported by **7** files
- `extensions/workflow-monitor/workflow-tracker.ts` — imported by **6** files
- `extensions/workflow-monitor/plan-task-lifecycle.ts` — imported by **6** files
- `extensions/workflow-monitor/auto-lifecycle.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-task-identity.ts` — imported by **5** files
- `extensions/workflow-monitor/prompt-template.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-runtime.ts` — imported by **5** files
- `extensions/workflow-monitor/auto-control.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-phases.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-state-normalizer.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-state-codec.ts` — imported by **5** files
- `extensions/workflow-monitor/fresh-continuation.ts` — imported by **4** files
- `extensions/workflow-monitor/workflow-plan-continuation.ts` — imported by **4** files
- `extensions/workflow-monitor/command-dispatch.ts` — imported by **4** files

## Import Map (who imports what)

- `extensions/workflow-monitor/workflow-transitions.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/agent-end-review-stats.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts` +54 more
- `extensions/workflow-monitor/command-router.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/command-intake.ts` +10 more
- `extensions/workflow-monitor/workflow-state-store.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-prompt-dispatcher.ts`, `extensions/workflow-monitor/auto-watchdog.ts` +10 more
- `extensions/workflow-monitor/workflow-stats.ts` ← `extensions/workflow-monitor/agent-end-review-stats.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/auto-prompt-dispatcher.ts` +10 more
- `extensions/workflow-monitor/workflow-core.ts` ← `extensions/workflow-monitor/renderers.ts`, `extensions/workflow-monitor/workflow-state-codec-auto-control.ts`, `extensions/workflow-monitor/workflow-state-codec-auto.ts`, `extensions/workflow-monitor/workflow-state-codec-metadata.ts`, `extensions/workflow-monitor/workflow-state-codec-review.ts` +9 more
- `extensions/workflow-monitor/workflow-stats-target.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/command-registry.ts`, `extensions/workflow-monitor/composition.ts` +2 more
- `extensions/workflow-monitor/workflow-dispatch-options.ts` ← `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-watchdog.ts`, `extensions/workflow-monitor/fresh-continuation-state.ts`, `extensions/workflow-monitor/fresh-continuation.ts` +2 more
- `extensions/workflow-monitor/workflow-tracker.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/command-dispatch.ts`, `extensions/workflow-monitor/workflow-state-store.ts`, `tests/addy-auto-command.test.ts`, `tests/auto-action-keys.test.ts` +1 more
- `extensions/workflow-monitor/plan-task-lifecycle.ts` ← `extensions/workflow-monitor/plan-task-resolution.ts`, `extensions/workflow-monitor/workflow-state-codec-commits.ts`, `tests/auto-lifecycle.test.ts`, `tests/plan-task-resolution.test.ts`, `tests/slice-plan-series.test.ts` +1 more
- `extensions/workflow-monitor/auto-lifecycle.ts` ← `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/auto-watchdog.ts`, `extensions/workflow-monitor/command-registry.ts`, `extensions/workflow-monitor/composition.ts`, `extensions/workflow-monitor/manual-frontier-guard.ts`

---

# Test Coverage

> **0%** of routes and models are covered by tests
> 74 test files found

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_