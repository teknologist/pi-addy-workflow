import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTicketResultEnvelope,
  queuePauseSummary,
  type TicketPhaseResult,
  type TicketQueueResult,
} from '../extensions/workflow-monitor/ticket-phase-result.ts';

const lifecycle = {
  implemented: true,
  verified: true,
  reviewed: false,
};

function ticketResult(
  overrides: Partial<TicketPhaseResult> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'review',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#9' },
    runId: 'run-1',
    claimId: 'claim-1',
    claim: {
      id: 'claim-1',
      owner: 'agent',
      claimedAt: '2026-07-15T00:00:00.000Z',
    },
    actionKey: 'action-1',
    attempt: 1,
    postRevision: 'rev-2',
    lifecycle,
    activity: { marker: 'action-1:1', id: 'comment-1' },
    repositoryScope: ['.'],
    reviewDisposition: { status: 'findings', count: 2 },
    ...overrides,
  };
}

function envelope(value: unknown): string {
  return `<!-- ADDY-TICKET-RESULT ${JSON.stringify(value)} -->`;
}

const expectation = {
  operation: 'review' as const,
  actionKey: 'action-1',
  attempt: 1,
  sourceKind: 'github' as const,
  ticketRef: '#9',
  runId: 'run-1',
  claimId: 'claim-1',
  previousLifecycle: { implemented: true, verified: true, reviewed: false },
  previousRepositoryScope: ['.'],
};

test('extracts exactly one strict ticket result envelope', () => {
  const result = extractTicketResultEnvelope(
    `Narrative is ignored.\n${envelope(ticketResult())}`,
    expectation,
  );
  assert.equal(result.kind, 'ticket-phase-result');
  assert.equal(result.operation, 'review');
});

test('missing, duplicate, malformed, unknown, stale, and mismatched envelopes fail closed', () => {
  assert.throws(() => extractTicketResultEnvelope('success', expectation));
  assert.throws(() =>
    extractTicketResultEnvelope(
      `${envelope(ticketResult())}\n${envelope(ticketResult())}`,
      expectation,
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      '<!-- ADDY-TICKET-RESULT {nope} -->',
      expectation,
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ extra: true } as never)),
      expectation,
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ actionKey: 'old' } as never)),
      expectation,
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(
        ticketResult({ source: { kind: 'github', ref: '#10' } } as never),
      ),
      expectation,
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ operation: 'verify' } as never)),
      expectation,
    ),
  );
});

test('forbids narrative and sensitive payload fields or content', () => {
  for (const forbidden of [
    'body',
    'comments',
    'prompt',
    'logs',
    'token',
    'secret',
  ])
    assert.throws(() =>
      extractTicketResultEnvelope(
        envelope(ticketResult({ [forbidden]: 'leak' } as never)),
        expectation,
      ),
    );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ postRevision: 'line one\nline two' } as never)),
      expectation,
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ postRevision: 'Bearer abc' } as never)),
      expectation,
    ),
  );
});

test('review disposition is structured and owns only Reviewed', () => {
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(
        ticketResult({ reviewDisposition: { status: 'clean' } } as never),
      ),
      expectation,
    ),
  );
  const clean = ticketResult({
    lifecycle: { ...lifecycle, reviewed: true },
    reviewDisposition: { status: 'clean' },
  } as never);
  assert.equal(
    extractTicketResultEnvelope(envelope(clean), expectation).kind,
    'ticket-phase-result',
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(
        ticketResult({
          lifecycle: { implemented: false, verified: true, reviewed: false },
        } as never),
      ),
      expectation,
    ),
  );
});

test('blocked and failed REVIEW preserve lifecycle without disposition consistency', () => {
  for (const outcome of ['blocked', 'failed'] as const) {
    for (const reviewDisposition of [
      undefined,
      { status: 'clean' as const },
      { status: 'findings' as const, count: 1 },
    ]) {
      const result = ticketResult({
        outcome,
        lifecycle: { implemented: true, verified: true, reviewed: true },
        reviewDisposition,
      } as never);
      assert.equal(
        extractTicketResultEnvelope(envelope(result), {
          ...expectation,
          previousLifecycle: {
            implemented: true,
            verified: true,
            reviewed: true,
          },
        }).kind,
        'ticket-phase-result',
      );
    }
    assert.throws(() =>
      extractTicketResultEnvelope(
        envelope(ticketResult({ outcome } as never)),
        {
          ...expectation,
          previousLifecycle: {
            implemented: true,
            verified: true,
            reviewed: true,
          },
        },
      ),
    );
  }
});

test('successful lifecycle operations require their exact postcondition and never regress', () => {
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(
        ticketResult({
          operation: 'verify',
          lifecycle: { implemented: true, verified: false, reviewed: false },
          reviewDisposition: undefined,
        } as never),
      ),
      { ...expectation, operation: 'verify' },
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(
        ticketResult({
          outcome: 'failed',
          lifecycle: { implemented: true, verified: true, reviewed: true },
          reviewDisposition: { status: 'clean' },
        } as never),
      ),
      expectation,
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(
        ticketResult({
          lifecycle: { implemented: true, verified: false, reviewed: false },
          reviewDisposition: { status: 'findings', count: 1 },
        } as never),
      ),
      {
        ...expectation,
        previousLifecycle: {
          implemented: true,
          verified: true,
          reviewed: true,
        },
      },
    ),
  );
});

test('repository scope is immutable outside approval and FINISH evidence is exact and unique', () => {
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ repositoryScope: ['.', 'extra'] } as never)),
      expectation,
    ),
  );

  const approval = ticketResult({
    operation: 'repository-scope-approval',
    repository: 'extra',
    reviewDisposition: undefined,
    repositoryScope: ['.', 'extra'],
  } as never);
  const approvalExpectation = {
    ...expectation,
    operation: 'repository-scope-approval' as const,
    repository: 'extra',
  };
  assert.equal(
    extractTicketResultEnvelope(envelope(approval), approvalExpectation).kind,
    'ticket-phase-result',
  );
  for (const repositoryScope of [
    ['extra'],
    ['replacement', '.'],
    ['.', 'extra', 'other'],
    ['.', 'other'],
  ])
    assert.throws(() =>
      extractTicketResultEnvelope(
        envelope(ticketResult({ ...approval, repositoryScope } as never)),
        approvalExpectation,
      ),
    );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ ...approval, repository: 'other' } as never)),
      approvalExpectation,
    ),
  );

  const finish = ticketResult({
    operation: 'finish',
    lifecycle: { implemented: true, verified: true, reviewed: true },
    reviewDisposition: undefined,
    repositoryScope: ['.', 'extra'],
    commitEvidence: [
      { repository: '.', commit: 'abc' },
      { repository: 'extra', commit: 'def' },
    ],
  } as never);
  const finishExpectation = {
    ...expectation,
    operation: 'finish' as const,
    previousLifecycle: {
      implemented: true,
      verified: true,
      reviewed: true,
    },
    previousRepositoryScope: ['.', 'extra'],
  };
  assert.equal(
    extractTicketResultEnvelope(envelope(finish), finishExpectation).kind,
    'ticket-phase-result',
  );
  for (const outcome of ['succeeded', 'reconciled'] as const)
    for (const incompleteLifecycle of [
      { implemented: false, verified: false, reviewed: false },
      { implemented: true, verified: false, reviewed: false },
      { implemented: true, verified: true, reviewed: false },
    ])
      assert.throws(() =>
        extractTicketResultEnvelope(
          envelope(
            ticketResult({
              ...finish,
              outcome,
              lifecycle: incompleteLifecycle,
            } as never),
          ),
          { ...finishExpectation, previousLifecycle: incompleteLifecycle },
        ),
      );
  for (const commitEvidence of [
    [{ repository: '.', commit: 'abc' }],
    [
      { repository: '.', commit: 'abc' },
      { repository: '.', commit: 'def' },
    ],
    [
      { repository: '.', commit: 'abc' },
      { repository: 'other', commit: 'def' },
    ],
  ])
    assert.throws(() =>
      extractTicketResultEnvelope(
        envelope(ticketResult({ ...finish, commitEvidence } as never)),
        finishExpectation,
      ),
    );
});

test('status carries an authoritative claimed or unclaimed snapshot', () => {
  const claimed = extractTicketResultEnvelope(
    envelope(ticketResult()),
    expectation,
  );
  assert.equal(claimed.kind, 'ticket-phase-result');
  assert.equal(claimed.claim?.id, 'claim-1');

  const status = ticketResult({
    operation: 'status',
    runId: undefined,
    claimId: undefined,
    claim: null,
    activity: undefined,
    reviewDisposition: undefined,
  } as never);
  delete status.runId;
  delete status.claimId;
  delete status.activity;
  delete status.reviewDisposition;
  const result = extractTicketResultEnvelope(envelope(status), {
    operation: 'status',
    actionKey: 'action-1',
    attempt: 1,
    sourceKind: 'github',
    ticketRef: '#9',
  });
  assert.equal(result.kind, 'ticket-phase-result');
  assert.equal(result.claim, null);

  const missing = ticketResult();
  delete missing.claim;
  assert.throws(() =>
    extractTicketResultEnvelope(envelope(missing), expectation),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ claim: { id: 'claim-1' } } as never)),
      expectation,
    ),
  );
});

test('activity evidence is bound to the expected action and attempt', () => {
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ activity: { marker: 'old-action:1' } } as never)),
      expectation,
    ),
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(ticketResult({ activity: { marker: 'action-1:0' } } as never)),
      expectation,
    ),
  );
});

test('lost-envelope reconciliation is bound to the expected operation', () => {
  const reconciled = ticketResult({ outcome: 'reconciled' } as never);
  assert.equal(
    extractTicketResultEnvelope(envelope(reconciled), expectation).outcome,
    'reconciled',
  );
  assert.throws(() =>
    extractTicketResultEnvelope(
      envelope(
        ticketResult({ outcome: 'reconciled', operation: 'build' } as never),
      ),
      expectation,
    ),
  );
});

test('empty and mixed queue results retain categories and deterministic summaries', () => {
  const empty = {
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'blocked',
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label', value: 'ready-for-agent' },
    categories: {
      eligible: { count: 0, refs: [] },
      blocked: { count: 0, refs: [] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 0, refs: [] },
    },
    terminalReason: 'empty',
  };
  const parsedEmpty = extractTicketResultEnvelope(envelope(empty), {
    operation: 'select',
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label', value: 'ready-for-agent' },
  });
  assert.equal(parsedEmpty.kind, 'ticket-queue-result');
  assert.equal(queuePauseSummary(parsedEmpty), 'Ticket queue is empty.');
  assert.equal('source' in parsedEmpty, false);
  assert.equal('claimId' in parsedEmpty, false);

  const mixed = structuredClone(empty) as TicketQueueResult;
  mixed.outcome = 'blocked';
  mixed.categories.blocked = { count: 1, refs: ['#1'] };
  mixed.categories.claimed = { count: 1, refs: ['#2'] };
  mixed.categories.ineligible = { count: 1, refs: ['#3'] };
  mixed.terminalReason = 'mixed';
  const parsedMixed = extractTicketResultEnvelope(envelope(mixed), {
    operation: 'select',
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label', value: 'ready-for-agent' },
  });
  assert.equal(parsedMixed.kind, 'ticket-queue-result');
  assert.equal(
    queuePauseSummary(parsedMixed),
    'Ticket queue paused: 1 blocked, 1 claimed, 1 ineligible, 0 ambiguous.',
  );
});

test('queue rejects successful terminal results without a selection and duplicate refs across categories', () => {
  const queue: TicketQueueResult = {
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'succeeded',
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label', value: 'ready-for-agent' },
    categories: {
      eligible: { count: 0, refs: [] },
      blocked: { count: 0, refs: [] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 0, refs: [] },
    },
    terminalReason: 'empty',
  };
  const expected = {
    operation: 'select' as const,
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label' as const, value: 'ready-for-agent' },
  };
  for (const outcome of ['succeeded', 'reconciled'] as const) {
    queue.outcome = outcome;
    assert.throws(() => extractTicketResultEnvelope(envelope(queue), expected));
  }

  queue.outcome = 'blocked';
  queue.categories.blocked = { count: 1, refs: ['#9'] };
  queue.categories.claimed = { count: 1, refs: ['#9'] };
  queue.terminalReason = 'mixed';
  assert.throws(() => extractTicketResultEnvelope(envelope(queue), expected));
});

test('result expectations require only their operation identity fields', () => {
  const queue = {
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'blocked',
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label', value: 'ready-for-agent' },
    categories: {
      eligible: { count: 0, refs: [] },
      blocked: { count: 0, refs: [] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 0, refs: [] },
    },
    terminalReason: 'empty',
  };
  const queueExpectation = {
    operation: 'select' as const,
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label' as const, value: 'ready-for-agent' },
  };
  assert.equal(
    extractTicketResultEnvelope(envelope(queue), queueExpectation).kind,
    'ticket-queue-result',
  );
  for (const expected of [
    { ...queueExpectation, selector: undefined },
    { ...queueExpectation, repository: '/other' },
  ])
    assert.throws(() =>
      extractTicketResultEnvelope(envelope(queue), expected as never),
    );

  for (const expected of [
    { ...expectation, selector: queueExpectation.selector },
    { ...expectation, repository: '/other' },
  ])
    assert.throws(() =>
      extractTicketResultEnvelope(envelope(ticketResult()), expected as never),
    );

  const repositoryResult = ticketResult({
    operation: 'add-repository',
    repository: '/other',
    reviewDisposition: undefined,
  } as never);
  assert.throws(() =>
    extractTicketResultEnvelope(envelope(repositoryResult), {
      ...expectation,
      operation: 'add-repository',
    }),
  );
});

test('queue selects eligible first and ambiguity has next precedence', () => {
  const selected = {
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'succeeded',
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label', value: 'ready-for-agent' },
    categories: {
      eligible: { count: 1, refs: ['#2'] },
      blocked: { count: 1, refs: ['#1'] },
      claimed: { count: 0, refs: [] },
      ineligible: { count: 0, refs: [] },
      ambiguous: { count: 1, refs: ['#3'] },
    },
    selected: { source: { kind: 'github', ref: '#2' } },
    terminalReason: 'selected',
  };
  const queueExpectation = {
    operation: 'select' as const,
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label' as const, value: 'ready-for-agent' },
  };
  const parsed = extractTicketResultEnvelope(
    envelope(selected),
    queueExpectation,
  );
  for (const selector of [
    { kind: 'status', value: 'ready-for-agent' },
    { kind: 'label', value: 'other' },
  ])
    assert.throws(() =>
      extractTicketResultEnvelope(
        envelope({ ...selected, selector }),
        queueExpectation,
      ),
    );
  assert.equal(parsed.kind, 'ticket-queue-result');
  assert.equal(queuePauseSummary(parsed), 'Selected Ticket #2.');
  assert.throws(() =>
    extractTicketResultEnvelope(envelope(selected), {
      operation: 'select',
      actionKey: 'queue-1',
      attempt: 0,
      selector: { kind: 'label', value: 'ready-for-agent' },
      sourceKind: 'linear',
    }),
  );

  delete (selected as { selected?: unknown }).selected;
  selected.categories.eligible = { count: 0, refs: [] };
  selected.terminalReason = 'configuration-ambiguous';
  selected.outcome = 'failed';
  const ambiguous = extractTicketResultEnvelope(envelope(selected), {
    operation: 'select',
    actionKey: 'queue-1',
    attempt: 0,
    selector: { kind: 'label', value: 'ready-for-agent' },
  });
  assert.equal(ambiguous.kind, 'ticket-queue-result');
  assert.match(queuePauseSummary(ambiguous), /configuration ambiguity/);
});
