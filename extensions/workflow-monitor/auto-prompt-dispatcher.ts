import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { pendingAutoActionForPrompt } from './auto-control.ts';
import {
  planAutoPromptDispatch,
  type AutoPromptDispatchPlan,
} from './command-dispatch.ts';
import { expandPackagedPromptTemplate } from './prompt-template.ts';
import { buildTicketPrompt } from './ticket-prompt.ts';
import type { FreshContinuationDispatchOptions } from './fresh-continuation.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type AutoPromptDelivery = {
  handleUserMessageDeliveryFailure(
    ctx: unknown,
    message: string,
    error: unknown,
  ): void;
  safeSendUserMessage(
    pi: ExtensionAPI,
    ctx: unknown,
    message: string,
    options: {
      autoMode?: boolean;
      useDefaultDelivery?: boolean;
      idleTurnDelivery?: boolean;
    },
  ): void;
  sendUserMessage(
    pi: ExtensionAPI,
    ctx: unknown,
    message: string,
    options?: {
      autoMode?: boolean;
      useDefaultDelivery?: boolean;
      idleTurnDelivery?: boolean;
    },
  ): void | Promise<void>;
};

type AutoPromptFreshContinuation = {
  resumePendingFreshContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    options: FreshContinuationDispatchOptions,
    mode?: 'current-session' | 'after-compaction',
  ): Promise<'none' | 'stale-cleared' | 'delivered'>;
  runFreshContextContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    reason: NonNullable<WorkflowState['autoFreshReason']>,
  ): Promise<void>;
};

type AutoPromptDispatcherDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  delivery: AutoPromptDelivery;
  freshContinuation: AutoPromptFreshContinuation;
  freshContext(
    ctx: unknown,
  ): Parameters<typeof planAutoPromptDispatch>[0]['freshContext'];
  getState(ctx: unknown): WorkflowState;
  ensureAutoRunnerOwnership?(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    actionKey?: string,
  ): boolean | Promise<boolean>;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
};

export function createAutoPromptDispatcher(deps: AutoPromptDispatcherDeps) {
  async function executeCurrentSessionAutoPromptPlan(
    pi: ExtensionAPI,
    ctx: unknown,
    prompt: string,
    state: WorkflowState,
    plan: Extract<AutoPromptDispatchPlan, { kind: 'current-session' }>,
    options: FreshContinuationDispatchOptions = {},
  ): Promise<void> {
    const message = plan.deliveryPrompt ?? prompt;
    deps.setState(
      ctx,
      plan.state,
      options.appendEntry === false ? undefined : deps.appendEntry(pi),
    );
    const deliveryOptions = {
      autoMode: state.autoMode,
      useDefaultDelivery: options.useDefaultDelivery,
      idleTurnDelivery: options.idleTurnDelivery,
    };
    if (options.idleTurnDelivery)
      deps.delivery.safeSendUserMessage(pi, ctx, message, deliveryOptions);
    else {
      try {
        const delivered = deps.delivery.sendUserMessage(
          pi,
          ctx,
          message,
          deliveryOptions,
        );
        await delivered;
      } catch (error) {
        deps.delivery.handleUserMessageDeliveryFailure(ctx, message, error);
        throw error;
      }
    }
  }

  async function dispatchAutoPromptFreshAware(
    pi: ExtensionAPI,
    ctx: unknown,
    prompt: string,
    state: WorkflowState,
    updates: Partial<WorkflowState> = {},
    statsTarget?: WorkflowStatsTarget,
    options: FreshContinuationDispatchOptions = {},
    deliveryPrompt?: string,
  ): Promise<void> {
    if (
      state.autoMode &&
      deps.ensureAutoRunnerOwnership &&
      !(await deps.ensureAutoRunnerOwnership(pi, ctx, state, prompt))
    )
      return;
    let dispatchState = state;
    let resolvedDeliveryPrompt = deliveryPrompt;
    if (state.executionSource === 'ticket') {
      const pending = pendingAutoActionForPrompt(
        prompt,
        state,
        statsTarget,
        'next-action',
        '',
      );
      if (pending.executionSource !== 'ticket')
        throw new Error('Ticket dispatch did not produce a Ticket action.');
      dispatchState = { ...state, autoPendingAction: pending };
      resolvedDeliveryPrompt = buildTicketPrompt({
        operation: pending.operation,
        sourceKind: pending.sourceKind,
        ...(pending.operation === 'select'
          ? {}
          : { ticketRef: pending.ticketRef }),
        runId: pending.runId,
        claimId: pending.claimId,
        staleClaimId: pending.staleClaimId,
        repository: pending.repository,
        repositoryRoot: state.ticketRun?.repositoryRoot,
        selector: pending.selector,
        manual: !state.autoMode,
        pendingClarification: state.ticketRun?.pendingClarification,
        repositoryScope: state.ticketRun?.repositoryScope,
        ...(pending.operation === 'finish' &&
        state.ticketRun?.lastValidatedResult?.operation === 'finish'
          ? {
              commitEvidence:
                state.ticketRun.lastValidatedResult.commitEvidence,
              finishStage: state.ticketRun.lastValidatedResult.finishStage,
              finishActivityKind:
                state.ticketRun.lastValidatedResult.finishActivityKind,
            }
          : {}),
        actionKey: pending.key,
        attempt: Number(pending.attemptMarker.slice('attempt-'.length)),
      });
    }
    const plan = planAutoPromptDispatch({
      prompt,
      state: dispatchState,
      updates,
      statsTarget,
      options,
      freshContext: deps.freshContext(ctx),
      deliveryPrompt: resolvedDeliveryPrompt,
      expandedPrompt: expandPackagedPromptTemplate(prompt),
    });
    if (plan.kind === 'current-session') {
      await executeCurrentSessionAutoPromptPlan(
        pi,
        ctx,
        prompt,
        state,
        plan,
        options,
      );
      return;
    }

    deps.setState(
      ctx,
      plan.state,
      options.appendEntry === false ? undefined : deps.appendEntry(pi),
    );
    if (options.disableFreshSession) {
      const pendingState = deps.getState(ctx);
      if (pendingState.autoFreshPrompt && pendingState.autoFreshReason) {
        const fallbackOptions = {
          ...options,
          freshContextBypassReason: plan.reason,
          useDefaultDelivery: options.disableCompaction
            ? options.useDefaultDelivery
            : true,
        };
        await deps.freshContinuation.resumePendingFreshContinuation(
          pi,
          ctx,
          fallbackOptions,
          options.disableCompaction ? 'current-session' : 'after-compaction',
        );
      }
      return;
    }
    await deps.freshContinuation.runFreshContextContinuation(
      pi,
      ctx,
      plan.reason,
    );
  }

  return { dispatchAutoPromptFreshAware };
}
