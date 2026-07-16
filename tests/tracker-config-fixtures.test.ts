import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadTrackerFixture,
  validateTrackerFixture,
} from './fixtures/tracker-config/load.ts';

const cases = [
  {
    name: 'github',
    required: [
      'gh issue list',
      'gh issue view',
      'assigning the issue',
      'gh issue comment',
      '--add-label',
      '--remove-label',
      'gh issue close',
      'GitHub shares numbering between',
    ],
  },
  {
    name: 'linear',
    required: [
      'Linear skill/tools',
      'description, labels, status, assignee, project, cycle, and comments',
      'add a Linear comment',
      'Apply / remove labels',
      'completed or canceled state',
    ],
  },
  {
    name: 'local',
    required: [
      'issues/<NN>-<slug>.md',
      'Status:',
      '`claimed`/`resolved`',
      'Blocked by: NN, NN',
      '## Comments',
      'first by number wins',
    ],
  },
  {
    name: 'to-tickets-ticket',
    required: [
      '## What to build',
      '## Acceptance criteria',
      '- [ ]',
      '## Blocked by',
    ],
    forbidden: ['ADDY:TICKET-LIFECYCLE'],
  },
] as const;

for (const fixture of cases) {
  test(`${fixture.name} tracker contract is frozen and complete`, async () => {
    const content = await loadTrackerFixture(fixture.name);
    assert.doesNotThrow(() =>
      validateTrackerFixture(
        content,
        fixture.required,
        'forbidden' in fixture ? fixture.forbidden : [],
      ),
    );
  });
}

test('fixture validation rejects missing provenance and missing semantics', () => {
  assert.throws(
    () => validateTrackerFixture('# no provenance', []),
    /provenance/i,
  );
  assert.throws(
    () =>
      validateTrackerFixture(
        '<!-- provenance: source=x; sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; captured=2026-07-16 -->',
        ['required operation'],
      ),
    /required operation/,
  );
});
