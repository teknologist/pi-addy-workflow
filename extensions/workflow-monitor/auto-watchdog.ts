import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { WorkflowAction } from './auto-lifecycle.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { WorkflowTimerRuntime } from './workflow-runtime.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type AutoWatchdogOptions = WorkflowDispatchOptions;

type AutoWatchdogDeps = {
  actionKeyForAction(
    state: WorkflowState,
    action: WorkflowAction,
  ): string | undefined;
  appendEntry(pi: ExtensionAPI): AppendEntry;
  baseCwd(ctx: unknown): string | undefined;
  createRuntime(pi: ExtensionAPI, ctx: unknown): WorkflowTimerRuntime;
  dispatchNextAutoWorkflowPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    allowSamePhase?: boolean,
    options?: AutoWatchdogOptions,
  ): Promise<void>;
  getState(ctx: unknown): WorkflowState;
  ensureAutoRunnerOwnership?(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    actionKey?: string,
  ): boolean | Promise<boolean>;
  isChildSession(): boolean;
  nextActionForState(state: WorkflowState, baseCwd?: string): WorkflowAction;
  resumePendingFreshContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    options?: AutoWatchdogOptions,
  ): Promise<'none' | 'stale-cleared' | 'delivered'>;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
};

export function createAutoWatchdog(deps: AutoWatchdogDeps) {
  async function maybeRunAutoWatchdog(
    pi: ExtensionAPI,
    ctx: unknown,
    trigger: string,
    options: AutoWatchdogOptions = {},
  ): Promise<boolean> {
    if (deps.isChildSession()) return false;
    const state = deps.getState(ctx);
    if (!state.autoMode || state.autoPausedReason) return false;

    const pendingFresh = await deps.resumePendingFreshContinuation(pi, ctx, {
      ...options,
      useDefaultDelivery: true,
    });
    if (pendingFresh === 'delivered') return true;
    if (pendingFresh === 'stale-cleared') return false;

    const action = deps.nextActionForState(state, deps.baseCwd(ctx));
    const actionKey = deps.actionKeyForAction(state, action);
    if (!actionKey) return false;
    if (
      deps.ensureAutoRunnerOwnership &&
      !(await deps.ensureAutoRunnerOwnership(pi, ctx, state, actionKey))
    )
      return false;

    if (state.autoPendingAction && state.autoPendingAction.key !== actionKey) {
      deps.setState(
        ctx,
        { ...state, autoPendingAction: undefined },
        options.appendEntry === false ? undefined : deps.appendEntry(pi),
      );
    }

    void trigger;
    const runtime = deps.createRuntime(pi, ctx);
    if (
      !runtime.runOnce('auto-watchdog', actionKey, (release) =>
        runtime.schedule(release, 100),
      )
    )
      return true;

    await deps.dispatchNextAutoWorkflowPrompt(
      pi,
      ctx,
      options.allowSamePhase ?? false,
      options,
    );
    return true;
  }

  return { maybeRunAutoWatchdog };
}
