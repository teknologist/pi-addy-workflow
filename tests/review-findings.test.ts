import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewFindingsFingerprint,
  reviewIssueFindings,
  reviewIssueStatsFromText,
  reviewTextHasActionableFindings,
} from '../extensions/workflow-monitor/review-findings.ts';

test('review findings parser counts actionable sections and preserves warning severity', () => {
  const text = [
    'Critical Issues:',
    '- Data loss risk',
    'Warnings:',
    '- Retry state can drift',
    'Suggestions:',
    '- Rename helper',
  ].join('\n');

  assert.deepEqual(reviewIssueStatsFromText(text), {
    critical: 1,
    important: 1,
    suggestion: 1,
    unknown: 0,
    total: 3,
  });
  assert.equal(reviewTextHasActionableFindings(text), true);
});

test('review findings parser ignores clean proof host and port tokens', () => {
  const text = [
    'No issues found.',
    '- Live proof passed at http://localhost:3031',
    '- External check hit api.example.com:443 successfully',
    '- Smoke reached api.example.rs:443',
    '- Status reached status.example.sh:443',
  ].join('\n');

  assert.deepEqual(reviewIssueFindings(text), []);
  assert.equal(reviewTextHasActionableFindings(text), false);
});

test('review findings parser still catches file line citations next to urls', () => {
  assert.deepEqual(
    reviewIssueFindings(
      'fix src/server.ts:42 before review can pass — see http://localhost:3031 for repro',
    ),
    [
      {
        line: 'fix src/server.ts:42 before review can pass — see http://localhost:3031 for repro',
        severity: 'unknown',
      },
    ],
  );
});

test('review findings parser catches common extensionless file citations', () => {
  assert.deepEqual(reviewIssueFindings('Dockerfile:12 uses root user'), [
    { line: 'dockerfile:12 uses root user', severity: 'unknown' },
  ]);
  assert.deepEqual(reviewIssueFindings('- File/line: Makefile:8'), [
    { line: '- file/line: makefile:8', severity: 'unknown' },
  ]);
  assert.deepEqual(reviewIssueFindings('.env:3 exposes a secret'), [
    { line: '.env:3 exposes a secret', severity: 'unknown' },
  ]);
  assert.deepEqual(reviewIssueFindings('.gitignore:4 ignores build output'), [
    { line: '.gitignore:4 ignores build output', severity: 'unknown' },
  ]);
  assert.deepEqual(reviewIssueFindings('.dockerignore:2 leaks node_modules'), [
    { line: '.dockerignore:2 leaks node_modules', severity: 'unknown' },
  ]);
  assert.deepEqual(reviewIssueFindings('.npmrc:1 pins a bad registry'), [
    { line: '.npmrc:1 pins a bad registry', severity: 'unknown' },
  ]);
  assert.deepEqual(reviewIssueFindings('.env.local:5 exposes a secret'), [
    { line: '.env.local:5 exposes a secret', severity: 'unknown' },
  ]);
});

test('review findings fingerprint uses finding lines instead of surrounding prose', () => {
  const first = ['Important:', '- Fix src/a.ts:1', 'extra proof'].join('\n');
  const second = ['Important:', '- Fix src/a.ts:1', 'different proof'].join(
    '\n',
  );

  assert.equal(
    reviewFindingsFingerprint(first),
    reviewFindingsFingerprint(second),
  );
});
