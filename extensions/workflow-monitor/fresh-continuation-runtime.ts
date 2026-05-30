import type { AutoFreshReason } from './workflow-transitions.ts';
import { createWorkflowRuntime } from './workflow-runtime.ts';
import { currentSessionFallbackOptions as fallbackOptionsForIdleSignal } from './fresh-continuation-state.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type FreshContinuationDispatchOptions = WorkflowDispatchOptions;

export type FreshContinuationNoticeDeps = {
  notify(ctx: unknown, message: string, level?: string): void;
};

export function freshContextNotice(reason: AutoFreshReason): string {
  return reason === 'between-tasks'
    ? 'Addy auto is clearing context and starting a fresh session before the next task.'
    : reason === 'before-review'
      ? 'Addy auto is clearing context and starting a fresh session before review.'
      : 'Addy auto is clearing context and starting a fresh session before the next workflow step.';
}

export async function showFreshContextNotice(
  deps: FreshContinuationNoticeDeps,
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

export function currentSessionFallbackOptions(
  ctx: unknown,
  options: FreshContinuationDispatchOptions,
): FreshContinuationDispatchOptions {
  return fallbackOptionsForIdleSignal(
    options,
    createWorkflowRuntime({} as ExtensionAPI, ctx).hasIdleSignal(),
  );
}
