import test from 'node:test';
import assert from 'node:assert/strict';
import { planFreshContinuationStart } from '../extensions/workflow-monitor/fresh-continuation-plan.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('fresh continuation planner covers start decisions without runtime side effects', () => {
  const base = createInitialWorkflowState();
  const cases = [
    {
      name: 'stale pending prompt is cleared',
      state: { ...base, autoFreshPrompt: '/addy-build PLAN.md' },
      canStartFreshSession: true,
      consumedKeys: new Set<string>(),
      kind: 'clear-stale',
    },
    {
      name: 'consumed pending prompt no-ops',
      state: { ...base, autoFreshConsumedKey: 'fresh-key' },
      canStartFreshSession: true,
      consumedKeys: new Set<string>(),
      kind: 'already-consumed',
    },
    {
      name: 'delivered key no-ops',
      state: {
        ...base,
        autoFreshPrompt: '/addy-review PLAN.md',
        autoFreshReason: 'before-review' as const,
        autoFreshDeliveryKey: 'fresh-key',
      },
      canStartFreshSession: true,
      consumedKeys: new Set(['fresh-key']),
      kind: 'already-delivered',
    },
    {
      name: 'missing fresh session continues current session',
      state: {
        ...base,
        autoFreshPrompt: '/addy-review PLAN.md',
        autoFreshReason: 'before-review' as const,
      },
      canStartFreshSession: false,
      consumedKeys: new Set<string>(),
      kind: 'continue-current-session',
      reason: 'before-review',
    },
    {
      name: 'available fresh session starts handoff',
      state: base,
      canStartFreshSession: true,
      consumedKeys: new Set<string>(),
      kind: 'start-fresh-session',
      reason: 'before-step',
    },
  ];

  for (const current of cases) {
    const plan = planFreshContinuationStart({
      state: current.state,
      requestedReason: 'before-step',
      canStartFreshSession: current.canStartFreshSession,
      consumedKeys: current.consumedKeys,
    });

    assert.equal(plan.kind, current.kind, current.name);
    if (
      (plan.kind === 'continue-current-session' ||
        plan.kind === 'start-fresh-session') &&
      'reason' in current
    )
      assert.equal(plan.reason, current.reason);
    if (plan.kind === 'clear-stale')
      assert.equal(plan.state.autoFreshPrompt, undefined);
  }
});
