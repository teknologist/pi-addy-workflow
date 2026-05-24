import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  autoWorkflowActionKeyForPromptState,
  currentAutoWorkflowActionKey,
  idleUserMessageKey,
} from './auto-action-keys.ts';
import { pendingAutoActionForPrompt } from './auto-control.ts';
import { addAutoRecoveryGuidance } from './auto-recovery-prompt-policy.ts';
import { workflowTextFromInput } from './command-router.ts';
import { expandPackagedPromptTemplate } from './prompt-template.ts';
import {
  createWorkflowRuntime,
  type UserMessageDeliveryOptions,
} from './workflow-runtime.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import { runWhenIdle } from './workflow-timer-loop.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';

export type WorkflowDeliveryOptions = {
  autoMode?: boolean;
  useDefaultDelivery?: boolean;
  idleTurnDelivery?: boolean;
};

type WorkflowDeliveryDeps = {
  getState(ctx: unknown): WorkflowState;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
  appendEntryFromContext(ctx: unknown): AppendEntry;
  latestActiveStatsTarget(
    state: WorkflowState,
  ): WorkflowStatsTarget | undefined;
  isStaleExtensionContextError(error: unknown): boolean;
  notifyWarning(ctx: unknown, message: string): void;
  retryMs: number;
  maxAttempts: number;
};

function followUpDeliveryOptions(): UserMessageDeliveryOptions {
  return { deliverAs: 'followUp', streamingBehavior: 'followUp' };
}

function defaultDeliveryOptions(): UserMessageDeliveryOptions {
  return { deliverAs: 'followUp', streamingBehavior: 'followUp' };
}

function idleTurnDeliveryOptions(): UserMessageDeliveryOptions {
  return { streamingBehavior: 'followUp' };
}

export function createWorkflowDelivery(deps: WorkflowDeliveryDeps) {
  function preservePendingAutoActionForRetry(
    ctx: unknown,
    message: string,
    deliveryPrompt?: string,
  ): string | undefined {
    const state = deps.getState(ctx);
    if (!state.autoMode) return undefined;
    const prompt = workflowTextFromInput(message);
    const target = deps.latestActiveStatsTarget(state);
    const pendingAction = pendingAutoActionForPrompt(
      prompt,
      state,
      target,
      'idle-retry',
      autoWorkflowActionKeyForPromptState(prompt, state, target),
      deliveryPrompt,
    );
    deps.setState(
      ctx,
      { ...state, autoPendingAction: pendingAction },
      deps.appendEntryFromContext(ctx),
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
    deps.notifyWarning(
      ctx,
      `Addy auto could not deliver the next workflow prompt: ${details}. The prompt was preserved and Addy will retry it on the next safe lifecycle event.`,
    );
  }

  function safeSendUserMessage(
    pi: ExtensionAPI,
    ctx: unknown,
    message: string,
    options: WorkflowDeliveryOptions,
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
    options: WorkflowDeliveryOptions,
  ): void {
    const runtime = createWorkflowRuntime(pi, ctx);
    const key = idleUserMessageKey(ctx, message);
    let scheduledActionKey: string | undefined;

    runWhenIdle({
      runtime,
      registry: 'idle-user-message',
      key,
      retryMs: deps.retryMs,
      maxAttempts: deps.maxAttempts,
      onStart: () => {
        scheduledActionKey = options.autoMode
          ? preservePendingAutoActionForRetry(ctx, message)
          : undefined;
      },
      onTimeout: () => {
        preservePendingAutoActionAfterDeliveryFailure(ctx, message);
        deps.notifyWarning(
          ctx,
          'Addy auto is still busy; the next workflow prompt was preserved for retry.',
        );
      },
      onReady: () => {
        const latestState = deps.getState(ctx);
        if (options.idleTurnDelivery && scheduledActionKey) {
          const latestActionKey = currentAutoWorkflowActionKey(
            latestState,
            deps.latestActiveStatsTarget(latestState),
          );
          if (latestActionKey !== scheduledActionKey) return;
        }
        if (
          scheduledActionKey &&
          latestState.autoPendingAction?.key === scheduledActionKey
        ) {
          deps.setState(
            ctx,
            { ...latestState, autoPendingAction: undefined },
            deps.appendEntryFromContext(ctx),
          );
        }
        safeSendUserMessage(pi, ctx, message, options);
      },
      onError: (error) => {
        if (deps.isStaleExtensionContextError(error)) return;
        try {
          handleUserMessageDeliveryFailure(ctx, message, error);
        } catch {
          const details =
            error instanceof Error ? error.message : String(error);
          deps.notifyWarning(
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
    options: WorkflowDeliveryOptions = {},
  ): void | Promise<void> {
    const expandedMessage = expandPackagedPromptTemplate(message);
    const deliveredMessage = options.autoMode
      ? addAutoRecoveryGuidance(expandedMessage, message)
      : expandedMessage;
    const runtime = createWorkflowRuntime(pi, ctx);
    if (
      options.idleTurnDelivery &&
      options.useDefaultDelivery &&
      runtime.hasIdleSignal() &&
      runtime.canSendUserMessage() &&
      runtime.isBusy()
    ) {
      scheduleUserMessageAfterIdle(pi, ctx, message, options);
      return;
    }

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

  return {
    handleUserMessageDeliveryFailure,
    safeSendUserMessage,
    sendUserMessage,
  };
}
