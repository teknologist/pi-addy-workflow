import {
  getMarkdownTheme,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { Markdown } from '@earendil-works/pi-tui';
import { readFileSync } from 'node:fs';
import {
  ensureGlobalAddyWorkflowConfig,
  loadAddyWorkflowConfig,
} from './workflow-monitor/config.ts';
import {
  planAutoPromptDispatch,
  planManualStepDispatch,
  stateAfterAutoPrompt,
  type AutoPromptDispatchPlan,
} from './workflow-monitor/command-dispatch.ts';
import {
  autoRetryKey,
  pendingAutoActionForPrompt,
  staleAutoFreshUpdates,
  stateWithPendingAutoAction,
  validPendingFreshContinuation,
} from './workflow-monitor/auto-control.ts';
import {
  autoWorkflowActionKeyForAction,
  autoWorkflowActionKeyForPromptState,
  currentAutoWorkflowActionKey,
  idleUserMessageKey,
} from './workflow-monitor/auto-action-keys.ts';
import { createAutoAgentEnd } from './workflow-monitor/auto-agent-end.ts';
import {
  FRESH_CONTEXT_STEP_COMMANDS,
  commandFromPrompt,
  isFreshContextStepCommand,
  isManualAddyWorkflowCommand,
  phaseFromWorkflowPrompt,
  workflowTextFromInput,
} from './workflow-monitor/command-router.ts';
import {
  createWorkflowRuntime,
  type UserMessageDeliveryOptions,
} from './workflow-monitor/workflow-runtime.ts';
import { expandPackagedPromptTemplate } from './workflow-monitor/prompt-template.ts';
import { runWhenIdle } from './workflow-monitor/workflow-timer-loop.ts';
import {
  createFreshContinuationCoordinator,
  type FreshContinuationDispatchOptions,
} from './workflow-monitor/fresh-continuation.ts';
import {
  reviewIssueStatsFromText,
  reviewTextHasActionableFindings,
} from './workflow-monitor/review-findings.ts';
import {
  handleWorkflowEvent,
  initializeWorkflowWidget,
  openNextWorkflowPrompt,
  resetWorkflow,
} from './workflow-monitor/workflow-handler.ts';
import {
  getContextWorkflowState,
  setContextWorkflowState,
} from './workflow-monitor/workflow-state-store.ts';
import {
  archiveWorkflowStats,
  recordWorkflowReviewIssues,
  renderWorkflowStatsMarkdown,
  renderWorkflowStatsText,
  type WorkflowStatsTarget,
} from './workflow-monitor/workflow-stats.ts';
import { resolveWorkflowPlanPath } from './workflow-monitor/workflow-plan-path.ts';
import { createTaskCommitCoordinator } from './workflow-monitor/task-commit-coordinator.ts';
import {
  WORKFLOW_PHASES,
  type AutoFreshReason,
  type WorkflowPhase,
} from './workflow-monitor/workflow-transitions.ts';
import {
  ADDY_AUTO_TASK_COMMIT_PROMPT,
  allTasksInCurrentPlanAreClosed,
  nextUnfinishedSlicePlanPath,
  nextWorkflowActionForActivePlanLifecycle,
  nextPromptForPhase,
  planTasksFromMarkdown,
} from './workflow-monitor/workflow-tracker.ts';

type CommandEvent = string | { args?: string[]; input?: string };
type InputEvent = { input?: string; text?: string; source?: string };
type ToolEvent = {
  command?: string;
  text?: string;
  success?: boolean;
  artifact?: string;
};
type ToolCallEvent = {
  toolName?: string;
  name?: string;
  input?: Record<string, unknown>;
};
type SubagentEvent = { agent?: string; agentName?: string };
type AgentEndEvent = {
  agent?: string;
  agentName?: string;
  messages?: AgentMessage[];
  message?: AgentMessage;
};
type AgentMessage = {
  role?: string;
  content?: unknown;
  stopReason?: string;
  diagnostics?: Array<{ type?: string }>;
};
type DispatchOptions = FreshContinuationDispatchOptions;

const ADDY_STATS_MESSAGE_TYPE = 'pi-addy-workflow-stats';
const AUTO_TASK_COMMIT_PROMPT = ADDY_AUTO_TASK_COMMIT_PROMPT;
const AUTO_FRESH_IDLE_RETRY_MS = 50;
const AUTO_FRESH_IDLE_MAX_ATTEMPTS = 1200;
const AUTO_SAME_PHASE_MAX_RETRIES = 12;

const freshContinuation = createFreshContinuationCoordinator({
  getState: (ctx) => getContextWorkflowState(ctx as never),
  setState: (ctx, state, appendEntry) =>
    setContextWorkflowState(ctx as never, state, appendEntry),
  appendEntry: appendWorkflowEntry,
  extensionApiFromContext,
  notify: notifyWorkflow,
  notifyWarning: notifyWorkflowWarning,
  sendUserMessage,
  dispatchNextAutoWorkflowPrompt,
  retryMs: AUTO_FRESH_IDLE_RETRY_MS,
  maxAttempts: AUTO_FRESH_IDLE_MAX_ATTEMPTS,
});

const taskCommitCoordinator = createTaskCommitCoordinator({
  appendEntry: appendWorkflowEntry,
  archiveWorkflowStats,
  dispatchAutoPromptFreshAware,
  dispatchNextAutoWorkflowPrompt,
  expandPackagedPromptTemplate,
  freshContinuation,
  latestActiveStatsTarget,
  notify: notifyWorkflow,
  setState: (ctx, state, appendEntry) =>
    setContextWorkflowState(ctx as never, state, appendEntry),
  validPendingFreshContinuation,
});

const autoAgentEnd = createAutoAgentEnd({
  appendEntry: appendWorkflowEntry,
  archiveWorkflowStats,
  actionTargetsCompletePlanTask,
  dispatchAutoPromptFreshAware,
  dispatchNextAutoWorkflowPrompt,
  maxReviewFixLoops: (ctx) =>
    loadAddyWorkflowConfig(
      ctx as {
        cwd?: string;
        ui?: { notify?: (message: string, level?: string) => void };
      },
    ).auto.review.maxFixLoops,
  maybeDispatchTaskCommit,
  notifyWarning: (ctx, message) => notifyWorkflow(ctx, message, 'warning'),
  setState: (ctx, state, appendEntry) =>
    setContextWorkflowState(ctx as never, state, appendEntry),
  showWorkflowStats,
});

function isWorkflowPhase(value: string | undefined): value is WorkflowPhase {
  return WORKFLOW_PHASES.includes(value as WorkflowPhase);
}

function appendWorkflowEntry(pi: ExtensionAPI) {
  return (type: string, data: unknown) => pi.appendEntry?.(type, data);
}

function appendWorkflowEntryFromContext(ctx: unknown) {
  return (type: string, data: unknown) =>
    (
      ctx as {
        sessionManager?: {
          appendCustomEntry?: (type: string, data: unknown) => void;
        };
      }
    ).sessionManager?.appendCustomEntry?.(type, data);
}

function extensionApiFromContext(ctx: unknown): ExtensionAPI {
  return {
    appendEntry: appendWorkflowEntryFromContext(ctx),
    sendUserMessage: (content: string, options?: UserMessageDeliveryOptions) =>
      (
        ctx as {
          sendUserMessage?: (
            content: string,
            options?: UserMessageDeliveryOptions,
          ) => void | Promise<void>;
        }
      ).sendUserMessage?.(content, options),
  } as ExtensionAPI;
}

function parseCommandArgs(event: CommandEvent): string[] {
  if (typeof event === 'string') return event.split(/\s+/).filter(Boolean);
  return event.args ?? event.input?.split(/\s+/).filter(Boolean) ?? [];
}

function appendAutoUnblockGuidance(message: string, command?: string): string {
  const fixAllGuidance =
    command === '/addy-fix-all'
      ? `

## Addy Auto Fix-All Handoff

This is an auto-dispatched fix pass. Fix only the surfaced review issues and run narrow validation for the changed scope. Do not invoke or perform \`/addy-verify\` or \`/addy-review\` inside this \`/addy-fix-all\` turn. When this turn ends, the Addy auto monitor will dispatch \`/addy-verify\` first, then \`/addy-review\`.`
      : '';

  return `${message}

## Addy Auto Mode Recovery

Addy Auto Mode is active. If this step blocks, repeats, or finds missing artifacts, use the Pi \`addy-auto-unblock\` skill before pausing. That skill must apply \`debugging-and-error-recovery\` to reproduce, classify, and safely fix scoped blockers.

Critical rule: do not skip, weaken, or silently reinterpret acceptance criteria, verification, or review. Only mark lifecycle checkboxes when there is real evidence from this run.${fixAllGuidance}`;
}

function extractWriteArtifact(event: ToolCallEvent): string | undefined {
  const toolName = event.toolName ?? event.name ?? '';
  const input = event.input ?? {};
  if (
    ![
      'write',
      'edit',
      'multi_edit',
      'obsidian_obsidian_append_content',
      'obsidian_obsidian_patch_content',
    ].includes(toolName)
  )
    return undefined;

  for (const key of ['path', 'file_path', 'filepath']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }

  return undefined;
}

function activePlanPrompt(
  command: string,
  state: ReturnType<typeof getContextWorkflowState>,
): string | undefined {
  return state.activePlan ? `${command} ${state.activePlan}` : undefined;
}

function textFromMessage(message: AgentMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map((part) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
        ? part.text
        : '',
    )
    .filter(Boolean)
    .join('\n');
}

function latestAssistantText(event: AgentEndEvent): string {
  const messages = event.messages ?? (event.message ? [event.message] : []);
  return textFromMessage(
    [...messages].reverse().find((message) => message.role === 'assistant') ??
      messages.at(-1),
  );
}

function latestAssistantMessage(
  event: AgentEndEvent,
): AgentMessage | undefined {
  const messages = event.messages ?? (event.message ? [event.message] : []);
  return (
    [...messages].reverse().find((message) => message.role === 'assistant') ??
    messages.at(-1)
  );
}

function agentEndedWithProviderTransportFailure(event: AgentEndEvent): boolean {
  const message = latestAssistantMessage(event);
  return Boolean(
    message?.stopReason === 'error' &&
    message.diagnostics?.some(
      (diagnostic) => diagnostic.type === 'provider_transport_failure',
    ),
  );
}

function reviewedTaskWasCompleted(
  previousState: ReturnType<typeof getContextWorkflowState>,
  state: ReturnType<typeof getContextWorkflowState>,
): boolean {
  if (!previousState.activePlan || !state.activePlan) return false;
  if (
    !previousState.currentTask ||
    previousState.currentTask === 'none' ||
    previousState.currentTask === 'all tasks complete'
  )
    return false;
  if (!previousState.currentTaskIndex || !previousState.taskCount) return false;

  return (
    state.activePlan !== previousState.activePlan ||
    state.currentTask !== previousState.currentTask ||
    state.currentTaskIndex !== previousState.currentTaskIndex ||
    state.taskCount !== previousState.taskCount
  );
}

function followUpDeliveryOptions(): UserMessageDeliveryOptions {
  return { deliverAs: 'followUp', streamingBehavior: 'followUp' };
}

function defaultDeliveryOptions(): UserMessageDeliveryOptions {
  return { deliverAs: 'followUp', streamingBehavior: 'followUp' };
}

function idleTurnDeliveryOptions(): UserMessageDeliveryOptions {
  return { streamingBehavior: 'followUp' };
}

function isSubagentChildSession(): boolean {
  return process.env.PI_SUBAGENT_CHILD === '1';
}

function preservePendingAutoActionForRetry(
  ctx: unknown,
  message: string,
  deliveryPrompt?: string,
): string | undefined {
  const state = getContextWorkflowState(ctx as never);
  if (!state.autoMode) return undefined;
  const prompt = workflowTextFromInput(message);
  const pendingAction = pendingAutoActionForPrompt(
    prompt,
    state,
    latestActiveStatsTarget(state),
    'idle-retry',
    autoWorkflowActionKeyForPromptState(
      prompt,
      state,
      latestActiveStatsTarget(state),
    ),
    deliveryPrompt,
  );
  setContextWorkflowState(
    ctx as never,
    { ...state, autoPendingAction: pendingAction },
    appendWorkflowEntryFromContext(ctx),
  );
  return pendingAction.key;
}

function preservePendingAutoActionAfterDeliveryFailure(
  ctx: unknown,
  message: string,
): void {
  preservePendingAutoActionForRetry(ctx, workflowTextFromInput(message));
}

function handleUserMessageDeliveryFailure(
  ctx: unknown,
  message: string,
  error: unknown,
): void {
  preservePendingAutoActionAfterDeliveryFailure(ctx, message);
  const details = error instanceof Error ? error.message : String(error);
  notifyWorkflowWarning(
    ctx,
    `Addy auto could not deliver the next workflow prompt: ${details}. The prompt was preserved and Addy will retry it on the next safe lifecycle event.`,
  );
}

function safeSendUserMessage(
  pi: ExtensionAPI,
  ctx: unknown,
  message: string,
  options: {
    autoMode?: boolean;
    useDefaultDelivery?: boolean;
    idleTurnDelivery?: boolean;
  },
): void {
  try {
    void Promise.resolve(sendUserMessage(pi, ctx, message, options)).catch(
      (error) => handleUserMessageDeliveryFailure(ctx, message, error),
    );
  } catch (error) {
    handleUserMessageDeliveryFailure(ctx, message, error);
  }
}

function scheduleUserMessageAfterIdle(
  pi: ExtensionAPI,
  ctx: unknown,
  message: string,
  options: {
    autoMode?: boolean;
    useDefaultDelivery?: boolean;
    idleTurnDelivery?: boolean;
  },
): void {
  const runtime = createWorkflowRuntime(pi, ctx);
  const key = idleUserMessageKey(ctx, message);
  let scheduledActionKey: string | undefined;

  runWhenIdle({
    runtime,
    registry: 'idle-user-message',
    key,
    retryMs: AUTO_FRESH_IDLE_RETRY_MS,
    maxAttempts: AUTO_FRESH_IDLE_MAX_ATTEMPTS,
    onStart: () => {
      scheduledActionKey = options.autoMode
        ? preservePendingAutoActionForRetry(ctx, message)
        : undefined;
    },
    onTimeout: () => {
      preservePendingAutoActionAfterDeliveryFailure(ctx, message);
      notifyWorkflowWarning(
        ctx,
        'Addy auto is still busy; the next workflow prompt was preserved for retry.',
      );
    },
    onReady: () => {
      const latestState = getContextWorkflowState(ctx as never);
      if (options.idleTurnDelivery && scheduledActionKey) {
        const latestActionKey = currentAutoWorkflowActionKey(
          latestState,
          latestActiveStatsTarget(latestState),
        );
        if (latestActionKey !== scheduledActionKey) return;
      }
      if (
        scheduledActionKey &&
        latestState.autoPendingAction?.key === scheduledActionKey
      ) {
        setContextWorkflowState(
          ctx as never,
          { ...latestState, autoPendingAction: undefined },
          appendWorkflowEntryFromContext(ctx),
        );
      }
      safeSendUserMessage(pi, ctx, message, options);
    },
    onError: (error) => {
      if (isStaleExtensionContextError(error)) return;
      try {
        handleUserMessageDeliveryFailure(ctx, message, error);
      } catch {
        const details = error instanceof Error ? error.message : String(error);
        notifyWorkflowWarning(
          ctx,
          `Addy auto could not deliver the next workflow prompt: ${details}.`,
        );
      }
    },
  });
}

function sendUserMessage(
  pi: ExtensionAPI,
  ctx: unknown,
  message: string,
  options: {
    autoMode?: boolean;
    useDefaultDelivery?: boolean;
    idleTurnDelivery?: boolean;
  } = {},
): void | Promise<void> {
  const expandedMessage = expandPackagedPromptTemplate(message);
  const deliveredMessage = options.autoMode
    ? appendAutoUnblockGuidance(expandedMessage, commandFromPrompt(message))
    : expandedMessage;
  if (
    options.idleTurnDelivery &&
    options.useDefaultDelivery &&
    hasContextIdleSignal(ctx) &&
    canSendUserMessage(pi, ctx) &&
    isContextBusy(ctx)
  ) {
    scheduleUserMessageAfterIdle(pi, ctx, message, options);
    return;
  }

  const runtime = createWorkflowRuntime(pi, ctx);
  if (!runtime.canSendUserMessage()) {
    if (options.autoMode)
      preservePendingAutoActionAfterDeliveryFailure(
        ctx,
        workflowTextFromInput(message),
      );
    runtime.setEditorText(deliveredMessage);
    runtime.notify(
      options.autoMode
        ? `Prefilled ${workflowTextFromInput(message)}; Addy auto could not send it, so the prompt was preserved for retry.`
        : `Prefilled ${message}; submit it to continue Addy auto.`,
      'info',
    );
    return;
  }

  return runtime.sendUserMessage(
    deliveredMessage,
    options.useDefaultDelivery
      ? options.idleTurnDelivery
        ? idleTurnDeliveryOptions()
        : defaultDeliveryOptions()
      : followUpDeliveryOptions(),
  );
}

function canSendUserMessage(pi: ExtensionAPI, ctx: unknown): boolean {
  return createWorkflowRuntime(pi, ctx).canSendUserMessage();
}

function isContextBusy(ctx: unknown): boolean {
  return createWorkflowRuntime({} as ExtensionAPI, ctx).isBusy();
}

function hasContextIdleSignal(ctx: unknown): boolean {
  return createWorkflowRuntime({} as ExtensionAPI, ctx).hasIdleSignal();
}

function notifyWorkflow(ctx: unknown, message: string, level?: string): void {
  createWorkflowRuntime({} as ExtensionAPI, ctx).notify(message, level);
}

function notifyWorkflowWarning(ctx: unknown, message: string): void {
  notifyWorkflow(ctx, message, 'warning');
}

function latestActiveStatsTarget(
  state: ReturnType<typeof getContextWorkflowState>,
): WorkflowStatsTarget | undefined {
  const task = Object.values(state.stats?.active.tasks ?? {}).at(-1);
  if (!task) return undefined;
  return statsTargetFromTask(task);
}

function statsTargetFromTask(
  task: NonNullable<
    ReturnType<typeof getContextWorkflowState>['stats']
  >['active']['tasks'][string],
): WorkflowStatsTarget {
  return {
    plan: task.plan,
    taskId: task.taskId,
    sliceIndex: task.sliceIndex,
    taskIndex: task.taskIndex,
    taskTitle: task.taskTitle,
  };
}

function planTaskIsComplete(
  planPath: string | undefined,
  baseCwd: string | undefined,
  target: WorkflowStatsTarget,
): boolean {
  if (!planPath || (!target.taskTitle && !target.taskId)) return false;

  try {
    const tasks = planTasksFromMarkdown(
      readFileSync(resolveWorkflowPlanPath(planPath, baseCwd), 'utf8'),
    );
    const task = target.taskId
      ? tasks.find((candidate) => candidate.taskId === target.taskId)
      : target.taskIndex
        ? tasks[target.taskIndex - 1]
        : tasks.find((candidate) => candidate.title === target.taskTitle);
    return Boolean(
      task?.complete &&
      (target.taskId
        ? task.taskId === target.taskId
        : task.title === target.taskTitle),
    );
  } catch {
    return false;
  }
}

function actionTargetsCompletePlanTask(
  state: ReturnType<typeof getContextWorkflowState>,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
  baseCwd?: string,
): boolean {
  if (!action?.taskTitle) return false;
  return planTaskIsComplete(state.activePlan, baseCwd, {
    taskIndex:
      state.currentTask === action.taskTitle
        ? state.currentTaskIndex
        : undefined,
    taskTitle: action.taskTitle,
    taskId: action.taskId,
  });
}

function completedPlanAutoContinuation(
  state: ReturnType<typeof getContextWorkflowState>,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
  baseCwd?: string,
):
  | {
      state: ReturnType<typeof getContextWorkflowState>;
      action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>;
    }
  | undefined {
  const command = commandFromPrompt(action?.prompt);
  if (command !== '/addy-review' && command !== '/addy-finish')
    return undefined;
  if (!allTasksInCurrentPlanAreClosed(state, baseCwd)) return undefined;

  const nextSlicePlan = nextUnfinishedSlicePlanPath(state, baseCwd);
  if (!nextSlicePlan && command === '/addy-review')
    return {
      state,
      action: {
        prompt: nextPromptForPhase('finish', state.activePlan),
        taskTitle: action?.taskTitle,
        missingStatuses: [],
      },
    };
  if (!nextSlicePlan) return undefined;

  const nextState = {
    ...state,
    activePlan: nextSlicePlan,
    activeSuitePlan: state.activeSuitePlan ?? state.activePlan,
    currentTask: undefined,
    currentTaskId: undefined,
    nextTask: undefined,
    nextTaskId: undefined,
    currentTaskIndex: undefined,
    taskCount: undefined,
    currentTaskSummary: undefined,
    nextTaskSummary: undefined,
    autoReviewTask: undefined,
    autoReviewTaskId: undefined,
    autoReviewTaskIndex: undefined,
  };
  return {
    state: nextState,
    action: nextWorkflowActionForActivePlanLifecycle(nextState, baseCwd),
  };
}

function latestCompletedActiveStatsTarget(
  state: ReturnType<typeof getContextWorkflowState>,
  baseCwd?: string,
): WorkflowStatsTarget | undefined {
  const tasks = Object.values(state.stats?.active.tasks ?? {});
  for (const task of [...tasks].reverse()) {
    if (
      !task.taskTitle ||
      task.taskTitle === 'none' ||
      task.taskTitle === 'all tasks complete'
    )
      continue;
    const target = statsTargetFromTask(task);
    if (
      task.verifyRuns > 0 &&
      task.reviewRuns > 0 &&
      planTaskIsComplete(target.plan ?? state.activePlan, baseCwd, target)
    )
      return target;
  }
  return undefined;
}

function activePlanPromptForTarget(
  command: string,
  state: ReturnType<typeof getContextWorkflowState>,
  target?: WorkflowStatsTarget,
): string | undefined {
  const plan = target?.plan ?? state.activePlan;
  return plan ? `${command} ${plan}` : undefined;
}

function autoPauseWarning(
  prompt: string,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
): string {
  const missing = action?.missingStatuses?.join(', ');
  const task = action?.taskTitle ? ` Task: ${action.taskTitle}.` : '';
  const missingText = missing ? ` Missing: ${missing}.` : '';
  return `Addy auto paused at ${prompt}; the current lifecycle step is still incomplete after retry.${task}${missingText} Re-run the step after fixing the work, or update the plan checkbox only if that phase is actually complete.`;
}

function autoRecoveryPrompt(
  prompt: string,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
  retryCount: number,
): string {
  const task = action?.taskTitle ?? 'the current task';
  const missing = action?.missingStatuses?.join(', ') ?? 'the current phase';
  return `${expandPackagedPromptTemplate(prompt)}

## Addy Auto Same-Phase Recovery Pass

This is autonomous retry #${retryCount + 1} for the same incomplete lifecycle phase. Do not stop after a preflight/status report. Grind until the phase is complete or you can prove a hard blocker needs user input.

Target task: ${task}
Missing lifecycle evidence: ${missing}

Required loop:
1. Re-read the plan and the current task acceptance criteria.
2. Self-assess what is still missing for this exact phase.
3. Diagnose the blocker using focused commands and existing tests.
4. Make the smallest safe fix needed for this phase.
5. Run focused verification proving the fix.
6. Update only the lifecycle checkbox(es) backed by evidence from this turn.
7. If verification fails, iterate again in this same turn instead of pausing.

Pause only for a real hard blocker: missing credentials, destructive production risk, unresolved merge conflict, or explicit user decision required. If you pause, name the blocker and the exact command/evidence that proves it.`;
}

function stateWithCompletedLifecyclePhasesFromPlan(
  state: ReturnType<typeof getContextWorkflowState>,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
): ReturnType<typeof getContextWorkflowState> {
  const command = commandFromPrompt(action?.prompt);
  const missingStatuses = action?.missingStatuses;
  const phases = { ...state.phases };

  if (command === '/addy-finish') {
    phases.build = 'complete';
    phases.verify = 'complete';
    phases.review = 'complete';
  } else {
    if (missingStatuses && !missingStatuses.includes('Implemented'))
      phases.build = 'complete';
    if (missingStatuses && !missingStatuses.includes('Verified'))
      phases.verify = 'complete';
  }

  return { ...state, phases };
}

function isStaleExtensionContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      'This extension ctx is stale after session replacement',
    )
  );
}

function addStatsHeading(markdown: string, heading?: string): string {
  if (!heading) return markdown;
  return [`## ${heading}`, '', markdown.replace(/^## /, '### ')].join('\n');
}

function showWorkflowStats(
  pi: ExtensionAPI,
  ctx: unknown,
  state: ReturnType<typeof getContextWorkflowState>,
  options: { heading?: string; planPath?: string } = {},
): void {
  const statsText = renderWorkflowStatsText(state, options.planPath);
  const fallbackText = options.heading
    ? `${options.heading}\n${statsText}`
    : statsText;
  const markdown = addStatsHeading(
    renderWorkflowStatsMarkdown(state, options.planPath),
    options.heading,
  );

  if (pi.sendMessage) {
    pi.sendMessage({
      customType: ADDY_STATS_MESSAGE_TYPE,
      content: fallbackText,
      display: true,
      details: { markdown },
    });
    return;
  }

  notifyWorkflow(ctx, fallbackText, 'info');
}

function parseAutoFreshReason(
  event: CommandEvent,
): AutoFreshReason | undefined {
  const args = parseCommandArgs(event);
  const freshIndex = args.indexOf('--fresh');
  const value = freshIndex >= 0 ? args[freshIndex + 1] : args[0];
  return value === 'between-tasks' ||
    value === 'before-step' ||
    value === 'before-review'
    ? value
    : undefined;
}

function shouldFreshContextBeforeStep(input: string, ctx: unknown): boolean {
  const command = input.trim().split(/\s+/, 1)[0];
  if (!isFreshContextStepCommand(command)) return false;
  return loadAddyWorkflowConfig(
    ctx as {
      cwd?: string;
      ui?: { notify?: (message: string, level?: string) => void };
    },
  ).auto.freshContext.beforeEveryStep;
}

async function dispatchManualFrontierGuard(
  pi: ExtensionAPI,
  input: string,
  ctx: unknown,
  options: DispatchOptions = {},
): Promise<boolean> {
  const command = commandFromPrompt(input);
  if (command !== '/addy-build') return false;

  const state = getContextWorkflowState(ctx as never);
  if (!state.activePlan) return false;
  const action = nextWorkflowActionForActivePlanLifecycle(
    state,
    (ctx as { cwd?: string }).cwd,
  );
  const requiredCommand = commandFromPrompt(action?.prompt);
  if (!action?.prompt || requiredCommand === '/addy-build') return false;

  const notify = (message: string, level: string) =>
    notifyWorkflow(ctx, message, level);
  notify(
    `Addy refused /addy-build because the frontier task requires ${requiredCommand}.`,
    'warning',
  );

  const commitTarget = taskCommitCoordinator.actionCommitTarget(state, action);
  if (commitTarget) {
    await taskCommitCoordinator.dispatchTaskCommitPrompt(
      pi,
      ctx,
      state,
      commitTarget,
      {
        ...options,
        useDefaultDelivery: true,
      },
    );
    return true;
  }

  await dispatchAutoPromptFreshAware(
    pi,
    ctx,
    action.prompt,
    state,
    {},
    action.taskTitle
      ? {
          plan: state.activePlan,
          sliceIndex: state.currentSliceIndex,
          taskIndex: action.taskIndex ?? state.currentTaskIndex,
          taskTitle: action.taskTitle,
          taskId: action.taskId,
        }
      : undefined,
    { ...options, useDefaultDelivery: true },
  );
  return true;
}

async function dispatchManualStepWithFreshContextConfig(
  pi: ExtensionAPI,
  input: string,
  ctx: unknown,
): Promise<boolean> {
  const plan = planManualStepDispatch(input);
  notifyWorkflow(ctx, plan.notice, 'info');
  sendUserMessage(pi, ctx, expandPackagedPromptTemplate(plan.prompt));
  return true;
}

function executeCurrentSessionAutoPromptPlan(
  pi: ExtensionAPI,
  ctx: unknown,
  prompt: string,
  state: ReturnType<typeof getContextWorkflowState>,
  plan: Extract<AutoPromptDispatchPlan, { kind: 'current-session' }>,
  options: DispatchOptions = {},
): void {
  const message = plan.deliveryPrompt ?? prompt;
  setContextWorkflowState(
    ctx as never,
    plan.state,
    options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
  );
  const deliveryOptions = {
    autoMode: state.autoMode,
    useDefaultDelivery: options.useDefaultDelivery,
    idleTurnDelivery: options.idleTurnDelivery,
  };
  if (options.idleTurnDelivery)
    safeSendUserMessage(pi, ctx, message, deliveryOptions);
  else {
    try {
      const delivered = sendUserMessage(pi, ctx, message, deliveryOptions);
      if (delivered && typeof (delivered as Promise<void>).catch === 'function')
        void (delivered as Promise<void>).catch((error) =>
          handleUserMessageDeliveryFailure(ctx, message, error),
        );
    } catch (error) {
      handleUserMessageDeliveryFailure(ctx, message, error);
      throw error;
    }
  }
}

async function dispatchAutoPromptFreshAware(
  pi: ExtensionAPI,
  ctx: unknown,
  prompt: string,
  state: ReturnType<typeof getContextWorkflowState>,
  updates: Partial<ReturnType<typeof getContextWorkflowState>> = {},
  statsTarget?: WorkflowStatsTarget,
  options: DispatchOptions = {},
  deliveryPrompt?: string,
): Promise<void> {
  const plan = planAutoPromptDispatch({
    prompt,
    state,
    updates,
    statsTarget,
    options,
    freshContext: loadAddyWorkflowConfig(
      ctx as {
        cwd?: string;
        ui?: { notify?: (message: string, level?: string) => void };
      },
    ).auto.freshContext,
    deliveryPrompt,
    expandedPrompt: expandPackagedPromptTemplate(prompt),
  });
  if (plan.kind === 'current-session') {
    executeCurrentSessionAutoPromptPlan(pi, ctx, prompt, state, plan, options);
    return;
  }

  setContextWorkflowState(
    ctx as never,
    plan.state,
    options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
  );
  if (options.disableFreshSession) {
    const pendingState = getContextWorkflowState(ctx as never);
    if (validPendingFreshContinuation(pendingState)) {
      const fallbackOptions = {
        ...options,
        freshContextBypassReason: plan.reason,
        useDefaultDelivery: options.disableCompaction
          ? options.useDefaultDelivery
          : true,
      };
      if (options.disableCompaction)
        await freshContinuation.deliverPendingFreshPromptInCurrentSession(
          pi,
          ctx,
          pendingState,
          fallbackOptions,
        );
      else
        freshContinuation.schedulePendingFreshPromptAfterCompaction(
          pi,
          ctx,
          pendingState,
          fallbackOptions,
        );
    }
    return;
  }
  await freshContinuation.runFreshContextContinuation(pi, ctx, plan.reason);
}

async function maybeDispatchTaskCommit(
  pi: ExtensionAPI,
  ctx: unknown,
  reviewText: string,
  previousState: ReturnType<typeof getContextWorkflowState>,
  state: ReturnType<typeof getContextWorkflowState>,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
  options: DispatchOptions = {},
): Promise<boolean> {
  if (commandFromPrompt(previousState.autoLastPrompt) !== '/addy-review')
    return false;
  if (!reviewText.trim() || reviewTextHasActionableFindings(reviewText))
    return false;
  const nextCommand = commandFromPrompt(action?.prompt);

  const reviewedTask =
    previousState.autoReviewTask && previousState.autoReviewTask !== 'none'
      ? previousState.autoReviewTask
      : previousState.currentTask;
  const reviewedTaskId =
    previousState.autoReviewTaskId ?? previousState.currentTaskId;
  const planMovedPastReviewTarget = Boolean(
    reviewedTask &&
    reviewedTask !== 'none' &&
    action?.taskTitle &&
    action.taskTitle !== reviewedTask,
  );
  const reviewedTaskIsComplete = planTaskIsComplete(
    previousState.activePlan,
    (ctx as { cwd?: string }).cwd,
    {
      taskId: reviewedTaskId,
      taskIndex:
        previousState.autoReviewTaskIndex ?? previousState.currentTaskIndex,
      taskTitle: reviewedTask,
    },
  );
  if (nextCommand === '/addy-review' && !reviewedTaskIsComplete) return false;
  if (
    !planMovedPastReviewTarget &&
    !reviewedTaskWasCompleted(previousState, state) &&
    !reviewedTaskIsComplete
  )
    return false;

  const commitTarget = taskCommitCoordinator.withPlanTaskId(
    {
      plan: previousState.activePlan,
      taskId: reviewedTaskId,
      sliceIndex: previousState.currentSliceIndex,
      taskIndex:
        previousState.autoReviewTaskIndex ?? previousState.currentTaskIndex,
      taskTitle: reviewedTask,
    },
    (ctx as { cwd?: string }).cwd,
  );
  if (!commitTarget) return false;
  await taskCommitCoordinator.dispatchTaskCommitPrompt(
    pi,
    ctx,
    state,
    commitTarget,
    options,
  );
  return true;
}

async function dispatchNextAutoWorkflowPrompt(
  pi: ExtensionAPI,
  ctx: unknown,
  allowSamePhase = false,
  options: DispatchOptions = {},
): Promise<void> {
  const workflowCtx = ctx as never;
  const state = getContextWorkflowState(workflowCtx);
  setContextWorkflowState(
    workflowCtx,
    state,
    options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
  );
  const refreshedState = getContextWorkflowState(workflowCtx);
  const action = nextWorkflowActionForActivePlanLifecycle(
    refreshedState,
    (ctx as { cwd?: string }).cwd,
  );
  const completedContinuation = completedPlanAutoContinuation(
    refreshedState,
    action,
    (ctx as { cwd?: string }).cwd,
  );
  const dispatchState = completedContinuation?.state ?? refreshedState;
  const dispatchAction = completedContinuation?.action ?? action;
  if (completedContinuation) {
    setContextWorkflowState(
      workflowCtx,
      completedContinuation.state,
      options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
    );
  }
  const prompt = dispatchAction?.prompt;
  if (!prompt) {
    notifyWorkflow(
      ctx,
      'Addy auto is active, but no active plan is available.',
      'warning',
    );
    return;
  }

  const actionPendingCommitTarget = taskCommitCoordinator.actionCommitTarget(
    dispatchState,
    dispatchAction,
  );
  if (actionPendingCommitTarget) {
    await taskCommitCoordinator.dispatchTaskCommitPrompt(
      pi,
      ctx,
      dispatchState,
      actionPendingCommitTarget,
      options,
    );
    return;
  }

  const pendingCommitTarget = latestCompletedActiveStatsTarget(
    dispatchState,
    (ctx as { cwd?: string }).cwd,
  );
  if (
    pendingCommitTarget &&
    commandFromPrompt(dispatchState.autoLastPrompt) !== AUTO_TASK_COMMIT_PROMPT
  ) {
    await taskCommitCoordinator.dispatchTaskCommitPrompt(
      pi,
      ctx,
      dispatchState,
      pendingCommitTarget,
      options,
    );
    return;
  }

  const lifecycleSyncedState = stateWithCompletedLifecyclePhasesFromPlan(
    dispatchState,
    dispatchAction,
  );
  const phase = phaseFromWorkflowPrompt(prompt);
  const retryKey = autoRetryKey(lifecycleSyncedState, prompt);
  const isSameIncompletePhase = phase && phase === lifecycleSyncedState.current;
  const retryCount =
    lifecycleSyncedState.autoRetryKey === retryKey
      ? (lifecycleSyncedState.autoRetryCount ?? 0)
      : 0;
  if (
    !allowSamePhase &&
    isSameIncompletePhase &&
    retryCount >= AUTO_SAME_PHASE_MAX_RETRIES
  ) {
    setContextWorkflowState(
      workflowCtx,
      { ...lifecycleSyncedState, autoPausedReason: 'same-phase-retry-limit' },
      options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
    );
    notifyWorkflow(ctx, autoPauseWarning(prompt, dispatchAction), 'warning');
    return;
  }

  const deliveryPrompt =
    !allowSamePhase && isSameIncompletePhase && retryCount >= 1
      ? autoRecoveryPrompt(prompt, dispatchAction, retryCount)
      : undefined;

  const reviewTask =
    phase === 'review'
      ? (dispatchAction?.taskTitle ?? lifecycleSyncedState.currentTask)
      : undefined;
  const finishTask =
    phase === 'finish' ? lifecycleSyncedState.autoReviewTask : undefined;
  const reviewTaskId =
    phase === 'review'
      ? (dispatchAction?.taskId ?? lifecycleSyncedState.currentTaskId)
      : undefined;
  const finishTaskId =
    phase === 'finish' ? lifecycleSyncedState.autoReviewTaskId : undefined;
  await dispatchAutoPromptFreshAware(
    pi,
    ctx,
    prompt,
    lifecycleSyncedState,
    {
      autoRetryKey: retryKey,
      autoRetryCount: isSameIncompletePhase ? retryCount + 1 : 0,
      autoReviewTask: reviewTask ?? finishTask,
      autoReviewTaskId: reviewTaskId ?? finishTaskId,
      autoReviewTaskIndex:
        phase === 'review'
          ? lifecycleSyncedState.currentTaskIndex
          : phase === 'finish'
            ? lifecycleSyncedState.autoReviewTaskIndex
            : undefined,
    },
    reviewTask || finishTask
      ? {
          taskId: reviewTaskId ?? finishTaskId,
          taskIndex:
            phase === 'review'
              ? lifecycleSyncedState.currentTaskIndex
              : lifecycleSyncedState.autoReviewTaskIndex,
          taskTitle: reviewTask ?? finishTask,
        }
      : undefined,
    options,
    deliveryPrompt,
  );
}

async function maybeRunAutoWatchdog(
  pi: ExtensionAPI,
  ctx: unknown,
  trigger: string,
  options: DispatchOptions = {},
): Promise<boolean> {
  if (isSubagentChildSession()) return false;
  const workflowCtx = ctx as never;
  const state = getContextWorkflowState(workflowCtx);
  if (!state.autoMode || state.autoPausedReason) return false;

  if (validPendingFreshContinuation(state)) {
    await freshContinuation.deliverPendingFreshPromptInCurrentSession(
      pi,
      ctx,
      state,
      {
        ...options,
        freshContextBypassReason: state.autoFreshReason,
        useDefaultDelivery: true,
      },
    );
    return true;
  }

  const action = nextWorkflowActionForActivePlanLifecycle(
    state,
    (ctx as { cwd?: string }).cwd,
  );
  const actionKey = autoWorkflowActionKeyForAction(state, action);
  if (!actionKey) return false;

  if (state.autoPendingAction && state.autoPendingAction.key !== actionKey) {
    setContextWorkflowState(
      workflowCtx,
      { ...state, autoPendingAction: undefined },
      options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
    );
  }

  void trigger;
  const dedupeKey = actionKey;
  const runtime = createWorkflowRuntime(pi, ctx);
  if (
    !runtime.runOnce('auto-watchdog', dedupeKey, (release) =>
      runtime.schedule(release, 100),
    )
  )
    return true;

  await dispatchNextAutoWorkflowPrompt(
    pi,
    ctx,
    options.allowSamePhase ?? false,
    options,
  );
  return true;
}

async function dispatchNextAutoWorkflowPromptAfterAgentEnd(
  pi: ExtensionAPI,
  ctx: unknown,
  event: AgentEndEvent,
): Promise<void> {
  const workflowCtx = ctx as never;
  const agentEndOptions: DispatchOptions = {
    disableFreshSession: true,
    idleTurnDelivery: true,
    useDefaultDelivery: true,
  };
  const state = getContextWorkflowState(workflowCtx);
  if (
    await taskCommitCoordinator.maybeContinueAfterTaskCommit(
      pi,
      ctx,
      latestAssistantText(event),
      state,
      agentEndOptions,
    )
  )
    return;
  setContextWorkflowState(workflowCtx, state, appendWorkflowEntry(pi));
  const refreshedState = getContextWorkflowState(workflowCtx);
  const action = nextWorkflowActionForActivePlanLifecycle(
    refreshedState,
    (ctx as { cwd?: string }).cwd,
  );
  await autoAgentEnd.continueAfterAgentEnd(
    pi,
    ctx,
    latestAssistantText(event),
    state,
    refreshedState,
    action,
    agentEndOptions,
  );
}

export default function addyWorkflowMonitor(pi: ExtensionAPI) {
  pi.registerMessageRenderer?.(ADDY_STATS_MESSAGE_TYPE, (message) => {
    const details = message.details as { markdown?: unknown } | undefined;
    const markdown =
      typeof details?.markdown === 'string'
        ? details.markdown
        : typeof message.content === 'string'
          ? message.content
          : '';
    return new Markdown(markdown, 0, 0, getMarkdownTheme());
  });

  pi.on('session_start', async (_event: unknown, ctx: unknown) => {
    ensureGlobalAddyWorkflowConfig(
      ctx as {
        cwd?: string;
        ui?: { notify?: (message: string, level?: string) => void };
      },
    );
    const state = initializeWorkflowWidget(ctx as never);
    const notify = (message: string, level: string) =>
      notifyWorkflow(ctx, message, level);
    if (state.autoFreshPrompt && !state.autoFreshReason) {
      notify(
        'Ignoring stale Addy auto fresh continuation without a recorded reason.',
        'warning',
      );
      setContextWorkflowState(
        ctx as never,
        { ...state, ...staleAutoFreshUpdates() },
        appendWorkflowEntry(pi),
      );
    } else if (
      validPendingFreshContinuation(state) &&
      !isSubagentChildSession()
    )
      await freshContinuation.deliverPendingFreshPrompt(pi, ctx, state, {
        freshContextBypassReason: state.autoFreshReason,
        useDefaultDelivery: true,
      });
    else
      await maybeRunAutoWatchdog(pi, ctx, 'session-start', {
        disableFreshSession: true,
        disableCompaction: true,
        useDefaultDelivery: true,
      });
  });

  pi.on('input', async (event: InputEvent, ctx: unknown) => {
    const input = event.input ?? event.text ?? '';
    const workflowText = workflowTextFromInput(input);
    const state = getContextWorkflowState(ctx as never);
    const consumedState = freshContinuation.pendingFreshInputMatches(
      input,
      state,
    )
      ? freshContinuation.consumedPendingFreshPromptState(state)
      : undefined;
    if (consumedState) {
      setContextWorkflowState(
        ctx as never,
        consumedState,
        appendWorkflowEntry(pi),
      );
      return { action: 'continue' as const };
    }
    const manualAddyCommand = isManualAddyWorkflowCommand(input);
    if (
      manualAddyCommand &&
      event.source !== 'extension' &&
      (await dispatchManualFrontierGuard(pi, workflowText, ctx))
    )
      return { action: 'continue' as const };
    handleWorkflowEvent(
      ctx as never,
      {
        source: 'user-input',
        text: workflowText,
        manualAddyCommand,
      },
      appendWorkflowEntry(pi),
    );
    return { action: 'continue' as const };
  });

  pi.on('tool_result', (event: ToolEvent, ctx: unknown) => {
    handleWorkflowEvent(
      ctx as never,
      {
        source: 'tool-result',
        text: event.text,
        command: event.command,
        success: event.success,
        artifact: event.artifact,
      },
      appendWorkflowEntry(pi),
    );
  });

  pi.on('tool_call', (event: ToolCallEvent, ctx: unknown) => {
    const artifact = extractWriteArtifact(event);
    if (!artifact) return;
    handleWorkflowEvent(
      ctx as never,
      {
        source: 'file-write',
        artifact,
      },
      appendWorkflowEntry(pi),
    );
  });

  pi.on('before_agent_start', (event: SubagentEvent, ctx: unknown) => {
    try {
      handleWorkflowEvent(
        ctx as never,
        {
          source: 'subagent-call',
          agentName: event.agentName ?? event.agent,
        },
        appendWorkflowEntry(pi),
      );
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  });

  pi.on('agent_end', async (event: AgentEndEvent, ctx: unknown) => {
    try {
      const state = getContextWorkflowState(ctx as never);
      const reviewAgent = event.agentName ?? event.agent;
      const shouldRecordReviewIssues = Boolean(
        state.reviewStatsKey &&
        (!state.reviewStatsAgent || reviewAgent === state.reviewStatsAgent),
      );
      const reviewText = latestAssistantText(event);
      const stateWithReviewIssues = shouldRecordReviewIssues
        ? recordWorkflowReviewIssues(
            state,
            reviewIssueStatsFromText(reviewText),
          )
        : state;
      if (stateWithReviewIssues !== state)
        setContextWorkflowState(
          ctx as never,
          stateWithReviewIssues,
          appendWorkflowEntry(pi),
        );
      if (!stateWithReviewIssues.autoMode) return;
      if (agentEndedWithProviderTransportFailure(event)) {
        const retryPrompt = stateWithReviewIssues.autoLastPrompt;
        if (
          retryPrompt &&
          (commandFromPrompt(retryPrompt)?.startsWith('/addy-') ||
            commandFromPrompt(retryPrompt) === AUTO_TASK_COMMIT_PROMPT)
        ) {
          setContextWorkflowState(
            ctx as never,
            stateWithPendingAutoAction(
              {
                ...stateWithReviewIssues,
                autoLastPrompt: undefined,
              },
              retryPrompt,
              latestActiveStatsTarget(stateWithReviewIssues),
              'idle-retry',
              autoWorkflowActionKeyForPromptState(
                retryPrompt,
                stateWithReviewIssues,
                latestActiveStatsTarget(stateWithReviewIssues),
              ),
            ),
            appendWorkflowEntry(pi),
          );
          notifyWorkflow(
            ctx,
            'Addy auto preserved the workflow prompt after a provider transport failure and will retry it on the next safe lifecycle event.',
            'warning',
          );
          return;
        }
      }
      if (
        stateWithReviewIssues.autoFreshPrompt &&
        !stateWithReviewIssues.autoFreshReason
      ) {
        setContextWorkflowState(
          ctx as never,
          { ...stateWithReviewIssues, ...staleAutoFreshUpdates() },
          appendWorkflowEntry(pi),
        );
      } else if (
        validPendingFreshContinuation(stateWithReviewIssues) &&
        !isSubagentChildSession()
      ) {
        freshContinuation.schedulePendingFreshPromptAfterCompaction(
          pi,
          ctx,
          stateWithReviewIssues,
          {
            freshContextBypassReason: stateWithReviewIssues.autoFreshReason,
            useDefaultDelivery: true,
          },
        );
        return;
      }
      await dispatchNextAutoWorkflowPromptAfterAgentEnd(pi, ctx, event);
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  });

  for (const command of FRESH_CONTEXT_STEP_COMMANDS) {
    pi.registerCommand?.(command.slice(1), {
      description: `Run ${command} in a fresh session when Addy fresh context is enabled.`,
      handler: async (event: CommandEvent, ctx: unknown) => {
        const args = parseCommandArgs(event);
        const input = `${command}${args.length ? ` ${args.join(' ')}` : ''}`;
        if (await dispatchManualFrontierGuard(pi, input, ctx))
          return { action: 'continue' as const };
        handleWorkflowEvent(
          ctx as never,
          { source: 'command', text: input, manualAddyCommand: true },
          appendWorkflowEntry(pi),
        );
        if (shouldFreshContextBeforeStep(input, ctx))
          await dispatchManualStepWithFreshContextConfig(pi, input, ctx);
        else sendUserMessage(pi, ctx, input);
        return { action: 'continue' as const };
      },
    });
  }

  pi.registerCommand?.('addy-auto-continue', {
    description: 'Internal Addy auto continuation command.',
    handler: async (event: CommandEvent, ctx: unknown) => {
      const reason = parseAutoFreshReason(event);
      const notify = (message: string, level: string) =>
        notifyWorkflow(ctx, message, level);
      if (!reason) {
        notify(
          'Usage: /addy-auto-continue --fresh <between-tasks|before-step|before-review>',
          'warning',
        );
        return { action: 'continue' as const };
      }

      await freshContinuation.runFreshContextContinuation(pi, ctx, reason);
      return { action: 'continue' as const };
    },
  });

  pi.registerCommand?.('addy-auto', {
    description:
      'Run the Addy build, verify, review, and finish loop for the active plan.',
    handler: async (event: CommandEvent, ctx: unknown) => {
      const args = parseCommandArgs(event);
      const notify = (message: string, level: string) =>
        notifyWorkflow(ctx, message, level);
      if (args[0] !== 'stop') {
        const pending = getContextWorkflowState(ctx as never);
        if (pending.autoFreshPrompt && !pending.autoFreshReason) {
          notify(
            'Ignoring stale Addy auto fresh continuation without a recorded reason.',
            'warning',
          );
          setContextWorkflowState(
            ctx as never,
            { ...pending, ...staleAutoFreshUpdates() },
            appendWorkflowEntry(pi),
          );
        } else if (validPendingFreshContinuation(pending)) {
          await freshContinuation.deliverPendingFreshPromptInCurrentSession(
            pi,
            ctx,
            pending,
            {
              freshContextBypassReason: pending.autoFreshReason,
              useDefaultDelivery: false,
            },
          );
          return { action: 'continue' as const };
        } else if (
          commandFromPrompt(pending.autoLastPrompt) === AUTO_TASK_COMMIT_PROMPT
        ) {
          const pendingCommitTarget = latestActiveStatsTarget(pending);
          if (pendingCommitTarget) {
            await taskCommitCoordinator.dispatchTaskCommitPrompt(
              pi,
              ctx,
              pending,
              pendingCommitTarget,
              {
                disableFreshSession: true,
                disableCompaction: true,
              },
            );
            return { action: 'continue' as const };
          }
        }
      }
      const text = `/addy-auto${args.length ? ` ${args.join(' ')}` : ''}`;

      handleWorkflowEvent(
        ctx as never,
        {
          source: 'command',
          text,
          artifact:
            args[0] === 'stop' ? undefined : args.join(' ') || undefined,
        },
        appendWorkflowEntry(pi),
      );

      if (args[0] !== 'stop')
        await maybeRunAutoWatchdog(pi, ctx, 'addy-auto-command', {
          disableFreshSession: true,
          disableCompaction: true,
          allowSamePhase: true,
        });
      else {
        const state = getContextWorkflowState(ctx as never);
        showWorkflowStats(pi, ctx, state, { heading: 'Addy auto stopped.' });
      }
      return { action: 'continue' as const };
    },
  });

  pi.registerCommand?.('addy-stats', {
    description: 'Show Addy workflow stats for the active or supplied plan.',
    handler: (event: CommandEvent, ctx: unknown) => {
      const args = parseCommandArgs(event);
      showWorkflowStats(pi, ctx, getContextWorkflowState(ctx as never), {
        planPath: args.join(' ') || undefined,
      });
      return { action: 'continue' as const };
    },
  });

  pi.registerCommand?.('addy-workflow-reset', {
    description: 'Reset Addy workflow state and clear the widget.',
    handler: (_event: CommandEvent, ctx: unknown) => {
      resetWorkflow(ctx as never, appendWorkflowEntry(pi));
      return { action: 'continue' as const };
    },
  });

  pi.registerCommand?.('addy-workflow-next', {
    description: 'Open an Addy workflow prompt for a requested phase.',
    handler: (event: CommandEvent, ctx: unknown) => {
      const [phase, ...artifactParts] = parseCommandArgs(event);
      if (!isWorkflowPhase(phase)) {
        notifyWorkflow(
          ctx,
          'Usage: /addy-workflow-next <define|plan|build|simplify|verify|review|finish> [artifact]',
          'warning',
        );
        return { action: 'continue' as const };
      }

      handleWorkflowEvent(
        ctx as never,
        {
          source: 'command',
          text: `/addy-workflow-next ${phase}`,
          artifact: artifactParts.join(' ') || undefined,
        },
        appendWorkflowEntry(pi),
      );
      openNextWorkflowPrompt(
        ctx as never,
        phase,
        artifactParts.join(' ') || undefined,
      );
      return { action: 'continue' as const };
    },
  });
}
