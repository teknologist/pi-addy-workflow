import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_CONTINUE_USAGE,
  WORKFLOW_NEXT_USAGE,
  planAutoContinueCommand,
  planFreshStepCommand,
  planStatsCommand,
  planWorkflowNextCommand,
  registeredFreshStepCommandNames,
} from '../extensions/workflow-monitor/command-intake.ts';

test('command intake exposes registered fresh step command names', () => {
  assert.ok(registeredFreshStepCommandNames().includes('addy-build'));
  assert.ok(registeredFreshStepCommandNames().includes('addy-review'));
});

test('command intake plans fresh step input and workflow event', () => {
  const plan = planFreshStepCommand('/addy-review', { args: ['PLAN.md'] });

  assert.equal(plan.input, '/addy-review PLAN.md');
  assert.deepEqual(plan.workflowEvent, {
    source: 'command',
    text: '/addy-review PLAN.md',
    manualAddyCommand: true,
  });
});

test('command intake plans auto continuation reason or warning', () => {
  assert.deepEqual(
    planAutoContinueCommand({ input: '--fresh before-review' }),
    {
      kind: 'run',
      reason: 'before-review',
    },
  );
  assert.deepEqual(planAutoContinueCommand({ args: [] }), {
    kind: 'warn',
    message: AUTO_CONTINUE_USAGE,
  });
});

test('command intake plans stats path', () => {
  assert.deepEqual(planStatsCommand({ args: ['docs/plan.md'] }), {
    planPath: 'docs/plan.md',
  });
  assert.deepEqual(planStatsCommand({ args: [] }), { planPath: undefined });
});

test('command intake plans workflow-next open or warning', () => {
  assert.deepEqual(planWorkflowNextCommand({ args: ['review', 'PLAN.md'] }), {
    kind: 'open',
    phase: 'review',
    artifact: 'PLAN.md',
    workflowEvent: {
      source: 'command',
      text: '/addy-workflow-next review',
      artifact: 'PLAN.md',
    },
  });
  assert.deepEqual(planWorkflowNextCommand({ args: ['bogus'] }), {
    kind: 'warn',
    message: WORKFLOW_NEXT_USAGE,
  });
});
