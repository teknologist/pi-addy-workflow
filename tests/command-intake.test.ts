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

  assert.equal(plan.kind, 'run');
  if (plan.kind !== 'run') return;
  assert.equal(plan.input, '/addy-review PLAN.md');
  assert.deepEqual(plan.workflowEvent, {
    source: 'command',
    text: '/addy-review PLAN.md',
    manualAddyCommand: true,
  });
});

test('command intake preserves legacy free-text rendering', () => {
  const plan = planFreshStepCommand('/addy-build', {
    args: ['explain', 'the', 'change'],
  });

  assert.equal(plan.kind, 'run');
  if (plan.kind === 'run')
    assert.equal(plan.input, '/addy-build explain the change');
});

test('command intake rejects malformed quoted command lines with usage', () => {
  for (const input of ['--ticket "ENG-42', '--ticket ENG-42\\']) {
    const plan = planFreshStepCommand('/addy-build', input);
    assert.equal(plan.kind, 'warn');
    if (plan.kind === 'warn') assert.match(plan.message, /Use --ticket/);
  }
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
    kind: 'plan-stats',
    planPath: 'docs/plan.md',
  });
  assert.deepEqual(planStatsCommand({ args: [] }), { kind: 'plan-stats' });
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

test('command intake re-quotes opaque ticket refs', () => {
  const plan = planFreshStepCommand('/addy-build', {
    args: ['--ticket', 'local tickets/01.md'],
  });

  assert.equal(plan.kind, 'run');
  if (plan.kind === 'run')
    assert.equal(plan.input, '/addy-build --ticket "local tickets/01.md"');
});
