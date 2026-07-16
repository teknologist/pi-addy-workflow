import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ticketClaimSafetyWarning,
  ticketStateBlocksReset,
} from '../extensions/workflow-monitor/ticket-source-switch.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

const validTicketRun = {
  schemaVersion: 1 as const,
  source: { kind: 'github' as const, ref: 'ENG-42' },
  runId: 'run-1',
  claim: {
    id: 'claim-1',
    owner: 'eric',
    claimedAt: '2026-07-15T00:00:00.000Z',
  },
  lifecycle: { implemented: true, verified: false, reviewed: false },
  repositoryScope: ['/repo'],
};

const live = {
  ...createInitialWorkflowState(),
  executionSource: 'ticket' as const,
  ticketRun: validTicketRun,
};

const corrupt = {
  ...createInitialWorkflowState(),
  executionSource: 'ticket' as const,
  ticketRecovery: {
    possibleClaim: true as const,
    ticketRef: 'ENG-42',
    reason: 'invalid Ticket state',
  },
};

test('live claim blocks source switches and shipping with recovery guidance', () => {
  for (const input of [
    '/addy-plan',
    '/addy-ship',
    '/addy-build docs/plans/x.md',
    '/addy-auto docs/plans/x.md',
    '/addy-build --ticket ENG-43',
  ]) {
    const warning = ticketClaimSafetyWarning(live, input);
    assert.match(warning!, /ENG-42/);
    assert.match(warning!, /\/addy-ticket status ENG-42/);
    assert.match(warning!, /\/addy-ticket release ENG-42/);
  }
  assert.equal(ticketStateBlocksReset(live), true);
});

test('same claim lifecycle and exact recovery operations remain available', () => {
  for (const input of [
    '/addy-build --ticket ENG-42',
    '/addy-verify --ticket ENG-42',
    '/addy-ticket status ENG-42',
    '/addy-ticket release ENG-42',
    '/addy-ticket reclaim ENG-42',
    '/addy-ticket add-repository ENG-42 ../repo',
    '/addy-auto stop',
  ])
    assert.equal(ticketClaimSafetyWarning(live, input), undefined);

  for (const input of [
    '/addy-ticket release ENG-43',
    '/addy-ticket reclaim ENG-43',
    '/addy-ticket add-repository ENG-43 ../repo',
    '/addy-ticket release ENG-42 extra',
    '/addy-ticket add-repository ENG-42',
  ])
    assert.match(ticketClaimSafetyWarning(live, input)!, /ENG-42/);
});

test('corrupt possible claim blocks reset and unsafe switches but allows only recovery operations', () => {
  assert.equal(ticketStateBlocksReset(corrupt), true);
  assert.match(
    ticketClaimSafetyWarning(corrupt, '/addy-ship')!,
    /manual repair/i,
  );
  for (const input of [
    '/addy-ticket status ENG-42',
    '/addy-ticket release ENG-42',
    '/addy-ticket reclaim ENG-42',
  ])
    assert.equal(ticketClaimSafetyWarning(corrupt, input), undefined);
  assert.match(
    ticketClaimSafetyWarning(
      corrupt,
      '/addy-ticket add-repository ENG-42 ../repo',
    )!,
    /corrupt/i,
  );
});

test('recovery without a stored ref allows only strict supplied release or reclaim', () => {
  const unknownRefRecovery = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRecovery: {
      possibleClaim: true as const,
      reason: 'invalid Ticket state',
    },
  };

  for (const input of [
    '/addy-ticket release ENG-42',
    '/addy-ticket reclaim "local tickets/01.md"',
  ])
    assert.equal(
      ticketClaimSafetyWarning(unknownRefRecovery, input),
      undefined,
    );
  for (const input of [
    '/addy-ticket release',
    '/addy-ticket release ENG-42 extra',
    '/addy-ticket add-repository ENG-42 ../repo',
  ])
    assert.match(
      ticketClaimSafetyWarning(unknownRefRecovery, input)!,
      /corrupt/i,
    );
});

test('plan state does not block reset or commands', () => {
  const state = createInitialWorkflowState();
  assert.equal(ticketStateBlocksReset(state), false);
  assert.equal(ticketClaimSafetyWarning(state, '/addy-ship'), undefined);
});
