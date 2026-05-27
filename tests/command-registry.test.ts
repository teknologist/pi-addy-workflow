import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWorkflowCommands } from '../extensions/workflow-monitor/command-registry.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

function createHarness() {
  const commands = new Map<
    string,
    { handler: (event: unknown, ctx: unknown) => unknown }
  >();
  const sent: string[] = [];
  const events: unknown[] = [];
  const notifications: string[] = [];
  let statsHeading: string | undefined;
  let statsPlanPath: string | undefined;
  const state = createInitialWorkflowState();
  registerWorkflowCommands(
    {
      registerCommand: (
        name: string,
        command: { handler: (event: unknown, ctx: unknown) => unknown },
      ) => {
        commands.set(name, command);
      },
    } as never,
    {
      appendEntry: () => () => {},
      resumePendingFreshContinuation: async () => 'none',
      dispatchManualFrontierGuard: async () => false,
      dispatchManualStepWithFreshContextConfig: () => true,
      dispatchTaskCommitPrompt: async () => {},
      getState: () => state,
      handleWorkflowEvent: (_ctx, event) => events.push(event),
      maybeRunAutoWatchdog: async () => {},
      notify: (_ctx, message) => notifications.push(message),
      openNextWorkflowPrompt: (_ctx, phase, artifact) =>
        sent.push(
          `/addy-workflow-next ${phase}${artifact ? ` ${artifact}` : ''}`,
        ),
      resetWorkflow: () => sent.push('reset'),
      runFreshContextContinuation: async () => {},
      sendUserMessage: (_pi, _ctx, input) => sent.push(input),
      setState: () => {},
      shouldFreshContextBeforeStep: () => false,
      showWorkflowStats: (_pi, _ctx, _state, options) => {
        statsHeading = options?.heading;
        statsPlanPath = options?.planPath;
      },
    },
  );
  return {
    commands,
    events,
    notifications,
    sent,
    get statsHeading() {
      return statsHeading;
    },
    get statsPlanPath() {
      return statsPlanPath;
    },
    state,
  };
}

test('command registry registers workflow commands through the host API', () => {
  const harness = createHarness();

  assert.ok(harness.commands.has('addy-build'));
  assert.ok(harness.commands.has('addy-auto'));
  assert.ok(harness.commands.has('addy-auto-continue'));
  assert.ok(harness.commands.has('addy-stats'));
  assert.ok(harness.commands.has('addy-workflow-next'));
});

test('fresh-context step command records command event and sends user message', async () => {
  const harness = createHarness();

  await harness.commands.get('addy-review')?.handler({ args: ['PLAN.md'] }, {});

  assert.deepEqual(harness.events, [
    {
      source: 'command',
      text: '/addy-review PLAN.md',
      manualAddyCommand: true,
    },
  ]);
  assert.deepEqual(harness.sent, ['/addy-review PLAN.md']);
});

test('addy-auto-continue warns when missing a fresh-context reason', async () => {
  const harness = createHarness();

  await harness.commands.get('addy-auto-continue')?.handler({ args: [] }, {});

  assert.equal(
    harness.notifications[0],
    'Usage: /addy-auto-continue --fresh <between-tasks|before-step|before-review>',
  );
});

test('addy-auto stop records command event and shows stats', async () => {
  const harness = createHarness();

  await harness.commands.get('addy-auto')?.handler({ args: ['stop'] }, {});

  assert.deepEqual(harness.events, [
    { source: 'command', text: '/addy-auto stop', artifact: undefined },
  ]);
  assert.equal(harness.statsHeading, 'Addy auto stopped.');
});

test('addy-stats defaults to the active plan', () => {
  const harness = createHarness();
  harness.state.activePlan = 'docs/plans/current.md';

  harness.commands.get('addy-stats')?.handler({ args: [] }, {});

  assert.equal(harness.statsPlanPath, 'docs/plans/current.md');
});

test('addy-stats preserves supplied plan and explicit all-history mode', () => {
  const harness = createHarness();
  harness.state.activePlan = 'docs/plans/current.md';

  harness.commands
    .get('addy-stats')
    ?.handler({ args: ['docs/plans/other.md'] }, {});
  assert.equal(harness.statsPlanPath, 'docs/plans/other.md');

  harness.commands.get('addy-stats')?.handler({ args: ['--all'] }, {});
  assert.equal(harness.statsPlanPath, undefined);
});
