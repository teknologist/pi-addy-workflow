import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  autoFreshContinuationKey,
  pendingFreshContinuationKey,
  pendingFreshContinuationKeyMatches,
  staleAutoFreshUpdates,
  validPendingFreshContinuation,
} from './auto-control.ts';
import {
  createWorkflowRuntime,
  type UserMessageDeliveryOptions,
} from './workflow-runtime.ts';
import {
  consumedPendingFreshPromptState,
  currentSessionFallbackOptions as fallbackOptionsForIdleSignal,
  pendingFreshInputMatches,
} from './fresh-continuation-state.ts';
import { planFreshContinuationStart } from './fresh-continuation-plan.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { AppendEntry, WorkflowContext } from './workflow-state-store.ts';
import { runWhenIdle } from './workflow-timer-loop.ts';
import {
  type AutoFreshReason,
  type WorkflowState,
} from './workflow-transitions.ts';

export type FreshContinuationDispatchOptions = WorkflowDispatchOptions;

type PendingFreshWorkflowState = WorkflowState & {
  autoFreshPrompt: string;
  autoFreshReason: AutoFreshReason;
};

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

function freshContextNotice(reason: AutoFreshReason): string {
  return reason === 'between-tasks'
    ? 'Addy auto is clearing context and starting a fresh session before the next task.'
    : reason === 'before-review'
      ? 'Addy auto is clearing context and starting a fresh session before review.'
      : 'Addy auto is clearing context and starting a fresh session before the next workflow step.';
}

async function showFreshContextNotice(
  deps: FreshContinuationCoordinatorDeps,
  ctx: unknown,
  reason: AutoFreshReason,
): Promise<void> {
  const message = freshContextNotice(reason);
  deps.notify(ctx, message, 'info');
  await (
    ctx as {
      sendMessage?: (
        message: unknown,
        options?: {
          deliverAs?: 'steer' | 'followUp' | 'nextTurn';
          triggerTurn?: boolean;
        },
      ) => void | Promise<void>;
    }
  ).sendMessage?.(
    {
      customType: 'pi-addy-workflow',
      content: message,
      display: true,
    },
    { deliverAs: 'nextTurn' },
  );
}

function currentSessionFallbackOptions(
  ctx: unknown,
  options: FreshContinuationDispatchOptions,
): FreshContinuationDispatchOptions {
  return fallbackOptionsForIdleSignal(
    options,
    createWorkflowRuntime({} as ExtensionAPI, ctx).hasIdleSignal(),
  );
}

export function createFreshContinuationCoordinator(
  deps: FreshContinuationCoordinatorDeps,
) {
  function setState(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    options: FreshContinuationDispatchOptions,
  ): void {
    deps.setState(
      ctx,
      state,
      options.appendEntry === false ? undefined : deps.appendEntry(pi),
    );
  }

  async function retryPendingFreshPromptAfterBusyError(
    pi: ExtensionAPI,
    ctx: unknown,
    options: FreshContinuationDispatchOptions,
    message: string,
  ): Promise<boolean> {
    if (
      !options.useDefaultDelivery ||
      !/Agent is already processing|already processing/i.test(message)
    )
      return false;
    const latestState = deps.getState(ctx);
    if (!validPendingFreshContinuation(latestState)) return false;
    await deliverPendingFreshPrompt(pi, ctx, latestState, {
      ...options,
      useDefaultDelivery: false,
    });
    return true;
  }

  function schedulePendingFreshPromptDelivery(
    pi: ExtensionAPI,
    ctx: unknown,
    state: PendingFreshWorkflowState,
    options: FreshContinuationDispatchOptions,
  ): void {
    const runtime = createWorkflowRuntime(pi, ctx);
    const key =
      state.autoFreshDeliveryKey ??
      autoFreshContinuationKey(
        state.autoFreshPrompt,
        state.autoFreshReason,
        state,
      );

    runWhenIdle({
      runtime,
      registry: 'auto-fresh',
      key,
      retryMs: deps.retryMs,
      maxAttempts: deps.maxAttempts,
      onTimeout: () => {
        deps.notifyWarning(
          ctx,
          'Addy auto is still busy; pending fresh continuation was preserved. Run /addy-auto to retry it.',
        );
      },
      onReady: async () => {
        const latestState = deps.getState(ctx);
        if (!pendingFreshContinuationKeyMatches(latestState, key)) return;
        await deliverPendingFreshPrompt(pi, ctx, latestState, options);
      },
      onError: async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (
          await retryPendingFreshPromptAfterBusyError(pi, ctx, options, message)
        )
          return;
        deps.notifyWarning(
          ctx,
          `Addy auto could not deliver the pending fresh continuation: ${message}`,
        );
      },
    });
  }

  async function deliverPendingFreshPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    options: FreshContinuationDispatchOptions = {},
  ): Promise<boolean> {
    if (!validPendingFreshContinuation(state)) return false;
    const runtime = createWorkflowRuntime(pi, ctx);
    if (
      options.useDefaultDelivery &&
      runtime.canSendUserMessage() &&
      runtime.isBusy()
    ) {
      schedulePendingFreshPromptDelivery(pi, ctx, state, options);
      return true;
    }
    const prompt = state.autoFreshPrompt;
    const deliveryPrompt = state.autoFreshExpandedPrompt ?? prompt;
    if (!runtime.canSendUserMessage()) {
      deps.sendUserMessage(pi, ctx, deliveryPrompt, {
        autoMode: state.autoMode,
        useDefaultDelivery: options.useDefaultDelivery,
      });
      return true;
    }
    const key =
      state.autoFreshDeliveryKey ??
      autoFreshContinuationKey(prompt, state.autoFreshReason, state);
    const nextState = consumedPendingFreshPromptState({
      ...state,
      autoFreshDeliveryKey: key,
    });
    if (!nextState) return false;
    setState(pi, ctx, nextState, options);
    try {
      await deps.sendUserMessage(pi, ctx, deliveryPrompt, {
        autoMode: state.autoMode,
        useDefaultDelivery: options.useDefaultDelivery,
      });
    } catch (error) {
      setState(pi, ctx, state, options);
      throw error;
    }
    consumedAutoFreshKeys.add(key);
    return true;
  }

  async function deliverPendingFreshPromptInCurrentSession(
    pi: ExtensionAPI,
    ctx: unknown,
    state: PendingFreshWorkflowState,
    options: FreshContinuationDispatchOptions,
  ): Promise<void> {
    const fallbackOptions = currentSessionFallbackOptions(ctx, options);
    try {
      await deliverPendingFreshPrompt(pi, ctx, state, fallbackOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        await retryPendingFreshPromptAfterBusyError(
          pi,
          ctx,
          fallbackOptions,
          message,
        )
      )
        return;
      deps.notifyWarning(
        ctx,
        `Addy auto could not continue in the current session: ${message}. Pending fresh continuation was preserved.`,
      );
    }
  }

  async function deliverLatestPendingFreshPromptInCurrentSession(
    pi: ExtensionAPI,
    ctx: unknown,
    options: FreshContinuationDispatchOptions,
    key?: string,
  ): Promise<void> {
    const latestState = deps.getState(ctx);
    if (key) {
      if (!pendingFreshContinuationKeyMatches(latestState, key)) return;
    } else if (!validPendingFreshContinuation(latestState)) return;
    await deliverPendingFreshPromptInCurrentSession(
      pi,
      ctx,
      latestState,
      options,
    );
  }

  async function resumePendingFreshContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    options: FreshContinuationDispatchOptions = {},
    mode: PendingFreshResumeMode = 'current-session',
  ): Promise<PendingFreshResumeResult> {
    const state = deps.getState(ctx);
    if (state.autoFreshPrompt && !state.autoFreshReason) {
      deps.notify(
        ctx,
        'Ignoring stale Addy auto fresh continuation without a recorded reason.',
        'warning',
      );
      deps.setState(
        ctx,
        { ...state, ...staleAutoFreshUpdates() },
        options.appendEntry === false ? undefined : deps.appendEntry(pi),
      );
      return 'stale-cleared';
    }
    if (!validPendingFreshContinuation(state)) return 'none';

    const resumeOptions = {
      ...options,
      freshContextBypassReason:
        options.freshContextBypassReason ?? state.autoFreshReason,
    };
    if (mode === 'after-compaction') {
      schedulePendingFreshPromptAfterCompaction(pi, ctx, state, resumeOptions);
    } else {
      await deliverPendingFreshPromptInCurrentSession(
        pi,
        ctx,
        state,
        resumeOptions,
      );
    }
    return 'delivered';
  }

  function schedulePendingFreshPromptAfterCompaction(
    pi: ExtensionAPI,
    ctx: unknown,
    state: PendingFreshWorkflowState,
    options: FreshContinuationDispatchOptions,
  ): boolean {
    const runtime = createWorkflowRuntime(pi, ctx);
    const key = pendingFreshContinuationKey(state);
    const stateWithKey = { ...state, autoFreshDeliveryKey: key };
    setState(pi, ctx, stateWithKey, options);

    if (
      !runtime.runOnce('auto-fresh-fallback', key, (release) => {
        deps.notifyWarning(
          ctx,
          'Addy auto could not start a fresh session; continuing in the current session.',
        );
        void deliverLatestPendingFreshPromptInCurrentSession(
          pi,
          ctx,
          options,
          key,
        )
          .catch((error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            deps.notifyWarning(
              ctx,
              `Addy auto could not continue after fresh-session fallback: ${message}`,
            );
          })
          .finally(release);
      })
    )
      return true;
    return true;
  }

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
        schedulePendingFreshPromptAfterCompaction(pi, ctx, initialState, {
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
        currentSessionFallbackOptions(ctx, {
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
          await deliverPendingFreshPrompt(
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
        schedulePendingFreshPromptAfterCompaction(pi, ctx, latestState, {
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
        currentSessionFallbackOptions(ctx, {
          freshContextBypassReason: reason,
          useDefaultDelivery: true,
        }),
      );
    }
  }

  return {
    consumedPendingFreshPromptState,
    currentSessionFallbackOptions,
    deliverPendingFreshPrompt,
    deliverPendingFreshPromptInCurrentSession,
    pendingFreshInputMatches,
    runFreshContextContinuation,
    schedulePendingFreshPromptAfterCompaction,
    resumePendingFreshContinuation,
  };
}

const consumedAutoFreshKeys = new Set<string>();

export function defaultFreshContinuationDeliveryOptions(): UserMessageDeliveryOptions {
  return { deliverAs: 'followUp', streamingBehavior: 'followUp' };
}

export type { PendingFreshWorkflowState };
