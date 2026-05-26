import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  planAutoContinueCommand,
  planFreshStepCommand,
  planStatsCommand,
  planWorkflowNextCommand,
  registeredFreshStepCommandNames,
} from './command-intake.ts';
import type { CommandEvent } from './workflow-host-events.ts';
import type { FreshContinuationDispatchOptions } from './fresh-continuation.ts';
import type { WorkflowAction } from './auto-lifecycle.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import { latestActiveStatsTarget } from './workflow-stats-target.ts';
import type { WorkflowPhase, WorkflowState } from './workflow-transitions.ts';
import { handleAddyAutoCommand } from './addy-auto-command.ts';

type ContinueResult = { action: 'continue' };

type FreshStepCommandDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  dispatchManualFrontierGuard(
    pi: ExtensionAPI,
    input: string,
    ctx: unknown,
  ): Promise<boolean>;
  dispatchManualStepWithFreshContextConfig(
    pi: ExtensionAPI,
    input: string,
    ctx: unknown,
  ): boolean | Promise<boolean>;
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
  sendUserMessage(pi: ExtensionAPI, ctx: unknown, input: string): void;
  shouldFreshContextBeforeStep(input: string, ctx: unknown): boolean;
};

type AutoCommandDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  resumePendingFreshContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    options: FreshContinuationDispatchOptions,
  ): Promise<'none' | 'stale-cleared' | 'delivered'>;
  dispatchTaskCommitPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    target: NonNullable<ReturnType<typeof latestActiveStatsTarget>>,
    options: FreshContinuationDispatchOptions,
  ): Promise<void>;
  getState(ctx: unknown): WorkflowState;
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

type AutoContinueCommandDeps = {
  notify(ctx: unknown, message: string, level: string): void;
  runFreshContextContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    reason: NonNullable<WorkflowState['autoFreshReason']>,
  ): Promise<void>;
};

type StatsCommandDeps = {
  getState(ctx: unknown): WorkflowState;
  showWorkflowStats(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    options?: { heading?: string; planPath?: string },
  ): void;
};

type WorkflowControlCommandDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  handleWorkflowEvent(
    ctx: unknown,
    event: unknown,
    appendEntry?: AppendEntry,
  ): void;
  notify(ctx: unknown, message: string, level: string): void;
  openNextWorkflowPrompt(
    ctx: unknown,
    phase: WorkflowPhase,
    artifact?: string,
  ): void;
  resetWorkflow(ctx: unknown, appendEntry?: AppendEntry): void;
};

type CommandRegistryDeps = FreshStepCommandDeps &
  AutoCommandDeps &
  AutoContinueCommandDeps &
  StatsCommandDeps &
  WorkflowControlCommandDeps;

export function registerWorkflowCommands(
  pi: ExtensionAPI,
  deps: CommandRegistryDeps,
): void {
  for (const commandName of registeredFreshStepCommandNames()) {
    const command = `/${commandName}`;
    pi.registerCommand?.(commandName, {
      description: `Run ${command} in a fresh session when Addy fresh context is enabled.`,
      handler: async (event: CommandEvent, ctx: unknown) => {
        const plan = planFreshStepCommand(command, event);
        const input = plan.input;
        if (await deps.dispatchManualFrontierGuard(pi, input, ctx))
          return { action: 'continue' } satisfies ContinueResult;
        deps.handleWorkflowEvent(ctx, plan.workflowEvent, deps.appendEntry(pi));
        if (deps.shouldFreshContextBeforeStep(input, ctx))
          await deps.dispatchManualStepWithFreshContextConfig(pi, input, ctx);
        else deps.sendUserMessage(pi, ctx, input);
        return { action: 'continue' } satisfies ContinueResult;
      },
    });
  }

  pi.registerCommand?.('addy-auto-continue', {
    description: 'Internal Addy auto continuation command.',
    handler: async (event: CommandEvent, ctx: unknown) => {
      const plan = planAutoContinueCommand(event);
      if (plan.kind === 'warn') {
        deps.notify(ctx, plan.message, 'warning');
        return { action: 'continue' } satisfies ContinueResult;
      }

      await deps.runFreshContextContinuation(pi, ctx, plan.reason);
      return { action: 'continue' } satisfies ContinueResult;
    },
  });

  pi.registerCommand?.('addy-auto', {
    description:
      'Run the Addy build, verify, review, and finish loop for the active plan.',
    handler: async (event: CommandEvent, ctx: unknown) => {
      return handleAddyAutoCommand(pi, event, ctx, deps);
    },
  });

  pi.registerCommand?.('addy-stats', {
    description: 'Show Addy workflow stats for the active or supplied plan.',
    handler: (event: CommandEvent, ctx: unknown) => {
      const plan = planStatsCommand(event);
      deps.showWorkflowStats(pi, ctx, deps.getState(ctx), {
        planPath: plan.planPath,
      });
      return { action: 'continue' } satisfies ContinueResult;
    },
  });

  pi.registerCommand?.('addy-workflow-reset', {
    description: 'Reset Addy workflow state and clear the widget.',
    handler: (_event: CommandEvent, ctx: unknown) => {
      deps.resetWorkflow(ctx, deps.appendEntry(pi));
      return { action: 'continue' } satisfies ContinueResult;
    },
  });

  pi.registerCommand?.('addy-workflow-next', {
    description: 'Open an Addy workflow prompt for a requested phase.',
    handler: (event: CommandEvent, ctx: unknown) => {
      const plan = planWorkflowNextCommand(event);
      if (plan.kind === 'warn') {
        deps.notify(ctx, plan.message, 'warning');
        return { action: 'continue' } satisfies ContinueResult;
      }

      deps.handleWorkflowEvent(ctx, plan.workflowEvent, deps.appendEntry(pi));
      deps.openNextWorkflowPrompt(ctx, plan.phase, plan.artifact);
      return { action: 'continue' } satisfies ContinueResult;
    },
  });
}
