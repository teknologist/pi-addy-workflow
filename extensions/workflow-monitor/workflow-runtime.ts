import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export type UserMessageDeliveryOptions = {
  deliverAs?: 'steer' | 'followUp';
  streamingBehavior?: 'steer' | 'followUp';
};

export type WorkflowRuntime = {
  canSendUserMessage(): boolean;
  hasIdleSignal(): boolean;
  isBusy(): boolean;
  sendUserMessage(
    content: string,
    options?: UserMessageDeliveryOptions,
  ): void | Promise<void>;
  setEditorText(content: string): void;
  notify(message: string, level?: string): void;
  notifyWarning(message: string): void;
  schedule(callback: () => void, delayMs: number): void;
  runOnce(
    registry: WorkflowTimerRegistry,
    key: string,
    callback: (release: () => void) => void,
  ): boolean;
  getParentSession(): string | undefined;
  canStartFreshSession(): boolean;
  startFreshSession(options: {
    withSession: (ctx: unknown) => Promise<void> | void;
  }): Promise<WorkflowFreshSessionResult>;
};

export type WorkflowFreshSessionResult =
  | { status: 'started' }
  | { status: 'missing' }
  | { status: 'cancelled' };

export type WorkflowTimerRegistry =
  | 'auto-fresh'
  | 'auto-fresh-fallback'
  | 'auto-watchdog'
  | 'idle-user-message';

const timerRegistries = new Map<WorkflowTimerRegistry, Set<string>>([
  ['auto-fresh', new Set()],
  ['auto-fresh-fallback', new Set()],
  ['auto-watchdog', new Set()],
  ['idle-user-message', new Set()],
]);

function registryKeys(registry: WorkflowTimerRegistry): Set<string> {
  const keys = timerRegistries.get(registry);
  if (keys) return keys;
  const created = new Set<string>();
  timerRegistries.set(registry, created);
  return created;
}

type RuntimeContext = {
  cwd?: string;
  isIdle?: () => boolean;
  newSession?: (options: {
    parentSession?: string;
    withSession: (ctx: unknown) => Promise<void> | void;
  }) => Promise<{ cancelled?: boolean } | void>;
  sendUserMessage?: (
    content: string,
    options?: UserMessageDeliveryOptions,
  ) => void | Promise<void>;
  sessionManager?: {
    getSessionFile?: () => string | undefined;
  };
  ui?: {
    setEditorText?: (text: string) => void;
    notify?: (message: string, level?: string) => void;
  };
};

export function createWorkflowRuntime(
  pi: ExtensionAPI,
  ctx: unknown,
): WorkflowRuntime {
  const runtimeCtx = ctx as RuntimeContext;
  const runtimePi = pi as ExtensionAPI & {
    sendUserMessage?: (
      content: string,
      options?: UserMessageDeliveryOptions,
    ) => void | Promise<void>;
  };

  return {
    canSendUserMessage() {
      return Boolean(runtimeCtx.sendUserMessage || runtimePi.sendUserMessage);
    },
    hasIdleSignal() {
      return typeof runtimeCtx.isIdle === 'function';
    },
    isBusy() {
      if (typeof runtimeCtx.isIdle !== 'function') return false;
      try {
        return !runtimeCtx.isIdle.call(ctx);
      } catch {
        return false;
      }
    },
    sendUserMessage(content, options) {
      if (runtimeCtx.sendUserMessage)
        return runtimeCtx.sendUserMessage.call(ctx, content, options);
      return runtimePi.sendUserMessage?.call(pi, content, options);
    },
    setEditorText(content) {
      runtimeCtx.ui?.setEditorText?.(content);
    },
    notify(message, level) {
      runtimeCtx.ui?.notify?.(message, level);
    },
    notifyWarning(message) {
      runtimeCtx.ui?.notify?.(message, 'warning');
    },
    schedule(callback, delayMs) {
      setTimeout(callback, delayMs);
    },
    runOnce(registry, key, callback) {
      const keys = registryKeys(registry);
      if (keys.has(key)) return false;
      keys.add(key);
      callback(() => keys.delete(key));
      return true;
    },
    getParentSession() {
      return runtimeCtx.sessionManager?.getSessionFile?.();
    },
    canStartFreshSession() {
      return typeof runtimeCtx.newSession === 'function';
    },
    async startFreshSession(options) {
      if (!runtimeCtx.newSession) return { status: 'missing' };
      const parentCwd = runtimeCtx.cwd;
      const result = await runtimeCtx.newSession.call(ctx, {
        parentSession: runtimeCtx.sessionManager?.getSessionFile?.(),
        withSession: async (newCtx: unknown) => {
          if (parentCwd && !(newCtx as { cwd?: string }).cwd)
            (newCtx as { cwd?: string }).cwd = parentCwd;
          await options.withSession(newCtx);
        },
      });
      return result?.cancelled
        ? { status: 'cancelled' }
        : { status: 'started' };
    },
  };
}
