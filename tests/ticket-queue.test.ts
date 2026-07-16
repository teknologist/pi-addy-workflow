import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketPrompt } from '../extensions/workflow-monitor/ticket-prompt.ts';
import { pendingAutoActionForPrompt } from '../extensions/workflow-monitor/auto-control.ts';
import { formatTicketResultEnvelope } from '../extensions/workflow-monitor/ticket-phase-result.ts';
import { ingestTicketResult } from '../extensions/workflow-monitor/ticket-result-ingestion.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

const selector = { kind: 'label' as const, value: 'team-ready' };

test('queue prompt defines one deterministic source-neutral frontier', () => {
  const prompt = buildTicketPrompt({
    operation: 'select',
    selector,
    actionKey: 'select-1',
    attempt: 0,
  });

  assert.match(prompt, /resolve the configured ready-for-agent mapping/i);
  assert.match(prompt, /oldest unblocked eligible/i);
  assert.match(prompt, /numeric prefix.*path fallback/i);
  assert.match(prompt, /open.*objective.*acceptance criteri(?:on|a).*blocker/i);
  assert.match(prompt, /closed.*pull request.*claimed.*malformed.*blocked/i);
  assert.match(prompt, /classify every (?:matching )?candidate/i);
  assert.match(prompt, /read-only/i);
});

test('duplicate selections are scoped to drain ID plus tracker and ref', () => {
  const completedRun = {
    schemaVersion: 1 as const,
    source: { kind: 'github' as const, ref: '#1' },
    runId: 'old-run',
    queueSelector: selector,
    queueDrainId: 'drain-a',
    lifecycle: { implemented: true, verified: true, reviewed: true },
    repositoryScope: ['.'],
    lastValidatedResult: {
      operation: 'finish' as const,
      outcome: 'succeeded' as const,
      actionKey: 'finish-old',
      attempt: 0,
      commitEvidence: [
        {
          repository: '.',
          result: 'no-changes' as const,
          recordedAt: '2026-07-15T00:00:00.000Z',
        },
      ],
      finishStage: 'terminal-refetch' as const,
      finishActivityKind: 'final' as const,
      terminal: {
        state: 'closed' as const,
        confirmedAt: '2026-07-15T00:00:00.000Z',
      },
    },
  };

  for (const [name, drainId, source, expectedStatus] of [
    [
      'same drain',
      'drain-a',
      { kind: 'github' as const, ref: '#1' },
      'rejected',
    ],
    [
      'cross tracker',
      'drain-a',
      { kind: 'linear' as const, ref: '#1' },
      'accepted',
    ],
    [
      'new drain',
      'drain-b',
      { kind: 'github' as const, ref: '#1' },
      'accepted',
    ],
  ] as const) {
    const state = {
      ...createInitialWorkflowState(),
      autoMode: true,
      executionSource: 'ticket' as const,
      ticketQueue: { schemaVersion: 1 as const, selector, drainId },
      ticketHistory: [completedRun],
    };
    const pending = pendingAutoActionForPrompt(
      '/addy-auto --tickets --label team-ready',
      state,
      undefined,
      'next-action',
      '',
    );
    if (pending.executionSource !== 'ticket') assert.fail('expected ticket');
    const result = formatTicketResultEnvelope({
      schemaVersion: 1,
      kind: 'ticket-queue-result',
      operation: 'select',
      outcome: 'succeeded',
      actionKey: pending.key,
      attempt: 0,
      selector,
      categories: {
        eligible: { count: 1, refs: [source] },
        blocked: { count: 0, refs: [] },
        claimed: { count: 0, refs: [] },
        ineligible: { count: 0, refs: [] },
        ambiguous: { count: 0, refs: [] },
      },
      eligibleCandidates: [{ source, createdAt: '2026-07-15T00:00:00.000Z' }],
      selected: { source },
      terminalReason: 'selected',
    });

    const ingestion = ingestTicketResult(
      { ...state, autoPendingAction: pending },
      result,
    );
    assert.equal(ingestion.status, expectedStatus, name);
  }
});
