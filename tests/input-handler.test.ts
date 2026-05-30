import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputHandler } from '../extensions/workflow-monitor/input-handler.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

test('input handler consumes matching pending fresh prompt before workflow events', async () => {
  let state: WorkflowState = {
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-review PLAN.md',
  };
  let events = 0;
  const handler = createInputHandler({
    appendEntry: () => () => {},
    consumedPendingFreshPromptState: (current) => ({
      ...current,
      autoFreshPrompt: undefined,
    }),
    dispatchManualFrontierGuard: async () => false,
    getState: () => state,
    handleWorkflowEvent: () => {
      events += 1;
    },
    isManualAddyWorkflowCommand: () => true,
    pendingFreshInputMatches: () => true,
    setState: (_ctx, nextState) => {
      state = nextState;
    },
  });

  const result = await handler.handleInput(
    {} as never,
    { text: '/addy-review PLAN.md' },
    {},
  );

  assert.deepEqual(result, { action: 'continue' });
  assert.equal(state.autoFreshPrompt, undefined);
  assert.equal(events, 0);
});

test('input handler lets manual frontier guard intercept user Addy commands', async () => {
  let guardedInput: string | undefined;
  let events = 0;
  const handler = createInputHandler({
    appendEntry: () => () => {},
    consumedPendingFreshPromptState: () => undefined,
    dispatchManualFrontierGuard: async (_pi, input) => {
      guardedInput = input;
      return true;
    },
    getState: () => createInitialWorkflowState(),
    handleWorkflowEvent: () => {
      events += 1;
    },
    isManualAddyWorkflowCommand: () => true,
    pendingFreshInputMatches: () => false,
    setState: () => {},
  });

  await handler.handleInput({} as never, { text: '/addy-build plan.md' }, {});

  assert.equal(guardedInput, '/addy-build plan.md');
  assert.equal(events, 0);
});

test('input handler records normalized workflow input when not intercepted', async () => {
  const events: unknown[] = [];
  const handler = createInputHandler({
    appendEntry: () => () => {},
    consumedPendingFreshPromptState: () => undefined,
    dispatchManualFrontierGuard: async () => false,
    getState: () => createInitialWorkflowState(),
    handleWorkflowEvent: (_ctx, event) => events.push(event),
    isManualAddyWorkflowCommand: () => true,
    pendingFreshInputMatches: () => false,
    setState: () => {},
  });

  await handler.handleInput(
    {} as never,
    { text: '/addy-review PLAN.md', source: 'extension' },
    {},
  );

  assert.deepEqual(events, [
    {
      source: 'user-input',
      text: '/addy-review PLAN.md',
      manualAddyCommand: true,
    },
  ]);
});
