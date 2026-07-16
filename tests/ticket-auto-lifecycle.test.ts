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
