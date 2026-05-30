import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  inputTextFromEvent,
  type InputEvent as WorkflowInputEvent,
} from './workflow-host-events.ts';
import { workflowTextFromInput } from './command-router.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type InputHandlerDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  consumedPendingFreshPromptState(
    state: WorkflowState,
  ): WorkflowState | undefined;
  dispatchManualFrontierGuard(
    pi: ExtensionAPI,
    input: string,
    ctx: unknown,
  ): Promise<boolean>;
  getState(ctx: unknown): WorkflowState;
  handleWorkflowEvent(
    ctx: unknown,
    event: unknown,
    appendEntry?: AppendEntry,
  ): void;
  isManualAddyWorkflowCommand(input: string): boolean;
  pendingFreshInputMatches(input: string, state: WorkflowState): boolean;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
};

export function createInputHandler(deps: InputHandlerDeps) {
  async function handleInput(
    pi: ExtensionAPI,
    event: WorkflowInputEvent,
    ctx: unknown,
  ): Promise<{ action: 'continue' }> {
    const input = inputTextFromEvent(event);
    const workflowText = workflowTextFromInput(input);
    const state = deps.getState(ctx);
    const consumedState = deps.pendingFreshInputMatches(input, state)
      ? deps.consumedPendingFreshPromptState(state)
      : undefined;
    if (consumedState) {
      deps.setState(ctx, consumedState, deps.appendEntry(pi));
      return { action: 'continue' };
    }
    const manualAddyCommand = deps.isManualAddyWorkflowCommand(input);
    if (
      manualAddyCommand &&
      event.source !== 'extension' &&
      (await deps.dispatchManualFrontierGuard(pi, workflowText, ctx))
    )
      return { action: 'continue' };
    deps.handleWorkflowEvent(
      ctx,
      {
        source: 'user-input',
        text: workflowText,
        manualAddyCommand,
      },
      deps.appendEntry(pi),
    );
    return { action: 'continue' };
  }

  return { handleInput };
}
