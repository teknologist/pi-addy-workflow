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
import { createFreshContinuationCoordinator } from './fresh-continuation.ts';
import { archiveWorkflowStats } from './workflow-stats.ts';
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
import { createAutoLoopDispatchPort } from './auto-loop.ts';
import { createAutoWorkflowOrchestrator } from './auto-workflow-orchestrator.ts';
import { createSessionStartHandler } from './session-start-handler.ts';
import { createAgentEndHandler } from './agent-end-handler.ts';
import {
  acquireAutoRunnerLock,
  autoRunnerLockOwnerSummary,
  consumeAutoRunnerStopIntent,
  recordAutoRunnerStopIntent,
  releaseAutoRunnerLock,
  renewAutoRunnerLock,
  startAutoRunnerHeartbeat,
  verifyAutoRunnerLock,
  type AutoRunnerLockResult,
} from './auto-runner-lock.ts';
import { createInputHandler } from './input-handler.ts';
import { registerWorkflowCommands } from './commands.ts';
import { registerWorkflowEvents } from './events.ts';
import {
  WORKFLOW_WIDGET_KEY,
  renderWorkflowWidget,
} from './workflow-widget-presenter.ts';
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
import { stopAutoModeControlUpdates } from './workflow-state-control.ts';
import {
  ADDY_AUTO_TASK_COMMIT_PROMPT,
  nextWorkflowActionForActivePlanLifecycle,
} from './workflow-tracker.ts';

const AUTO_TASK_COMMIT_PROMPT = ADDY_AUTO_TASK_COMMIT_PROMPT;
const AUTO_FRESH_IDLE_RETRY_MS = 50;
const AUTO_FRESH_IDLE_MAX_ATTEMPTS = 1200;
const AUTO_SAME_PHASE_MAX_RETRIES = 12;

const getWorkflowState = getWorkflowStateFromContext;
const rawSetWorkflowState = setWorkflowStateFromContext;
const autoLoop = createAutoLoopDispatchPort();

function autoRunnerPassiveMessage(
  result: Exclude<AutoRunnerLockResult, { status: 'owned' | 'reclaimed' }>,
): string {
  if (result.status === 'passive-child')
    return 'Addy auto passive — subagent child processes cannot drive auto mode.';
  return `Addy auto passive — running in another Pi instance. ${autoRunnerLockOwnerSummary(result.owner)}. Run /addy-auto stop here to request the owner stop.`;
}

function showAutoRunnerPassiveWidget(
  ctx: unknown,
  state: WorkflowState,
  message: string,
): void {
  const host = ctx as {
    cwd?: string;
    ui?: { setWidget?: (key: string, value: unknown) => void };
  };
  host.ui?.setWidget?.(
    WORKFLOW_WIDGET_KEY,
    (_tui?: unknown, theme?: unknown) => {
      const workflowWidget = renderWorkflowWidget(state, host.cwd)(
        _tui,
        theme as Parameters<ReturnType<typeof renderWorkflowWidget>>[1],
      );
      return {
        invalidate() {
          workflowWidget.invalidate();
        },
        render(width?: number) {
          return [...workflowWidget.render(width), message];
        },
      };
    },
  );
}

function releaseOwnedAutoRunnerLock(ctx: unknown): void {
  try {
    releaseAutoRunnerLock(ctx as never);
  } catch (error) {
    notifyWorkflowWarning(
      ctx,
      `Addy auto could not release the runner lock: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function setWorkflowState(
  ctx: unknown,
  state: WorkflowState,
  appendEntry?: Parameters<typeof setWorkflowStateFromContext>[2],
): void {
  const previous = getWorkflowState(ctx);
  rawSetWorkflowState(ctx, state, appendEntry);
  if (previous.autoMode && !state.autoMode) releaseOwnedAutoRunnerLock(ctx);
}

function acceptOwnedAutoRunnerLock(
  pi: ExtensionAPI,
  ctx: unknown,
  state: WorkflowState,
  result: Extract<AutoRunnerLockResult, { status: 'owned' | 'reclaimed' }>,
  actionKey?: string,
  activePlan?: string,
): boolean {
  startAutoRunnerHeartbeat(ctx as never, {
    activePlan: activePlan ?? state.activePlan,
    lastActionKey: actionKey,
  });
  if (consumeAutoRunnerStopIntent(ctx as never, result.lock)) {
    setWorkflowState(
      ctx,
      {
        ...state,
        ...stopAutoModeControlUpdates(),
        lastTrigger: '/addy-auto stop',
      },
      appendWorkflowEntry(pi),
    );
    showWorkflowStats(pi, ctx, getWorkflowState(ctx), {
      heading: 'Addy auto stopped by request from another Pi instance.',
    });
    return false;
  }
  return true;
}

function ensureAutoRunnerOwnership(
  pi: ExtensionAPI,
  ctx: unknown,
  state: WorkflowState,
  actionKey?: string,
  activePlan?: string,
): boolean | Promise<boolean> {
  const verifyResult = verifyAutoRunnerLock(ctx as never, {
    activePlan: activePlan ?? state.activePlan,
    lastActionKey: actionKey,
  });
  if (verifyResult.status === 'owned') {
    const renewed = renewAutoRunnerLock(ctx as never, {
      activePlan: activePlan ?? state.activePlan,
      lastActionKey: actionKey,
    });
    if (renewed.status === 'owned')
      return acceptOwnedAutoRunnerLock(
        pi,
        ctx,
        state,
        renewed as Extract<AutoRunnerLockResult, { status: 'owned' }>,
        actionKey,
        activePlan,
      );
  }

  return acquireAutoRunnerLock(ctx as never, {
    activePlan: activePlan ?? state.activePlan,
    lastActionKey: actionKey,
  }).then((result) => {
    if (result.status === 'owned' || result.status === 'reclaimed') {
      return acceptOwnedAutoRunnerLock(
        pi,
        ctx,
        state,
        result as Extract<
          AutoRunnerLockResult,
          { status: 'owned' | 'reclaimed' }
        >,
        actionKey,
        activePlan,
      );
    }
    const passiveMessage = autoRunnerPassiveMessage(
      result as Exclude<
        AutoRunnerLockResult,
        { status: 'owned' | 'reclaimed' }
      >,
    );
    showAutoRunnerPassiveWidget(ctx, state, passiveMessage);
    notifyWorkflowWarning(ctx, passiveMessage);
    return false;
  });
}

function recordAutoRunnerStopRequest(
  ctx: unknown,
): 'owned' | 'recorded' | 'no-owner' | 'passive-child' {
  return recordAutoRunnerStopIntent(ctx as never).status;
}

const workflowDelivery = createWorkflowDelivery({
  getState: getWorkflowState,
  ensureAutoRunnerOwnership,
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
  ensureAutoRunnerOwnership,
  setState: setWorkflowState,
  appendEntry: appendWorkflowEntry,
  extensionApiFromContext,
  notify: notifyWorkflow,
  notifyWarning: notifyWorkflowWarning,
  sendUserMessage: workflowDelivery.sendUserMessage,
  dispatchNextAutoWorkflowPrompt: autoLoop.dispatchNextAutoWorkflowPrompt,
  retryMs: AUTO_FRESH_IDLE_RETRY_MS,
  maxAttempts: AUTO_FRESH_IDLE_MAX_ATTEMPTS,
});

const autoPromptDispatcher = createAutoPromptDispatcher({
  appendEntry: appendWorkflowEntry,
  delivery: workflowDelivery,
  freshContinuation,
  freshContext: freshContextConfig,
  getState: getWorkflowState,
  ensureAutoRunnerOwnership,
  setState: setWorkflowState,
});

const taskCommitCoordinator = createTaskCommitCoordinator({
  appendEntry: appendWorkflowEntry,
  archiveWorkflowStats,
  dispatchAutoPromptFreshAware: autoLoop.dispatchAutoPromptFreshAware,
  dispatchNextAutoWorkflowPrompt: autoLoop.dispatchNextAutoWorkflowPrompt,
  expandPackagedPromptTemplate,
  freshContinuation,
  latestActiveStatsTarget,
  notify: notifyWorkflow,
  setState: setWorkflowState,
});

const autoWorkflowOrchestrator = createAutoWorkflowOrchestrator({
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
autoLoop.bind(autoWorkflowOrchestrator);

const autoWatchdog = createAutoWatchdog({
  actionKeyForAction: autoWorkflowActionKeyForAction,
  appendEntry: appendWorkflowEntry,
  baseCwd,
  createRuntime: createWorkflowRuntime,
  dispatchNextAutoWorkflowPrompt: autoLoop.dispatchNextAutoWorkflowPrompt,
  getState: getWorkflowState,
  ensureAutoRunnerOwnership,
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
  ensureAutoRunnerOwnership,
  isChildSession: isSubagentChildSession,
  maybeRunAutoWatchdog: (pi, ctx, trigger, options) =>
    autoWatchdog.maybeRunAutoWatchdog(pi, ctx, trigger, options),
});

const manualFrontierGuard = createManualFrontierGuard({
  actionCommitTarget: (state, action) =>
    taskCommitCoordinator.actionCommitTarget(state, action),
  baseCwd,
  dispatchAutoPrompt: autoLoop.dispatchAutoPromptFreshAware,
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
  dispatchAutoPromptFreshAware: autoLoop.dispatchAutoPromptFreshAware,
  dispatchNextAutoWorkflowPrompt: autoLoop.dispatchNextAutoWorkflowPrompt,
  maxReviewFixLoops,
  maybeDispatchTaskCommit: autoLoop.maybeDispatchTaskCommit,
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
  ensureAutoRunnerOwnership,
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
    ensureAutoRunnerOwnership,
    handleWorkflowEvent: handleWorkflowEventFromContext,
    maybeRunAutoWatchdog: (pi, ctx, source, options) =>
      autoWatchdog.maybeRunAutoWatchdog(pi, ctx, source, options),
    notify: notifyWorkflow,
    openNextWorkflowPrompt: openNextWorkflowPromptFromContext,
    recordAutoRunnerStopIntent: recordAutoRunnerStopRequest,
    releaseAutoRunnerLock: releaseOwnedAutoRunnerLock,
    resetWorkflow: (ctx, appendEntry) => {
      resetWorkflowFromContext(ctx, appendEntry);
      releaseOwnedAutoRunnerLock(ctx);
    },
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
