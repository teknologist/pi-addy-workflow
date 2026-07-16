import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingAutoActionForPrompt } from '../extensions/workflow-monitor/auto-control.ts';
import { formatTicketResultEnvelope } from '../extensions/workflow-monitor/ticket-phase-result.ts';
import { ingestTicketResult } from '../extensions/workflow-monitor/ticket-result-ingestion.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';
import {
  parsePersistedWorkflowState,
  serializeWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-codec.ts';
import { sanitizedProjectFallbackWorkflowState } from '../extensions/workflow-monitor/workflow-state-store-project-control.ts';

const selector = { kind: 'status' as const, value: 'ready for agent' };
const claim = {
  id: 'claim-a',
  owner: 'agent',
  claimedAt: '2026-07-15T00:00:00.000Z',
};

test('FINISH continues only the drain that owns the ticket run', () => {
  const ticketRun = {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#1' },
    runId: 'run-a',
    claim,
    queueSelector: selector,
    queueDrainId: 'drain-a',
    lifecycle: { implemented: true, verified: true, reviewed: true },
    repositoryScope: ['.'],
  };
  const state = {
    ...createInitialWorkflowState(),
    autoMode: true,
    executionSource: 'ticket' as const,
    ticketQueue: { schemaVersion: 1 as const, selector, drainId: 'drain-a' },
    ticketRun,
  };
  const pending = pendingAutoActionForPrompt(
    '/addy-finish --ticket #1',
    state,
    undefined,
    'next-action',
    '',
  );
  if (pending.executionSource !== 'ticket') assert.fail('expected ticket');
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'finish',
    outcome: 'succeeded',
    source: ticketRun.source,
    runId: ticketRun.runId,
    claimId: claim.id,
    claim,
    actionKey: pending.key,
    attempt: 0,
    postRevision: 'closed-rev',
    lifecycle: { implemented: true, verified: true, reviewed: true },
    activity: { marker: `${pending.key}:0`, kind: 'final' },
    repositoryScope: ['.'],
    commitEvidence: [
      {
        repository: '.',
        result: 'no-changes',
        recordedAt: '2026-07-15T01:00:00.000Z',
      },
    ],
    finishStage: 'terminal-refetch',
    terminal: { state: 'closed', confirmedAt: '2026-07-15T01:01:00.000Z' },
  });

  const ingestion = ingestTicketResult(
    { ...state, autoPendingAction: pending },
    result,
  );
  assert.equal(ingestion.status, 'accepted');
  assert.equal(ingestion.state.autoMode, true);
  assert.equal(ingestion.state.ticketRun, undefined);
  assert.deepEqual(ingestion.state.ticketQueue?.selector, selector);
  assert.equal(ingestion.state.ticketHistory?.at(-1)?.source.ref, '#1');
  assert.equal(ingestion.state.autoPendingAction?.executionSource, 'ticket');
  if (ingestion.state.autoPendingAction?.executionSource !== 'ticket')
    assert.fail('expected queue selection');
  assert.equal(ingestion.state.autoPendingAction.operation, 'select');
  assert.notEqual(ingestion.state.autoPendingAction.runId, 'run-a');
  assert.equal(
    ingestion.state.autoFreshPrompt,
    '/addy-auto --tickets --status "ready for agent"',
  );
  assert.deepEqual(ingestion.state.autoPendingAction.selector, selector);
  assert.equal(ingestion.state.autoFreshReason, 'between-tasks');
  assert.match(
    ingestion.state.autoFreshDeliveryKey ?? '',
    new RegExp(ingestion.state.autoPendingAction.runId),
  );
  const restored = parsePersistedWorkflowState(
    serializeWorkflowState(ingestion.state),
  );
  assert.deepEqual(restored?.ticketQueue?.selector, selector);
  assert.equal(restored?.autoPendingAction?.executionSource, 'ticket');

  const standalone = ingestTicketResult(
    {
      ...state,
      autoMode: false,
      ticketQueue: { ...state.ticketQueue, drainId: 'drain-b' },
      autoPendingAction: pending,
    },
    result,
  );
  assert.equal(standalone.status, 'accepted');
  assert.equal(standalone.state.executionSource, undefined);
  assert.equal(standalone.state.ticketQueue?.drainId, 'drain-b');
  assert.equal(standalone.state.autoPendingAction, undefined);
  assert.equal(standalone.state.autoFreshPrompt, undefined);

  const restoredStandalone = parsePersistedWorkflowState(
    serializeWorkflowState(standalone.state),
  );
  assert.equal(restoredStandalone?.executionSource, undefined);
  assert.equal(restoredStandalone?.ticketQueue?.drainId, 'drain-b');
  assert.equal(restoredStandalone?.ticketRecovery, undefined);
});

test('terminal queue categories round-trip without creating possible-claim recovery', () => {
  for (const [terminalReason, populated, expectedPause, expectedWarning] of [
    ['empty', [], undefined, 'Ticket queue is empty.'],
    [
      'all-blocked',
      ['blocked'],
      'ticket-operation-blocked',
      'Ticket queue paused: 1 blocked, 0 claimed, 0 ineligible, 0 ambiguous.',
    ],
    [
      'all-claimed',
      ['claimed'],
      'ticket-operation-blocked',
      'Ticket queue paused: 0 blocked, 1 claimed, 0 ineligible, 0 ambiguous.',
    ],
    [
      'all-ineligible',
      ['ineligible'],
      'ticket-operation-blocked',
      'Ticket queue paused: 0 blocked, 0 claimed, 1 ineligible, 0 ambiguous.',
    ],
    [
      'mixed',
      ['blocked', 'claimed', 'ineligible'],
      'ticket-operation-blocked',
      'Ticket queue paused: 1 blocked, 1 claimed, 1 ineligible, 0 ambiguous.',
    ],
    [
      'configuration-ambiguous',
      ['ambiguous'],
      'configuration-ambiguous',
      'Ticket queue paused for configuration ambiguity (1).',
    ],
  ] as const) {
    const state = {
      ...createInitialWorkflowState(),
      autoMode: true,
      executionSource: 'ticket' as const,
      ticketQueue: {
        schemaVersion: 1 as const,
        selector,
        drainId: 'drain-a',
      },
    };
    const pending = pendingAutoActionForPrompt(
      '/addy-auto --tickets --status "ready for agent"',
      state,
      undefined,
      'next-action',
      '',
    );
    if (pending.executionSource !== 'ticket') assert.fail('expected ticket');
    const category = (
      name: 'blocked' | 'claimed' | 'ineligible' | 'ambiguous',
      ref: string,
    ) => ({
      count: populated.some((value) => value === name) ? 1 : 0,
      refs: populated.some((value) => value === name)
        ? [{ kind: 'github' as const, ref }]
        : [],
    });
    const result = formatTicketResultEnvelope({
      schemaVersion: 1,
      kind: 'ticket-queue-result',
      operation: 'select',
      outcome: 'blocked',
      actionKey: pending.key,
      attempt: 0,
      selector,
      categories: {
        eligible: { count: 0, refs: [] },
        blocked: category('blocked', '#2'),
        claimed: category('claimed', '#3'),
        ineligible: category('ineligible', '#4'),
        ambiguous: category('ambiguous', '#5'),
      },
      eligibleCandidates: [],
      terminalReason,
    });
    const ingestion = ingestTicketResult(
      {
        ...state,
        autoPendingAction: pending,
        autoLastPrompt: '__addy-auto-task-commit__',
        autoRetryKey: 'stale-retry',
        autoRetryCount: 2,
        autoFreshPrompt: pending.prompt,
        autoFreshExpandedPrompt: 'stale expanded queue prompt',
        autoFreshReason: 'between-tasks',
        autoFreshDeliveryKey: 'stale-fresh-delivery',
        autoFreshConsumedKey: 'stale-fresh-consumed',
        autoReviewFixKey: 'stale-review-fix',
      },
      result,
    );
    const restored = parsePersistedWorkflowState(
      serializeWorkflowState(ingestion.state),
    );
    const projectFallback = sanitizedProjectFallbackWorkflowState(restored);

    assert.equal(ingestion.state.executionSource, undefined, terminalReason);
    assert.equal(restored?.executionSource, undefined, terminalReason);
    assert.equal(restored?.ticketRecovery, undefined, terminalReason);
    assert.equal(restored?.autoMode, false, terminalReason);
    assert.equal(restored?.autoPausedReason, expectedPause, terminalReason);
    assert.equal(restored?.autoPendingAction, undefined, terminalReason);
    assert.equal(restored?.autoLastPrompt, undefined, terminalReason);
    assert.equal(restored?.autoRetryKey, undefined, terminalReason);
    assert.equal(restored?.autoFreshPrompt, undefined, terminalReason);
    assert.equal(restored?.autoFreshReason, undefined, terminalReason);
    assert.equal(restored?.autoReviewFixKey, undefined, terminalReason);
    assert.equal(projectFallback?.autoMode, false, terminalReason);
    assert.ok(restored?.warnings.includes(expectedWarning), terminalReason);
    assert.deepEqual(restored?.ticketQueue, state.ticketQueue, terminalReason);
  }
});
