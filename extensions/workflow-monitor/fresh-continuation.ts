import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  staleAutoFreshUpdates,
  validPendingFreshContinuation,
} from './auto-control.ts';
import {
  createWorkflowRuntime,
  type UserMessageDeliveryOptions,
} from './workflow-runtime.ts';
import { showFreshContextNotice } from './fresh-continuation-runtime.ts';
import { planFreshContinuationStart } from './fresh-continuation-plan.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import {
  createPendingFreshDelivery,
  type PendingFreshWorkflowState,
} from './fresh-continuation-delivery.ts';
import type { AutoFreshReason, WorkflowState } from './workflow-transitions.ts';

export type FreshContinuationDispatchOptions = WorkflowDispatchOptions;

type FreshContinuationCoordinatorDeps = {
  getState(ctx: unknown): WorkflowState;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
  appendEntry(pi: ExtensionAPI): AppendEntry;
  extensionApiFromContext(ctx: unknown): ExtensionAPI;
  notify(ctx: unknown, message: string, level?: string): void;
  notifyWarning(ctx: unknown, message: string): void;
  sendUserMessage(
    pi: ExtensionAPI,
    ctx: unknown,
    message: string,
    options: {
      autoMode?: boolean;
      useDefaultDelivery?: boolean;
      idleTurnDelivery?: boolean;
    },
  ): void | Promise<void>;
  dispatchNextAutoWorkflowPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    allowSamePhase: boolean,
    options: FreshContinuationDispatchOptions,
  ): Promise<void>;
  retryMs: number;
  maxAttempts: number;
};

type PendingFreshResumeMode = 'current-session' | 'after-compaction';

type PendingFreshResumeResult = 'none' | 'stale-cleared' | 'delivered';

export type FreshContinuationCoordinator = ReturnType<
  typeof createFreshContinuationCoordinator
>;

export function createFreshContinuationCoordinator(
  deps: FreshContinuationCoordinatorDeps,
) {
  const delivery = createPendingFreshDelivery(deps, consumedAutoFreshKeys);

  async function runFreshContextContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    requestedReason: AutoFreshReason,
  ): Promise<void> {
    const runtime = createWorkflowRuntime(pi, ctx);
    const notify = (msg: string, level: string) => deps.notify(ctx, msg, level);
    const initialState = deps.getState(ctx);
    const plan = planFreshContinuationStart({
      state: initialState,
      requestedReason,
      canStartFreshSession: runtime.canStartFreshSession(),
      consumedKeys: consumedAutoFreshKeys,
    });
    if (plan.kind === 'clear-stale') {
      notify(plan.message, 'warning');
      deps.setState(ctx, plan.state, deps.appendEntry(pi));
      return;
    }
    if (plan.kind === 'already-consumed' || plan.kind === 'already-delivered')
      return;
    const reason = plan.reason;
    const continueInCurrentSession = async () => {
      if (validPendingFreshContinuation(initialState)) {
        delivery.scheduleAfterCompaction(pi, ctx, initialState, {
          freshContextBypassReason: reason,
          useDefaultDelivery: true,
        });
        return;
      }
      notify(
        'Addy auto could not start a fresh session; continuing in the current session.',
        'warning',
      );
      await deps.dispatchNextAutoWorkflowPrompt(
        pi,
        ctx,
        false,
        delivery.currentSessionFallbackOptions(ctx, {
          freshContextBypassReason: reason,
          useDefaultDelivery: true,
        }),
      );
    };

    if (plan.kind === 'continue-current-session') {
      await continueInCurrentSession();
      return;
    }

    await showFreshContextNotice(deps, ctx, reason);
    const result = await runtime.startFreshSession({
      withSession: async (newCtx: unknown) => {
        await showFreshContextNotice(deps, newCtx, reason);
        const replacementPi = deps.extensionApiFromContext(newCtx);
        const replacementState = deps.getState(newCtx);
        if (
          replacementState.autoFreshPrompt &&
          !replacementState.autoFreshReason
        ) {
          deps.notify(
            newCtx,
            'Ignoring stale Addy auto fresh continuation without a recorded reason.',
            'warning',
          );
          deps.setState(
            newCtx,
            { ...replacementState, ...staleAutoFreshUpdates() },
            undefined,
          );
          return;
        }
        const deliveryReason = validPendingFreshContinuation(replacementState)
          ? replacementState.autoFreshReason
          : reason;
        if (
          await delivery.deliverPendingFreshPrompt(
            replacementPi,
            newCtx,
            replacementState,
            {
              freshContextBypassReason: deliveryReason,
              useDefaultDelivery: true,
            },
          )
        )
          return;
        if (replacementState.autoFreshConsumedKey) return;
        await deps.dispatchNextAutoWorkflowPrompt(
          replacementPi,
          newCtx,
          false,
          {
            freshContextBypassReason: deliveryReason,
            useDefaultDelivery: true,
          },
        );
      },
    });
    if (result.status === 'missing') {
      await continueInCurrentSession();
      return;
    }
    if (result.status === 'cancelled') {
      notify(
        'Addy auto fresh continuation was cancelled; continuing in the current session.',
        'warning',
      );
      const latestState = deps.getState(ctx);
      if (validPendingFreshContinuation(latestState)) {
        delivery.scheduleAfterCompaction(pi, ctx, latestState, {
          freshContextBypassReason: reason,
          useDefaultDelivery: true,
        });
        return;
      }
      notify(
        'Addy auto fresh continuation was cancelled; continuing in the current session.',
        'warning',
      );
      await deps.dispatchNextAutoWorkflowPrompt(
        pi,
        ctx,
        false,
        delivery.currentSessionFallbackOptions(ctx, {
          freshContextBypassReason: reason,
          useDefaultDelivery: true,
        }),
      );
    }
  }

  return {
    consumedPendingFreshPromptState: delivery.consumedPendingFreshPromptState,
    currentSessionFallbackOptions: delivery.currentSessionFallbackOptions,
    deliverPendingFreshPrompt: delivery.deliverPendingFreshPrompt,
    deliverPendingFreshPromptInCurrentSession: delivery.deliverInCurrentSession,
    pendingFreshInputMatches: delivery.pendingFreshInputMatches,
    runFreshContextContinuation,
    schedulePendingFreshPromptAfterCompaction: delivery.scheduleAfterCompaction,
    resumePendingFreshContinuation: (
      pi: ExtensionAPI,
      ctx: unknown,
      options: FreshContinuationDispatchOptions = {},
      mode: PendingFreshResumeMode = 'current-session',
    ): Promise<PendingFreshResumeResult> =>
      delivery.resume(pi, ctx, options, mode),
  };
}

const consumedAutoFreshKeys = new Set<string>();

export function defaultFreshContinuationDeliveryOptions(): UserMessageDeliveryOptions {
  return { deliverAs: 'followUp', streamingBehavior: 'followUp' };
}

export type { PendingFreshWorkflowState };
