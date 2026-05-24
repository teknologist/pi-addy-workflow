import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { commandFromPrompt } from './command-router.ts';
import { agentTextReportsCommitComplete } from './commit-result.ts';
import { clearReviewControlUpdates } from './review-control.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type WorkflowAction = { prompt?: string } | undefined;

export type AutoAgentFinishDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  archiveWorkflowStats(state: WorkflowState, reason: string): WorkflowState;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
  showWorkflowStats(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    options?: { heading?: string; planPath?: string },
  ): void;
};

export function finishTextReportsComplete(text: string): boolean {
  return (
    /(?:^|\s)Finished!(?:\s|$)/i.test(text) ||
    agentTextReportsCommitComplete(text)
  );
}

export function maybeCompleteAutoFinish(
  deps: AutoAgentFinishDeps,
  pi: ExtensionAPI,
  ctx: unknown,
  text: string,
  state: WorkflowState,
  action: WorkflowAction,
): boolean {
  if (commandFromPrompt(state.autoLastPrompt) !== '/addy-finish') return false;
  if (commandFromPrompt(action?.prompt) !== '/addy-finish') return false;
  if (!finishTextReportsComplete(text)) return false;

  const completedState = deps.archiveWorkflowStats(
    {
      ...state,
      phases: {
        ...state.phases,
        finish: 'complete',
      },
      autoMode: false,
      autoLastPrompt: undefined,
      autoRetryKey: undefined,
      autoRetryCount: undefined,
      autoFreshPrompt: undefined,
      autoFreshExpandedPrompt: undefined,
      autoFreshReason: undefined,
      autoFreshDeliveryKey: undefined,
      autoFreshConsumedKey: undefined,
      autoPendingAction: undefined,
      autoPausedReason: undefined,
      ...clearReviewControlUpdates(),
    },
    'completed',
  );
  deps.setState(ctx, completedState, deps.appendEntry(pi));
  deps.showWorkflowStats(pi, ctx, completedState, { heading: 'Finished!' });
  return true;
}
