import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeTicketSource } from './fixtures/fake-ticket-source.ts';

function source(selector?: string) {
  return new FakeTicketSource({
    ref: '#10',
    body: 'Objective\n- [ ] criterion',
    ...(selector ? { selector } : {}),
    repositoryScope: ['/repo'],
  });
}

test('release restores only a recorded originating selector', () => {
  for (const selector of [undefined, 'ready-for-agent']) {
    const ticket = source(selector);
    const claimed = ticket.apply({
      operation: 'claim',
      expectedRevision: '0',
      actionKey: 'claim-1',
      owner: 'agent',
      claimId: 'claim-1',
      removeSelector: true,
    });
    const released = ticket.apply({
      operation: 'release',
      expectedRevision: claimed.revision,
      actionKey: 'release-1',
      claimId: 'claim-1',
      activity: 'Released ticket',
    });
    assert.equal(released.selector, selector);
  }
});

test('claim refuses unrecoverable selector removal and conflicting ownership', () => {
  const missingIdentity = source('ready-for-agent');
  missingIdentity.removeSelectorWithoutClaim();
  assert.throws(
    () =>
      missingIdentity.apply({
        operation: 'claim',
        expectedRevision: missingIdentity.fetch().revision,
        actionKey: 'claim-1',
        owner: 'agent',
        claimId: 'claim-1',
        removeSelector: true,
      }),
    /manual repair/,
  );

  const conflict = source();
  const owned = conflict.apply({
    operation: 'claim',
    expectedRevision: '0',
    actionKey: 'other-claim',
    owner: 'other-agent',
    stopAfter: 'native-owner',
  });
  assert.throws(
    () =>
      conflict.apply({
        operation: 'claim',
        expectedRevision: owned.revision,
        actionKey: 'claim-1',
        owner: 'agent',
        claimId: 'claim-1',
      }),
    /conflicting native owner/,
  );
  assert.deepEqual(conflict.fetch(), owned);
});
