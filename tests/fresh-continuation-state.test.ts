import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumedPendingFreshPromptState,
  currentSessionFallbackOptions,
  pendingFreshInputMatches,
} from '../extensions/workflow-monitor/fresh-continuation-state.ts';
import { autoFreshContinuationKey } from '../extensions/workflow-monitor/auto-control.ts';
import type { WorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

const pendingState: WorkflowState = {
  phases: {
    define: 'complete',
    plan: 'complete',
    build: 'active',
    simplify: 'pending',
    verify: 'pending',
    review: 'pending',
    finish: 'pending',
  },
  warnings: [],
  autoMode: true,
  autoFreshPrompt: '/addy-build plans/slice-01.md',
  autoFreshExpandedPrompt:
    'Invocation: `/addy-build plans/slice-01.md`\n\nExpanded prompt',
  autoFreshReason: 'before-step',
  autoRetryKey: 'retry-key',
  autoRetryCount: 2,
};

test('fresh continuation state consumes pending prompt and preserves retry metadata', () => {
  const consumed = consumedPendingFreshPromptState(pendingState);

  assert.equal(consumed?.autoFreshPrompt, undefined);
  assert.equal(consumed?.autoFreshReason, undefined);
  assert.equal(consumed?.autoFreshConsumedKey?.includes('/addy-build'), true);
  assert.equal(consumed?.autoRetryKey, 'retry-key');
  assert.equal(consumed?.autoRetryCount, 2);
});

test('fresh continuation state matches invocation and expanded prompt text', () => {
  assert.equal(
    pendingFreshInputMatches(
      'Invocation: `/addy-build plans/slice-01.md`',
      pendingState,
    ),
    true,
  );
  assert.equal(
    pendingFreshInputMatches(
      pendingState.autoFreshExpandedPrompt!,
      pendingState,
    ),
    true,
  );
  assert.equal(pendingFreshInputMatches('/addy-review', pendingState), false);
});

test('fresh continuation preserves ticket identity and claim state', () => {
  const state: WorkflowState = {
    ...pendingState,
    executionSource: 'ticket',
    ticketRun: {
      schemaVersion: 1,
      source: { kind: 'github', ref: 'ENG-42' },
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
  const consumed = consumedPendingFreshPromptState(state);
  assert.equal(consumed?.executionSource, 'ticket');
  assert.deepEqual(consumed?.ticketRun, state.ticketRun);
});

test('fresh continuation keys include ticket run and claim identity', () => {
  const ticketState: WorkflowState = {
    ...pendingState,
    executionSource: 'ticket',
    ticketRun: {
      schemaVersion: 1,
      source: { kind: 'github', ref: 'ENG-42' },
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
  const key = autoFreshContinuationKey(
    ticketState.autoFreshPrompt!,
    ticketState.autoFreshReason!,
    ticketState,
  );

  assert.notEqual(
    key,
    autoFreshContinuationKey(
      ticketState.autoFreshPrompt!,
      ticketState.autoFreshReason!,
      {
        ...ticketState,
        ticketRun: { ...ticketState.ticketRun!, runId: 'run-2' },
      },
    ),
  );
  assert.notEqual(
    key,
    autoFreshContinuationKey(
      ticketState.autoFreshPrompt!,
      ticketState.autoFreshReason!,
      {
        ...ticketState,
        ticketRun: {
          ...ticketState.ticketRun!,
          claim: { ...ticketState.ticketRun!.claim!, id: 'claim-2' },
        },
      },
    ),
  );
});

test('current session fallback options disables default delivery without idle signal', () => {
  assert.deepEqual(
    currentSessionFallbackOptions(
      { useDefaultDelivery: true, idleTurnDelivery: true },
      false,
    ),
    { useDefaultDelivery: false, idleTurnDelivery: true },
  );
  assert.deepEqual(
    currentSessionFallbackOptions({ useDefaultDelivery: true }, true),
    { useDefaultDelivery: true },
  );
});
