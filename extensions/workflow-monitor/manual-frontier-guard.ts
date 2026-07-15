import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { commandFromPrompt } from './command-router.ts';
import type { WorkflowAction } from './auto-lifecycle.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import { ticketClaimSafetyWarning } from './ticket-source-switch.ts';

type ManualFrontierGuardOptions = {
  appendEntry?: boolean;
  useDefaultDelivery?: boolean;
  idleTurnDelivery?: boolean;
  disableFreshSession?: boolean;
  disableCompaction?: boolean;
  allowSamePhase?: boolean;
};

type ManualFrontierGuardDeps = {
  actionCommitTarget(
    state: WorkflowState,
    action: WorkflowAction,
  ): WorkflowStatsTarget | undefined;
  baseCwd(ctx: unknown): string | undefined;
  dispatchAutoPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    prompt: string,
    state: WorkflowState,
    updates?: Partial<WorkflowState>,
    statsTarget?: WorkflowStatsTarget,
    options?: ManualFrontierGuardOptions,
  ): Promise<void>;
  dispatchTaskCommitPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    target: WorkflowStatsTarget,
    options?: ManualFrontierGuardOptions,
  ): Promise<void>;
  getState(ctx: unknown): WorkflowState;
  nextActionForState(state: WorkflowState, baseCwd?: string): WorkflowAction;
  notify(ctx: unknown, message: string, level: string): void;
};

export function createManualFrontierGuard(deps: ManualFrontierGuardDeps) {
  async function dispatchManualFrontierGuard(
    pi: ExtensionAPI,
    input: string,
    ctx: unknown,
    options: ManualFrontierGuardOptions = {},
  ): Promise<boolean> {
    const command = commandFromPrompt(input);
    const state = deps.getState(ctx);
    const ticketWarning = ticketClaimSafetyWarning(state, input);
    if (ticketWarning) {
      deps.notify(ctx, ticketWarning, 'warning');
      return true;
    }
    if (command !== '/addy-build') return false;
    if (!state.activePlan) return false;
    const action = deps.nextActionForState(state, deps.baseCwd(ctx));
    const requiredCommand = commandFromPrompt(action?.prompt);
    if (!action?.prompt || requiredCommand === '/addy-build') return false;

    deps.notify(
      ctx,
      `Addy refused /addy-build because the frontier task requires ${requiredCommand}.`,
      'warning',
    );

    const commitTarget = deps.actionCommitTarget(state, action);
    if (commitTarget) {
      await deps.dispatchTaskCommitPrompt(pi, ctx, state, commitTarget, {
        ...options,
        useDefaultDelivery: true,
      });
      return true;
    }

    await deps.dispatchAutoPrompt(
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

  return { dispatchManualFrontierGuard };
}
