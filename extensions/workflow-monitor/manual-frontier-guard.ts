import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { commandFromPrompt, workflowTextFromInput } from './command-router.ts';
import type { WorkflowAction } from './auto-lifecycle.ts';
import { parseTicketCommand } from './ticket-command.ts';
import { tokenizeCommandLine } from './workflow-host-events.ts';
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
    let ticketIntent;
    try {
      const [, ...args] = tokenizeCommandLine(workflowTextFromInput(input));
      ticketIntent = parseTicketCommand(command ?? '', args);
    } catch {
      ticketIntent = undefined;
    }
    if (ticketIntent?.kind === 'ticket-lifecycle') {
      const intent = ticketIntent;
      const run =
        state.executionSource === 'ticket' ? state.ticketRun : undefined;
      if (!run?.claim) {
        if (intent.command === '/addy-build') {
          if (run && run.source.ref !== intent.ticketRef) {
            deps.notify(
              ctx,
              `Addy refused /addy-build: requested ${intent.ticketRef} does not match existing unclaimed run ${run.source.ref}. Retry with /addy-build --ticket ${run.source.ref}.`,
              'warning',
            );
            return true;
          }
          return false;
        }
        deps.notify(
          ctx,
          `Addy refused ${intent.command}: Ticket lifecycle actions require the current run's live claim. Run /addy-build --ticket ${intent.ticketRef} to claim it first.`,
          'warning',
        );
        return true;
      }
      const simplifyAllowed =
        run.lifecycle.implemented &&
        !run.lifecycle.verified &&
        run.lifecycle.lastCompletedPhase === 'build';
      if (intent.command === '/addy-code-simplify') {
        if (simplifyAllowed) return false;
        deps.notify(
          ctx,
          'Addy refused /addy-code-simplify: Ticket SIMPLIFY is optional only after BUILD and before VERIFY.',
          'warning',
        );
        return true;
      }
      const action = deps.nextActionForState(state, deps.baseCwd(ctx));
      const requiredCommand = commandFromPrompt(action?.prompt);
      if (!action?.prompt || requiredCommand === intent.command) return false;
      deps.notify(
        ctx,
        `Addy refused ${intent.command} because Ticket ${run.source.ref} requires ${requiredCommand}.`,
        'warning',
      );
      await deps.dispatchAutoPrompt(
        pi,
        ctx,
        action.prompt,
        state,
        {},
        undefined,
        { ...options, useDefaultDelivery: true },
      );
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
