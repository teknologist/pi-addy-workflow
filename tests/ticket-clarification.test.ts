import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingAutoActionForPrompt } from '../extensions/workflow-monitor/auto-control.ts';
import {
  clearTicketClarification,
  resolveTicketClarification,
  setTicketClarification,
} from '../extensions/workflow-monitor/ticket-clarification.ts';
import {
  parsePersistedWorkflowState,
  serializeWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-codec.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

const state = {
  ...createInitialWorkflowState(),
  executionSource: 'ticket' as const,
  ticketRun: {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#10' },
    runId: 'run-1',
    claim: {
      id: 'claim-1',
      owner: 'agent',
      claimedAt: '2026-07-15T00:00:00.000Z',
    },
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['/repo'],
  },
};

test('extension-owned Ticket clarification transitions set, resolve, and clear durably', () => {
  const pending = setTicketClarification(state, {
    kind: 'tracker-routing',
    prompt: 'Use GitHub or Linear routing?',
  });
  const persistedPending = parsePersistedWorkflowState(
    serializeWorkflowState(pending),
  )!;
  assert.deepEqual(persistedPending.ticketRun?.pendingClarification, {
    kind: 'tracker-routing',
    prompt: 'Use GitHub or Linear routing?',
  });

  const resolved = resolveTicketClarification(persistedPending, 'github');
  const persistedResolved = parsePersistedWorkflowState(
    serializeWorkflowState(resolved),
  )!;
  assert.deepEqual(persistedResolved.ticketRun?.pendingClarification, {
    kind: 'tracker-routing',
    prompt: 'Use GitHub or Linear routing?',
    resolution: 'github',
  });

  assert.equal(
    clearTicketClarification(persistedResolved).ticketRun?.pendingClarification,
    undefined,
  );
});

test('canceled clarification survives persistence and retry with the same action identity', () => {
  const pending = setTicketClarification(state, {
    kind: 'completion-transition',
    prompt: 'Which completion state should be used?',
  });
  const first = pendingAutoActionForPrompt(
    '/addy-build --ticket #10',
    pending,
    undefined,
    'next-action',
    'ignored',
  );
  assert.equal(first.executionSource, 'ticket');
  if (first.executionSource !== 'ticket') assert.fail('expected Ticket action');
  const persisted = parsePersistedWorkflowState(
    serializeWorkflowState({ ...pending, autoPendingAction: first }),
  )!;
  const retry = pendingAutoActionForPrompt(
    first.prompt,
    persisted,
    undefined,
    'idle-retry',
    'ignored',
  );

  assert.equal(retry.executionSource, 'ticket');
  if (retry.executionSource !== 'ticket') assert.fail('expected Ticket retry');
  assert.deepEqual(
    persisted.ticketRun?.pendingClarification,
    pending.ticketRun?.pendingClarification,
  );
  assert.equal(retry.key, first.key);
  assert.equal(retry.attemptMarker, first.attemptMarker);
});
