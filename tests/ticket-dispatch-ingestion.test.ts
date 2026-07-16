import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingAutoActionForPrompt } from '../extensions/workflow-monitor/auto-control.ts';
import { formatTicketResultEnvelope } from '../extensions/workflow-monitor/ticket-phase-result.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-state.ts';
import { createAddyWorkflowHarness } from './fixtures/fake-workflow-runtime.ts';

test('bare Ticket queue keeps its default selector through dispatch and ingestion', async () => {
  const harness = createAddyWorkflowHarness({
    cwd: mkdtempSync(join(tmpdir(), 'addy-ticket-default-queue-')),
    id: 'ticket-default-queue',
  });

  await harness.commands
    .get('addy-auto')!
    .handler({ args: ['--tickets'] }, harness.ctx);

  const pending = harness.ctx.state.autoPendingAction;
  assert.equal(pending?.executionSource, 'ticket');
  if (pending?.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  assert.deepEqual(pending.selector, { kind: 'default', value: 'unbound' });
  assert.match(pending.key, /default:unbound/);
  assert.match(harness.lastPrompt() ?? '', /Queue selector: default:unbound/);

  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'succeeded',
    actionKey: pending.key,
    attempt: 0,
    selector: pending.selector!,
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
  await harness.events.get('agent_end')!(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: result }] },
      ],
    },
    harness.ctx,
  );

  assert.deepEqual(harness.ctx.state.ticketRun.queueSelector, pending.selector);
});

test('Ticket queue dispatch uses the gateway and ingests one agent result idempotently', async () => {
  const harness = createAddyWorkflowHarness({
    cwd: mkdtempSync(join(tmpdir(), 'addy-ticket-dispatch-')),
    id: 'ticket-dispatch',
  });

  await harness.commands
    .get('addy-auto')!
    .handler(
      { args: ['--tickets', '--label', 'ready-for-agent'] },
      harness.ctx,
    );

  const pending = harness.ctx.state.autoPendingAction;
  assert.equal(pending?.executionSource, 'ticket');
  if (pending?.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  assert.match(harness.lastPrompt() ?? '', /Operation: select/);
  assert.match(harness.lastPrompt() ?? '', /ADDY-TICKET-RESULT/);

  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-queue-result',
    operation: 'select',
    outcome: 'succeeded',
    actionKey: pending.key,
    attempt: Number(pending.attemptMarker.slice('attempt-'.length)),
    selector: pending.selector!,
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
  const event = {
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: result }] },
    ],
  };

  await harness.events.get('agent_end')!(event, harness.ctx);
  assert.equal(harness.ctx.state.ticketRun.source.ref, '#9');
  assert.match(harness.lastPrompt() ?? '', /Operation: claim/);
  assert.match(harness.lastPrompt() ?? '', /Ticket ref: #9/);

  const claimPending = harness.ctx.state.autoPendingAction;
  assert.equal(claimPending.operation, 'claim');
  const claimResult = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'claim',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#9' },
    runId: claimPending.runId,
    claimId: claimPending.claimId,
    claim: {
      id: claimPending.claimId,
      owner: 'agent',
      claimedAt: '2026-07-15T00:00:00.000Z',
    },
    actionKey: claimPending.key,
    attempt: Number(claimPending.attemptMarker.slice('attempt-'.length)),
    postRevision: 'rev-claim',
    lifecycle: { implemented: false, verified: false, reviewed: false },
    activity: { marker: `${claimPending.key}:0`, id: 'claim-comment' },
    repositoryScope: [harness.ctx.cwd],
  });
  await harness.events.get('agent_end')!(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: claimResult }] },
      ],
    },
    harness.ctx,
  );

  assert.equal(harness.ctx.state.ticketRun.claim.id, claimPending.claimId);
  assert.equal(harness.ctx.state.autoPendingAction.operation, 'build');
  assert.equal(
    harness.ctx.state.autoPendingAction.claimId,
    claimPending.claimId,
  );
  assert.match(harness.lastPrompt() ?? '', /Operation: build/);

  const messagesAfterAcceptedResult = harness.sentMessages.length;
  const warningsAfterAcceptedResult = harness.ctx.state.warnings.length;
  await harness.events.get('agent_end')!(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: claimResult }] },
      ],
    },
    harness.ctx,
  );
  assert.equal(harness.sentMessages.length, messagesAfterAcceptedResult);
  assert.equal(harness.ctx.state.warnings.length, warningsAfterAcceptedResult);
  assert.equal(
    harness.ctx.state.ticketRun.lastValidatedResult.operation,
    'claim',
  );
});

test('registered manual Ticket management dispatches a contract prompt and ingests its result', async () => {
  const harness = createAddyWorkflowHarness({
    cwd: mkdtempSync(join(tmpdir(), 'addy-ticket-manual-status-')),
    id: 'ticket-manual-status',
  });

  await harness.commands
    .get('addy-ticket')!
    .handler({ args: ['status', '#9'] }, harness.ctx);

  const pending = harness.ctx.state.autoPendingAction;
  assert.equal(harness.ctx.state.autoMode, false);
  assert.equal(pending?.executionSource, 'ticket');
  if (pending?.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  assert.equal(pending.operation, 'status');
  assert.match(harness.lastPrompt() ?? '', /Operation: status/);
  assert.match(harness.lastPrompt() ?? '', /ADDY-TICKET-RESULT/);
  assert.notEqual(harness.lastPrompt(), '/addy-ticket status #9');

  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'status',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#9' },
    runId: pending.runId,
    claim: null,
    actionKey: pending.key,
    attempt: 0,
    postRevision: 'rev-status',
    lifecycle: { implemented: false, verified: false, reviewed: false },
    repositoryScope: ['.'],
  });
  await harness.events.get('agent_end')!(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: result }] },
      ],
    },
    harness.ctx,
  );

  assert.equal(harness.ctx.state.ticketRun.revision, 'rev-status');
  assert.equal(harness.ctx.state.autoPendingAction, undefined);
  assert.equal(harness.ctx.state.autoMode, false);
});

test('registered manual BUILD claims an unclaimed Ticket before lifecycle work', async () => {
  const harness = createAddyWorkflowHarness({
    cwd: mkdtempSync(join(tmpdir(), 'addy-ticket-manual-build-')),
    id: 'ticket-manual-build',
  });

  await harness.commands
    .get('addy-build')!
    .handler({ args: ['--ticket', '#9'] }, harness.ctx);

  const pending = harness.ctx.state.autoPendingAction;
  assert.equal(pending?.executionSource, 'ticket');
  if (pending?.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  assert.equal(pending.operation, 'claim');
  assert.match(harness.lastPrompt() ?? '', /Operation: claim/);
  assert.doesNotMatch(harness.lastPrompt() ?? '', /Operation: build/);

  const claim = {
    id: pending.claimId!,
    owner: 'agent',
    claimedAt: '2026-07-15T00:00:00.000Z',
  };
  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'claim',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#9' },
    runId: pending.runId,
    claimId: pending.claimId,
    claim,
    actionKey: pending.key,
    attempt: 0,
    postRevision: 'rev-claim',
    lifecycle: { implemented: false, verified: false, reviewed: false },
    activity: { marker: `${pending.key}:0` },
    repositoryScope: [harness.ctx.cwd],
  });
  await harness.events.get('agent_end')!(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: result }] },
      ],
    },
    harness.ctx,
  );

  assert.equal(harness.ctx.state.ticketRun.claim.id, pending.claimId);
  assert.equal(harness.ctx.state.ticketRun.lifecycle.implemented, false);
  assert.equal(harness.ctx.state.autoMode, false);
});

test('manual BUILD rejects a mismatched unclaimed run ref and retries the matching ref', async () => {
  const harness = createAddyWorkflowHarness({
    cwd: mkdtempSync(join(tmpdir(), 'addy-ticket-manual-build-retry-')),
    id: 'ticket-manual-build-retry',
  });
  harness.ctx.state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    autoMode: false,
    ticketRun: {
      schemaVersion: 1,
      source: { kind: 'github', ref: '#9' },
      runId: 'run-1',
      repositoryRoot: harness.ctx.cwd,
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: ['.'],
    },
  };

  await harness.commands
    .get('addy-build')!
    .handler({ args: ['--ticket', '#10'] }, harness.ctx);

  assert.equal(harness.sentMessages.length, 0);
  assert.equal(harness.ctx.state.autoPendingAction, undefined);
  assert.equal(harness.ctx.state.ticketRun.source.ref, '#9');
  assert.equal(harness.notices.length, 1);
  assert.match(harness.notices[0].message, /requested #10.*unclaimed run #9/i);

  await harness.commands
    .get('addy-build')!
    .handler({ args: ['--ticket', '#9'] }, harness.ctx);

  const pending = harness.ctx.state.autoPendingAction;
  assert.equal(pending?.executionSource, 'ticket');
  if (pending?.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  assert.equal(pending.operation, 'claim');
  assert.equal(harness.notices.length, 1);
  assert.equal(pending.ticketRef, '#9');
  assert.equal(pending.runId, 'run-1');
  assert.match(harness.lastPrompt() ?? '', /Operation: claim/);
  assert.match(harness.lastPrompt() ?? '', /Ticket ref: #9/);
});

test('registered manual Ticket lifecycle dispatches a contract prompt and ingests its result', async () => {
  const harness = createAddyWorkflowHarness({
    cwd: mkdtempSync(join(tmpdir(), 'addy-ticket-manual-verify-')),
    id: 'ticket-manual-verify',
  });
  const claim = {
    id: 'claim-1',
    owner: 'agent',
    claimedAt: '2026-07-15T00:00:00.000Z',
  };
  harness.ctx.state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    autoMode: false,
    ticketRun: {
      schemaVersion: 1,
      source: { kind: 'github', ref: '#9' },
      runId: 'run-1',
      repositoryRoot: harness.ctx.cwd,
      claim,
      lifecycle: { implemented: true, verified: false, reviewed: false },
      repositoryScope: ['.'],
    },
  };

  await harness.commands
    .get('addy-verify')!
    .handler({ args: ['--ticket', '#9'] }, harness.ctx);

  const pending = harness.ctx.state.autoPendingAction;
  assert.equal(harness.ctx.state.autoMode, false);
  assert.equal(pending?.executionSource, 'ticket');
  if (pending?.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  assert.equal(pending.operation, 'verify');
  assert.match(harness.lastPrompt() ?? '', /Operation: verify/);
  assert.match(harness.lastPrompt() ?? '', /Ticket ref: #9/);

  const result = formatTicketResultEnvelope({
    schemaVersion: 1,
    kind: 'ticket-phase-result',
    operation: 'verify',
    outcome: 'succeeded',
    source: { kind: 'github', ref: '#9' },
    runId: 'run-1',
    claimId: claim.id,
    claim,
    actionKey: pending.key,
    attempt: 0,
    postRevision: 'rev-verify',
    lifecycle: { implemented: true, verified: true, reviewed: false },
    activity: { marker: `${pending.key}:0` },
    repositoryScope: ['.'],
  });
  await harness.events.get('agent_end')!(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: result }] },
      ],
    },
    harness.ctx,
  );

  assert.equal(harness.ctx.state.ticketRun.lifecycle.verified, true);
  assert.equal(harness.ctx.state.autoPendingAction, undefined);
  assert.equal(harness.ctx.state.autoMode, false);
});

test('registered manual command persists canceled clarification and clears it after resolved retry', async () => {
  const harness = createAddyWorkflowHarness({
    cwd: mkdtempSync(join(tmpdir(), 'addy-ticket-manual-clarification-')),
    id: 'ticket-manual-clarification',
  });
  const claim = {
    id: 'claim-1',
    owner: 'agent',
    claimedAt: '2026-07-15T00:00:00.000Z',
  };
  harness.ctx.state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    ticketRun: {
      schemaVersion: 1,
      source: { kind: 'github', ref: '#9' },
      runId: 'run-1',
      repositoryRoot: harness.ctx.cwd,
      claim,
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: ['.'],
    },
  };

  await harness.commands
    .get('addy-build')!
    .handler({ args: ['--ticket', '#9'] }, harness.ctx);
  const first = harness.ctx.state.autoPendingAction;
  if (first?.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  const clarification = {
    kind: 'completion-transition' as const,
    prompt: 'Close or keep open?',
  };
  await harness.events.get('agent_end')!(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: formatTicketResultEnvelope({
                schemaVersion: 1,
                kind: 'ticket-phase-result',
                operation: 'build',
                outcome: 'blocked',
                source: { kind: 'github', ref: '#9' },
                runId: 'run-1',
                claimId: claim.id,
                claim,
                actionKey: first.key,
                attempt: Number(first.attemptMarker.slice('attempt-'.length)),
                postRevision: 'rev-blocked',
                lifecycle: {
                  implemented: false,
                  verified: false,
                  reviewed: false,
                },
                repositoryScope: ['.'],
                clarification,
              }),
            },
          ],
        },
      ],
    },
    harness.ctx,
  );
  assert.deepEqual(
    harness.ctx.state.ticketRun.pendingClarification,
    clarification,
  );
  assert.equal(harness.ctx.state.ticketRun.claim.id, claim.id);

  await harness.commands
    .get('addy-build')!
    .handler({ args: ['--ticket', '#9'] }, harness.ctx);
  const retry = harness.ctx.state.autoPendingAction;
  if (retry?.executionSource !== 'ticket')
    assert.fail('expected Ticket action');
  assert.match(harness.lastPrompt() ?? '', /Close or keep open\?/);
  await harness.events.get('agent_end')!(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: formatTicketResultEnvelope({
                schemaVersion: 1,
                kind: 'ticket-phase-result',
                operation: 'build',
                outcome: 'succeeded',
                source: { kind: 'github', ref: '#9' },
                runId: 'run-1',
                claimId: claim.id,
                claim,
                actionKey: retry.key,
                attempt: Number(retry.attemptMarker.slice('attempt-'.length)),
                postRevision: 'rev-built',
                lifecycle: {
                  implemented: true,
                  verified: false,
                  reviewed: false,
                },
                activity: {
                  marker: `${retry.key}:${Number(retry.attemptMarker.slice('attempt-'.length))}`,
                },
                repositoryScope: ['.'],
                clarification: { ...clarification, resolution: 'close' },
              }),
            },
          ],
        },
      ],
    },
    harness.ctx,
  );
  assert.equal(harness.ctx.state.ticketRun.pendingClarification, undefined);
  assert.equal(harness.ctx.state.ticketRun.lifecycle.implemented, true);
});

test('accepted successful or reconciled Ticket FINISH stops Auto without redispatch', async () => {
  for (const outcome of ['succeeded', 'reconciled'] as const) {
    const harness = createAddyWorkflowHarness({
      cwd: mkdtempSync(join(tmpdir(), 'addy-ticket-finish-')),
      id: `ticket-finish-${outcome}`,
    });
    const ticketRun = {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: '#9' },
      runId: 'run-1',
      repositoryRoot: harness.ctx.cwd,
      claim: {
        id: 'claim-1',
        owner: 'agent',
        claimedAt: '2026-07-15T00:00:00.000Z',
      },
      lifecycle: {
        implemented: true,
        verified: true,
        reviewed: true,
        lastCompletedPhase: 'review' as const,
      },
      repositoryScope: ['.'],
    };
    const state = {
      ...createInitialWorkflowState(),
      executionSource: 'ticket' as const,
      autoMode: true,
      ticketRun,
    };
    const pending = pendingAutoActionForPrompt(
      '/addy-finish --ticket #9',
      state,
      undefined,
      'next-action',
      'ignored',
    );
    assert.equal(pending.executionSource, 'ticket');
    if (pending.executionSource !== 'ticket')
      assert.fail('expected Ticket action');
    harness.ctx.state = {
      ...state,
      autoLastPrompt: pending.prompt,
      autoPendingAction: pending,
    };
    const messageCount = harness.sentMessages.length;
    const result = formatTicketResultEnvelope({
      schemaVersion: 1,
      kind: 'ticket-phase-result',
      operation: 'finish',
      outcome,
      source: ticketRun.source,
      runId: ticketRun.runId,
      claimId: ticketRun.claim.id,
      claim: ticketRun.claim,
      actionKey: pending.key,
      attempt: Number(pending.attemptMarker.slice('attempt-'.length)),
      postRevision: 'rev-finish',
      lifecycle: { implemented: true, verified: true, reviewed: true },
      activity: {
        marker: `${pending.key}:0`,
        id: 'finish-comment',
        kind: 'final',
      },
      repositoryScope: ['.'],
      commitEvidence: [
        {
          repository: '.',
          result: 'committed',
          commitSha: 'abc1234',
          recordedAt: '2026-07-15T01:00:00.000Z',
        },
      ],
      finishStage: 'terminal-refetch',
      terminal: {
        state: 'closed',
        confirmedAt: '2026-07-15T01:01:00.000Z',
      },
    });

    await harness.events.get('agent_end')!(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: result }] },
        ],
      },
      harness.ctx,
    );

    assert.equal(harness.ctx.state.autoMode, false);
    assert.equal(harness.ctx.state.autoPendingAction, undefined);
    assert.equal(harness.sentMessages.length, messageCount);
    assert.equal(harness.ctx.state.ticketRun, undefined);
    assert.equal(
      harness.ctx.state.ticketHistory.at(-1).lastValidatedResult.operation,
      'finish',
    );
  }
});
