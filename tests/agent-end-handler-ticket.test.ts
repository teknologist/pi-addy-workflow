import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentEndHandler } from '../extensions/workflow-monitor/agent-end-handler.ts';
import { ticketAutoWorkflowActionKey } from '../extensions/workflow-monitor/auto-action-keys.ts';
import { formatTicketResultEnvelope } from '../extensions/workflow-monitor/ticket-phase-result.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

const claim = {
  id: 'claim-1',
  owner: 'agent',
  claimedAt: '2026-07-15T00:00:00.000Z',
};

const actionKey = ticketAutoWorkflowActionKey(
  {
    source: 'ticket',
    sourceKind: 'github',
    ticketRef: '#9',
    runId: 'run-1',
    claimId: 'claim-1',
  },
  'verify',
  'attempt-1',
);

function initial(autoMode = false): WorkflowState {
  return {
    ...createInitialWorkflowState(),
    autoMode,
    executionSource: 'ticket',
    ticketRun: {
      schemaVersion: 1,
      source: { kind: 'github', ref: '#9' },
      runId: 'run-1',
      claim,
      revision: 'rev-1',
      lifecycle: { implemented: true, verified: false, reviewed: false },
      repositoryScope: ['repo'],
    },
    autoPendingAction: {
      executionSource: 'ticket',
      key: actionKey,
      prompt: '/addy-verify --ticket #9',
      sourceKind: 'github',
      ticketRef: '#9',
      runId: 'run-1',
      claimId: 'claim-1',
      operation: 'verify',
      attemptMarker: 'attempt-1',
      reason: 'next-action',
      attempts: 1,
      createdAt: '2026-07-15T00:00:00.000Z',
    },
  };
}

const result = formatTicketResultEnvelope({
  schemaVersion: 1,
  kind: 'ticket-phase-result',
  operation: 'verify',
  outcome: 'succeeded',
  source: { kind: 'github', ref: '#9' },
  runId: 'run-1',
  claimId: 'claim-1',
  claim,
  actionKey,
  attempt: 1,
  postRevision: 'rev-2',
  lifecycle: { implemented: true, verified: true, reviewed: false },
  activity: { marker: `${actionKey}:1`, id: 'comment-2' },
  repositoryScope: ['repo'],
});

function harness(start: WorkflowState, providerRetry = false) {
  let state = start;
  let autoContinuations = 0;
  let appends = 0;
  let providerRetryCalls = 0;
  let continuedRevision: string | undefined;
  const handler = createAgentEndHandler({
    appendEntry: () => () => {
      appends += 1;
    },
    autoAgentEndContinue: async (_pi, _ctx, _text, _previous, next) => {
      autoContinuations += 1;
      continuedRevision = next.ticketRun?.revision;
    },
    baseCwd: () => '/repo',
    getState: () => state,
    ensureAutoRunnerOwnership: () => true,
    isChildSession: () => false,
    maybeContinueAfterTaskCommit: async () => false,
    nextActionForState: () => ({ prompt: '/addy-review --ticket #9' }),
    preserveProviderTransportRetry: () => {
      providerRetryCalls += 1;
      return providerRetry;
    },
    resumePendingFreshContinuation: async () => 'none',
    setState: (_ctx, next, append) => {
      state = next;
      append?.('workflow-state', next);
    },
  });
  return {
    handler,
    get state() {
      return state;
    },
    get autoContinuations() {
      return autoContinuations;
    },
    get appends() {
      return appends;
    },
    get providerRetryCalls() {
      return providerRetryCalls;
    },
    get continuedRevision() {
      return continuedRevision;
    },
  };
}

test('manual Ticket result persists before the auto-mode early return', async () => {
  const run = harness(initial(false));
  await run.handler.handleAgentEnd(
    {} as never,
    {},
    { message: { role: 'assistant', content: result } },
  );
  assert.equal(run.state.ticketRun?.revision, 'rev-2');
  assert.equal(run.state.ticketRun?.lifecycle.verified, true);
  assert.equal(run.state.ticketRun?.activityMarker, `${actionKey}:1`);
  assert.equal(run.state.ticketRun?.lastValidatedResult?.actionKey, actionKey);
  assert.equal(run.state.autoPendingAction, undefined);
  assert.equal(run.autoContinuations, 0);
});

test('Auto Ticket result advances once and duplicate envelope is idempotent', async () => {
  const run = harness(initial(true));
  const event = { message: { role: 'assistant', content: result } };
  await run.handler.handleAgentEnd({} as never, {}, event);
  await run.handler.handleAgentEnd({} as never, {}, event);
  assert.equal(run.autoContinuations, 1);
  assert.equal(run.state.ticketRun?.lastValidatedResult?.actionKey, actionKey);
});

test('duplicate selected Queue envelope does not warn or retrigger Auto', async () => {
  const state = initial(true);
  state.ticketRun = undefined;
  const pending = state.autoPendingAction;
  if (pending?.executionSource !== 'ticket')
    throw new Error('missing Ticket action');
  const selector = { kind: 'label' as const, value: 'ready-for-agent' };
  const queueKey = ticketAutoWorkflowActionKey(
    {
      source: 'ticket',
      sourceKind: 'github',
      ticketRef: 'ready-for-agent',
      runId: 'run-1',
      selector,
    },
    'select',
    'attempt-1',
  );
  state.autoPendingAction = {
    ...pending,
    key: queueKey,
    operation: 'select',
    claimId: undefined,
    selector,
    ticketRef: 'ready-for-agent',
    prompt: '/addy-auto --tickets --label ready-for-agent',
  };
  const queueResult = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'succeeded',
    actionKey: queueKey,
    attempt: 1,
    selector,
    categories: {
      eligible: { count: 1, refs: ['#9'] },
      blocked: { count: 0, refs: [] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 0, refs: [] },
    },
    selected: { source: { kind: 'github', ref: '#9' } },
    terminalReason: 'selected',
  });
  const run = harness(state);
  const event = { message: { role: 'assistant', content: queueResult } };
  await run.handler.handleAgentEnd({} as never, {}, event);
  const acceptedState = run.state;
  await run.handler.handleAgentEnd({} as never, {}, event);
  assert.equal(run.state, acceptedState);
  assert.equal(run.autoContinuations, 1);
  assert.equal(run.state.warnings.length, 1);
});

test('free-form success and malformed envelopes cannot complete Ticket operations', async () => {
  for (const content of ['success', '<!-- ADDY-TICKET-RESULT {bad} -->']) {
    const run = harness(initial(true));
    await run.handler.handleAgentEnd(
      {} as never,
      {},
      { message: { role: 'assistant', content } },
    );
    assert.equal(run.state.ticketRun?.lifecycle.verified, false);
    assert.equal(run.state.autoPendingAction?.key, actionKey);
    assert.equal(run.autoContinuations, 0);
    assert.match(run.state.warnings.at(-1) ?? '', /Ticket result rejected/);
  }
});

test('Ticket REVIEW persists structured disposition instead of prose findings', async () => {
  const state = initial(false);
  const reviewKey = ticketAutoWorkflowActionKey(
    {
      source: 'ticket',
      sourceKind: 'github',
      ticketRef: '#9',
      runId: 'run-1',
      claimId: 'claim-1',
    },
    'review',
    'attempt-1',
  );
  state.ticketRun!.lifecycle = {
    implemented: true,
    verified: true,
    reviewed: false,
  };
  const pending = state.autoPendingAction;
  if (pending?.executionSource !== 'ticket')
    throw new Error('missing Ticket action');
  state.autoPendingAction = {
    ...pending,
    key: reviewKey,
    prompt: '/addy-review --ticket #9',
    operation: 'review',
  };
  const reviewResult = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'review',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#9' },
    runId: 'run-1',
    claimId: 'claim-1',
    claim,
    actionKey: reviewKey,
    attempt: 1,
    postRevision: 'rev-3',
    lifecycle: { implemented: true, verified: true, reviewed: false },
    activity: { marker: `${reviewKey}:1` },
    repositoryScope: ['repo'],
    reviewDisposition: { status: 'findings', count: 2 },
  });
  const run = harness(state);
  await run.handler.handleAgentEnd(
    {} as never,
    {},
    {
      agentName: 'addy-reviewer',
      message: { role: 'assistant', content: `Success prose\n${reviewResult}` },
    },
  );
  assert.deepEqual(
    run.state.ticketRun?.lastValidatedResult?.reviewDisposition,
    { status: 'findings', count: 2 },
  );
  assert.equal(run.state.ticketRun?.lifecycle.reviewed, false);
});

test('blocked and failed Ticket results durably disable Auto before clearing pending', async () => {
  for (const outcome of ['blocked', 'failed'] as const) {
    const run = harness(initial(true));
    const terminalResult = formatTicketResultEnvelope({
      schemaVersion: 1,
      kind: 'ticket-phase-result',
      operation: 'verify',
      outcome,
      source: { kind: 'github', ref: '#9' },
      runId: 'run-1',
      claimId: 'claim-1',
      claim,
      actionKey,
      attempt: 1,
      postRevision: 'rev-2',
      lifecycle: { implemented: true, verified: false, reviewed: false },
      repositoryScope: ['repo'],
    });
    await run.handler.handleAgentEnd(
      {} as never,
      {},
      { message: { role: 'assistant', content: terminalResult } },
    );
    assert.equal(run.state.autoMode, false);
    assert.equal(run.state.autoPausedReason, `ticket-operation-${outcome}`);
    assert.equal(run.state.autoPendingAction, undefined);
    assert.equal(run.state.ticketRun?.lastValidatedResult?.outcome, outcome);
    assert.equal(run.autoContinuations, 0);
    assert.equal(run.appends, 1);
  }
});

test('unclaimed STATUS is persisted before Auto dispatch', async () => {
  const state = initial(true);
  state.ticketRun = undefined;
  const pending = state.autoPendingAction;
  if (pending?.executionSource !== 'ticket')
    throw new Error('missing Ticket action');
  const statusKey = ticketAutoWorkflowActionKey(
    {
      source: 'ticket',
      sourceKind: 'github',
      ticketRef: '#9',
      runId: 'run-1',
    },
    'status',
    'attempt-1',
  );
  state.autoPendingAction = {
    ...pending,
    key: statusKey,
    operation: 'status',
    claimId: undefined,
    prompt: '/addy-ticket status #9',
  };
  const status = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'status',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#9' },
    runId: 'run-1',
    claim: null,
    actionKey: statusKey,
    attempt: 1,
    postRevision: 'status-rev',
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['repo'],
  });
  const run = harness(state);
  await run.handler.handleAgentEnd(
    {} as never,
    {},
    { message: { role: 'assistant', content: status } },
  );
  assert.equal(run.state.ticketRun?.claim, undefined);
  assert.equal(run.continuedRevision, 'status-rev');
  assert.equal(run.autoContinuations, 1);
});

test('manual plan agent ends preserve legacy transport behavior', async () => {
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'plan' as const,
    autoMode: false,
    autoLastPrompt: '/addy-build',
  };
  const run = harness(state, true);
  await run.handler.handleAgentEnd(
    {} as never,
    {},
    {
      message: {
        role: 'assistant',
        content: '',
        stopReason: 'error',
        diagnostics: [{ type: 'provider_transport_failure' }],
      },
    },
  );
  assert.equal(run.providerRetryCalls, 0);
  assert.equal(run.state, state);
});

test('provider failure is handled before ingestion and retains pending identity', async () => {
  const run = harness(initial(true), true);
  await run.handler.handleAgentEnd(
    {} as never,
    {},
    {
      message: {
        role: 'assistant',
        content: result,
        stopReason: 'error',
        diagnostics: [{ type: 'provider_transport_failure' }],
      },
    },
  );
  assert.equal(run.providerRetryCalls, 1);
  assert.equal(run.state.autoPendingAction?.key, actionKey);
  assert.equal(run.state.ticketRun?.lifecycle.verified, false);
  assert.equal(run.autoContinuations, 0);
});
