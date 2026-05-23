# Libraries

> **Navigation aid.** Library inventory extracted via AST. Read the source files listed here before modifying exported functions.

**25 library files** across 1 module

## Extensions (25 files)

- `extensions/workflow-monitor/workflow-transitions.ts` — createInitialWorkflowState, phaseIndex, resolveTargetPhase, transitionWorkflow, WorkflowPhase, PhaseStatus, …
- `extensions/workflow-monitor/auto-control.ts` — hasLiveAutoControl, explicitlyStoppedAuto, withProjectAutoControl, sanitizedProjectFallbackAutoControl, autoFreshContinuationKey, validPendingFreshContinuation, …
- `extensions/workflow-monitor/workflow-tracker.ts` — renderWorkflowStrip, workflowArtifactForFooter, workflowArtifactName, allTasksInCurrentPlanAreClosed, nextUnfinishedSlicePlanPath, unfinishedLifecycleStepsFromMarkdown, …
- `extensions/workflow-monitor/workflow-stats.ts` — emptyIssueStats, addIssueStats, createEmptyWorkflowStats, normalizeWorkflowStats, recordWorkflowTaskTurn, recordWorkflowVerifyRun, …
- `extensions/workflow-monitor/command-router.ts` — workflowTextFromInput, commandFromPrompt, commandNameFromText, phaseForWorkflowCommand, phaseFromWorkflowPrompt, commandForWorkflowPhase, …
- `extensions/agent-installer/core.ts` — defaultAgentTargetRoot, isSafeTargetPath, addGeneratedNotice, listMarkdownFiles, syncAgents, packageAgentSourceRoot, …
- `extensions/workflow-monitor/command-dispatch.ts` — stateAfterAutoPrompt, freshContextReasonForPrompt, planAutoPromptDispatch, planPendingFreshDispatch, planManualStepDispatch, CommandDispatchOptions, …
- `extensions/workflow-monitor/plan-task-lifecycle.ts` — planTasksFromMarkdown, workflowTaskCommitKey, taskMatchesPlanTask, taskIsClosed, planTaskFrontier, PlanTaskStatus, …
- `extensions/bootstrap/core.ts` — shouldSkipBootstrap, toolAvailable, buildAddyBootstrap, injectAddyBootstrap, BootstrapToolAvailability, BootstrapOptions, …
- `extensions/workflow-monitor/workflow-state-codec.ts` — normalizeWorkflowState, serializeWorkflowState, parseWorkflowState, parsePersistedWorkflowState, workflowStateFromEntry, WorkflowStateEntry, …
- `extensions/workflow-monitor/review-findings.ts` — reviewTextHasActionableFindings, reviewFindingsFingerprint, reviewIssueStatsFromText, reviewIssueFindings, ReviewIssueSeverity, ReviewIssueFinding
- `extensions/workflow-monitor/task-commit-coordinator.ts` — agentTextReportsCommitComplete, commitShaFromAgentText, autoTaskCommitPrompt, withPlanTaskId, actionCommitTarget, createTaskCommitCoordinator
- `extensions/workflow-monitor/auto-action-keys.ts` — idleUserMessageKey, autoWorkflowActionKey, autoWorkflowActionKeyForAction, autoWorkflowActionKeyForPromptState, currentAutoWorkflowActionKey
- `extensions/workflow-monitor/prompt-template.ts` — expandPackagedPromptTemplate, parseTemplateArgs, stripFrontmatter, substituteTemplateArgs, PromptTemplateDeps
- `extensions/workflow-monitor/review-control.ts` — clearReviewControlUpdates, clearReviewControl, reviewFixKey, legacyReviewFixKey, REVIEW_CONTROL_FIELDS
- `extensions/workflow-monitor/workflow-handler.ts` — summarizeWorkflowTasks, handleWorkflowEvent, initializeWorkflowWidget, resetWorkflow, openNextWorkflowPrompt
- `extensions/workflow-monitor/workflow-runtime.ts` — createWorkflowRuntime, UserMessageDeliveryOptions, WorkflowRuntime, WorkflowFreshSessionResult, WorkflowTimerRegistry
- `extensions/workflow-monitor/workflow-state-store.ts` — getContextWorkflowState, setContextWorkflowState, WorkflowContext, AppendEntry, workflowStateStore
- `extensions/workflow-monitor/config.ts` — ensureGlobalAddyWorkflowConfig, loadAddyWorkflowConfig, AddyWorkflowConfig, DEFAULT_ADDY_WORKFLOW_CONFIG
- `extensions/workflow-monitor/fresh-continuation.ts` — createFreshContinuationCoordinator, defaultFreshContinuationDeliveryOptions, FreshContinuationDispatchOptions, FreshContinuationCoordinator
- `extensions/workflow-monitor/auto-agent-end.ts` — finishTextReportsComplete, createAutoAgentEnd
- `extensions/workflow-monitor/repository-scope.ts` — repositoryScopesForPlan, repositoryScopeForPlan
- `extensions/workflow-monitor/workflow-plan-path.ts` — resolveWorkflowPlanPath, resolveWorkflowPlanPathRelativeTo
- `extensions/workflow-monitor/workflow-timer-loop.ts` — runWhenIdle, RunWhenIdleOptions
- `extensions/workflow-monitor/warnings.ts` — workflowWarningText

---
_Back to [overview.md](./overview.md)_