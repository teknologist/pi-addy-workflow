import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANUAL_FRESH_CONTEXT_NOTICE,
  freshContextReasonForPrompt,
  planAutoPromptDispatch,
  planManualStepDispatch,
} from '../extensions/workflow-monitor/command-dispatch.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

const freshContext = {
  beforeEveryStep: false,
  betweenTasks: false,
  beforeReview: false,
};

test('command dispatch plans auto current-session prompt state updates', () => {
  const state = {
    ...createInitialWorkflowState(),
    current: 'build' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      build: 'active' as const,
    },
    activePlan: 'docs/plans/current.md',
    currentTask: 'Current task',
    currentTaskId: 'task-current',
    currentTaskIndex: 1,
    autoMode: true,
    autoPendingAction: {
      key: 'stale',
      prompt: '/addy-verify docs/plans/current.md',
      reason: 'idle-retry' as const,
      attempts: 0,
      createdAt: '2026-05-22T00:00:00.000Z',
    },
  };

  const plan = planAutoPromptDispatch({
    prompt: '/addy-verify docs/plans/current.md',
    state,
    freshContext,
    expandedPrompt: '# Addy Verify',
  });

  assert.equal(plan.kind, 'current-session');
  assert.equal(plan.state.autoLastPrompt, '/addy-verify docs/plans/current.md');
  assert.equal(plan.state.autoPendingAction, undefined);
  assert.equal(plan.state.current, 'verify');
  assert.equal(
    Object.values(plan.state.stats?.active.tasks ?? {})[0]?.verifyRuns,
    1,
  );
});

test('command dispatch plans pending fresh review from expanded invocation', () => {
  const state = {
    ...createInitialWorkflowState(),
    current: 'verify' as const,
    activePlan: 'docs/plans/current.md',
    autoMode: true,
  };
  const prompt =
    '# Addy Review\n\nInvocation: `/addy-review docs/plans/current.md`';

  const plan = planAutoPromptDispatch({
    prompt,
    state,
    freshContext: { ...freshContext, beforeReview: true },
    expandedPrompt: prompt,
  });

  assert.equal(plan.kind, 'pending-fresh');
  assert.equal(plan.reason, 'before-review');
  assert.equal(plan.state.autoFreshPrompt, prompt);
  assert.equal(plan.state.autoFreshReason, 'before-review');
  assert.equal(plan.state.current, 'verify');
});

test('command dispatch classifies fresh-context reasons', () => {
  const state = { ...createInitialWorkflowState(), autoMode: true };

  assert.equal(
    freshContextReasonForPrompt(
      '/addy-review docs/plan.md',
      state,
      {},
      {
        ...freshContext,
        beforeReview: true,
      },
    ),
    'before-review',
  );
  assert.equal(
    freshContextReasonForPrompt(
      '/addy-build docs/plan.md',
      state,
      {},
      {
        ...freshContext,
        beforeEveryStep: true,
      },
    ),
    'before-step',
  );
  assert.equal(
    freshContextReasonForPrompt(
      '/addy-finish docs/plan.md',
      state,
      {},
      {
        ...freshContext,
        beforeEveryStep: true,
      },
    ),
    undefined,
  );
});

test('command dispatch plans manual commands for current session', () => {
  const plan = planManualStepDispatch('/addy-verify docs/plan.md');

  assert.equal(plan.prompt, '/addy-verify docs/plan.md');
  assert.equal(plan.notice, MANUAL_FRESH_CONTEXT_NOTICE);
});
