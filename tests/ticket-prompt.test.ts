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

test('SELECT prompt binds drain-scoped exclusions by source kind and ref', () => {
  const prompt = buildTicketPrompt({
    operation: 'select',
    selector: { kind: 'label', value: 'ready-for-agent' },
    queueDrainId: 'drain-a',
    excludedTickets: [
      { kind: 'github', ref: '#9' },
      { kind: 'linear', ref: '#9' },
    ],
    actionKey: 'action-1',
    attempt: 1,
  });

  assert.match(prompt, /Queue drain id: drain-a/);
  assert.match(prompt, /exact source kind \+ ref pairs/);
  assert.match(prompt, /github:#9/);
  assert.match(prompt, /linear:#9/);
  assert.match(prompt, /oldest createdAt then source kind and ref/);
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
  assert.match(prompt('add-repository'), /explicit user approval/i);
  assert.match(prompt('add-repository'), /append it once.*locked.*scope/i);
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

test('claim administration prompts preserve staged ownership and selector facts', () => {
  const prompt = (operation: 'claim' | 'release' | 'reclaim') =>
    buildTicketPrompt({
      operation,
      sourceKind: 'github',
      ticketRef: '#10',
      runId: 'run-1',
      claimId: 'claim-new',
      ...(operation === 'reclaim' ? { staleClaimId: 'claim-old' } : {}),
      selector: { kind: 'label', value: 'ready-for-agent' },
      actionKey: 'action-1',
      attempt: 0,
    });

  assert.match(
    prompt('claim'),
    /native ownership[\s\S]*managed block[\s\S]*remove the originating selector[\s\S]*refetch/i,
  );
  assert.match(prompt('claim'), /resume only missing stages/i);
  assert.match(prompt('claim'), /manual repair/i);
  assert.match(prompt('release'), /restore[\s\S]*only when[\s\S]*recorded/i);
  assert.match(prompt('release'), /must not invent/i);
  assert.match(prompt('reclaim'), /direct ownership transfer/i);
  assert.match(prompt('reclaim'), /must not requeue|never requeue/i);
});

test('manual ambiguity asks once and cancellation preserves the claim without mutation', () => {
  const value = buildTicketPrompt({
    operation: 'build',
    sourceKind: 'github',
    ticketRef: '#10',
    runId: 'run-1',
    claimId: 'claim-1',
    actionKey: 'action-1',
    attempt: 0,
    manual: true,
  });
  assert.match(value, /exactly one bounded ask_user question/i);
  assert.match(value, /persist.*resolved.*fact/i);
  assert.match(value, /cancel.*claim.*blocked.*no mutation/is);

  const retry = buildTicketPrompt({
    operation: 'build',
    sourceKind: 'github',
    ticketRef: '#10',
    runId: 'run-1',
    claimId: 'claim-1',
    actionKey: 'action-1',
    attempt: 0,
    manual: true,
    pendingClarification: {
      kind: 'completion-transition',
      prompt: 'Close or keep open?',
    },
  });
  assert.match(retry, /Pending clarification: completion-transition/);
  assert.match(retry, /Close or keep open\?/);
  assert.match(retry, /return.*resolution.*result envelope/is);
});

test('lifecycle prompts lock scope before edits and require targeted owned mutation', () => {
  const build = buildTicketPrompt({
    operation: 'build',
    sourceKind: 'local',
    ticketRef: 'ticket.md',
    runId: 'run-1',
    claimId: 'claim-1',
    actionKey: 'action-1',
    attempt: 0,
  });
  assert.match(
    build,
    /repository scope[\s\S]*locked[\s\S]*before[\s\S]*code edit/i,
  );
  assert.match(build, /exact acceptance criteria/i);
  assert.match(
    build,
    /Implemented.*only.*every required acceptance criterion/is,
  );

  const simplify = buildTicketPrompt({
    operation: 'simplify',
    sourceKind: 'local',
    ticketRef: 'ticket.md',
    runId: 'run-1',
    claimId: 'claim-1',
    actionKey: 'action-2',
    attempt: 0,
  });
  assert.match(simplify, /only after BUILD and before VERIFY/i);
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
