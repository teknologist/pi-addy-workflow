import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { createAutoWorkflowOrchestrator } from './auto-workflow-orchestrator.ts';
import type { FreshContinuationDispatchOptions } from './fresh-continuation.ts';
import type { WorkflowAction } from './auto-lifecycle.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type AutoWorkflowOrchestrator = ReturnType<
  typeof createAutoWorkflowOrchestrator
>;

export function createAutoLoopDispatchPort() {
  let orchestrator: AutoWorkflowOrchestrator | undefined;

  function requireOrchestrator(): AutoWorkflowOrchestrator {
    if (!orchestrator) throw new Error('Auto loop dispatch port is not bound');
    return orchestrator;
  }

  return {
    bind(nextOrchestrator: AutoWorkflowOrchestrator): void {
      orchestrator = nextOrchestrator;
    },

    dispatchAutoPromptFreshAware(
      pi: ExtensionAPI,
      ctx: unknown,
      prompt: string,
      state: WorkflowState,
      updates: Partial<WorkflowState> = {},
      statsTarget?: WorkflowStatsTarget,
      options: FreshContinuationDispatchOptions = {},
      deliveryPrompt?: string,
    ): Promise<void> {
      return requireOrchestrator().dispatchAutoPromptFreshAware(
        pi,
        ctx,
        prompt,
        state,
        updates,
        statsTarget,
        options,
        deliveryPrompt,
      );
    },

    maybeDispatchTaskCommit(
      pi: ExtensionAPI,
      ctx: unknown,
      reviewText: string,
      previousState: WorkflowState,
      state: WorkflowState,
      action: WorkflowAction,
      options: FreshContinuationDispatchOptions = {},
    ): Promise<boolean> {
      return requireOrchestrator().maybeDispatchTaskCommit(
        pi,
        ctx,
        reviewText,
        previousState,
        state,
        action,
        options,
      );
    },

    dispatchNextAutoWorkflowPrompt(
      pi: ExtensionAPI,
      ctx: unknown,
      allowSamePhase = false,
      options: FreshContinuationDispatchOptions = {},
    ): Promise<void> {
      return requireOrchestrator().dispatchNextAutoWorkflowPrompt(
        pi,
        ctx,
        allowSamePhase,
        options,
      );
    },
  };
}
