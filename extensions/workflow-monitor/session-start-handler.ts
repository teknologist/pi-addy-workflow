import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type SessionStartOptions = WorkflowDispatchOptions;

type SessionStartDeps = {
  resumePendingFreshContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    options: SessionStartOptions & {
      freshContextBypassReason?: WorkflowState['autoFreshReason'];
    },
  ): Promise<'none' | 'stale-cleared' | 'delivered'>;
  ensureConfig(ctx: unknown): void;
  initializeWidget(ctx: unknown): WorkflowState;
  ensureAutoRunnerOwnership?(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    actionKey?: string,
  ): boolean | Promise<boolean>;
  isChildSession(): boolean;
  maybeRunAutoWatchdog(
    pi: ExtensionAPI,
    ctx: unknown,
    trigger: string,
    options?: SessionStartOptions,
  ): Promise<boolean>;
};

export function createSessionStartHandler(deps: SessionStartDeps) {
  async function handleSessionStart(
    pi: ExtensionAPI,
    ctx: unknown,
  ): Promise<void> {
    deps.ensureConfig(ctx);
    const state = deps.initializeWidget(ctx);
    if (!deps.isChildSession()) {
      if (
        state.autoMode &&
        deps.ensureAutoRunnerOwnership &&
        !(await deps.ensureAutoRunnerOwnership(pi, ctx, state, 'session-start'))
      )
        return;
      const pendingFresh = await deps.resumePendingFreshContinuation(pi, ctx, {
        useDefaultDelivery: true,
      });
      if (pendingFresh !== 'none') return;
    }
    await deps.maybeRunAutoWatchdog(pi, ctx, 'session-start', {
      disableFreshSession: true,
      disableCompaction: true,
      useDefaultDelivery: true,
    });
  }

  return { handleSessionStart };
}
