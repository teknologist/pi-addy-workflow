import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkflowStateWithProjectControl,
  sanitizedProjectFallbackWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-store-project-control.ts';
import { ticketAutoWorkflowActionKey } from '../extensions/workflow-monitor/auto-action-keys.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('store project control sanitizes project fallback auto state', () => {
  const state = sanitizedProjectFallbackWorkflowState({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build docs/plans/current.md',
    autoFreshReason: 'before-step',
    autoFreshDeliveryKey: 'fresh-key',
    autoLastPrompt: '/addy-review docs/plans/old.md',
    autoReviewFixKey: 'old-review-fix',
  });

  assert.equal(state?.autoMode, true);
  assert.equal(state?.autoFreshPrompt, '/addy-build docs/plans/current.md');
  assert.equal(state?.autoLastPrompt, undefined);
  assert.equal(state?.autoReviewFixKey, undefined);
});

test('store project control revives live project auto control', () => {
  const state = resolveWorkflowStateWithProjectControl(
    createInitialWorkflowState(),
    {
      ...createInitialWorkflowState(),
      autoMode: true,
      autoPendingAction: {
        key: 'pending-key',
        prompt: '/addy-verify docs/plans/current.md',
        reason: 'idle-retry',
        attempts: 1,
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    },
  );

  assert.equal(state.autoMode, true);
  assert.equal(state.autoPendingAction?.key, 'pending-key');
});

test('store project control reconciles an authoritative mismatched project claim', () => {
  const local = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    autoMode: true,
    autoPendingAction: {
      executionSource: 'ticket' as const,
      key: ticketAutoWorkflowActionKey(
        {
          source: 'ticket',
          sourceKind: 'github',
          ticketRef: 'ENG-41',
          runId: 'old-run',
          claimId: 'old-claim',
        },
        'build',
        'attempt-0',
      ),
      prompt: '/addy-build --ticket ENG-41',
      sourceKind: 'github' as const,
      ticketRef: 'ENG-41',
      runId: 'old-run',
      claimId: 'old-claim',
      operation: 'build' as const,
      attemptMarker: 'attempt-0',
      reason: 'next-action' as const,
      attempts: 0,
      createdAt: '2026-07-14T00:00:00.000Z',
    },
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: 'ENG-41' },
      runId: 'old-run',
      claim: {
        id: 'old-claim',
        owner: 'eric',
        claimedAt: '2026-07-14T00:00:00.000Z',
      },
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: ['/repo'],
    },
  };
  const project = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    autoMode: true,
    autoPendingAction: {
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
        'attempt-1',
      ),
      prompt: '/addy-verify --ticket ENG-42',
      sourceKind: 'github' as const,
      ticketRef: 'ENG-42',
      runId: 'run-1',
      claimId: 'claim-1',
      operation: 'verify' as const,
      attemptMarker: 'attempt-1',
      reason: 'next-action' as const,
      attempts: 1,
      createdAt: '2026-07-15T00:01:00.000Z',
    },
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: 'ENG-42' },
      runId: 'run-1',
      claim: {
        id: 'claim-1',
        owner: 'eric',
        claimedAt: '2026-07-15T00:00:00.000Z',
      },
      lifecycle: { implemented: true, verified: false, reviewed: false },
      repositoryScope: ['/repo'],
    },
  };

  const state = resolveWorkflowStateWithProjectControl(local, project);
  assert.equal(state.ticketRun?.source.ref, 'ENG-42');
  assert.equal(state.ticketRun?.claim?.id, 'claim-1');
  assert.equal(state.autoPendingAction?.key, project.autoPendingAction.key);
  assert.equal(state.autoMode, true);
});

test('store project control fails closed when authoritative action mismatches its claim', () => {
  const project = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    autoMode: true,
    autoPendingAction: {
      executionSource: 'ticket' as const,
      key: 'wrong-ticket',
      prompt: '/addy-build --ticket ENG-41',
      sourceKind: 'github' as const,
      ticketRef: 'ENG-41',
      runId: 'old-run',
      claimId: 'old-claim',
      operation: 'build' as const,
      attemptMarker: 'attempt-0',
      reason: 'next-action' as const,
      attempts: 0,
      createdAt: '2026-07-14T00:00:00.000Z',
    },
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: 'ENG-42' },
      runId: 'run-1',
      claim: {
        id: 'claim-1',
        owner: 'eric',
        claimedAt: '2026-07-15T00:00:00.000Z',
      },
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: ['/repo'],
    },
  };

  const state = resolveWorkflowStateWithProjectControl(
    createInitialWorkflowState(),
    project,
  );
  assert.equal(state.ticketRun, undefined);
  assert.equal(state.autoPendingAction, undefined);
  assert.equal(state.ticketRecovery?.possibleClaim, true);
  assert.equal(state.ticketRecovery?.ticketRef, 'ENG-42');
});

test('store project control preserves a fresh queue frontier between tickets', () => {
  const selector = { kind: 'label' as const, value: 'ready-for-agent' };
  const project = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    autoMode: true,
    ticketQueue: {
      schemaVersion: 1 as const,
      selector,
      drainId: 'drain-a',
    },
    autoPendingAction: {
      executionSource: 'ticket' as const,
      key: ticketAutoWorkflowActionKey(
        {
          source: 'ticket',
          ticketRef: 'ready-for-agent',
          runId: 'next-run',
          selector,
        },
        'select',
        'attempt-0',
      ),
      prompt: '/addy-auto --tickets --label ready-for-agent',
      ticketRef: 'ready-for-agent',
      runId: 'next-run',
      selector,
      operation: 'select' as const,
      attemptMarker: 'attempt-0',
      reason: 'next-action' as const,
      attempts: 0,
      createdAt: '2026-07-15T00:00:00.000Z',
    },
  };

  const state = resolveWorkflowStateWithProjectControl(
    createInitialWorkflowState(),
    project,
  );
  assert.equal(state.executionSource, 'ticket');
  assert.deepEqual(state.ticketQueue?.selector, selector);
  assert.equal(state.autoPendingAction?.executionSource, 'ticket');
});

test('store project control preserves a validated pre-claim ticket run', () => {
  const project = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: 'ENG-42' },
      runId: 'run-1',
      revision: 'rev-1',
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: ['/repo'],
    },
  };

  const state = resolveWorkflowStateWithProjectControl(
    createInitialWorkflowState(),
    project,
  );
  assert.equal(state.executionSource, 'ticket');
  assert.equal(state.ticketRun?.source.ref, 'ENG-42');
  assert.equal(state.ticketRun?.claim, undefined);
  assert.equal(state.ticketRun?.revision, 'rev-1');
});

test('store project control reconciles newer state for the same claim', () => {
  const claim = {
    id: 'claim-1',
    owner: 'eric',
    claimedAt: '2026-07-15T00:00:00.000Z',
  };
  const run = {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: 'ENG-42' },
    runId: 'run-1',
    claim,
    revision: 'rev-1',
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['/repo'],
  };
  const state = resolveWorkflowStateWithProjectControl(
    {
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: run,
    },
    {
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: {
        ...run,
        revision: 'rev-2',
        lifecycle: { implemented: true, verified: true, reviewed: false },
        repositoryScope: ['/repo', '/repo/shared'],
        pendingScopeRequest: { repository: '/repo/extra' },
      },
    },
  );

  assert.equal(state.ticketRun?.revision, 'rev-2');
  assert.equal(state.ticketRun?.lifecycle.verified, true);
  assert.deepEqual(state.ticketRun?.repositoryScope, ['/repo', '/repo/shared']);
  assert.equal(state.ticketRun?.pendingScopeRequest?.repository, '/repo/extra');
});

test('store project control lets consumed project fresh state replace stale branch pending state', () => {
  const state = resolveWorkflowStateWithProjectControl(
    {
      ...createInitialWorkflowState(),
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-build docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'fresh-key',
    },
    {
      ...createInitialWorkflowState(),
      current: 'build',
      activePlan: 'docs/plans/current.md',
      autoFreshConsumedKey: 'fresh-key',
    },
  );

  assert.equal(state.current, 'build');
  assert.equal(state.autoFreshPrompt, undefined);
  assert.equal(state.autoFreshDeliveryKey, undefined);
  assert.equal(state.autoFreshConsumedKey, 'fresh-key');
});
