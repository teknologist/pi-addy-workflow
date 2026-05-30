import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  createWorkflowRuntime,
  type UserMessageDeliveryOptions,
} from './workflow-runtime.ts';

export function appendWorkflowEntry(pi: ExtensionAPI) {
  return (type: string, data: unknown) => pi.appendEntry?.(type, data);
}

export function appendWorkflowEntryFromContext(ctx: unknown) {
  return (type: string, data: unknown) =>
    (
      ctx as {
        sessionManager?: {
          appendCustomEntry?: (type: string, data: unknown) => void;
        };
      }
    ).sessionManager?.appendCustomEntry?.(type, data);
}

export function extensionApiFromContext(ctx: unknown): ExtensionAPI {
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

export function notifyWorkflow(
  ctx: unknown,
  message: string,
  level?: string,
): void {
  createWorkflowRuntime({} as ExtensionAPI, ctx).notify(message, level);
}

export function notifyWorkflowWarning(ctx: unknown, message: string): void {
  notifyWorkflow(ctx, message, 'warning');
}
