import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketPrompt } from '../extensions/workflow-monitor/ticket-prompt.ts';
import { loadTrackerFixture } from './fixtures/tracker-config/load.ts';

const operations = [
  'select',
  'status',
  'claim',
  'release',
  'reclaim',
  'add-repository',
  'repository-scope-approval',
  'build',
  'simplify',
  'verify',
  'review',
  'fix-all',
  'finish',
] as const;

for (const operation of operations) {
  test(`contract prompt for ${operation} requires the source-neutral gateway`, () => {
    const prompt = buildTicketPrompt({
      operation,
      sourceKind: 'github',
      ticketRef: '#9',
      runId: 'run-1',
      claimId: 'claim-1',
      ...(operation === 'reclaim' ? { staleClaimId: 'claim-old' } : {}),
      actionKey: 'action-1',
      attempt: 1,
    });
    for (const invariant of [
      'docs/agents/issue-tracker.md',
      'docs/agents/triage-labels.md',
      'authoritative',
      'authoritative claim snapshot or null',
      'exactly one hidden JSON result envelope',
      'ADDY-TICKET-RESULT',
    ])
      assert.match(prompt, new RegExp(invariant, 'i'));
    assert.doesNotMatch(prompt, /gh issue|api\.linear|fetch\(/i);
    assert.match(prompt, /do not mutate a parent ticket or pull request/i);
  });
}

test('SELECT and STATUS prompts are minimal and read-only', () => {
  for (const operation of ['select', 'status'] as const) {
    const prompt = buildTicketPrompt({
      operation,
      sourceKind: 'github',
      ticketRef: '#9',
      actionKey: 'action-1',
      attempt: 1,
    });
    assert.match(prompt, /read-only/i);
    assert.match(prompt, /must not mutate/i);
    assert.doesNotMatch(prompt, /targeted merge|Ticket Activity|post-write/i);
  }
});

test('ownership operations state exact claim, release, and reclaim semantics', () => {
  const prompt = (operation: (typeof operations)[number]) =>
    buildTicketPrompt({
      operation,
      sourceKind: 'github',
      ticketRef: '#9',
      runId: 'run-1',
      claimId: 'claim-1',
      ...(operation === 'reclaim' ? { staleClaimId: 'claim-old' } : {}),
      actionKey: 'action-1',
      attempt: 1,
    });
  assert.match(prompt('claim'), /native owner.*claim identity.*selector/is);
  assert.match(prompt('claim'), /remove.*selector.*after/is);
  assert.match(prompt('release'), /exact claim identity/i);
  assert.match(prompt('release'), /remove.*owner/i);
  assert.match(prompt('reclaim'), /Stale claim id: claim-old/);
  assert.match(prompt('reclaim'), /Claim id: claim-1/);
  assert.match(prompt('reclaim'), /stale.*ownership evidence/i);
  assert.match(prompt('reclaim'), /replace.*claim identity/i);
  assert.match(prompt('add-repository'), /request.*approval/i);
  assert.match(prompt('add-repository'), /must not expand repository scope/i);
  assert.match(
    prompt('repository-scope-approval'),
    /explicit approval.*exact repository/i,
  );
  assert.match(
    buildTicketPrompt({
      operation: 'repository-scope-approval',
      sourceKind: 'github',
      ticketRef: '#9',
      runId: 'run-1',
      claimId: 'claim-1',
      repository: '/repo/extra',
      actionKey: 'action-1',
      attempt: 1,
    }),
    /Requested repository: \/repo\/extra/,
  );
});

test('RECLAIM prompt rejects missing or reused replacement identity', () => {
  const request = {
    operation: 'reclaim' as const,
    sourceKind: 'github' as const,
    ticketRef: '#9',
    runId: 'run-1',
    actionKey: 'action-1',
    attempt: 1,
  };
  assert.throws(
    () => buildTicketPrompt(request),
    /distinct stale and replacement/,
  );
  assert.throws(
    () =>
      buildTicketPrompt({
        ...request,
        staleClaimId: 'claim-1',
        claimId: 'claim-1',
      }),
    /distinct stale and replacement/,
  );
});

test('mutating phase prompts require targeted idempotent writes', () => {
  for (const operation of [
    'build',
    'simplify',
    'verify',
    'review',
    'fix-all',
    'finish',
  ] as const) {
    const prompt = buildTicketPrompt({
      operation,
      sourceKind: 'github',
      ticketRef: '#9',
      runId: 'run-1',
      claimId: 'claim-1',
      actionKey: 'action-1',
      attempt: 1,
    });
    assert.match(prompt, /refetch/i);
    assert.match(prompt, /targeted merge/i);
    assert.match(prompt, /idempotent Ticket Activity/i);
    assert.match(prompt, /post-write/i);
  }
});

test('contract prompts enforce exclusive lifecycle ownership', () => {
  const prompt = (operation: (typeof operations)[number]) =>
    buildTicketPrompt({
      operation,
      sourceKind: 'local',
      ticketRef: '.scratch/x/issues/01-a.md',
      runId: 'run-1',
      claimId: 'claim-1',
      actionKey: 'action-1',
      attempt: 1,
    });
  assert.match(
    prompt('build'),
    /BUILD owns only acceptance criteria and Implemented/,
  );
  assert.match(prompt('simplify'), /SIMPLIFY changes no lifecycle status/);
  assert.match(prompt('verify'), /VERIFY owns only Verified/);
  assert.match(prompt('review'), /REVIEW owns only Reviewed/);
  assert.match(prompt('fix-all'), /FIX-ALL changes no lifecycle status/);
  assert.match(prompt('finish'), /FINISH changes no lifecycle status/);
  assert.doesNotMatch(prompt('finish'), /skip verification|ship anyway/i);
});

test('relative repository requests use the owning ticket repository root', () => {
  const prompt = buildTicketPrompt({
    operation: 'add-repository',
    sourceKind: 'github',
    ticketRef: '#9',
    runId: 'run-1',
    claimId: 'claim-1',
    repository: '../companion',
    repositoryRoot: '/work/owner',
    actionKey: 'action-1',
    attempt: 0,
  });

  assert.match(prompt, /Requested repository: \/work\/companion/);
  assert.throws(
    () =>
      buildTicketPrompt({
        operation: 'add-repository',
        sourceKind: 'github',
        ticketRef: '#9',
        runId: 'run-1',
        claimId: 'claim-1',
        repository: '../companion',
        actionKey: 'action-1',
        attempt: 0,
      }),
    /repository root/i,
  );
});

test('fixture docs carry backend mechanics while gateway carries none', async () => {
  const [github, linear, local] = await Promise.all(
    ['github', 'linear', 'local'].map(loadTrackerFixture),
  );
  assert.match(github, /gh issue view/);
  assert.match(linear, /Linear skill\/tools/);
  assert.match(local, /Status:.*claimed/s);
  const gateway = buildTicketPrompt({
    operation: 'claim',
    sourceKind: 'github',
    ticketRef: '#9',
    runId: 'run-1',
    claimId: 'claim-1',
    actionKey: 'action-1',
    attempt: 1,
  });
  assert.doesNotMatch(gateway, /gh issue view|linear issue|writeFile/i);
});
