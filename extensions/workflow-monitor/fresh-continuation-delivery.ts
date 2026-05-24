import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  autoFreshContinuationKey,
  pendingFreshContinuationKey,
  pendingFreshContinuationKeyMatches,
  staleAutoFreshUpdates,
  validPendingFreshContinuation,
} from './auto-control.ts';
import {
  consumedPendingFreshPromptState,
  pendingFreshInputMatches,
} from './fresh-continuation-state.ts';
import { currentSessionFallbackOptions } from './fresh-continuation-runtime.ts';
import { createWorkflowRuntime } from './workflow-runtime.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import { runWhenIdle } from './workflow-timer-loop.ts';
import type { AutoFreshReason, WorkflowState } from './workflow-transitions.ts';

export type FreshContinuationDispatchOptions = WorkflowDispatchOptions;

export type PendingFreshWorkflowState = WorkflowState & {
  autoFreshPrompt: string;
  autoFreshReason: AutoFreshReason;
};

type PendingFreshResumeMode = 'current-session' | 'after-compaction';
type PendingFreshResumeResult = 'none' | 'stale-cleared' | 'delivered';

type PendingFreshDeliveryDeps = {
  getState(ctx: unknown): WorkflowState;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
  appendEntry(pi: ExtensionAPI): AppendEntry;
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
  retryMs: number;
  maxAttempts: number;
};

export function createPendingFreshDelivery(
  deps: PendingFreshDeliveryDeps,
  consumedAutoFreshKeys: Set<string>,
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

  async function retryAfterBusyError(
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
        if (await retryAfterBusyError(pi, ctx, options, message)) return;
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

  async function deliverInCurrentSession(
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
      if (await retryAfterBusyError(pi, ctx, fallbackOptions, message)) return;
      deps.notifyWarning(
        ctx,
        `Addy auto could not continue in the current session: ${message}. Pending fresh continuation was preserved.`,
      );
    }
  }

  async function deliverLatestInCurrentSession(
    pi: ExtensionAPI,
    ctx: unknown,
    options: FreshContinuationDispatchOptions,
    key?: string,
  ): Promise<void> {
    const latestState = deps.getState(ctx);
    if (key) {
      if (!pendingFreshContinuationKeyMatches(latestState, key)) return;
    } else if (!validPendingFreshContinuation(latestState)) return;
    await deliverInCurrentSession(pi, ctx, latestState, options);
  }

  function scheduleAfterCompaction(
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
        void deliverLatestInCurrentSession(pi, ctx, options, key)
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

  async function resume(
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
      scheduleAfterCompaction(pi, ctx, state, resumeOptions);
    } else {
      await deliverInCurrentSession(pi, ctx, state, resumeOptions);
    }
    return 'delivered';
  }

  return {
    consumedPendingFreshPromptState,
    currentSessionFallbackOptions,
    deliverPendingFreshPrompt,
    deliverInCurrentSession,
    pendingFreshInputMatches,
    resume,
    scheduleAfterCompaction,
  };
}
