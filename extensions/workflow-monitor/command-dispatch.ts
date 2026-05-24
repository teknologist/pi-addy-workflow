import type { AddyWorkflowConfig } from './config.ts';
import {
  commandFromPrompt,
  isFreshContextStepCommand,
  isManualTurnCommand,
  phaseFromWorkflowPrompt,
} from './command-router.ts';
import { stateWithPendingFreshPrompt } from './fresh-continuation-pending-state.ts';
import { ADDY_AUTO_TASK_COMMIT_PROMPT } from './workflow-tracker.ts';
import {
  recordWorkflowReviewRun,
  recordWorkflowTaskTurn,
  recordWorkflowVerifyRun,
  type WorkflowStatsTarget,
} from './workflow-stats.ts';
import {
  transitionWorkflow,
  type AutoFreshReason,
  type WorkflowState,
} from './workflow-transitions.ts';

export type CommandDispatchOptions = {
  freshContextBypassReason?: AutoFreshReason;
};

export type AutoPromptDispatchPlan =
  | {
      kind: 'current-session';
      state: WorkflowState;
      deliveryPrompt?: string;
    }
  | {
      kind: 'pending-fresh';
      reason: AutoFreshReason;
      state: WorkflowState;
    };

export const MANUAL_FRESH_CONTEXT_NOTICE =
  'Addy beforeEveryStep fresh sessions are applied to auto-dispatched steps; manual workflow commands continue in the current session.';

function autoStatsCommand(command: string | undefined): boolean {
  return (
    isManualTurnCommand(command) || command === ADDY_AUTO_TASK_COMMIT_PROMPT
  );
}

export function stateAfterAutoPrompt(
  prompt: string,
  state: WorkflowState,
  updates: Partial<WorkflowState> = {},
  statsTarget?: WorkflowStatsTarget,
): WorkflowState {
  const nextState = {
    ...state,
    autoLastPrompt: prompt,
    autoPendingAction: undefined,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
    ...updates,
  };
  const cmd = commandFromPrompt(prompt);
  const target =
    statsTarget ??
    (cmd === '/addy-review' ||
    cmd === '/addy-finish' ||
    cmd === ADDY_AUTO_TASK_COMMIT_PROMPT
      ? {
          taskId: nextState.autoReviewTaskId ?? nextState.currentTaskId,
          taskIndex:
            nextState.autoReviewTaskIndex ?? nextState.currentTaskIndex,
          taskTitle: nextState.autoReviewTask ?? nextState.currentTask,
        }
      : {
          taskId: nextState.currentTaskId,
          taskIndex: nextState.currentTaskIndex,
          taskTitle: nextState.currentTask,
        });
  const stateWithStats =
    cmd === '/addy-verify'
      ? recordWorkflowVerifyRun(nextState, target)
      : cmd === '/addy-review'
        ? recordWorkflowReviewRun(nextState, target)
        : autoStatsCommand(cmd)
          ? recordWorkflowTaskTurn(nextState, target)
          : nextState;
  return cmd?.startsWith('/addy-')
    ? transitionWorkflow(stateWithStats, {
        source: 'user-input',
        text: prompt,
        manualAddyCommand: false,
      })
    : stateWithStats;
}

export function freshContextReasonForPrompt(
  prompt: string,
  state: WorkflowState,
  options: CommandDispatchOptions,
  freshContext: AddyWorkflowConfig['auto']['freshContext'],
): AutoFreshReason | undefined {
  if (options.freshContextBypassReason) return undefined;
  const command = commandFromPrompt(prompt);
  const phase = phaseFromWorkflowPrompt(prompt);
  if (command === '/addy-finish' && state.autoMode) return undefined;
  if (phase === 'review' && freshContext.beforeReview) return 'before-review';
  if (
    command &&
    isFreshContextStepCommand(command) &&
    freshContext.beforeEveryStep
  )
    return 'before-step';
  return undefined;
}

export function planAutoPromptDispatch(input: {
  prompt: string;
  state: WorkflowState;
  updates?: Partial<WorkflowState>;
  statsTarget?: WorkflowStatsTarget;
  options?: CommandDispatchOptions;
  freshContext: AddyWorkflowConfig['auto']['freshContext'];
  deliveryPrompt?: string;
  expandedPrompt: string;
}): AutoPromptDispatchPlan {
  const options = input.options ?? {};
  const reason = freshContextReasonForPrompt(
    input.prompt,
    input.state,
    options,
    input.freshContext,
  );
  if (reason) {
    return planPendingFreshDispatch({ ...input, reason });
  }

  return {
    kind: 'current-session',
    state: stateAfterAutoPrompt(
      input.prompt,
      input.state,
      input.updates,
      input.statsTarget,
    ),
    deliveryPrompt: input.deliveryPrompt,
  };
}

export function planPendingFreshDispatch(input: {
  prompt: string;
  reason: AutoFreshReason;
  state: WorkflowState;
  updates?: Partial<WorkflowState>;
  deliveryPrompt?: string;
  expandedPrompt: string;
}): AutoPromptDispatchPlan {
  return {
    kind: 'pending-fresh',
    reason: input.reason,
    state: stateWithPendingFreshPrompt(
      input.prompt,
      input.reason,
      input.state,
      input.updates,
      input.deliveryPrompt ?? input.expandedPrompt,
    ),
  };
}

export function planManualStepDispatch(input: string): {
  prompt: string;
  notice: string;
} {
  return {
    prompt: input,
    notice: MANUAL_FRESH_CONTEXT_NOTICE,
  };
}
