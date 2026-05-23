import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  repositoryScopeForPlan,
  repositoryScopesForPlan,
} from '../extensions/workflow-monitor/repository-scope.ts';

function createPlanRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-addy-repository-scope-'));
  mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
  return root;
}

test('repository scope includes base cwd and explicit repository scope values', () => {
  const root = createPlanRoot();
  const planPath = join(root, 'docs', 'plans', 'slice.md');
  writeFileSync(
    planPath,
    ['# Slice', 'Repository scope: current repository, `../companion`;'].join(
      '\n',
    ),
  );

  assert.deepEqual(repositoryScopesForPlan(planPath, root), [
    root,
    resolve(root, '../companion'),
  ]);
});

test('repository scope resolves relative index plan owner and companion repos', () => {
  const root = createPlanRoot();
  const indexPath = join(root, 'docs', 'plans', 'index.md');
  const slicePath = join(root, 'docs', 'plans', 'slices', 'slice.md');
  mkdirSync(join(root, 'docs', 'plans', 'slices'), { recursive: true });
  writeFileSync(
    indexPath,
    [
      '# Index',
      '**Owner repo:** current repository',
      '**Companion repo:** sibling `../companion-repo`',
    ].join('\n'),
  );
  writeFileSync(slicePath, ['# Slice', 'Index: `../index.md`'].join('\n'));

  assert.equal(
    repositoryScopeForPlan(slicePath, root),
    [root, resolve(root, '../companion-repo')].join('; '),
  );
});

test('repository scope rejects generic prose fragments from unquoted scope lines', () => {
  const root = createPlanRoot();
  const planPath = join(root, 'docs', 'plans', 'slice.md');
  writeFileSync(
    planPath,
    [
      '# Slice',
      'Repository scope: current repository and any touched companion repo.',
    ].join('\n'),
  );

  assert.deepEqual(repositoryScopesForPlan(planPath, root), [root]);
});

test('repository scope resolves unquoted relative paths with only and punctuation', () => {
  const root = createPlanRoot();
  const planPath = join(root, 'docs', 'plans', 'slice.md');
  writeFileSync(
    planPath,
    ['# Slice', 'Repository scope: ../companion only;'].join('\n'),
  );

  assert.deepEqual(repositoryScopesForPlan(planPath, root), [
    root,
    resolve(root, '../companion'),
  ]);
});

test('repository scope falls back to base cwd when plan cannot be read', () => {
  const root = createPlanRoot();

  assert.deepEqual(repositoryScopesForPlan('missing.md', root), [root]);
});
