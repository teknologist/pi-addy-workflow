import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryScopesFromMarkdown } from '../extensions/workflow-monitor/repository-scope.ts';
import { FakeTicketSource } from './fixtures/fake-ticket-source.ts';

test('Ticket scope defaults to current repository and normalizes declared repositories uniquely', () => {
  assert.deepEqual(repositoryScopesFromMarkdown('Objective', '/work/owner'), [
    '/work/owner',
  ]);
  assert.deepEqual(
    repositoryScopesFromMarkdown(
      [
        'Repository scope: current repository, `../companion`',
        '**Owner repo:** `owner`',
        '**Companion repo:** sibling `../companion`',
      ].join('\n'),
      '/work/owner',
    ),
    ['/work/owner', '/work/companion'],
  );
});

test('approved repository is locked and commented before work can continue', () => {
  const ticket = new FakeTicketSource({
    ref: 'ENG-42',
    body: 'Objective\n- [ ] criterion',
    repositoryScope: ['/work/owner'],
  });
  const claimed = ticket.apply({
    operation: 'claim',
    expectedRevision: '0',
    actionKey: 'claim-1',
    owner: 'agent',
    claimId: 'claim-1',
  });
  const approved = ticket.apply({
    operation: 'add-repository',
    expectedRevision: claimed.revision,
    actionKey: 'scope-1',
    claimId: 'claim-1',
    repository: '/work/companion',
    activity: 'Approved companion repository',
  });

  assert.deepEqual(approved.repositoryScope, [
    '/work/owner',
    '/work/companion',
  ]);
  assert.equal(approved.comments.length, 1);

  const duplicate = ticket.apply({
    operation: 'add-repository',
    expectedRevision: approved.revision,
    actionKey: 'scope-1',
    claimId: 'claim-1',
    repository: '/work/companion',
    activity: 'Approved companion repository',
  });
  assert.deepEqual(duplicate.repositoryScope, approved.repositoryScope);
  assert.equal(duplicate.comments.length, 1);
});
