import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeTicketSource,
  LostEnvelopeError,
} from './fixtures/fake-ticket-source.ts';

function source() {
  return new FakeTicketSource({
    ref: '#9',
    body: ['Objective', '- [ ] criterion', 'Unrelated human text'].join('\n'),
    selector: 'ready-for-agent',
    repositoryScope: ['repo'],
  });
}

test('claim stages are retry-safe and support partial recovery', () => {
  const ticket = source();
  const first = ticket.apply({
    operation: 'claim',
    expectedRevision: '0',
    actionKey: 'claim-1',
    owner: 'agent',
    claimId: 'claim-1',
    removeSelector: true,
    stopAfter: 'native-owner',
  });
  assert.equal(first.nativeOwner, 'agent');
  assert.equal(first.claimId, undefined);
  assert.equal(first.selector, 'ready-for-agent');

  const completed = ticket.apply({
    operation: 'claim',
    expectedRevision: first.revision,
    actionKey: 'claim-1',
    owner: 'agent',
    claimId: 'claim-1',
    removeSelector: true,
    activity: 'Claimed ticket',
  });
  assert.equal(completed.claimId, 'claim-1');
  assert.equal(completed.selector, undefined);
  assert.equal(completed.comments.length, 1);
});

test('release removes only the exact claim and recovers after partial failure', () => {
  const ticket = source();
  const claimed = ticket.apply({
    operation: 'claim',
    expectedRevision: '0',
    actionKey: 'claim-old',
    owner: 'old-agent',
    claimId: 'claim-old',
  });
  assert.throws(
    () =>
      ticket.apply({
        operation: 'release',
        expectedRevision: claimed.revision,
        actionKey: 'release-wrong',
        claimId: 'wrong-claim',
      }),
    /exact claim identity/,
  );
  assert.deepEqual(ticket.fetch(), claimed);

  ticket.loseNextEnvelope();
  assert.throws(
    () =>
      ticket.apply({
        operation: 'release',
        expectedRevision: claimed.revision,
        actionKey: 'release-old',
        claimId: 'claim-old',
        stopAfter: 'native-owner',
      }),
    LostEnvelopeError,
  );
  const partial = ticket.fetch();
  assert.equal(partial.nativeOwner, undefined);
  assert.equal(partial.claimId, 'claim-old');

  const released = ticket.apply({
    operation: 'release',
    expectedRevision: partial.revision,
    actionKey: 'release-old',
    claimId: 'claim-old',
    activity: 'Released ticket',
  });
  assert.equal(released.nativeOwner, undefined);
  assert.equal(released.claimId, undefined);
  assert.equal(released.comments.length, 1);
});

test('reclaim requires exact stale-owner evidence and survives races and partial failure', () => {
  const ticket = source();
  ticket.apply({
    operation: 'claim',
    expectedRevision: '0',
    actionKey: 'claim-old',
    owner: 'old-agent',
    claimId: 'claim-old',
  });
  const staleOwner = { owner: 'old-agent', claimId: 'claim-old' };
  assert.throws(
    () =>
      ticket.apply({
        operation: 'reclaim',
        expectedRevision: ticket.fetch().revision,
        actionKey: 'reclaim-new',
        owner: 'new-agent',
        claimId: 'claim-new',
        staleOwner,
      }),
    /live owner/,
  );

  ticket.markOwnerStale(staleOwner);
  const beforeRace = ticket.fetch();
  ticket.raceNextWrite();
  assert.throws(
    () =>
      ticket.apply({
        operation: 'reclaim',
        expectedRevision: beforeRace.revision,
        actionKey: 'reclaim-new',
        owner: 'new-agent',
        claimId: 'claim-new',
        staleOwner,
      }),
    /revision conflict/,
  );
  assert.equal(ticket.fetch().nativeOwner, 'old-agent');
  assert.equal(ticket.fetch().claimId, 'claim-old');

  const partial = ticket.apply({
    operation: 'reclaim',
    expectedRevision: ticket.fetch().revision,
    actionKey: 'reclaim-new',
    owner: 'new-agent',
    claimId: 'claim-new',
    staleOwner,
    stopAfter: 'native-owner',
  });
  assert.equal(partial.nativeOwner, 'new-agent');
  assert.equal(partial.claimId, 'claim-old');

  const reclaimed = ticket.apply({
    operation: 'reclaim',
    expectedRevision: partial.revision,
    actionKey: 'reclaim-new',
    owner: 'new-agent',
    claimId: 'claim-new',
    staleOwner,
    activity: 'Reclaimed ticket',
  });
  assert.equal(reclaimed.nativeOwner, 'new-agent');
  assert.equal(reclaimed.claimId, 'claim-new');
  assert.equal(reclaimed.comments.length, 1);
});

test('activity markers are idempotent across lost-envelope reconciliation', () => {
  const ticket = source();
  ticket.loseNextEnvelope();
  assert.throws(
    () =>
      ticket.apply({
        operation: 'build',
        expectedRevision: '0',
        actionKey: 'build-1',
        targetedReplacement: {
          from: '- [ ] criterion',
          to: '- [x] criterion',
        },
        activity: 'Built criterion',
      }),
    LostEnvelopeError,
  );
  const observed = ticket.fetch();
  assert.match(observed.body, /\[x\] criterion/);
  const reconciled = ticket.apply({
    operation: 'build',
    expectedRevision: observed.revision,
    actionKey: 'build-1',
    targetedReplacement: {
      from: '- [x] criterion',
      to: '- [x] criterion',
    },
    activity: 'Built criterion',
  });
  assert.equal(reconciled.comments.length, 1);
});

test('targeted mutation preserves unrelated edits and rejects revision races', () => {
  const ticket = source();
  ticket.humanEdit((body) => body.replace('Unrelated', 'Updated unrelated'));
  const fetched = ticket.fetch();
  const changed = ticket.apply({
    operation: 'build',
    expectedRevision: fetched.revision,
    actionKey: 'build-1',
    targetedReplacement: {
      from: '- [ ] criterion',
      to: '- [x] criterion',
    },
  });
  assert.match(changed.body, /Updated unrelated human text/);

  ticket.raceNextWrite();
  assert.throws(
    () =>
      ticket.apply({
        operation: 'verify',
        expectedRevision: changed.revision,
        actionKey: 'verify-1',
      }),
    /revision conflict/,
  );
});

test('targeted mutation rejects missing or ambiguous targets', () => {
  const missing = source();
  assert.throws(
    () =>
      missing.apply({
        operation: 'build',
        expectedRevision: '0',
        actionKey: 'build-1',
        targetedReplacement: { from: 'missing', to: 'done' },
      }),
    /exactly once/,
  );
  const ambiguous = source();
  ambiguous.humanEdit((body) => `${body}\n- [ ] criterion`);
  assert.throws(
    () =>
      ambiguous.apply({
        operation: 'build',
        expectedRevision: ambiguous.fetch().revision,
        actionKey: 'build-1',
        targetedReplacement: {
          from: '- [ ] criterion',
          to: '- [x] criterion',
        },
      }),
    /exactly once/,
  );
});

test('completion requires lifecycle and repository evidence', () => {
  const ticket = source();
  assert.throws(
    () =>
      ticket.apply({
        operation: 'finish',
        expectedRevision: '0',
        actionKey: 'finish-1',
        complete: true,
      }),
    /closure requirements/,
  );
  ticket.apply({
    operation: 'build',
    expectedRevision: ticket.fetch().revision,
    actionKey: 'build-1',
    targetedReplacement: {
      from: '- [ ] criterion',
      to: '- [x] criterion',
    },
  });
  ticket.setLifecycle({ implemented: true, verified: true, reviewed: true });
  ticket.setCommitEvidence({ repo: 'abc123' });
  assert.throws(
    () =>
      ticket.apply({
        operation: 'finish',
        expectedRevision: ticket.fetch().revision,
        actionKey: 'finish-1',
        complete: true,
      }),
    /closure requirements/,
  );
  assert.equal(ticket.fetch().terminal, undefined);
  assert.deepEqual(ticket.fetch().commitEvidence, { repo: 'abc123' });
  const completed = ticket.apply({
    operation: 'finish',
    expectedRevision: ticket.fetch().revision,
    actionKey: 'finish-1',
    complete: true,
    activity: { kind: 'final', content: 'Completed ticket' },
  });
  assert.equal(completed.terminal, 'resolved');
});

test('failure Activity is replaced by confirmed final Activity on retry', () => {
  const ticket = source();
  ticket.humanEdit((body) =>
    body.replace('- [ ] criterion', '- [x] criterion'),
  );
  ticket.setLifecycle({ implemented: true, verified: true, reviewed: true });
  ticket.setCommitEvidence({ repo: 'abc123' });

  const failed = ticket.apply({
    operation: 'finish',
    expectedRevision: ticket.fetch().revision,
    actionKey: 'finish-retry',
    activity: { kind: 'failure', content: 'Commit failed' },
  });
  assert.throws(
    () =>
      ticket.apply({
        operation: 'finish',
        expectedRevision: failed.revision,
        actionKey: 'finish-retry',
        complete: true,
      }),
    /closure requirements/,
  );

  const completed = ticket.apply({
    operation: 'finish',
    expectedRevision: ticket.fetch().revision,
    actionKey: 'finish-retry',
    activity: { kind: 'final', content: 'Completed ticket' },
    complete: true,
  });
  assert.equal(completed.terminal, 'resolved');
  assert.equal(completed.comments.length, 1);
  assert.match(completed.comments[0], /Completed ticket/);
  assert.doesNotMatch(completed.comments[0], /Commit failed/);
});

test('ambiguous routing, backend failures, parents, and pull requests never mutate', () => {
  const ambiguous = source();
  ambiguous.makeRoutingAmbiguous();
  assert.throws(
    () =>
      ambiguous.apply({
        operation: 'claim',
        expectedRevision: '0',
        actionKey: 'claim-1',
      }),
    /ambiguous routing/,
  );
  assert.equal(ambiguous.fetch().revision, '0');

  const failed = source();
  failed.failNextBackend('offline');
  assert.throws(
    () =>
      failed.apply({
        operation: 'status',
        expectedRevision: '0',
        actionKey: 'status-1',
      }),
    /offline/,
  );
  assert.equal(failed.fetch().revision, '0');

  for (const targetKind of ['parent', 'pull-request'] as const) {
    const excluded = new FakeTicketSource({
      ref: '#1',
      body: 'body',
      targetKind,
      repositoryScope: ['repo'],
    });
    assert.throws(
      () =>
        excluded.apply({
          operation: 'build',
          expectedRevision: '0',
          actionKey: 'build-1',
        }),
      /not a mutable child issue/,
    );
    assert.equal(excluded.fetch().revision, '0');
  }
});
