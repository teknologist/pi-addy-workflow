import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { commandFromPrompt } from './command-router.ts';
import { parseCommandArgs, type CommandEvent } from './workflow-host-events.ts';
import type { FreshContinuationDispatchOptions } from './fresh-continuation.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import { latestActiveStatsTarget } from './workflow-stats-target.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import { ADDY_AUTO_TASK_COMMIT_PROMPT } from './workflow-tracker.ts';

type ContinueResult = { action: 'continue' };
type PendingFreshResumeResult = 'none' | 'stale-cleared' | 'delivered';

export type AddyAutoCommandDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  resumePendingFreshContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    options: FreshContinuationDispatchOptions,
  ): Promise<PendingFreshResumeResult>;
  dispatchTaskCommitPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    target: NonNullable<ReturnType<typeof latestActiveStatsTarget>>,
    options: FreshContinuationDispatchOptions,
  ): Promise<void>;
  getState(ctx: unknown): WorkflowState;
  ensureAutoRunnerOwnership?(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    actionKey?: string,
    activePlan?: string,
  ): boolean | Promise<boolean>;
  handleWorkflowEvent(
    ctx: unknown,
    event: unknown,
    appendEntry?: AppendEntry,
  ): void;
  maybeRunAutoWatchdog(
    pi: ExtensionAPI,
    ctx: unknown,
    source: string,
    options: FreshContinuationDispatchOptions & { allowSamePhase?: boolean },
  ): Promise<unknown>;
  notify(ctx: unknown, message: string, level: string): void;
  recordAutoRunnerStopIntent?(
    ctx: unknown,
  ): 'owned' | 'recorded' | 'no-owner' | 'passive-child';
  releaseAutoRunnerLock?(ctx: unknown): void;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
  showWorkflowStats(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    options?: { heading?: string; planPath?: string },
  ): void;
};

async function resumePendingFreshContinuation(
  pi: ExtensionAPI,
  ctx: unknown,
  state: WorkflowState,
  deps: AddyAutoCommandDeps,
): Promise<PendingFreshResumeResult> {
  return deps.resumePendingFreshContinuation(pi, ctx, {
    freshContextBypassReason: state.autoFreshReason,
    useDefaultDelivery: false,
  });
}

async function resumePendingTaskCommit(
  pi: ExtensionAPI,
  ctx: unknown,
  state: WorkflowState,
  deps: AddyAutoCommandDeps,
): Promise<boolean> {
  if (commandFromPrompt(state.autoLastPrompt) !== ADDY_AUTO_TASK_COMMIT_PROMPT)
    return false;

  const pendingCommitTarget = latestActiveStatsTarget(state);
  if (!pendingCommitTarget) return false;

  await deps.dispatchTaskCommitPrompt(pi, ctx, state, pendingCommitTarget, {
    disableFreshSession: true,
    disableCompaction: true,
  });
  return true;
}

export async function handleAddyAutoCommand(
  pi: ExtensionAPI,
  event: CommandEvent,
  ctx: unknown,
  deps: AddyAutoCommandDeps,
): Promise<ContinueResult> {
  const args = parseCommandArgs(event);
  const desiredPlan =
    args[0] === 'stop' ? undefined : args.join(' ') || undefined;

  if (args[0] === 'stop') {
    const stopIntent = deps.recordAutoRunnerStopIntent?.(ctx);
    if (stopIntent === 'recorded') {
      deps.notify(
        ctx,
        'Addy auto stop requested; the owning Pi instance will stop before its next auto dispatch.',
        'warning',
      );
      return { action: 'continue' };
    }
    if (stopIntent === 'passive-child') {
      deps.notify(
        ctx,
        'Addy auto stop can only be requested from a top-level Pi instance.',
        'warning',
      );
      return { action: 'continue' };
    }
  }

  if (args[0] !== 'stop') {
    const pending = deps.getState(ctx);
    if (
      desiredPlan &&
      pending.autoMode &&
      pending.activePlan &&
      pending.activePlan !== desiredPlan
    ) {
      deps.notify(
        ctx,
        `Addy auto is already running for ${pending.activePlan}. Run /addy-auto stop or reset before starting ${desiredPlan}.`,
        'warning',
      );
      return { action: 'continue' };
    }
    if (
      deps.ensureAutoRunnerOwnership &&
      !(await deps.ensureAutoRunnerOwnership(
        pi,
        ctx,
        pending,
        'addy-auto-command',
        desiredPlan,
      ))
    )
      return { action: 'continue' };
    const pendingFreshResult = await resumePendingFreshContinuation(
      pi,
      ctx,
      pending,
      deps,
    );
    if (pendingFreshResult === 'delivered') return { action: 'continue' };
    if (
      pendingFreshResult === 'none' &&
      (await resumePendingTaskCommit(pi, ctx, pending, deps))
    )
      return { action: 'continue' };
  }

  const text = `/addy-auto${args.length ? ` ${args.join(' ')}` : ''}`;

  deps.handleWorkflowEvent(
    ctx,
    {
      source: 'command',
      text,
      artifact: args[0] === 'stop' ? undefined : args.join(' ') || undefined,
    },
    deps.appendEntry(pi),
  );

  if (args[0] !== 'stop')
    await deps.maybeRunAutoWatchdog(pi, ctx, 'addy-auto-command', {
      disableFreshSession: true,
      disableCompaction: true,
      allowSamePhase: true,
    });
  else
    deps.showWorkflowStats(pi, ctx, deps.getState(ctx), {
      heading: 'Addy auto stopped.',
    });
  if (args[0] === 'stop') deps.releaseAutoRunnerLock?.(ctx);

  return { action: 'continue' };
}
