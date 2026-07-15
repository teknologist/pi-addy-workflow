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
