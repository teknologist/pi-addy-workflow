import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  agentEndedWithProviderTransportFailure,
  type AgentEndEvent,
} from './agent-end-event.ts';
import { autoWorkflowActionKeyForPromptState } from './auto-action-keys.ts';
import { stateWithPendingAutoAction } from './auto-control.ts';
import { commandFromPrompt } from './command-router.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type ProviderTransportRetryDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  autoTaskCommitPrompt: string;
  latestActiveStatsTarget(
    state: WorkflowState,
  ): WorkflowStatsTarget | undefined;
  notifyWarning(ctx: unknown, message: string): void;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
};

function retryableAutoPrompt(prompt: string, autoTaskCommitPrompt: string) {
  const command = commandFromPrompt(prompt);
  return command?.startsWith('/addy-') || command === autoTaskCommitPrompt;
}

export function createProviderTransportRetryHandler(
  deps: ProviderTransportRetryDeps,
) {
  function maybePreserveProviderTransportRetry(
    pi: ExtensionAPI,
    ctx: unknown,
    event: AgentEndEvent,
    state: WorkflowState,
  ): boolean {
    if (!agentEndedWithProviderTransportFailure(event)) return false;

    if (state.autoPendingAction?.executionSource === 'ticket') {
      deps.notifyWarning(
        ctx,
        'Addy preserved the pending Ticket action after a provider transport failure.',
      );
      return true;
    }

    const retryPrompt = state.autoLastPrompt;
    if (
      !retryPrompt ||
      !retryableAutoPrompt(retryPrompt, deps.autoTaskCommitPrompt)
    )
      return false;

    const target = deps.latestActiveStatsTarget(state);
    deps.setState(
      ctx,
      stateWithPendingAutoAction(
        {
          ...state,
          autoLastPrompt: undefined,
        },
        retryPrompt,
        target,
        'idle-retry',
        autoWorkflowActionKeyForPromptState(retryPrompt, state, target),
      ),
      deps.appendEntry(pi),
    );
    deps.notifyWarning(
      ctx,
      'Addy auto preserved the workflow prompt after a provider transport failure and will retry it on the next safe lifecycle event.',
    );
    return true;
  }

  return { maybePreserveProviderTransportRetry };
}
