import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowDelivery } from '../extensions/workflow-monitor/workflow-delivery.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

function createHarness(initial: WorkflowState = createInitialWorkflowState()) {
  let state = initial;
  const warnings: string[] = [];
  const delivery = createWorkflowDelivery({
    getState: () => state,
    setState: (_ctx, nextState) => {
      state = nextState;
    },
    appendEntryFromContext: () => () => {},
    latestActiveStatsTarget: () => undefined,
    isStaleExtensionContextError: () => false,
    notifyWarning: (_ctx, message) => warnings.push(message),
    retryMs: 1,
    maxAttempts: 1,
  });

  return {
    delivery,
    warnings,
    get state() {
      return state;
    },
  };
}

test('workflow delivery appends auto recovery guidance to auto prompts', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoMode: true,
  });
  const sent: Array<{ content: string; options?: { deliverAs?: string } }> = [];

  await harness.delivery.sendUserMessage(
    {} as never,
    {
      sendUserMessage: (content: string, options?: { deliverAs?: string }) =>
        sent.push({ content, options }),
    },
    'Continue the workflow',
    { autoMode: true },
  );

  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /Addy Auto Mode Recovery/);
  assert.equal(sent[0].options?.deliverAs, 'followUp');
});

test('workflow delivery adds fix-all handoff only for fix-all prompt', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoMode: true,
  });
  const sent: string[] = [];

  await harness.delivery.sendUserMessage(
    {} as never,
    { sendUserMessage: (content: string) => sent.push(content) },
    '/addy-fix-all PLAN.md',
    { autoMode: true },
  );

  assert.match(sent[0], /Addy Auto Fix-All Handoff/);
  assert.match(sent[0], /will dispatch `\/addy-verify` first/);
});

test('workflow delivery preserves pending auto action when prompt cannot be sent', () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoMode: true,
    activePlan: 'PLAN.md',
  });
  const editorText: string[] = [];
  const notifications: Array<{ message: string; level?: string }> = [];

  harness.delivery.sendUserMessage(
    {} as never,
    {
      ui: {
        setEditorText: (text: string) => editorText.push(text),
        notify: (message: string, level?: string) =>
          notifications.push({ message, level }),
      },
    },
    '/addy-build PLAN.md',
    { autoMode: true },
  );

  assert.equal(harness.state.autoPendingAction?.prompt, '/addy-build PLAN.md');
  assert.match(editorText[0], /Addy Auto Mode Recovery/);
  assert.match(notifications[0].message, /prompt was preserved for retry/);
});

test('workflow delivery preserves pending auto action after delivery failure', () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoMode: true,
    activePlan: 'PLAN.md',
  });

  harness.delivery.handleUserMessageDeliveryFailure(
    {},
    '/addy-review PLAN.md',
    new Error('network down'),
  );

  assert.equal(harness.state.autoPendingAction?.prompt, '/addy-review PLAN.md');
  assert.match(harness.warnings[0], /network down/);
  assert.match(harness.warnings[0], /preserved/);
});
