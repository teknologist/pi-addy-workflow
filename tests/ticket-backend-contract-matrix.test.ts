import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeTicketSource,
  LostEnvelopeError,
  selectFakeTicket,
} from './fixtures/fake-ticket-source.ts';

const contracts = [
  { kind: 'github', terminal: 'closed' },
  { kind: 'linear', terminal: 'completed' },
  { kind: 'local', terminal: 'resolved' },
] as const;

function ticket(kind: (typeof contracts)[number]['kind'], ref = '02-ticket') {
  return new FakeTicketSource({
    kind,
    ref,
    body: [
      'Status: ready-for-agent',
      '## What to build',
      'Ship the slice',
      '## Acceptance criteria',
      '- [ ] behavior works',
      '## Blocked by',
      'None',
      '## Comments',
    ].join('\n'),
    selector: 'ready-for-agent',
    repositoryScope: ['repo'],
  });
}

for (const contract of contracts) {
  test(`${contract.kind} offline contract covers claim, lifecycle, Activity, evidence, completion, and recovery`, () => {
    const source = ticket(contract.kind);
    source.loseNextEnvelope();
    assert.throws(
      () =>
        source.apply({
          operation: 'claim',
          expectedRevision: '0',
          actionKey: 'claim-1',
          owner: 'agent',
          claimId: 'claim-1',
          removeSelector: true,
        }),
      LostEnvelopeError,
    );

    const claimed = source.fetch();
    assert.equal(claimed.nativeOwner, 'agent');
    assert.equal(claimed.claimId, 'claim-1');
    assert.equal(claimed.selector, undefined);
    if (contract.kind === 'local')
      assert.match(claimed.body, /Status: claimed/);

    let state = source.apply({
      operation: 'build',
      expectedRevision: claimed.revision,
      actionKey: 'build-1',
      targetedReplacement: {
        from: '- [ ] behavior works',
        to: '- [x] behavior works',
      },
      lifecycle: { implemented: true },
      activity: 'Built behavior',
    });
    state = source.apply({
      operation: 'verify',
      expectedRevision: state.revision,
      actionKey: 'verify-1',
      lifecycle: { verified: true },
      activity: 'Verified behavior',
    });
    state = source.apply({
      operation: 'review',
      expectedRevision: state.revision,
      actionKey: 'review-1',
      lifecycle: { reviewed: true },
      activity: 'Review found one issue',
    });
    state = source.apply({
      operation: 'fix-all',
      expectedRevision: state.revision,
      actionKey: 'fix-1',
      activity: 'Fixed review issue',
    });
    state = source.apply({
      operation: 'finish',
      expectedRevision: state.revision,
      actionKey: 'finish-1',
      commitEvidence: { repo: 'abc123' },
      activity: { kind: 'failure', content: 'Completion transition failed' },
    });
    assert.equal(state.terminal, undefined);

    const completed = source.apply({
      operation: 'finish',
      expectedRevision: state.revision,
      actionKey: 'finish-1',
      activity: { kind: 'final', content: 'Completed ticket' },
      complete: true,
    });
    assert.equal(completed.terminal, contract.terminal);
    assert.equal(completed.comments.length, 5);
    if (contract.kind === 'local') {
      assert.match(completed.body, /Status: resolved/);
      assert.match(completed.body, /## Comments[\s\S]*addy-activity:finish-1/);
    }
  });
}

test('Linear ambiguous routing pauses without mutation', () => {
  const source = ticket('linear', 'ENG-42');
  source.makeRoutingAmbiguous();
  assert.throws(
    () =>
      source.apply({
        operation: 'claim',
        expectedRevision: '0',
        actionKey: 'claim-ambiguous',
      }),
    /ambiguous routing/,
  );
  assert.equal(source.fetch().revision, '0');
  assert.equal(source.fetch().claimId, undefined);
});

test('offline queue contract enforces eligibility, label membership, direct bypass, blockers, optional local Labels, and numeric frontier', () => {
  const unlabeled = ticket('github', '#1');
  unlabeled.setSelector(undefined);
  const blocked = ticket('local', '01-blocked');
  blocked.setBlockers(['00-parent']);
  const later = ticket('local', '10-later');
  later.setLabels(['ready-for-agent']);
  const first = ticket('local', '02-first');
  const malformed = ticket('local', '00-malformed');
  malformed.humanEdit(() => 'Status: ready-for-agent\nNo acceptance criteria');

  assert.equal(
    selectFakeTicket([unlabeled, malformed, blocked, later, first], {
      mode: 'queue',
      selector: 'ready-for-agent',
    })?.fetch().ref,
    '02-first',
  );
  assert.equal(
    selectFakeTicket([unlabeled], { mode: 'direct', ref: '#1' })?.fetch().ref,
    '#1',
  );
  assert.equal(
    selectFakeTicket([malformed], { mode: 'direct', ref: '00-malformed' }),
    undefined,
  );
  assert.equal(
    selectFakeTicket([unlabeled], {
      mode: 'queue',
      selector: 'ready-for-agent',
    }),
    undefined,
  );
});
