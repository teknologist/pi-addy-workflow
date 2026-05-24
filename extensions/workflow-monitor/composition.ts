import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { actionTargetsCompletePlanTask } from './auto-lifecycle.ts';
import { stateAfterAutoPrompt } from './command-dispatch.ts';
import { autoWorkflowActionKeyForAction } from './auto-action-keys.ts';
import { createAutoAgentEnd } from './auto-agent-end.ts';
import { isManualAddyWorkflowCommand } from './command-router.ts';
import { createWorkflowRuntime } from './workflow-runtime.ts';
import { createWorkflowDelivery } from './workflow-delivery.ts';
import {
  appendWorkflowEntry,
  appendWorkflowEntryFromContext,
  extensionApiFromContext,
  notifyWorkflow,
  notifyWorkflowWarning,
} from './workflow-runtime-adapter.ts';
import {
  isStaleExtensionContextError,
  isSubagentChildSession,
} from './workflow-host-events.ts';
import { expandPackagedPromptTemplate } from './prompt-template.ts';
import {
  createFreshContinuationCoordinator,
  type FreshContinuationDispatchOptions,
} from './fresh-continuation.ts';
import {
  archiveWorkflowStats,
  type WorkflowStatsTarget,
} from './workflow-stats.ts';
import { latestActiveStatsTarget } from './workflow-stats-target.ts';
import {
  registerWorkflowRenderers,
  showWorkflowStats as showWorkflowStatsRenderer,
} from './renderers.ts';
import { createTaskCommitCoordinator } from './task-commit-coordinator.ts';
import { createProviderTransportRetryHandler } from './provider-transport-retry.ts';
import { createManualFreshStepDispatcher } from './manual-fresh-step.ts';
import { createManualFrontierGuard } from './manual-frontier-guard.ts';
import { createAutoWatchdog } from './auto-watchdog.ts';
import { createAutoPromptDispatcher } from './auto-prompt-dispatcher.ts';
import { createAutoWorkflowOrchestrator } from './auto-workflow-orchestrator.ts';
import { createSessionStartHandler } from './session-start-handler.ts';
import { createAgentEndHandler } from './agent-end-handler.ts';
import { createInputHandler } from './input-handler.ts';
import { registerWorkflowCommands } from './command-registry.ts';
import { registerWorkflowEvents } from './event-registry.ts';
import {
  baseCwd,
  ensureWorkflowConfig,
  freshContextConfig,
  getWorkflowStateFromContext,
  handleWorkflowEventFromContext,
  initializeWorkflowWidgetFromContext,
  maxReviewFixLoops,
  openNextWorkflowPromptFromContext,
  resetWorkflowFromContext,
  setWorkflowStateFromContext,
  shouldFreshContextBeforeEveryStep,
} from './composition-adapter.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import {
  ADDY_AUTO_TASK_COMMIT_PROMPT,
  nextWorkflowActionForActivePlanLifecycle,
} from './workflow-tracker.ts';

type DispatchOptions = FreshContinuationDispatchOptions;

const AUTO_TASK_COMMIT_PROMPT = ADDY_AUTO_TASK_COMMIT_PROMPT;
const AUTO_FRESH_IDLE_RETRY_MS = 50;
const AUTO_FRESH_IDLE_MAX_ATTEMPTS = 1200;
const AUTO_SAME_PHASE_MAX_RETRIES = 12;

const getWorkflowState = getWorkflowStateFromContext;
const setWorkflowState = setWorkflowStateFromContext;

const workflowDelivery = createWorkflowDelivery({
  getState: getWorkflowState,
  setState: setWorkflowState,
  appendEntryFromContext: appendWorkflowEntryFromContext,
  latestActiveStatsTarget,
  isStaleExtensionContextError,
  notifyWarning: notifyWorkflowWarning,
  retryMs: AUTO_FRESH_IDLE_RETRY_MS,
  maxAttempts: AUTO_FRESH_IDLE_MAX_ATTEMPTS,
});

const freshContinuation = createFreshContinuationCoordinator({
  getState: getWorkflowState,
  setState: setWorkflowState,
  appendEntry: appendWorkflowEntry,
  extensionApiFromContext,
  notify: notifyWorkflow,
  notifyWarning: notifyWorkflowWarning,
  sendUserMessage: workflowDelivery.sendUserMessage,
  dispatchNextAutoWorkflowPrompt,
  retryMs: AUTO_FRESH_IDLE_RETRY_MS,
  maxAttempts: AUTO_FRESH_IDLE_MAX_ATTEMPTS,
});

const autoPromptDispatcher = createAutoPromptDispatcher({
  appendEntry: appendWorkflowEntry,
  delivery: workflowDelivery,
  freshContinuation,
  freshContext: freshContextConfig,
  getState: getWorkflowState,
  setState: setWorkflowState,
});

let autoWorkflowOrchestrator: ReturnType<typeof createAutoWorkflowOrchestrator>;

const taskCommitCoordinator = createTaskCommitCoordinator({
  appendEntry: appendWorkflowEntry,
  archiveWorkflowStats,
  dispatchAutoPromptFreshAware,
  dispatchNextAutoWorkflowPrompt,
  expandPackagedPromptTemplate,
  freshContinuation,
  latestActiveStatsTarget,
  notify: notifyWorkflow,
  setState: setWorkflowState,
});

autoWorkflowOrchestrator = createAutoWorkflowOrchestrator({
  appendEntry: appendWorkflowEntry,
  autoPromptDispatcher,
  autoSamePhaseMaxRetries: AUTO_SAME_PHASE_MAX_RETRIES,
  autoTaskCommitPrompt: AUTO_TASK_COMMIT_PROMPT,
  baseCwd,
  getState: getWorkflowState,
  nextActionForState: nextWorkflowActionForActivePlanLifecycle,
  notify: notifyWorkflow,
  setState: setWorkflowState,
  taskCommitCoordinator,
});

const autoWatchdog = createAutoWatchdog({
  actionKeyForAction: autoWorkflowActionKeyForAction,
  appendEntry: appendWorkflowEntry,
  baseCwd,
  createRuntime: createWorkflowRuntime,
  dispatchNextAutoWorkflowPrompt,
  getState: getWorkflowState,
  isChildSession: isSubagentChildSession,
  nextActionForState: nextWorkflowActionForActivePlanLifecycle,
  resumePendingFreshContinuation: (pi, ctx, options) =>
    freshContinuation.resumePendingFreshContinuation(pi, ctx, options ?? {}),
  setState: setWorkflowState,
});

const sessionStartHandler = createSessionStartHandler({
  resumePendingFreshContinuation: (pi, ctx, options) =>
    freshContinuation.resumePendingFreshContinuation(pi, ctx, options),
  ensureConfig: ensureWorkflowConfig,
  initializeWidget: initializeWorkflowWidgetFromContext,
  isChildSession: isSubagentChildSession,
  maybeRunAutoWatchdog: (pi, ctx, trigger, options) =>
    autoWatchdog.maybeRunAutoWatchdog(pi, ctx, trigger, options),
});

const manualFrontierGuard = createManualFrontierGuard({
  actionCommitTarget: (state, action) =>
    taskCommitCoordinator.actionCommitTarget(state, action),
  baseCwd,
  dispatchAutoPrompt: dispatchAutoPromptFreshAware,
  dispatchTaskCommitPrompt: (pi, ctx, state, target, options) =>
    taskCommitCoordinator.dispatchTaskCommitPrompt(
      pi,
      ctx,
      state,
      target,
      options,
    ),
  getState: getWorkflowState,
  nextActionForState: nextWorkflowActionForActivePlanLifecycle,
  notify: notifyWorkflow,
});

const manualFreshStep = createManualFreshStepDispatcher({
  freshContextBeforeEveryStep: shouldFreshContextBeforeEveryStep,
  notify: notifyWorkflow,
  sendUserMessage: (pi, ctx, message) =>
    workflowDelivery.sendUserMessage(pi, ctx, message),
});

const providerTransportRetry = createProviderTransportRetryHandler({
  appendEntry: appendWorkflowEntry,
  autoTaskCommitPrompt: AUTO_TASK_COMMIT_PROMPT,
  latestActiveStatsTarget,
  notifyWarning: (ctx, message) => notifyWorkflow(ctx, message, 'warning'),
  setState: setWorkflowState,
});

const autoAgentEnd = createAutoAgentEnd({
  appendEntry: appendWorkflowEntry,
  archiveWorkflowStats,
  actionTargetsCompletePlanTask,
  dispatchAutoPromptFreshAware,
  dispatchNextAutoWorkflowPrompt,
  maxReviewFixLoops,
  maybeDispatchTaskCommit,
  notifyWarning: (ctx, message) => notifyWorkflow(ctx, message, 'warning'),
  setState: setWorkflowState,
  showWorkflowStats,
});

const inputHandler = createInputHandler({
  appendEntry: appendWorkflowEntry,
  consumedPendingFreshPromptState: (state) =>
    freshContinuation.consumedPendingFreshPromptState(state),
  dispatchManualFrontierGuard: (pi, input, ctx) =>
    manualFrontierGuard.dispatchManualFrontierGuard(pi, input, ctx),
  getState: getWorkflowState,
  handleWorkflowEvent: handleWorkflowEventFromContext,
  isManualAddyWorkflowCommand,
  pendingFreshInputMatches: (input, state) =>
    freshContinuation.pendingFreshInputMatches(input, state),
  setState: setWorkflowState,
});

const agentEndHandler = createAgentEndHandler({
  appendEntry: appendWorkflowEntry,
  autoAgentEndContinue: (
    pi,
    ctx,
    text,
    previousState,
    state,
    action,
    options,
  ) =>
    autoAgentEnd.continueAfterAgentEnd(
      pi,
      ctx,
      text,
      previousState,
      state,
      action,
      options,
    ),
  baseCwd,
  getState: getWorkflowState,
  isChildSession: isSubagentChildSession,
  maybeContinueAfterTaskCommit: (pi, ctx, text, state, options) =>
    taskCommitCoordinator.maybeContinueAfterTaskCommit(
      pi,
      ctx,
      text,
      state,
      options,
    ),
  nextActionForState: nextWorkflowActionForActivePlanLifecycle,
  preserveProviderTransportRetry: (pi, ctx, event, state) =>
    providerTransportRetry.maybePreserveProviderTransportRetry(
      pi,
      ctx,
      event,
      state,
    ),
  resumePendingFreshContinuation: (pi, ctx, options, mode) =>
    freshContinuation.resumePendingFreshContinuation(pi, ctx, options, mode),
  setState: setWorkflowState,
});

function showWorkflowStats(
  pi: ExtensionAPI,
  ctx: unknown,
  state: WorkflowState,
  options: { heading?: string; planPath?: string } = {},
): void {
  showWorkflowStatsRenderer(pi, ctx, state, options, notifyWorkflow);
}

async function dispatchAutoPromptFreshAware(
  pi: ExtensionAPI,
  ctx: unknown,
  prompt: string,
  state: WorkflowState,
  updates: Partial<WorkflowState> = {},
  statsTarget?: WorkflowStatsTarget,
  options: DispatchOptions = {},
  deliveryPrompt?: string,
): Promise<void> {
  await autoWorkflowOrchestrator.dispatchAutoPromptFreshAware(
    pi,
    ctx,
    prompt,
    state,
    updates,
    statsTarget,
    options,
    deliveryPrompt,
  );
}

async function maybeDispatchTaskCommit(
  pi: ExtensionAPI,
  ctx: unknown,
  reviewText: string,
  previousState: WorkflowState,
  state: WorkflowState,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
  options: DispatchOptions = {},
): Promise<boolean> {
  return autoWorkflowOrchestrator.maybeDispatchTaskCommit(
    pi,
    ctx,
    reviewText,
    previousState,
    state,
    action,
    options,
  );
}

async function dispatchNextAutoWorkflowPrompt(
  pi: ExtensionAPI,
  ctx: unknown,
  allowSamePhase = false,
  options: DispatchOptions = {},
): Promise<void> {
  await autoWorkflowOrchestrator.dispatchNextAutoWorkflowPrompt(
    pi,
    ctx,
    allowSamePhase,
    options,
  );
}

export function registerAddyWorkflowMonitor(pi: ExtensionAPI) {
  registerWorkflowRenderers(pi);

  registerWorkflowEvents(pi, {
    appendEntry: appendWorkflowEntry,
    handleAgentEnd: (pi, ctx, event) =>
      agentEndHandler.handleAgentEnd(pi, ctx, event),
    handleInput: (pi, event, ctx) => inputHandler.handleInput(pi, event, ctx),
    handleSessionStart: (pi, ctx) =>
      sessionStartHandler.handleSessionStart(pi, ctx),
    handleWorkflowEvent: handleWorkflowEventFromContext,
  });

  registerWorkflowCommands(pi, {
    appendEntry: appendWorkflowEntry,
    resumePendingFreshContinuation: (pi, ctx, options) =>
      freshContinuation.resumePendingFreshContinuation(pi, ctx, options),
    dispatchManualFrontierGuard: (pi, input, ctx) =>
      manualFrontierGuard.dispatchManualFrontierGuard(pi, input, ctx),
    dispatchManualStepWithFreshContextConfig: (pi, input, ctx) =>
      manualFreshStep.dispatchManualStepWithFreshContextConfig(pi, input, ctx),
    dispatchTaskCommitPrompt: (pi, ctx, state, target, options) =>
      taskCommitCoordinator.dispatchTaskCommitPrompt(
        pi,
        ctx,
        state,
        target,
        options,
      ),
    getState: getWorkflowState,
    handleWorkflowEvent: handleWorkflowEventFromContext,
    maybeRunAutoWatchdog: (pi, ctx, source, options) =>
      autoWatchdog.maybeRunAutoWatchdog(pi, ctx, source, options),
    notify: notifyWorkflow,
    openNextWorkflowPrompt: openNextWorkflowPromptFromContext,
    resetWorkflow: resetWorkflowFromContext,
    runFreshContextContinuation: (pi, ctx, reason) =>
      freshContinuation.runFreshContextContinuation(pi, ctx, reason),
    sendUserMessage: (pi, ctx, input) =>
      workflowDelivery.sendUserMessage(pi, ctx, input),
    setState: setWorkflowState,
    shouldFreshContextBeforeStep: (input, ctx) =>
      manualFreshStep.shouldFreshContextBeforeStep(input, ctx),
    showWorkflowStats,
  });
}
