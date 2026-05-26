import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { latestAssistantText, type AgentEndEvent } from './agent-end-event.ts';
import { stateWithAgentEndReviewIssues } from './agent-end-review-stats.ts';
import type { WorkflowAction } from './auto-lifecycle.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type AgentEndDispatchOptions = WorkflowDispatchOptions;

type AgentEndHandlerDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  autoAgentEndContinue(
    pi: ExtensionAPI,
    ctx: unknown,
    text: string,
    previousState: WorkflowState,
    state: WorkflowState,
    action: WorkflowAction,
    options?: AgentEndDispatchOptions,
  ): Promise<void>;
  baseCwd(ctx: unknown): string | undefined;
  getState(ctx: unknown): WorkflowState;
  ensureAutoRunnerOwnership?(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    actionKey?: string,
  ): boolean | Promise<boolean>;
  isChildSession(): boolean;
  maybeContinueAfterTaskCommit(
    pi: ExtensionAPI,
    ctx: unknown,
    text: string,
    state: WorkflowState,
    options?: AgentEndDispatchOptions,
  ): Promise<boolean>;
  nextActionForState(state: WorkflowState, baseCwd?: string): WorkflowAction;
  preserveProviderTransportRetry(
    pi: ExtensionAPI,
    ctx: unknown,
    event: AgentEndEvent,
    state: WorkflowState,
  ): boolean;
  resumePendingFreshContinuation(
    pi: ExtensionAPI,
    ctx: unknown,
    options: AgentEndDispatchOptions,
    mode: 'after-compaction',
  ): Promise<'none' | 'stale-cleared' | 'delivered'>;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
};

export function createAgentEndHandler(deps: AgentEndHandlerDeps) {
  async function dispatchNextAutoWorkflowPromptAfterAgentEnd(
    pi: ExtensionAPI,
    ctx: unknown,
    event: AgentEndEvent,
  ): Promise<void> {
    const agentEndOptions: AgentEndDispatchOptions = {
      disableFreshSession: true,
      idleTurnDelivery: true,
      useDefaultDelivery: true,
    };
    const state = deps.getState(ctx);
    const text = latestAssistantText(event);
    if (
      await deps.maybeContinueAfterTaskCommit(
        pi,
        ctx,
        text,
        state,
        agentEndOptions,
      )
    )
      return;
    deps.setState(ctx, state, deps.appendEntry(pi));
    const refreshedState = deps.getState(ctx);
    const action = deps.nextActionForState(refreshedState, deps.baseCwd(ctx));
    await deps.autoAgentEndContinue(
      pi,
      ctx,
      text,
      state,
      refreshedState,
      action,
      agentEndOptions,
    );
  }

  async function handleAgentEnd(
    pi: ExtensionAPI,
    ctx: unknown,
    event: AgentEndEvent,
  ): Promise<void> {
    const state = deps.getState(ctx);
    const reviewText = latestAssistantText(event);
    const stateWithReviewIssues = stateWithAgentEndReviewIssues(
      state,
      event,
      reviewText,
    );
    if (stateWithReviewIssues !== state)
      deps.setState(ctx, stateWithReviewIssues, deps.appendEntry(pi));
    if (!stateWithReviewIssues.autoMode) return;
    if (
      deps.ensureAutoRunnerOwnership &&
      !(await deps.ensureAutoRunnerOwnership(
        pi,
        ctx,
        stateWithReviewIssues,
        'agent-end',
      ))
    )
      return;
    if (
      deps.preserveProviderTransportRetry(pi, ctx, event, stateWithReviewIssues)
    )
      return;
    if (!deps.isChildSession()) {
      const pendingFresh = await deps.resumePendingFreshContinuation(
        pi,
        ctx,
        { useDefaultDelivery: true },
        'after-compaction',
      );
      if (pendingFresh === 'delivered') return;
      if (pendingFresh === 'stale-cleared')
        await dispatchNextAutoWorkflowPromptAfterAgentEnd(pi, ctx, event);
      if (pendingFresh === 'stale-cleared') return;
    }
    await dispatchNextAutoWorkflowPromptAfterAgentEnd(pi, ctx, event);
  }

  return { handleAgentEnd };
}
