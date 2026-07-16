import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketOperationForRun } from '../extensions/workflow-monitor/auto-lifecycle.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';
import { formatTicketResultEnvelope } from '../extensions/workflow-monitor/ticket-phase-result.ts';
import { pendingAutoActionForPrompt } from '../extensions/workflow-monitor/auto-control.ts';
import { ingestTicketResult } from '../extensions/workflow-monitor/ticket-result-ingestion.ts';
import { buildTicketPrompt } from '../extensions/workflow-monitor/ticket-prompt.ts';

const claim = {
  id: 'claim-1',
  owner: 'agent',
  claimedAt: '2026-07-15T00:00:00.000Z',
};

function run(
  lifecycle: { implemented: boolean; verified: boolean; reviewed: boolean },
  lastValidatedResult?: any,
) {
  return {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#12' },
    runId: 'run-1',
    claim,
    lifecycle,
    repositoryScope: ['.'],
    ...(lastValidatedResult ? { lastValidatedResult } : {}),
  };
}

test('Ticket Auto routes BUILD through FINISH and never chooses SIMPLIFY', () => {
  assert.equal(
    ticketOperationForRun(
      run({ implemented: false, verified: false, reviewed: false }),
    ),
    'build',
  );
  assert.equal(
    ticketOperationForRun(
      run(
        { implemented: true, verified: false, reviewed: false },
        { operation: 'simplify', outcome: 'succeeded' },
      ),
    ),
    'verify',
  );
  assert.equal(
    ticketOperationForRun(
      run(
        { implemented: true, verified: true, reviewed: false },
        {
          operation: 'review',
          outcome: 'succeeded',
          reviewDisposition: { status: 'findings', count: 1 },
        },
      ),
    ),
    'fix-all',
  );
  assert.equal(
    ticketOperationForRun(
      run({ implemented: true, verified: true, reviewed: true }),
    ),
    'finish',
  );
});

test('validated Ticket results record local stats once', () => {
  const state = {
    ...createInitialWorkflowState(),
    autoMode: true,
    executionSource: 'ticket' as const,
    ticketRun: run({ implemented: true, verified: true, reviewed: false }),
  };
  const pending = pendingAutoActionForPrompt(
    '/addy-review --ticket #12',
    state,
    undefined,
    'next-action',
    '',
  );
  if (pending.executionSource !== 'ticket') assert.fail('expected ticket');
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'review',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#12' },
    runId: 'run-1',
    claimId: claim.id,
    claim,
    actionKey: pending.key,
    attempt: 0,
    postRevision: 'rev-2',
    lifecycle: { implemented: true, verified: true, reviewed: false },
    activity: { marker: `${pending.key}:0` },
    repositoryScope: ['.'],
    reviewDisposition: { status: 'findings', count: 2 },
  } as any);

  const accepted = ingestTicketResult(
    { ...state, autoPendingAction: pending },
    result,
  );
  assert.equal(accepted.status, 'accepted', accepted.state.warnings.at(-1));
  const stats = Object.values(accepted.state.stats?.active.tickets ?? {})[0];
  assert.equal(stats.reviewRuns, 1);
  assert.equal(stats.findings, 2);
  const duplicate = ingestTicketResult(accepted.state, result);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(
    Object.values(duplicate.state.stats?.active.tickets ?? {})[0].reviewRuns,
    1,
  );
});

test('Auto ambiguity contract pauses without mutation', () => {
  const prompt = buildTicketPrompt({
    operation: 'build',
    sourceKind: 'github',
    ticketRef: '#12',
    runId: 'run-1',
    claimId: claim.id,
    manual: false,
    actionKey: 'build-1',
    attempt: 0,
  });
  assert.match(prompt, /configuration-ambiguous.*perform no mutation/i);
  assert.match(prompt, /scope-expansion-required.*perform no mutation/i);
});

test('Auto scope expansion pauses with an exact durable reason and preserves the claim', () => {
  const state = {
    ...createInitialWorkflowState(),
    autoMode: true,
    executionSource: 'ticket' as const,
    ticketRun: run({ implemented: false, verified: false, reviewed: false }),
  };
  const pending = pendingAutoActionForPrompt(
    '/addy-build --ticket #12',
    state,
    undefined,
    'next-action',
    '',
  );
  if (pending.executionSource !== 'ticket') assert.fail('expected ticket');
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'build',
    outcome: 'blocked',
    blockedReason: 'scope-expansion-required',
    source: { kind: 'github', ref: '#12' },
    runId: 'run-1',
    claimId: claim.id,
    claim,
    actionKey: pending.key,
    attempt: 0,
    postRevision: 'rev-2',
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['.'],
  } as any);

  const ingestion = ingestTicketResult(
    { ...state, autoPendingAction: pending },
    result,
  );
  assert.equal(ingestion.status, 'accepted');
  assert.equal(ingestion.state.autoPausedReason, 'scope-expansion-required');
  assert.equal(ingestion.state.autoMode, false);
  assert.deepEqual(ingestion.state.ticketRun?.claim, claim);
});
