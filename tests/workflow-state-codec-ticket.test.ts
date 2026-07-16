import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePersistedWorkflowState,
  serializeWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-codec.ts';
import { ticketAutoWorkflowActionKey } from '../extensions/workflow-monitor/auto-action-keys.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

export const validTicketRun = {
  schemaVersion: 1 as const,
  source: { kind: 'github' as const, ref: 'ENG-42' },
  runId: 'run-1',
  repositoryRoot: '/repo',
  claim: {
    id: 'claim-1',
    owner: 'eric',
    claimedAt: '2026-07-15T00:00:00.000Z',
  },
  revision: 'rev-3',
  queueSelector: { kind: 'label' as const, value: 'ready-for-agent' },
  lifecycle: { implemented: true, verified: false, reviewed: false },
  repositoryScope: ['/repo'],
  activityMarker: 'activity-1',
  lastValidatedResult: {
    operation: 'build' as const,
    outcome: 'succeeded' as const,
    actionKey: 'action-1',
    attempt: 0,
    revision: 'rev-3',
  },
};

test('legacy state round-trips without ticket fields', () => {
  const state = { ...createInitialWorkflowState(), activePlan: 'PLAN.md' };
  const parsed = parsePersistedWorkflowState(serializeWorkflowState(state));
  assert.equal(parsed?.activePlan, state.activePlan);
  assert.deepEqual(parsed?.phases, state.phases);
  assert.equal('executionSource' in parsed!, false);
  assert.equal('ticketRun' in parsed!, false);
});

test('valid ticket state round-trips strictly', () => {
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: validTicketRun,
  };
  const parsed = parsePersistedWorkflowState(serializeWorkflowState(state));
  assert.equal(parsed?.executionSource, 'ticket');
  assert.deepEqual(parsed?.ticketRun, validTicketRun);
  assert.equal(parsed?.ticketRecovery, undefined);
});

test('legacy add-repository evidence migrates its safe pending repository identity', () => {
  const legacyRun = {
    ...validTicketRun,
    pendingScopeRequest: { repository: '/repo/companion' },
    lastValidatedResult: {
      operation: 'add-repository' as const,
      outcome: 'succeeded' as const,
      actionKey: 'add-repository-1',
      attempt: 0,
    },
  };
  const parsed = parsePersistedWorkflowState(
    serializeWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: legacyRun,
    }),
  );
  assert.equal(
    parsed?.ticketRun?.lastValidatedResult?.repository,
    '/repo/companion',
  );
  assert.equal(
    parsed?.ticketRun?.lastValidatedResult?.repositoryAppended,
    false,
  );

  const unsafe = parsePersistedWorkflowState(
    serializeWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: {
        ...legacyRun,
        pendingScopeRequest: undefined,
      },
    }),
  );
  assert.equal(unsafe?.ticketRun, undefined);
  assert.equal(unsafe?.ticketRecovery?.possibleClaim, true);
});

test('Ticket operation pauses round-trip durably', () => {
  for (const autoPausedReason of [
    'ticket-operation-blocked',
    'ticket-operation-failed',
  ] as const) {
    const parsed = parsePersistedWorkflowState(
      serializeWorkflowState({
        ...createInitialWorkflowState(),
        autoMode: false,
        autoPausedReason,
        executionSource: 'ticket',
        ticketRun: validTicketRun,
      }),
    );
    assert.equal(parsed?.autoPausedReason, autoPausedReason);
    assert.equal(parsed?.autoMode, false);
  }
});

test('blocked and failed REVIEW dispositions round-trip when structured', () => {
  for (const outcome of ['blocked', 'failed'] as const)
    for (const reviewDisposition of [
      undefined,
      { status: 'clean' as const },
      { status: 'findings' as const, count: 1 },
    ]) {
      const ticketRun = {
        ...validTicketRun,
        lastValidatedResult: {
          operation: 'review' as const,
          outcome,
          actionKey: 'review-1',
          attempt: 1,
          ...(reviewDisposition ? { reviewDisposition } : {}),
        },
      };
      const parsed = parsePersistedWorkflowState(
        serializeWorkflowState({
          ...createInitialWorkflowState(),
          executionSource: 'ticket',
          ticketRun,
        }),
      );
      assert.deepEqual(parsed?.ticketRun, ticketRun);
    }
});

test('persisted successful FINISH requires completed lifecycle', () => {
  for (const outcome of ['succeeded', 'reconciled'] as const) {
    const lastValidatedResult = {
      operation: 'finish' as const,
      outcome,
      actionKey: 'finish-1',
      attempt: 1,
      commitEvidence: [{ repository: '/repo', commit: 'abc' }],
    };
    const completedRun = {
      ...validTicketRun,
      lifecycle: { implemented: true, verified: true, reviewed: true },
      lastValidatedResult,
    };
    assert.deepEqual(
      parsePersistedWorkflowState(
        serializeWorkflowState({
          ...createInitialWorkflowState(),
          executionSource: 'ticket',
          ticketRun: completedRun,
        }),
      )?.ticketRun,
      completedRun,
    );

    for (const lifecycle of [
      { implemented: false, verified: false, reviewed: false },
      { implemented: true, verified: false, reviewed: false },
      { implemented: true, verified: true, reviewed: false },
    ]) {
      const parsed = parsePersistedWorkflowState(
        serializeWorkflowState({
          ...createInitialWorkflowState(),
          executionSource: 'ticket',
          ticketRun: { ...validTicketRun, lifecycle, lastValidatedResult },
        }),
      );
      assert.equal(parsed?.ticketRun, undefined);
      assert.equal(parsed?.ticketRecovery?.possibleClaim, true);
    }
  }
});

test('persisted Ticket evidence remains operation-specific and exact', () => {
  for (const lastValidatedResult of [
    {
      operation: 'finish',
      outcome: 'succeeded',
      actionKey: 'finish-1',
      attempt: 1,
      reviewDisposition: { status: 'clean' },
      commitEvidence: [{ repository: '/repo', commit: 'abc' }],
    },
    {
      operation: 'review',
      outcome: 'succeeded',
      actionKey: 'review-1',
      attempt: 1,
      reviewDisposition: { status: 'clean' },
      commitEvidence: [{ repository: '/repo', commit: 'abc' }],
    },
    {
      operation: 'finish',
      outcome: 'succeeded',
      actionKey: 'finish-1',
      attempt: 1,
      commitEvidence: [
        { repository: '/repo', commit: 'abc' },
        { repository: '/repo', commit: 'def' },
      ],
    },
    {
      operation: 'finish',
      outcome: 'succeeded',
      actionKey: 'finish-1',
      attempt: 1,
      commitEvidence: [{ repository: '/other', commit: 'abc' }],
    },
  ]) {
    const parsed = parsePersistedWorkflowState(
      serializeWorkflowState({
        ...createInitialWorkflowState(),
        executionSource: 'ticket',
        ticketRun: { ...validTicketRun, lastValidatedResult } as never,
      }),
    );
    assert.equal(parsed?.ticketRun, undefined);
    assert.equal(parsed?.ticketRecovery?.possibleClaim, true);
  }
});

test('ticket pending actions persist source-neutral retry identity', () => {
  const pending = {
    executionSource: 'ticket' as const,
    key: ticketAutoWorkflowActionKey(
      {
        source: 'ticket',
        sourceKind: 'github',
        ticketRef: 'ENG-42',
        runId: 'run-1',
        claimId: 'claim-1',
      },
      'verify',
      'attempt-2',
    ),
    prompt: '/addy-verify --ticket ENG-42',
    sourceKind: 'github' as const,
    ticketRef: 'ENG-42',
    runId: 'run-1',
    claimId: 'claim-1',
    operation: 'verify' as const,
    attemptMarker: 'attempt-2',
    reason: 'idle-retry' as const,
    attempts: 2,
    createdAt: '2026-07-15T00:00:00.000Z',
  };
  const parsed = parsePersistedWorkflowState(
    serializeWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: validTicketRun,
      autoPendingAction: pending,
    }),
  );

  assert.deepEqual(parsed?.autoPendingAction, pending);

  const { runId: _runId, ...missingRun } = pending;
  const corrupt = parsePersistedWorkflowState({
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    ticketRun: validTicketRun,
    autoPendingAction: missingRun,
  });
  assert.equal(corrupt?.executionSource, 'ticket');
  assert.equal(corrupt?.ticketRecovery?.possibleClaim, true);
});

test('unclaimed CLAIM identity survives persistence for retry', () => {
  const { claim: _claim, ...unclaimedRun } = validTicketRun;
  const pending = {
    executionSource: 'ticket' as const,
    key: ticketAutoWorkflowActionKey(
      {
        source: 'ticket',
        sourceKind: 'github',
        ticketRef: 'ENG-42',
        runId: 'run-1',
        claimId: 'staged-claim',
      },
      'claim',
      'attempt-0',
    ),
    prompt: '/addy-ticket claim ENG-42',
    sourceKind: 'github' as const,
    ticketRef: 'ENG-42',
    runId: 'run-1',
    claimId: 'staged-claim',
    operation: 'claim' as const,
    attemptMarker: 'attempt-0',
    reason: 'next-action' as const,
    attempts: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
  };
  const parsed = parsePersistedWorkflowState(
    serializeWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: {
        ...unclaimedRun,
        lifecycle: { implemented: false, verified: false, reviewed: false },
        lastValidatedResult: undefined,
      },
      autoPendingAction: pending,
    }),
  );

  assert.deepEqual(parsed?.autoPendingAction, pending);
  assert.equal(parsed?.ticketRun?.claim, undefined);
});

test('ticket pending action must match its run identity and prompt operation', () => {
  const pending = {
    executionSource: 'ticket' as const,
    key: ticketAutoWorkflowActionKey(
      {
        source: 'ticket',
        sourceKind: 'github',
        ticketRef: 'ENG-42',
        runId: 'run-1',
        claimId: 'claim-1',
      },
      'verify',
      'attempt-0',
    ),
    prompt: '/addy-verify --ticket ENG-42',
    sourceKind: 'github' as const,
    ticketRef: 'ENG-42',
    runId: 'run-1',
    claimId: 'claim-1',
    operation: 'verify' as const,
    attemptMarker: 'attempt-0',
    reason: 'next-action' as const,
    attempts: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
  };

  for (const autoPendingAction of [
    { ...pending, sourceKind: 'linear' },
    { ...pending, ticketRef: 'ENG-41' },
    { ...pending, runId: 'run-2' },
    { ...pending, claimId: 'claim-2' },
    { ...pending, claimId: undefined },
    { ...pending, operation: 'review' },
  ]) {
    const parsed = parsePersistedWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: validTicketRun,
      autoPendingAction,
    });

    assert.equal(parsed?.ticketRun, undefined);
    assert.equal(parsed?.ticketRecovery?.possibleClaim, true);
  }
});

test('ticket pending operation identity fields are exact and action-key bound', () => {
  const base = {
    executionSource: 'ticket' as const,
    prompt: '/addy-auto --tickets --label ready-for-agent',
    sourceKind: 'github' as const,
    ticketRef: 'ENG-42',
    runId: 'run-1',
    claimId: 'claim-1',
    operation: 'select' as const,
    selector: { kind: 'label' as const, value: 'ready-for-agent' },
    attemptMarker: 'attempt-0',
    reason: 'next-action' as const,
    attempts: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
  };
  const valid = {
    ...base,
    key: ticketAutoWorkflowActionKey(
      { ...base, source: 'ticket' },
      'select',
      'attempt-0',
    ),
  };
  assert.deepEqual(
    parsePersistedWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: validTicketRun,
      autoPendingAction: valid,
    })?.autoPendingAction,
    valid,
  );

  for (const autoPendingAction of [
    { ...valid, selector: undefined },
    { ...valid, selector: { kind: 'label', value: 'other' } },
    {
      ...valid,
      operation: 'verify',
      prompt: '/addy-verify --ticket ENG-42',
    },
    { ...valid, operation: 'add-repository', selector: undefined },
    {
      ...valid,
      operation: 'verify',
      prompt: '/addy-verify --ticket ENG-42',
      selector: undefined,
      repository: '/other',
    },
  ]) {
    const parsed = parsePersistedWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: validTicketRun,
      autoPendingAction,
    });
    assert.equal(parsed?.ticketRun, undefined);
    assert.equal(parsed?.ticketRecovery?.possibleClaim, true);
  }

  const repository = '/other';
  const { selector: _selector, ...withoutSelector } = base;
  const repositoryAction = {
    ...withoutSelector,
    operation: 'add-repository' as const,
    prompt: `/addy-ticket add-repository ENG-42 ${repository}`,
    repository,
  };
  const keyedRepositoryAction = {
    ...repositoryAction,
    key: ticketAutoWorkflowActionKey(
      { ...repositoryAction, source: 'ticket' },
      'add-repository',
      'attempt-0',
    ),
  };
  assert.deepEqual(
    parsePersistedWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: validTicketRun,
      autoPendingAction: keyedRepositoryAction,
    })?.autoPendingAction,
    keyedRepositoryAction,
  );
});

test('ticket pending action key mismatch fails closed as recovery', () => {
  const parsed = parsePersistedWorkflowState({
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    ticketRun: validTicketRun,
    autoPendingAction: {
      executionSource: 'ticket',
      key: 'tampered-key',
      prompt: '/addy-verify --ticket ENG-42',
      sourceKind: 'github',
      ticketRef: 'ENG-42',
      runId: 'run-1',
      claimId: 'claim-1',
      operation: 'verify',
      attemptMarker: 'attempt-0',
      reason: 'next-action',
      attempts: 0,
      createdAt: '2026-07-15T00:00:00.000Z',
    },
  });

  assert.equal(parsed?.ticketRun, undefined);
  assert.equal(parsed?.ticketRecovery?.possibleClaim, true);
  assert.equal(parsed?.ticketRecovery?.ticketRef, 'ENG-42');
});

test('ticket recovery warnings remain unique across codec round trips', () => {
  const once = parsePersistedWorkflowState({
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    ticketRun: { ...validTicketRun, schemaVersion: 2 },
  })!;
  const twice = parsePersistedWorkflowState(serializeWorkflowState(once))!;

  assert.equal(twice.warnings.length, 1);
  assert.equal(twice.warnings[0], once.warnings[0]);
});

test('malformed ticket-associated pending state fails closed as recovery', () => {
  const parsed = parsePersistedWorkflowState({
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    ticketRun: validTicketRun,
    autoPendingAction: {
      executionSource: 'ticket',
      prompt: '/addy-verify --ticket ENG-42',
    },
  });

  assert.equal(parsed?.executionSource, 'ticket');
  assert.equal(parsed?.ticketRun, undefined);
  assert.equal(parsed?.ticketRecovery?.possibleClaim, true);
  assert.equal(parsed?.ticketRecovery?.ticketRef, 'ENG-42');
});

test('simultaneous ticket run and recovery state fails closed as corrupt', () => {
  const parsed = parsePersistedWorkflowState({
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    ticketRun: validTicketRun,
    ticketRecovery: {
      possibleClaim: true,
      ticketRef: 'ENG-42',
      reason: 'stale recovery',
    },
  });

  assert.equal(parsed?.ticketRun, undefined);
  assert.equal(parsed?.ticketRecovery?.possibleClaim, true);
});

test('unknown ticket schema and nested fields fail closed as corrupt', () => {
  for (const ticketRun of [
    { ...validTicketRun, schemaVersion: 2 },
    { ...validTicketRun, unexpected: true },
    { ...validTicketRun, source: { kind: 'jira', ref: 'ENG-42' } },
    {
      ...validTicketRun,
      lifecycle: { ...validTicketRun.lifecycle, implemented: 'yes' },
    },
    {
      ...validTicketRun,
      lastValidatedResult: {
        ...validTicketRun.lastValidatedResult,
        outcome: 'maybe',
      },
    },
  ]) {
    const parsed = parsePersistedWorkflowState({
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun,
    });
    assert.equal(parsed?.executionSource, 'ticket');
    assert.equal(parsed?.ticketRun, undefined);
    assert.equal(parsed?.ticketRecovery?.possibleClaim, true);
  }
});
