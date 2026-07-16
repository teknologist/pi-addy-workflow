import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketAutoWorkflowActionKey } from '../extensions/workflow-monitor/auto-action-keys.ts';
import { pendingAutoActionForPrompt } from '../extensions/workflow-monitor/auto-control.ts';
import { formatTicketResultEnvelope } from '../extensions/workflow-monitor/ticket-phase-result.ts';
import { ingestTicketResult } from '../extensions/workflow-monitor/ticket-result-ingestion.ts';
import {
  parsePersistedWorkflowState,
  serializeWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-codec.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

function pending(
  operation:
    | 'select'
    | 'status'
    | 'claim'
    | 'release'
    | 'reclaim'
    | 'add-repository'
    | 'repository-scope-approval',
  ticketRef: string,
  claimId?: string,
  repository?: string,
) {
  const attemptMarker = 'attempt-1';
  return {
    executionSource: 'ticket' as const,
    key: ticketAutoWorkflowActionKey(
      {
        source: 'ticket',
        sourceKind: 'github',
        ticketRef,
        runId: 'run-1',
        ...(claimId ? { claimId } : {}),
        ...(operation === 'select'
          ? { selector: { kind: 'label' as const, value: ticketRef } }
          : {}),
        ...(repository ? { repository } : {}),
      },
      operation,
      attemptMarker,
    ),
    prompt: `/addy-ticket ${operation} ${ticketRef}`,
    sourceKind: 'github' as const,
    ticketRef,
    runId: 'run-1',
    ...(claimId ? { claimId } : {}),
    ...(repository ? { repository } : {}),
    ...(operation === 'select'
      ? { selector: { kind: 'label' as const, value: ticketRef } }
      : {}),
    operation,
    attemptMarker,
    reason: 'next-action' as const,
    attempts: 1,
    createdAt: '2026-07-15T00:00:00.000Z',
  };
}

test('successful Queue selection persists the selected Ticket run identity', () => {
  const action = pending('select', 'ready-for-agent');
  const state = {
    ...createInitialWorkflowState(),
    autoMode: true,
    executionSource: 'ticket' as const,
    autoPendingAction: action,
  };
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'succeeded',
    actionKey: action.key,
    attempt: 1,
    selector: { kind: 'label', value: 'ready-for-agent' },
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
  const ingestion = ingestTicketResult(state, result, '/work/owner');
  assert.equal(ingestion.status, 'accepted');
  assert.deepEqual(ingestion.state.ticketRun, {
    schemaVersion: 1,
    source: { kind: 'github', ref: '#9' },
    runId: 'run-1',
    repositoryRoot: '/work/owner',
    queueSelector: { kind: 'label', value: 'ready-for-agent' },
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['.'],
    lastValidatedResult: {
      operation: 'select',
      outcome: 'succeeded',
      actionKey: action.key,
      attempt: 1,
    },
  });
  assert.equal(ingestion.state.autoPendingAction, undefined);

  const duplicate = ingestTicketResult(ingestion.state, result);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.state, ingestion.state);
  assert.equal(
    duplicate.state.warnings.length,
    ingestion.state.warnings.length,
  );
});

test('Queue duplicate rejects altered persisted identity', () => {
  const action = pending('select', 'ready-for-agent');
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    autoPendingAction: action,
  };
  const result = {
    schemaVersion: 1 as const,
    kind: 'ticket-queue-result' as const,
    operation: 'select' as const,
    outcome: 'succeeded' as const,
    actionKey: action.key,
    attempt: 1,
    selector: { kind: 'label' as const, value: 'ready-for-agent' },
    categories: {
      eligible: { count: 1, refs: ['#9'] },
      blocked: { count: 0, refs: [] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 0, refs: [] },
    },
    selected: { source: { kind: 'github' as const, ref: '#9' } },
    terminalReason: 'selected' as const,
  };
  const accepted = ingestTicketResult(
    state,
    formatTicketResultEnvelope(result),
  );
  const persisted = parsePersistedWorkflowState(
    serializeWorkflowState(accepted.state),
  )!;

  assert.equal(
    ingestTicketResult(
      persisted,
      formatTicketResultEnvelope({
        ...result,
        selected: { source: { kind: 'github', ref: '#10' } },
        categories: {
          ...result.categories,
          eligible: { count: 1, refs: ['#10'] },
        },
      }),
    ).status,
    'rejected',
  );
  assert.equal(
    ingestTicketResult(
      persisted,
      formatTicketResultEnvelope({ ...result, outcome: 'reconciled' }),
    ).status,
    'rejected',
  );
});

test('Queue ingestion does not require an active Ticket run and persists terminal state', () => {
  const action = pending('select', 'ready-for-agent');
  const state = {
    ...createInitialWorkflowState(),
    autoMode: true,
    executionSource: 'ticket' as const,
    autoPendingAction: action,
  };
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'blocked',
    actionKey: action.key,
    attempt: 1,
    selector: { kind: 'label', value: 'ready-for-agent' },
    categories: {
      eligible: { count: 0, refs: [] },
      blocked: { count: 1, refs: ['#9'] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 0, refs: [] },
    },
    terminalReason: 'all-blocked',
  });
  const ingestion = ingestTicketResult(state, result);
  assert.equal(ingestion.status, 'accepted');
  assert.equal(ingestion.state.autoMode, false);
  assert.equal(ingestion.state.autoPausedReason, 'ticket-operation-blocked');
  assert.equal(ingestion.state.autoPendingAction, undefined);
  assert.match(ingestion.state.warnings.at(-1) ?? '', /1 blocked/);
});

test('successful Queue result without a selection is rejected without advancing Auto', () => {
  const action = pending('select', 'ready-for-agent');
  const state = {
    ...createInitialWorkflowState(),
    autoMode: true,
    executionSource: 'ticket' as const,
    autoPendingAction: action,
  };
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'reconciled',
    actionKey: action.key,
    attempt: 1,
    selector: { kind: 'label', value: 'ready-for-agent' },
    categories: {
      eligible: { count: 0, refs: [] },
      blocked: { count: 0, refs: [] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 0, refs: [] },
    },
    terminalReason: 'empty',
  });
  const ingestion = ingestTicketResult(state, result);
  assert.equal(ingestion.status, 'rejected');
  assert.equal(ingestion.state.autoMode, true);
  assert.equal(ingestion.state.autoPendingAction, action);
});

test('Queue selector is bound to the pending selection', () => {
  const action = pending('select', 'ready-for-agent');
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    autoPendingAction: action,
  };
  const base = {
    schemaVersion: 1 as const,
    kind: 'ticket-queue-result' as const,
    operation: 'select' as const,
    outcome: 'blocked' as const,
    actionKey: action.key,
    attempt: 1,
    categories: {
      eligible: { count: 0, refs: [] },
      blocked: { count: 0, refs: [] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 0, refs: [] },
    },
    terminalReason: 'empty' as const,
  };
  for (const selector of [
    { kind: 'status' as const, value: 'ready-for-agent' },
    { kind: 'label' as const, value: 'other' },
  ])
    assert.equal(
      ingestTicketResult(
        state,
        formatTicketResultEnvelope({ ...base, selector }),
      ).status,
      'rejected',
    );
});

test('repository request and approval stay bound to the normalized repository', () => {
  const repository = '/repo/extra';
  const claimId = 'claim-1';
  const run = {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#9' },
    runId: 'run-1',
    claim: {
      id: claimId,
      owner: 'agent',
      claimedAt: '2026-07-15T00:00:00.000Z',
    },
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['/repo'],
  };
  const resultFor = (
    action: ReturnType<typeof pending>,
    operation: 'add-repository' | 'repository-scope-approval',
    repositoryScope: string[],
  ) =>
    formatTicketResultEnvelope({
      schemaVersion: 1,
      kind: 'ticket-phase-result',
      operation,
      outcome: 'succeeded',
      source: run.source,
      runId: run.runId,
      claimId,
      claim: run.claim,
      repository,
      actionKey: action.key,
      attempt: 1,
      postRevision: `rev-${operation}`,
      lifecycle: run.lifecycle,
      activity: { marker: `${action.key}:1` },
      repositoryScope,
    });

  const request = pending('add-repository', '#9', claimId, repository);
  const requested = ingestTicketResult(
    {
      ...createInitialWorkflowState(),
      executionSource: 'ticket' as const,
      autoPendingAction: request,
      ticketRun: run,
    },
    resultFor(request, 'add-repository', ['/repo']),
  );
  assert.equal(requested.status, 'accepted');
  assert.deepEqual(requested.state.ticketRun?.pendingScopeRequest, {
    repository,
  });

  const approval = pending(
    'repository-scope-approval',
    '#9',
    claimId,
    repository,
  );
  const approved = ingestTicketResult(
    {
      ...requested.state,
      autoPendingAction: approval,
    },
    resultFor(approval, 'repository-scope-approval', ['/repo', repository]),
  );
  assert.equal(approved.status, 'accepted');
  assert.equal(approved.state.ticketRun?.pendingScopeRequest, undefined);

  const persistedApproval = parsePersistedWorkflowState(
    serializeWorkflowState(approved.state),
  )!;
  const duplicate = ingestTicketResult(
    persistedApproval,
    resultFor(approval, 'repository-scope-approval', ['/repo', repository]),
  );
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.state, persistedApproval);
});

test('unclaimed STATUS ingestion does not require an active Ticket run', () => {
  const action = pending('status', '#9');
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    autoPendingAction: action,
  };
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'status',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#9' },
    runId: 'run-1',
    claim: null,
    actionKey: action.key,
    attempt: 1,
    postRevision: 'rev-1',
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['repo'],
  });
  const ingestion = ingestTicketResult(state, result);
  assert.equal(ingestion.status, 'accepted');
  assert.equal(ingestion.state.ticketRun?.source.ref, '#9');
  assert.equal(ingestion.state.ticketRun?.claim, undefined);
  assert.equal(ingestion.state.ticketRun?.revision, 'rev-1');
  assert.equal(ingestion.state.autoPendingAction, undefined);
});

test('claim and release apply the authoritative claim snapshot', () => {
  const originalClaim = {
    id: 'claim-old',
    owner: 'old-agent',
    claimedAt: '2026-07-14T00:00:00.000Z',
  };
  const nextClaim = {
    id: 'claim-new',
    owner: 'agent',
    claimedAt: '2026-07-15T00:00:00.000Z',
  };

  for (const operation of ['claim', 'release'] as const)
    for (const outcome of ['succeeded', 'reconciled'] as const) {
      const claimId = operation === 'release' ? originalClaim.id : nextClaim.id;
      const action = pending(operation, '#9', claimId);
      const state = {
        ...createInitialWorkflowState(),
        executionSource: 'ticket' as const,
        autoPendingAction: action,
        ticketRun: {
          schemaVersion: 1 as const,
          source: { kind: 'github' as const, ref: '#9' },
          runId: 'run-1',
          ...(operation === 'claim' ? {} : { claim: originalClaim }),
          lifecycle: { implemented: false, verified: false, reviewed: false },
          repositoryScope: ['repo'],
        },
      };
      const claim = operation === 'release' ? null : nextClaim;
      const result = formatTicketResultEnvelope({
        schemaVersion: 1,
        kind: 'ticket-phase-result',
        operation,
        outcome,
        source: { kind: 'github', ref: '#9' },
        runId: 'run-1',
        claimId,
        claim,
        actionKey: action.key,
        attempt: 1,
        postRevision: `rev-${operation}`,
        lifecycle: { implemented: false, verified: false, reviewed: false },
        activity: { marker: `${action.key}:1` },
        repositoryScope: ['repo'],
      });
      const ingestion = ingestTicketResult(state, result);
      assert.equal(ingestion.status, 'accepted');
      assert.deepEqual(ingestion.state.ticketRun?.claim, claim ?? undefined);
    }
});

test('phase duplicate rejects altered operation, source, claim, repository, or outcome', () => {
  const repository = '/repo/extra';
  const claim = {
    id: 'claim-1',
    owner: 'agent',
    claimedAt: '2026-07-15T00:00:00.000Z',
  };
  const action = pending(
    'repository-scope-approval',
    '#9',
    claim.id,
    repository,
  );
  const result = {
    schemaVersion: 1 as const,
    kind: 'ticket-phase-result' as const,
    operation: 'repository-scope-approval' as const,
    outcome: 'succeeded' as const,
    source: { kind: 'github' as const, ref: '#9' },
    runId: 'run-1',
    claimId: claim.id,
    claim,
    repository,
    actionKey: action.key,
    attempt: 1,
    postRevision: 'rev-approved',
    lifecycle: { implemented: false, verified: false, reviewed: false },
    activity: { marker: `${action.key}:1` },
    repositoryScope: ['/repo', repository],
  };
  const accepted = ingestTicketResult(
    {
      ...createInitialWorkflowState(),
      executionSource: 'ticket' as const,
      autoPendingAction: action,
      ticketRun: {
        schemaVersion: 1 as const,
        source: result.source,
        runId: result.runId,
        claim,
        lifecycle: result.lifecycle,
        repositoryScope: ['/repo'],
        pendingScopeRequest: { repository },
      },
    },
    formatTicketResultEnvelope(result),
  );
  const persisted = parsePersistedWorkflowState(
    serializeWorkflowState(accepted.state),
  )!;
  const altered = [
    { ...result, operation: 'add-repository' as const },
    { ...result, source: { kind: 'github' as const, ref: '#10' } },
    { ...result, claim: { ...claim, owner: 'other-agent' } },
    { ...result, repository: '/repo/other' },
    { ...result, outcome: 'reconciled' as const },
  ];

  for (const envelope of altered)
    assert.equal(
      ingestTicketResult(persisted, formatTicketResultEnvelope(envelope))
        .status,
      'rejected',
    );
  assert.equal(
    ingestTicketResult(persisted, formatTicketResultEnvelope(result)).status,
    'duplicate',
  );
});

test('persisted RECLAIM transfers a stale claim to its replacement end to end', () => {
  const staleClaim = {
    id: 'claim-old',
    owner: 'old-agent',
    claimedAt: '2026-07-14T00:00:00.000Z',
  };
  const replacementClaim = {
    id: 'claim-new',
    owner: 'new-agent',
    claimedAt: '2026-07-15T00:00:00.000Z',
  };
  const ticketRun = {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#9' },
    runId: 'run-1',
    claim: staleClaim,
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['repo'],
  };
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun,
  };
  const action = pendingAutoActionForPrompt(
    '/addy-ticket reclaim #9',
    state,
    undefined,
    'next-action',
    'ignored',
  );
  assert.equal(action.executionSource, 'ticket');
  assert.equal(action.staleClaimId, staleClaim.id);
  assert.ok(action.claimId);

  const persisted = parsePersistedWorkflowState(
    serializeWorkflowState({ ...state, autoPendingAction: action }),
  )!;
  assert.deepEqual(persisted.autoPendingAction, action);

  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'reclaim',
    outcome: 'succeeded',
    source: ticketRun.source,
    runId: ticketRun.runId,
    staleClaimId: staleClaim.id,
    claimId: action.claimId,
    claim: { ...replacementClaim, id: action.claimId },
    actionKey: action.key,
    attempt: 0,
    postRevision: 'rev-reclaimed',
    lifecycle: ticketRun.lifecycle,
    activity: { marker: `${action.key}:0` },
    repositoryScope: ticketRun.repositoryScope,
  });
  const ingestion = ingestTicketResult(persisted, result);
  assert.equal(ingestion.status, 'accepted');
  assert.deepEqual(ingestion.state.ticketRun?.claim, {
    ...replacementClaim,
    id: action.claimId,
  });

  const persistedReclaim = parsePersistedWorkflowState(
    serializeWorkflowState(ingestion.state),
  )!;
  const duplicate = ingestTicketResult(persistedReclaim, result);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.state, persistedReclaim);
});

test('RECLAIM rejects a replacement claim identity mismatch', () => {
  const staleClaim = {
    id: 'claim-old',
    owner: 'old-agent',
    claimedAt: '2026-07-14T00:00:00.000Z',
  };
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: '#9' },
      runId: 'run-1',
      claim: staleClaim,
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: ['repo'],
    },
  };
  const action = pendingAutoActionForPrompt(
    '/addy-ticket reclaim #9',
    state,
    undefined,
    'next-action',
    'ignored',
  );
  assert.equal(action.executionSource, 'ticket');
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'reclaim',
    outcome: 'succeeded',
    source: state.ticketRun.source,
    runId: state.ticketRun.runId,
    staleClaimId: staleClaim.id,
    claimId: 'different-replacement',
    claim: {
      id: 'different-replacement',
      owner: 'new-agent',
      claimedAt: '2026-07-15T00:00:00.000Z',
    },
    actionKey: action.key,
    attempt: 0,
    postRevision: 'rev-reclaimed',
    lifecycle: state.ticketRun.lifecycle,
    activity: { marker: `${action.key}:0` },
    repositoryScope: state.ticketRun.repositoryScope,
  });

  assert.equal(
    ingestTicketResult({ ...state, autoPendingAction: action }, result).status,
    'rejected',
  );
});

test('persisted partial RECLAIM retry keeps the exact replacement claim identity', () => {
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: '#9' },
      runId: 'run-1',
      claim: {
        id: 'claim-old',
        owner: 'old-agent',
        claimedAt: '2026-07-14T00:00:00.000Z',
      },
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: ['repo'],
    },
  };
  const first = pendingAutoActionForPrompt(
    '/addy-ticket reclaim #9',
    state,
    undefined,
    'next-action',
    'ignored',
  );
  const persisted = parsePersistedWorkflowState(
    serializeWorkflowState({ ...state, autoPendingAction: first }),
  )!;
  const retry = pendingAutoActionForPrompt(
    first.prompt,
    persisted,
    undefined,
    'idle-retry',
    'ignored',
  );

  assert.equal(first.executionSource, 'ticket');
  assert.ok(first.claimId);
  assert.equal(retry.executionSource, 'ticket');
  assert.equal(retry.staleClaimId, first.staleClaimId);
  assert.equal(retry.claimId, first.claimId);
  assert.equal(retry.key, first.key);
  assert.equal(retry.attemptMarker, first.attemptMarker);
});
