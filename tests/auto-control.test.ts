import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pendingAutoActionForPrompt,
  sanitizedProjectFallbackAutoControl,
  withProjectAutoControl,
} from '../extensions/workflow-monitor/auto-control.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('auto control project fallback preserves pending fresh prompt and clears stale review control', () => {
  const state = sanitizedProjectFallbackAutoControl({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build docs/plans/current.md',
    autoFreshExpandedPrompt: 'expanded build prompt',
    autoFreshReason: 'before-step',
    autoFreshDeliveryKey: 'fresh-key',
    autoLastPrompt: '/addy-review docs/plans/old.md',
    autoRetryKey:
      '/addy-build docs/plans/current.md\u001fdocs/plans/current.md',
    autoRetryCount: 2,
    autoReviewFixKey: 'old-review-fix',
    autoReviewFixCount: 3,
    autoReviewFindingFingerprint: 'same-finding',
    autoReviewFixNeedsReview: true,
    autoReviewTask: 'Old task',
    autoReviewTaskIndex: 4,
    reviewStatsKey: 'old-review-stats',
    reviewStatsAgent: 'addy-reviewer',
  });

  assert.equal(state.autoMode, true);
  assert.equal(state.autoFreshPrompt, '/addy-build docs/plans/current.md');
  assert.equal(state.autoFreshReason, 'before-step');
  assert.equal(state.autoRetryCount, 2);
  assert.equal(state.autoLastPrompt, undefined);
  assert.equal(state.autoReviewFixKey, undefined);
  assert.equal(state.autoReviewFixCount, undefined);
  assert.equal(state.autoReviewFindingFingerprint, undefined);
  assert.equal(state.autoReviewFixNeedsReview, undefined);
  assert.equal(state.autoReviewTask, undefined);
  assert.equal(state.autoReviewTaskIndex, undefined);
  assert.equal(state.reviewStatsKey, undefined);
  assert.equal(state.reviewStatsAgent, undefined);
});

test('ticket pending action preserves selector and repository retry identities', () => {
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: 'ENG-42' },
      runId: 'run-1',
      repositoryRoot: '/repo',
      claim: {
        id: 'claim-1',
        owner: 'eric',
        claimedAt: '2026-07-15T00:00:00.000Z',
      },
      lifecycle: { implemented: true, verified: false, reviewed: false },
      repositoryScope: ['/repo'],
    },
  };

  const pending = pendingAutoActionForPrompt(
    '/addy-verify --ticket ENG-42',
    state,
    undefined,
    'idle-retry',
    'ticket-key',
  );
  const selected = pendingAutoActionForPrompt(
    '/addy-auto --tickets --label ready-for-agent',
    {
      ...state,
      ticketRun: {
        ...state.ticketRun,
        queueSelector: { kind: 'label', value: 'ready-for-agent' },
      },
    },
    undefined,
    'idle-retry',
    'ticket-key',
  );
  const repository = pendingAutoActionForPrompt(
    '/addy-ticket add-repository ENG-42 ../companion',
    state,
    undefined,
    'idle-retry',
    'ticket-key',
  );

  assert.deepEqual(
    {
      executionSource: pending.executionSource,
      sourceKind:
        pending.executionSource === 'ticket' ? pending.sourceKind : undefined,
      ticketRef:
        pending.executionSource === 'ticket' ? pending.ticketRef : undefined,
      runId: pending.executionSource === 'ticket' ? pending.runId : undefined,
      claimId:
        pending.executionSource === 'ticket' ? pending.claimId : undefined,
      operation:
        pending.executionSource === 'ticket' ? pending.operation : undefined,
      attemptMarker:
        pending.executionSource === 'ticket'
          ? pending.attemptMarker
          : undefined,
      plan: pending.plan,
    },
    {
      executionSource: 'ticket',
      sourceKind: 'github',
      ticketRef: 'ENG-42',
      runId: 'run-1',
      claimId: 'claim-1',
      operation: 'verify',
      attemptMarker: 'attempt-0',
      plan: undefined,
    },
  );
  assert.deepEqual(
    selected.executionSource === 'ticket' ? selected.selector : undefined,
    { kind: 'label', value: 'ready-for-agent' },
  );
  assert.equal(
    repository.executionSource === 'ticket' ? repository.repository : undefined,
    '/companion',
  );
  const repositoryRetry = pendingAutoActionForPrompt(
    repository.prompt,
    { ...state, autoPendingAction: repository },
    undefined,
    'idle-retry',
    'ticket-key',
  );
  assert.equal(
    repositoryRetry.executionSource === 'ticket'
      ? repositoryRetry.attemptMarker
      : undefined,
    'attempt-0',
  );
});

test('ticket CLAIM persists one claim identity across retries', () => {
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: 'ENG-42' },
      runId: 'run-1',
      repositoryRoot: '/repo',
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: ['/repo'],
    },
  };

  const first = pendingAutoActionForPrompt(
    '/addy-ticket claim ENG-42',
    state,
    undefined,
    'next-action',
    'ignored',
  );
  assert.equal(first.executionSource, 'ticket');
  if (first.executionSource !== 'ticket') assert.fail('expected Ticket action');
  assert.ok(first.claimId);

  const retry = pendingAutoActionForPrompt(
    first.prompt,
    { ...state, autoPendingAction: first },
    undefined,
    'idle-retry',
    'ignored',
  );
  assert.equal(retry.executionSource, 'ticket');
  if (retry.executionSource !== 'ticket') assert.fail('expected Ticket action');
  assert.equal(retry.claimId, first.claimId);
  assert.equal(retry.key, first.key);
  assert.equal(retry.attemptMarker, first.attemptMarker);
});

test('ticket repository requests resolve from the persisted run root', () => {
  const pending = pendingAutoActionForPrompt(
    '/addy-ticket add-repository ENG-42 ../companion',
    {
      ...createInitialWorkflowState(),
      executionSource: 'ticket',
      ticketRun: {
        schemaVersion: 1,
        source: { kind: 'local', ref: 'ENG-42' },
        runId: 'run-1',
        repositoryRoot: '/work/owner',
        claim: {
          id: 'claim-1',
          owner: 'eric',
          claimedAt: '2026-07-15T00:00:00.000Z',
        },
        lifecycle: { implemented: true, verified: false, reviewed: false },
        repositoryScope: ['/work/owner'],
      },
    },
    undefined,
    'next-action',
    'ignored',
  );

  assert.equal(
    pending.executionSource === 'ticket' ? pending.repository : undefined,
    '/work/companion',
  );
});

test('auto control project fallback revives live project auto unless branch explicitly stopped', () => {
  const projectState = {
    ...createInitialWorkflowState(),
    autoMode: true,
    autoPendingAction: {
      key: 'pending-key',
      prompt: '/addy-verify docs/plans/current.md',
      reason: 'idle-retry' as const,
      attempts: 1,
      createdAt: '2026-05-22T00:00:00.000Z',
    },
  };

  assert.equal(
    withProjectAutoControl(createInitialWorkflowState(), projectState)
      .autoPendingAction?.key,
    'pending-key',
  );

  assert.equal(
    withProjectAutoControl(
      {
        ...createInitialWorkflowState(),
        autoPausedReason: 'user-stopped',
      },
      projectState,
    ).autoPendingAction,
    undefined,
  );
});
