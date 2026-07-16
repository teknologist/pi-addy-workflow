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
      dispatchTicketPrompt: async (_pi, _ctx, prompt) => {
        sent.push(prompt);
      },
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

test('addy-stats preserves an opaque ticket ref', () => {
  const harness = createHarness();

  harness.commands
    .get('addy-stats')
    ?.handler({ args: ['--ticket', 'local tickets/01.md'] }, {});

  assert.deepEqual(harness.sent, [
    '/addy-stats --ticket "local tickets/01.md"',
  ]);
});

test('addy-ticket preserves opaque args and blocks mutation of another live claim', () => {
  const harness = createHarness();
  harness.state.executionSource = 'ticket';
  harness.state.ticketRun = {
    schemaVersion: 1,
    source: { kind: 'local', ref: 'local tickets/01.md' },
    runId: 'run-1',
    claim: {
      id: 'claim-1',
      owner: 'eric',
      claimedAt: '2026-07-15T00:00:00.000Z',
    },
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['/repo'],
  };

  harness.commands
    .get('addy-ticket')
    ?.handler(
      { args: ['add-repository', 'local tickets/01.md', '../companion repo'] },
      {},
    );
  assert.deepEqual(harness.sent, [
    '/addy-ticket add-repository "local tickets/01.md" "../companion repo"',
  ]);

  harness.commands
    .get('addy-ticket')
    ?.handler({ args: ['release', 'ENG-43'] }, {});
  assert.equal(harness.sent.length, 1);
  assert.match(harness.notifications.at(-1)!, /local tickets\/01\.md/);
});

test('addy-workflow-next blocks every plan-oriented phase under a live claim', () => {
  const harness = createHarness();
  harness.state.executionSource = 'ticket';
  harness.state.ticketRun = {
    schemaVersion: 1,
    source: { kind: 'github', ref: 'ENG-42' },
    runId: 'run-1',
    claim: {
      id: 'claim-1',
      owner: 'eric',
      claimedAt: '2026-07-15T00:00:00.000Z',
    },
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['/repo'],
  };

  for (const phase of [
    'define',
    'plan',
    'build',
    'simplify',
    'verify',
    'review',
    'finish',
  ])
    harness.commands
      .get('addy-workflow-next')
      ?.handler({ args: [phase, 'docs/plans/new.md'] }, {});

  assert.equal(harness.sent.length, 0);
  assert.equal(harness.events.length, 0);
  assert.equal(harness.notifications.length, 7);
  assert.match(harness.notifications[0], /Ticket ENG-42 has a live claim/);
});
