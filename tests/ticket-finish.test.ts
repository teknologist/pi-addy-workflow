import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTicketResultEnvelope,
  formatTicketResultEnvelope,
  type TicketPhaseResult,
} from '../extensions/workflow-monitor/ticket-phase-result.ts';
import { ingestTicketResult } from '../extensions/workflow-monitor/ticket-result-ingestion.ts';
import { buildTicketPrompt } from '../extensions/workflow-monitor/ticket-prompt.ts';
import { pendingAutoActionForPrompt } from '../extensions/workflow-monitor/auto-control.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';
import {
  parsePersistedWorkflowState,
  serializeWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-codec.ts';

const claim = {
  id: 'claim-1',
  owner: 'agent',
  claimedAt: '2026-07-15T00:00:00.000Z',
};
const repositories = ['/work/repo-a', '/work/repo-b'];
const recordedAt = '2026-07-15T01:00:00.000Z';
const terminal = { state: 'closed' as const, confirmedAt: recordedAt };

function finishResult(
  overrides: Partial<TicketPhaseResult> = {},
): TicketPhaseResult {
  return {
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'finish',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#11' },
    runId: 'run-1',
    claimId: claim.id,
    claim,
    actionKey: 'finish-action',
    attempt: 0,
    postRevision: 'revision-2',
    lifecycle: { implemented: true, verified: true, reviewed: true },
    activity: {
      marker: 'finish-action:0',
      id: 'comment-1',
      kind: 'final',
    },
    repositoryScope: repositories,
    commitEvidence: [
      {
        repository: repositories[0],
        result: 'committed',
        commitSha: '0123456789abcdef0123456789abcdef01234567',
        recordedAt,
      },
      { repository: repositories[1], result: 'no-changes', recordedAt },
    ],
    finishStage: 'terminal-refetch',
    terminal,
    ...overrides,
  };
}

const expectation = {
  operation: 'finish' as const,
  actionKey: 'finish-action',
  attempt: 0,
  sourceKind: 'github' as const,
  ticketRef: '#11',
  runId: 'run-1',
  claimId: claim.id,
  previousLifecycle: { implemented: true, verified: true, reviewed: true },
  previousRepositoryScope: repositories,
};

function parse(result: TicketPhaseResult, expected = expectation): void {
  extractTicketResultEnvelope(formatTicketResultEnvelope(result), expected);
}

test('FINISH accepts one confirmed committed or no-changes entry per locked repository', () => {
  assert.doesNotThrow(() => parse(finishResult()));
});

test('FINISH rejects incomplete, duplicate, unknown, malformed, and unconfirmed evidence', () => {
  const valid = finishResult().commitEvidence!;
  for (const commitEvidence of [
    [valid[0]],
    [valid[0], valid[0]],
    [valid[0], { ...valid[1], repository: '/work/repo-c' }],
    [
      { repository: repositories[0], result: 'committed', recordedAt },
      valid[1],
    ],
    [
      {
        ...valid[0],
        commitSha: 'not-a-sha',
      },
      valid[1],
    ],
    [{ ...valid[0], result: 'unconfirmed' }, valid[1]],
    [valid[0], { ...valid[1], commitSha: '0123456' }],
  ])
    assert.throws(() => parse(finishResult({ commitEvidence } as never)));
});

test('FINISH rejects missing Activity, incomplete lifecycle, or unconfirmed terminal refetch', () => {
  assert.throws(() => parse(finishResult({ activity: undefined })));
  assert.throws(() =>
    parse(
      finishResult({
        lifecycle: { implemented: true, verified: true, reviewed: false },
      }),
    ),
  );
  assert.throws(() => parse(finishResult({ terminal: undefined })));
  assert.throws(() =>
    parse(finishResult({ finishStage: 'terminal-transition' } as never)),
  );
});

test('failed partial FINISH preserves the claim and pending action for staged retry', () => {
  const run = {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#11' },
    runId: 'run-1',
    claim,
    lifecycle: {
      implemented: true,
      verified: true,
      reviewed: true,
      lastCompletedPhase: 'review' as const,
    },
    repositoryScope: repositories,
  };
  const base = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: run,
  };
  const pending = pendingAutoActionForPrompt(
    '/addy-finish --ticket #11',
    base,
    undefined,
    'next-action',
    'ignored',
  );
  assert.equal(pending.executionSource, 'ticket');
  if (pending.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  const state = {
    ...base,
    autoPendingAction: pending,
    autoLastPrompt: pending.prompt,
  };
  const partial = finishResult({
    outcome: 'failed',
    actionKey: pending.key,
    attempt: 0,
    commitEvidence: [finishResult().commitEvidence![0]],
    activity: { marker: `${pending.key}:0`, kind: 'failure' },
    finishStage: 'repository-evidence',
    terminal: undefined,
  });
  const ingestion = ingestTicketResult(
    state,
    formatTicketResultEnvelope(partial),
  );

  assert.equal(ingestion.status, 'accepted');
  assert.equal(ingestion.state.ticketRun?.claim?.id, claim.id);
  assert.deepEqual(ingestion.state.autoPendingAction, pending);
  assert.deepEqual(ingestion.state.ticketRun?.lastValidatedResult, {
    operation: 'finish',
    outcome: 'failed',
    actionKey: pending.key,
    attempt: 0,
    revision: 'revision-2',
    claimId: claim.id,
    commitEvidence: [finishResult().commitEvidence![0]],
    finishStage: 'repository-evidence',
    finishActivityKind: 'failure',
  });

  const restored = parsePersistedWorkflowState(
    serializeWorkflowState(ingestion.state),
  )!;
  assert.deepEqual(
    restored.ticketRun?.lastValidatedResult,
    ingestion.state.ticketRun?.lastValidatedResult,
  );

  const completed = ingestTicketResult(
    restored,
    formatTicketResultEnvelope(
      finishResult({
        actionKey: pending.key,
        attempt: 0,
        activity: { marker: `${pending.key}:0`, kind: 'final' },
      }),
    ),
  );
  assert.equal(completed.status, 'accepted');
  assert.equal(completed.state.ticketHistory?.length, 1);
});

test('interrupted FINISH retry rejects regressed or altered durable frontier', () => {
  const evidence = finishResult().commitEvidence!;
  const run = {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#11' },
    runId: 'run-1',
    claim,
    lifecycle: { implemented: true, verified: true, reviewed: true },
    repositoryScope: repositories,
    lastValidatedResult: {
      operation: 'finish' as const,
      outcome: 'blocked' as const,
      actionKey: 'finish-action',
      attempt: 0,
      commitEvidence: [evidence[0]],
      finishStage: 'repository-evidence' as const,
      finishActivityKind: 'failure' as const,
    },
  };
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: run,
    autoPendingAction: {
      executionSource: 'ticket' as const,
      key: 'finish-action',
      prompt: '/addy-finish --ticket #11',
      sourceKind: 'github' as const,
      ticketRef: '#11',
      runId: 'run-1',
      claimId: claim.id,
      operation: 'finish' as const,
      attemptMarker: 'attempt-0',
      reason: 'idle-retry' as const,
      attempts: 0,
      createdAt: recordedAt,
    },
  };

  if (evidence[0].result !== 'committed')
    assert.fail('expected committed evidence');
  const duplicate = finishResult({
    outcome: 'blocked',
    commitEvidence: [
      {
        recordedAt: evidence[0].recordedAt,
        commitSha: evidence[0].commitSha,
        result: evidence[0].result,
        repository: evidence[0].repository,
      },
    ],
    activity: { marker: 'finish-action:0', kind: 'failure' },
    finishStage: 'repository-evidence',
    terminal: undefined,
  });
  assert.equal(
    ingestTicketResult(state, formatTicketResultEnvelope(duplicate)).status,
    'duplicate',
  );
  for (const commitEvidence of [
    [],
    [{ ...evidence[0], recordedAt: '2026-07-15T02:00:00.000Z' }],
    [evidence[1], evidence[0]],
  ])
    assert.equal(
      ingestTicketResult(
        {
          ...state,
          ticketRun: {
            ...run,
            lastValidatedResult: {
              ...run.lastValidatedResult,
              commitEvidence:
                commitEvidence.length === 2 ? evidence : [evidence[0]],
            },
          },
        },
        formatTicketResultEnvelope(
          finishResult({
            outcome: 'failed',
            commitEvidence,
            activity: { marker: 'finish-action:0', kind: 'failure' },
            finishStage: 'repository-evidence',
            terminal: undefined,
          }),
        ),
      ).status,
      'rejected',
    );
});

test('FINISH requires completed lifecycle before final Activity regardless of outcome', () => {
  for (const finishStage of [
    'final-activity',
    'terminal-transition',
    'terminal-refetch',
  ] as const)
    assert.throws(() =>
      parse(
        finishResult({
          outcome: 'failed',
          lifecycle: { implemented: true, verified: true, reviewed: false },
          finishStage,
          terminal: undefined,
        }),
        {
          ...expectation,
          previousLifecycle: {
            implemented: true,
            verified: true,
            reviewed: false,
          },
        },
      ),
    );
});

test('interrupted FINISH stages expose exactly the completed retry frontier', () => {
  const evidence = finishResult().commitEvidence!;
  for (const result of [
    finishResult({
      outcome: 'failed',
      commitEvidence: evidence,
      activity: undefined,
      finishStage: 'repository-evidence',
      terminal: undefined,
    }),
    finishResult({
      outcome: 'failed',
      finishStage: 'final-activity',
      terminal: undefined,
    }),
    finishResult({
      outcome: 'failed',
      finishStage: 'terminal-transition',
      terminal: undefined,
    }),
    finishResult({
      outcome: 'failed',
      finishStage: 'terminal-refetch',
      terminal: undefined,
    }),
  ])
    assert.doesNotThrow(() => parse(result));

  assert.throws(() =>
    parse(
      finishResult({
        outcome: 'failed',
        finishStage: 'final-activity',
        activity: undefined,
        terminal: undefined,
      }),
    ),
  );
});

test('failure Activity cannot authorize closure', () => {
  assert.throws(() =>
    parse(
      finishResult({
        outcome: 'failed',
        activity: { marker: 'finish-action:0', kind: 'failure' },
        finishStage: 'terminal-transition',
        terminal: undefined,
      }),
    ),
  );
});

test('FINISH rejects a conflicting claim even on a failed staged result', () => {
  assert.throws(() =>
    extractTicketResultEnvelope(
      formatTicketResultEnvelope(
        finishResult({
          outcome: 'failed',
          claim: { ...claim, id: 'other-claim' },
          claimId: claim.id,
          commitEvidence: [finishResult().commitEvidence![0]],
          activity: { marker: 'finish-action:0', kind: 'failure' },
          finishStage: 'repository-evidence',
          terminal: undefined,
        }),
      ),
      { ...expectation, claim },
    ),
  );
});

test('successful terminal FINISH archives once and clears active Ticket orchestration', () => {
  const run = {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#11' },
    runId: 'run-1',
    claim,
    lifecycle: {
      implemented: true,
      verified: true,
      reviewed: true,
      lastCompletedPhase: 'review' as const,
    },
    repositoryScope: repositories,
  };
  const base = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: run,
  };
  const pending = pendingAutoActionForPrompt(
    '/addy-finish --ticket #11',
    base,
    undefined,
    'next-action',
    'ignored',
  );
  assert.equal(pending.executionSource, 'ticket');
  if (pending.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  const result = finishResult({
    actionKey: pending.key,
    attempt: 0,
    activity: {
      marker: `${pending.key}:0`,
      id: 'comment-1',
      kind: 'final',
    },
  });
  const ingestion = ingestTicketResult(
    { ...base, autoPendingAction: pending, autoLastPrompt: pending.prompt },
    formatTicketResultEnvelope(result),
  );

  assert.equal(ingestion.status, 'accepted');
  assert.equal(ingestion.state.executionSource, undefined);
  assert.equal(ingestion.state.ticketRun, undefined);
  assert.equal(ingestion.state.ticketHistory?.length, 1);
  assert.equal(
    ingestion.state.ticketHistory?.[0].lastValidatedResult?.operation,
    'finish',
  );
});

test('resolved completion clarification is archived and cleared after terminal FINISH', () => {
  const clarification = {
    kind: 'completion-transition' as const,
    prompt: 'Move this Linear ticket to Done?',
  };
  const run = {
    schemaVersion: 1 as const,
    source: { kind: 'linear' as const, ref: 'ENG-11' },
    runId: 'run-1',
    claim,
    lifecycle: {
      implemented: true,
      verified: true,
      reviewed: true,
      lastCompletedPhase: 'review' as const,
    },
    repositoryScope: repositories,
    pendingClarification: clarification,
  };
  const base = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: run,
  };
  const pending = pendingAutoActionForPrompt(
    '/addy-finish --ticket ENG-11',
    base,
    undefined,
    'next-action',
    'ignored',
  );
  if (pending.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  const result = finishResult({
    source: run.source,
    actionKey: pending.key,
    activity: { marker: `${pending.key}:0`, kind: 'final' },
    terminal: { state: 'completed', confirmedAt: recordedAt },
    clarification: { ...clarification, resolution: 'Done' },
  });
  const ingestion = ingestTicketResult(
    { ...base, autoPendingAction: pending, autoLastPrompt: pending.prompt },
    formatTicketResultEnvelope(result),
  );

  assert.equal(ingestion.status, 'accepted');
  assert.equal(
    ingestion.state.ticketHistory?.[0].pendingClarification,
    undefined,
  );
  assert.equal(
    ingestion.state.ticketHistory?.[0].lastValidatedResult?.pendingClarification
      ?.resolution,
    'Done',
  );
});

test('Ticket FINISH prompt locks commit and closure ordering to named scope', () => {
  const prompt = buildTicketPrompt({
    operation: 'finish',
    sourceKind: 'github',
    ticketRef: '#11',
    runId: 'run-1',
    claimId: claim.id,
    repositoryScope: repositories,
    manual: true,
    actionKey: 'finish-action',
    attempt: 0,
  });

  assert.match(prompt, /\/work\/repo-a/);
  assert.match(prompt, /\/work\/repo-b/);
  assert.match(prompt, /final Activity.*before.*terminal transition/is);
  assert.match(prompt, /terminal refetch/i);
  assert.match(prompt, /resume only missing stages/i);
});
