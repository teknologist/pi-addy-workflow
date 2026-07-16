import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTicketResultEnvelope,
  formatTicketResultEnvelope,
  type TicketPhaseResult,
} from '../extensions/workflow-monitor/ticket-phase-result.ts';

function result(
  operation: TicketPhaseResult['operation'],
  lifecycle: TicketPhaseResult['lifecycle'],
  extra: Partial<TicketPhaseResult> = {},
): TicketPhaseResult {
  return {
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation,
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#10' },
    runId: 'run-1',
    claimId: 'claim-1',
    claim: {
      id: 'claim-1',
      owner: 'agent',
      claimedAt: '2026-07-15T00:00:00.000Z',
    },
    actionKey: `${operation}-1`,
    attempt: 0,
    postRevision: '2',
    lifecycle,
    repositoryScope: ['/repo'],
    activity: { marker: `${operation}-1:0` },
    ...extra,
  };
}

test('manual lifecycle result gates preserve exclusive checkbox ownership', () => {
  const previous = { implemented: true, verified: false, reviewed: false };
  assert.throws(
    () =>
      extractTicketResultEnvelope(
        formatTicketResultEnvelope(
          result('simplify', {
            implemented: true,
            verified: true,
            reviewed: false,
          }),
        ),
        {
          operation: 'simplify',
          actionKey: 'simplify-1',
          attempt: 0,
          previousLifecycle: previous,
        },
      ),
    /cannot change Ticket lifecycle verified/,
  );
  assert.throws(
    () =>
      extractTicketResultEnvelope(
        formatTicketResultEnvelope(
          result(
            'review',
            { implemented: true, verified: true, reviewed: true },
            { reviewDisposition: { status: 'findings', count: 1 } },
          ),
        ),
        {
          operation: 'review',
          actionKey: 'review-1',
          attempt: 0,
          previousLifecycle: {
            implemented: true,
            verified: true,
            reviewed: false,
          },
        },
      ),
    /disposition conflicts/,
  );
});

test('post-fix VERIFY may re-prove an already verified Ticket without changing other statuses', () => {
  const lifecycle = { implemented: true, verified: true, reviewed: false };
  assert.doesNotThrow(() =>
    extractTicketResultEnvelope(
      formatTicketResultEnvelope(result('verify', lifecycle)),
      {
        operation: 'verify',
        actionKey: 'verify-1',
        attempt: 0,
        previousLifecycle: lifecycle,
      },
    ),
  );
});
