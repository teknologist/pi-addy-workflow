import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  externalProgressProjectKey,
  externalProgressRoot,
  externalProgressRunsDir,
  finishExternalProgress,
  isExternalProgressStale,
  parseIssueImplementationProgressSnapshot,
  readExternalProgressProject,
  retainTerminalExternalProgress,
  selectExternalProgress,
  startExternalProgress,
  updateExternalProgress,
  writeExternalProgressSnapshot,
} from '../extensions/workflow-monitor/external-progress.ts';

const TIME = new Date('2026-07-14T12:00:00.000Z');

function createGitProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'addy-external-progress-'));
  writeFileSync(join(cwd, 'README.md'), 'fixture\n');
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {
    cwd,
    stdio: 'ignore',
  });
  execFileSync('git', ['config', 'user.name', 'Fixture'], {
    cwd,
    stdio: 'ignore',
  });
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'],
    {
      cwd,
      stdio: 'ignore',
    },
  );
  return cwd;
}

function setup(): { cwd: string; homeDir: string; cleanup: () => void } {
  const cwd = createGitProject();
  const homeDir = mkdtempSync(join(tmpdir(), 'addy-external-progress-home-'));
  return {
    cwd,
    homeDir,
    cleanup: () => {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    projectKey: 'a'.repeat(24),
    runId: '11111111-1111-4111-8111-111111111111',
    source: 'df-implement-issues',
    status: 'running',
    loopPhase: 'implementation',
    startedAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
    ...overrides,
  };
}

const EXTERNAL_PROGRESS_MODULE_URL = pathToFileURL(
  join(process.cwd(), 'extensions', 'workflow-monitor', 'external-progress.ts'),
).href;
const ADDY_PROGRESS_BIN = join(process.cwd(), 'bin', 'addy-progress.ts');

function runChild(
  script: string,
  args: string[],
  killAfterMs?: number,
  readinessLine?: string,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '--eval',
        script,
        ...args,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let ready = readinessLine === undefined;
    let timeoutError: Error | undefined;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      stdoutBuffer += chunk;
      if (!ready && stdoutBuffer.includes(`${readinessLine}\n`)) {
        ready = true;
        clearTimeout(readinessTimer);
        child.stdin.end('CONTINUE\n');
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const readinessTimer = setTimeout(() => {
      if (ready) return;
      timeoutError = new Error(
        `Timed out waiting for child readiness line ${readinessLine}`,
      );
      child.kill('SIGTERM');
    }, 15_000);
    const completionTimer = setTimeout(() => {
      timeoutError = new Error('Timed out waiting for child completion');
      child.kill('SIGTERM');
    }, 30_000);
    const killTimer =
      killAfterMs === undefined
        ? undefined
        : setTimeout(() => child.kill('SIGTERM'), killAfterMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(readinessTimer);
      clearTimeout(completionTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (timeoutError !== undefined) {
        reject(timeoutError);
        return;
      }
      if (!ready) {
        reject(
          new Error(
            `Child exited before publishing readiness line ${readinessLine}`,
          ),
        );
        return;
      }
      resolvePromise({ code, stdout, stderr });
    });
  });
}

test('addy-progress CLI starts, updates, and finishes through JSON stdin', () => {
  const fixture = setup();
  try {
    const env = { ...process.env, HOME: fixture.homeDir };
    const start = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        ADDY_PROGRESS_BIN,
        'start',
        '--cwd',
        fixture.cwd,
        '--source',
        'df-implement-issues',
      ],
      { encoding: 'utf8', env },
    );
    assert.equal(start.status, 0, start.stderr);
    assert.match(start.stdout, /^[0-9a-f-]{36}\n$/);
    assert.equal(start.stderr, '');
    const runId = start.stdout.trim();

    const update = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        ADDY_PROGRESS_BIN,
        'update',
        '--cwd',
        fixture.cwd,
        '--source',
        'df-implement-issues',
        '--run',
        runId,
        '--stdin',
      ],
      {
        encoding: 'utf8',
        env,
        input: JSON.stringify({
          loopPhase: 'queue',
          progressUnit: 'issues',
          currentItem: 'Issue one',
          completed: 0,
          total: 1,
        }),
      },
    );
    assert.equal(update.status, 0, update.stderr);
    assert.equal(update.stdout, '');

    const wrongOwner = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        ADDY_PROGRESS_BIN,
        'update',
        '--cwd',
        fixture.cwd,
        '--source',
        'implement-from-issues',
        '--run',
        runId,
        '--stdin',
      ],
      { encoding: 'utf8', env, input: '{}' },
    );
    assert.notEqual(wrongOwner.status, 0);
    assert.match(wrongOwner.stderr, /Cannot read external progress run/);

    const finish = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        ADDY_PROGRESS_BIN,
        'finish',
        '--cwd',
        fixture.cwd,
        '--source',
        'df-implement-issues',
        '--run',
        runId,
        '--stdin',
      ],
      {
        encoding: 'utf8',
        env,
        input: JSON.stringify({ status: 'completed', completed: 1 }),
      },
    );
    assert.equal(finish.status, 0, finish.stderr);
    assert.equal(finish.stdout, '');
    const repeatedFinish = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        ADDY_PROGRESS_BIN,
        'finish',
        '--cwd',
        fixture.cwd,
        '--source',
        'df-implement-issues',
        '--run',
        runId,
        '--stdin',
      ],
      {
        encoding: 'utf8',
        env,
        input: JSON.stringify({ status: 'completed' }),
      },
    );
    assert.notEqual(repeatedFinish.status, 0);
    assert.match(repeatedFinish.stderr, /immutable/);
    assert.equal(
      readExternalProgressProject({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }).snapshots[0]?.status,
      'completed',
    );
  } finally {
    fixture.cleanup();
  }
});

test('addy-progress CLI reuses the active implement-from-issues publication', () => {
  const fixture = setup();
  try {
    const env = { ...process.env, HOME: fixture.homeDir };
    const args = [
      '--experimental-strip-types',
      ADDY_PROGRESS_BIN,
      'start',
      '--cwd',
      fixture.cwd,
      '--source',
      'implement-from-issues',
    ];

    const direct = spawnSync(process.execPath, args, { encoding: 'utf8', env });
    assert.equal(direct.status, 0, direct.stderr);

    const wakeUp = spawnSync(process.execPath, args, { encoding: 'utf8', env });
    assert.equal(wakeUp.status, 0, wakeUp.stderr);
    assert.equal(wakeUp.stdout, direct.stdout);

    const project = readExternalProgressProject({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    assert.equal(project.snapshots.length, 1);
    assert.equal(project.snapshots[0]?.source, 'implement-from-issues');
    assert.equal(project.snapshots[0]?.runId, direct.stdout.trim());
  } finally {
    fixture.cleanup();
  }
});

test('addy-progress CLI rejects invalid commands and stdin concisely', () => {
  const fixture = setup();
  try {
    const env = { ...process.env, HOME: fixture.homeDir };
    const invalid = spawnSync(
      process.execPath,
      ['--experimental-strip-types', ADDY_PROGRESS_BIN, 'unknown'],
      { encoding: 'utf8', env },
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /^addy-progress: unknown command:/);
    assert.equal(invalid.stderr.trim().split('\n').length, 1);

    const duplicate = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        ADDY_PROGRESS_BIN,
        'start',
        '--cwd',
        fixture.cwd,
        '--cwd',
        fixture.cwd,
        '--source',
        'df-implement-issues',
      ],
      { encoding: 'utf8', env },
    );
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /duplicate option: --cwd/);

    const malformed = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        ADDY_PROGRESS_BIN,
        'update',
        '--cwd',
        fixture.cwd,
        '--source',
        'df-implement-issues',
        '--run',
        '11111111-1111-4111-8111-111111111111',
        '--stdin',
      ],
      { encoding: 'utf8', env, input: '{' },
    );
    assert.notEqual(malformed.status, 0);
    assert.equal(
      malformed.stderr,
      'addy-progress: stdin must contain valid JSON\n',
    );

    const oversized = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        ADDY_PROGRESS_BIN,
        'update',
        '--cwd',
        fixture.cwd,
        '--source',
        'df-implement-issues',
        '--run',
        '11111111-1111-4111-8111-111111111111',
        '--stdin',
      ],
      { encoding: 'utf8', env, input: 'x'.repeat(16 * 1024 + 1) },
    );
    assert.notEqual(oversized.status, 0);
    assert.equal(
      oversized.stderr,
      'addy-progress: stdin payload is too large\n',
    );
  } finally {
    fixture.cleanup();
  }
});

function processStartIdentity(pid: number): string | undefined {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/)[19];
    }
    if (process.platform === 'darwin') {
      return (
        execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || undefined
      );
    }
  } catch {
    // Process start identities are unavailable on this platform.
  }
  return undefined;
}

test('strictly parses schema-v1 snapshots and rejects invalid or unknown fields', () => {
  assert.deepEqual(
    parseIssueImplementationProgressSnapshot(snapshot()),
    snapshot(),
  );
  assert.throws(() =>
    parseIssueImplementationProgressSnapshot(snapshot({ unexpected: true })),
  );
  assert.throws(() =>
    parseIssueImplementationProgressSnapshot(snapshot({ status: 'paused' })),
  );
  assert.throws(() =>
    parseIssueImplementationProgressSnapshot(snapshot({ completed: -1 })),
  );
  assert.throws(() =>
    parseIssueImplementationProgressSnapshot(
      snapshot({ startedAt: 'not-a-date' }),
    ),
  );
});

test('normalizes display text and enforces a 256 Unicode code-point boundary', () => {
  const currentItem = `  cafe\u0301\n\tissue  `;
  assert.equal(
    parseIssueImplementationProgressSnapshot(snapshot({ currentItem }))
      .currentItem,
    'café issue',
  );
  assert.equal(
    parseIssueImplementationProgressSnapshot(
      snapshot({ currentItem: '😀'.repeat(256) }),
    ).currentItem,
    '😀'.repeat(256),
  );
  assert.throws(() =>
    parseIssueImplementationProgressSnapshot(
      snapshot({ currentItem: '😀'.repeat(257) }),
    ),
  );
});

test('accepts loop cycles but rejects arbitrary phase regressions', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      total: 2,
      now: TIME,
    });
    for (const loopPhase of [
      'queue',
      'implementation',
      'verification',
      'review-fix',
      'implementation',
      'verification',
      'review-fix',
      'commit-merge',
      'queue',
    ] as const) {
      updateExternalProgress({
        runId: run.runId,
        homeDir: fixture.homeDir,
        patch: { loopPhase },
        now: TIME,
      });
    }
    assert.throws(() =>
      updateExternalProgress({
        runId: run.runId,
        homeDir: fixture.homeDir,
        patch: { loopPhase: 'pre-loop' },
        now: TIME,
      }),
    );
  } finally {
    fixture.cleanup();
  }
});

test('updates use merge-patch semantics and enforce counter invariants', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      progressUnit: 'issues',
      currentItem: 'Issue one',
      completed: 0,
      now: TIME,
    });
    const updated = updateExternalProgress({
      runId: run.runId,
      homeDir: fixture.homeDir,
      patch: { loopPhase: 'queue', completed: 1, total: 3 },
      now: new Date(TIME.getTime() + 1),
    });
    assert.equal(updated.currentItem, 'Issue one');
    assert.equal(updated.progressUnit, 'issues');
    assert.equal(updated.total, 3);
    assert.throws(() =>
      updateExternalProgress({
        runId: run.runId,
        homeDir: fixture.homeDir,
        patch: { total: 4 },
        now: new Date(TIME.getTime() + 2),
      }),
    );
    assert.throws(() =>
      updateExternalProgress({
        runId: run.runId,
        homeDir: fixture.homeDir,
        patch: { completed: 0 },
        now: new Date(TIME.getTime() + 2),
      }),
    );
    assert.throws(() =>
      updateExternalProgress({
        runId: run.runId,
        homeDir: fixture.homeDir,
        patch: { completed: 4 },
        now: new Date(TIME.getTime() + 2),
      }),
    );
  } finally {
    fixture.cleanup();
  }
});

test('active status can move from running to blocked and back', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    const blocked = updateExternalProgress({
      runId: run.runId,
      homeDir: fixture.homeDir,
      patch: { status: 'blocked' },
      now: new Date(TIME.getTime() + 1),
    });
    const resumed = updateExternalProgress({
      runId: run.runId,
      homeDir: fixture.homeDir,
      patch: { status: 'running' },
      now: new Date(TIME.getTime() + 2),
    });
    assert.equal(blocked.status, 'blocked');
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.updatedAt, '2026-07-14T12:00:00.002Z');
  } finally {
    fixture.cleanup();
  }
});

test('terminal status patches are rejected without mutating active snapshots', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    assert.throws(
      () =>
        updateExternalProgress({
          runId: run.runId,
          homeDir: fixture.homeDir,
          patch: { status: 'completed' },
          now: new Date(TIME.getTime() + 1),
        }),
      /Use finishExternalProgress/,
    );
    const stored = readExternalProgressProject({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    }).snapshots[0];
    assert.equal(stored?.status, 'running');
    assert.equal(stored?.finishedAt, undefined);
  } finally {
    fixture.cleanup();
  }
});

test('terminal snapshots require timestamps and cannot change afterwards', () => {
  assert.throws(() =>
    parseIssueImplementationProgressSnapshot(
      snapshot({ status: 'completed', finishedAt: undefined }),
    ),
  );
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    const finished = finishExternalProgress({
      runId: run.runId,
      homeDir: fixture.homeDir,
      status: 'completed',
      now: new Date(TIME.getTime() + 1),
    });
    assert.equal(finished.finishedAt, '2026-07-14T12:00:00.001Z');
    assert.throws(() =>
      updateExternalProgress({
        runId: run.runId,
        homeDir: fixture.homeDir,
        patch: { currentItem: 'changed' },
      }),
    );
    assert.throws(() =>
      finishExternalProgress({
        runId: run.runId,
        homeDir: fixture.homeDir,
        status: 'failed',
      }),
    );
  } finally {
    fixture.cleanup();
  }
});

test('non-repository paths use a stable project key', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'addy-external-progress-non-git-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'addy-external-progress-home-'));
  try {
    assert.equal(
      externalProgressProjectKey({ cwd }),
      externalProgressProjectKey({ cwd: join(cwd, '.') }),
    );
    const run = startExternalProgress({
      cwd,
      homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    assert.equal(
      readExternalProgressProject({ cwd, homeDir }).snapshots[0]?.runId,
      run.runId,
    );
    assert.equal(
      selectExternalProgress({ cwd: join(cwd, '.'), homeDir }).active[0]
        ?.snapshot.runId,
      run.runId,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('propagates invalid Git common-directory output instead of falling back to cwd', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'addy-external-progress-git-output-'));
  try {
    const script = `
      import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const originalExecFileSync = childProcess.execFileSync;
      childProcess.execFileSync = (file, args, options) =>
        file === 'git' && args?.join(' ') === 'rev-parse --path-format=absolute --git-common-dir'
          ? 'relative/.git\\n'
          : originalExecFileSync(file, args, options);
      syncBuiltinESMExports();
      const { externalProgressProjectKey } = await import(${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)});
      assert.throws(
        () => externalProgressProjectKey({ cwd: process.argv[1] }),
        /Git did not return an absolute common directory/,
      );
    `;
    const result = await runChild(script, [cwd]);
    assert.equal(result.code, 0, result.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('propagates Git command failures other than not-a-repository', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'addy-external-progress-git-error-'));
  try {
    const script = `
      import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const originalExecFileSync = childProcess.execFileSync;
      childProcess.execFileSync = (file, args, options) => {
        if (file === 'git' && args?.join(' ') === 'rev-parse --path-format=absolute --git-common-dir') {
          const error = new Error('Git command failed');
          error.stderr = 'fatal: unable to read repository\\n';
          throw error;
        }
        return originalExecFileSync(file, args, options);
      };
      syncBuiltinESMExports();
      const { externalProgressProjectKey } = await import(${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)});
      assert.throws(
        () => externalProgressProjectKey({ cwd: process.argv[1] }),
        /Git command failed/,
      );
    `;
    const result = await runChild(script, [cwd]);
    assert.equal(result.code, 0, result.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('main checkouts and worktrees share a canonical project key', () => {
  const fixture = setup();
  const worktree = join(
    tmpdir(),
    `addy-external-progress-worktree-${process.pid}`,
  );
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktree], {
      cwd: fixture.cwd,
      stdio: 'ignore',
    });
    assert.equal(
      externalProgressProjectKey({ cwd: fixture.cwd }),
      externalProgressProjectKey({ cwd: worktree }),
    );
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: fixture.cwd,
      stdio: 'ignore',
    });
    fixture.cleanup();
  }
});

test('writes only outside the checkout and uses atomic per-run files', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    const runsDir = externalProgressRunsDir({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    assert.ok(realpathSync(runsDir).startsWith(realpathSync(fixture.homeDir)));
    assert.ok(existsSync(join(runsDir, `${run.runId}.json`)));
    assert.equal(
      readdirSync(runsDir).filter((name) => name.includes('.tmp-')).length,
      0,
    );
    assert.equal(
      execFileSync('git', ['status', '--short'], {
        cwd: fixture.cwd,
        encoding: 'utf8',
      }),
      '',
    );
  } finally {
    fixture.cleanup();
  }
});

test('concurrent starts reuse one active run per project and source', () => {
  const fixture = setup();
  try {
    const starts = Array.from({ length: 20 }, () =>
      startExternalProgress({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
        source: 'implement-from-issues',
        now: TIME,
      }),
    );
    assert.equal(new Set(starts.map((run) => run.runId)).size, 1);
    const second = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    assert.equal(
      readdirSync(
        externalProgressRunsDir({ cwd: fixture.cwd, homeDir: fixture.homeDir }),
      ).length,
      2,
    );
    assert.notEqual(starts[0]?.runId, second.runId);
  } finally {
    fixture.cleanup();
  }
});

test('blocked runs are reused and resume without resetting progress', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'implement-from-issues',
      now: TIME,
    });
    const blocked = updateExternalProgress({
      runId: run.runId,
      homeDir: fixture.homeDir,
      patch: {
        status: 'blocked',
        loopPhase: 'queue',
        progressUnit: 'issues',
        currentItem: 'Issue two',
        completed: 1,
        total: 3,
      },
      now: new Date(TIME.getTime() + 1),
    });

    const reused = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'implement-from-issues',
      now: new Date(TIME.getTime() + 2),
    });
    assert.deepEqual(reused, blocked);

    const resumed = updateExternalProgress({
      runId: run.runId,
      homeDir: fixture.homeDir,
      patch: { status: 'running' },
      now: new Date(TIME.getTime() + 3),
    });
    assert.equal(resumed.runId, run.runId);
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.loopPhase, 'queue');
    assert.equal(resumed.currentItem, 'Issue two');
    assert.equal(resumed.completed, 1);
    assert.equal(resumed.total, 3);
  } finally {
    fixture.cleanup();
  }
});

test('separate processes serialize concurrent starts to one active run', async () => {
  const fixture = setup();
  try {
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      const run = startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
      process.stdout.write(run.runId);
    `;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        runChild(script, [fixture.cwd, fixture.homeDir]),
      ),
    );
    assert.equal(
      results.every((result) => result.code === 0),
      true,
    );
    assert.equal(new Set(results.map((result) => result.stdout)).size, 1);
    assert.equal(
      readExternalProgressProject({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }).snapshots.filter((entry) => entry.status === 'running').length,
      1,
    );
  } finally {
    fixture.cleanup();
  }
});

test('competing processes safely reclaim an abandoned start lock', async () => {
  const fixture = setup();
  try {
    const first = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    finishExternalProgress({
      runId: first.runId,
      homeDir: fixture.homeDir,
      status: 'completed',
      now: new Date(TIME.getTime() + 1),
    });
    const runsDir = externalProgressRunsDir({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    const lockPath = join(runsDir, '.start.lock');
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: Number.MAX_SAFE_INTEGER,
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: Date.now(),
      }),
    );
    writeFileSync(
      `${lockPath}.reclaim-${Number.MAX_SAFE_INTEGER}-abandoned`,
      'orphaned quarantine',
    );
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      const run = startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'df-implement-issues',
      });
      process.stdout.write(run.runId);
    `;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        runChild(script, [fixture.cwd, fixture.homeDir]),
      ),
    );
    assert.equal(
      results.every((result) => result.code === 0),
      true,
    );
    assert.equal(new Set(results.map((result) => result.stdout)).size, 1);
    assert.equal(existsSync(lockPath), false);
    assert.equal(
      readdirSync(runsDir).some((name) => name.includes('.reclaim-')),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test('reclaims a lock when a live PID has been reused', async () => {
  const fixture = setup();
  try {
    startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    const lockPath = join(
      externalProgressRunsDir({ cwd: fixture.cwd, homeDir: fixture.homeDir }),
      '.start.lock',
    );
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        pidStartedAt: 'reused-process',
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: 0,
      }),
    );
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(script, [fixture.cwd, fixture.homeDir]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(lockPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('reclaims a Windows lock when its live PID has a different instance identity', async () => {
  const fixture = setup();
  try {
    startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    const lockPath = join(
      externalProgressRunsDir({ cwd: fixture.cwd, homeDir: fixture.homeDir }),
      '.start.lock',
    );
    const script = `
      import childProcess from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const originalExecFileSync = childProcess.execFileSync;
      childProcess.execFileSync = (file, args, options) =>
        file === 'powershell.exe'
          ? '638000000000000001\\n'
          : originalExecFileSync(file, args, options);
      syncBuiltinESMExports();
      const { startExternalProgress } = await import(${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)});
      writeFileSync(process.argv[3], JSON.stringify({
        pid: process.pid,
        pidStartedAt: '638000000000000000',
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: 0,
      }));
      process.stdout.write('LOCK_OWNER_PUBLISHED\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(
      script,
      [fixture.cwd, fixture.homeDir, lockPath],
      undefined,
      'LOCK_OWNER_PUBLISHED',
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(lockPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('does not steal a Windows lock owned by a matching live instance', async () => {
  const fixture = setup();
  try {
    startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    const lockPath = join(
      externalProgressRunsDir({ cwd: fixture.cwd, homeDir: fixture.homeDir }),
      '.start.lock',
    );
    const script = `
      import childProcess from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const originalExecFileSync = childProcess.execFileSync;
      childProcess.execFileSync = (file, args, options) =>
        file === 'powershell.exe'
          ? '638000000000000001\\n'
          : originalExecFileSync(file, args, options);
      syncBuiltinESMExports();
      const { startExternalProgress } = await import(${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)});
      writeFileSync(process.argv[3], JSON.stringify({
        pid: process.pid,
        pidStartedAt: '638000000000000001',
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: 0,
      }));
      process.stdout.write('LOCK_OWNER_PUBLISHED\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      let dateNowCalls = 0;
      Date.now = () => (dateNowCalls++ === 0 ? 0 : 5_000);
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(
      script,
      [fixture.cwd, fixture.homeDir, lockPath],
      undefined,
      'LOCK_OWNER_PUBLISHED',
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Could not acquire external progress lock/);
    assert.equal(existsSync(lockPath), true);
    const lockedOwner = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.equal(lockedOwner.pidStartedAt, '638000000000000001');
    assert.equal(lockedOwner.token, '11111111-1111-4111-8111-111111111111');
    assert.equal(Number.isSafeInteger(lockedOwner.pid), true);
  } finally {
    fixture.cleanup();
  }
});

test('does not steal a macOS lock when same-second process identity is ambiguous', async () => {
  const fixture = setup();
  try {
    startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    const lockPath = join(
      externalProgressRunsDir({ cwd: fixture.cwd, homeDir: fixture.homeDir }),
      '.start.lock',
    );
    const script = `
      import childProcess from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const originalExecFileSync = childProcess.execFileSync;
      childProcess.execFileSync = (file, args, options) =>
        file === 'ps'
          ? 'Wed Jul 14 12:00:00 2026\\n'
          : originalExecFileSync(file, args, options);
      syncBuiltinESMExports();
      const { startExternalProgress } = await import(${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)});
      writeFileSync(process.argv[3], JSON.stringify({
        pid: process.pid,
        pidStartedAt: 'Wed Jul 14 12:00:00 2026',
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: 0,
      }));
      process.stdout.write('LOCK_OWNER_PUBLISHED\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      let dateNowCalls = 0;
      Date.now = () => (dateNowCalls++ === 0 ? 0 : 5_000);
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(
      script,
      [fixture.cwd, fixture.homeDir, lockPath],
      undefined,
      'LOCK_OWNER_PUBLISHED',
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Could not acquire external progress lock/);
    assert.equal(existsSync(lockPath), true);
  } finally {
    fixture.cleanup();
  }
});

test('never steals an old lock owned by a live process', async () => {
  const fixture = setup();
  try {
    startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    const lockPath = join(
      externalProgressRunsDir({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }),
      '.start.lock',
    );
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: 0,
      }),
    );
    utimesSync(lockPath, new Date(0), new Date(0));
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(script, [fixture.cwd, fixture.homeDir], 250);
    assert.notEqual(result.code, 0);
    assert.equal(existsSync(lockPath), true);
    assert.equal(
      readExternalProgressProject({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }).snapshots.some((entry) => entry.source === 'implement-from-issues'),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test('restores a live owner quarantined by a dead reclaimer', async () => {
  const fixture = setup();
  try {
    const first = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    finishExternalProgress({
      runId: first.runId,
      homeDir: fixture.homeDir,
      status: 'completed',
    });
    const lockPath = join(
      externalProgressRunsDir({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }),
      '.start.lock',
    );
    const owner = JSON.stringify({
      pid: process.pid,
      token: '11111111-1111-4111-8111-111111111111',
      createdAt: Date.now(),
    });
    const marker = `${lockPath}.reclaim-${Number.MAX_SAFE_INTEGER}-dead`;
    writeFileSync(marker, owner);
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(script, [fixture.cwd, fixture.homeDir]);
    assert.notEqual(result.code, 0);
    assert.equal(existsSync(marker), false);
    assert.equal(readFileSync(lockPath, 'utf8'), owner);
  } finally {
    fixture.cleanup();
  }
});

test('never steals a matching live PID identity even when the lock is old', async (t) => {
  const identity = processStartIdentity(process.pid);
  if (identity === undefined) {
    t.skip('process start identities are unavailable');
    return;
  }
  const fixture = setup();
  try {
    startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    const lockPath = join(
      externalProgressRunsDir({ cwd: fixture.cwd, homeDir: fixture.homeDir }),
      '.start.lock',
    );
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        pidStartedAt: identity,
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: 0,
      }),
    );
    utimesSync(lockPath, new Date(0), new Date(0));
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(script, [fixture.cwd, fixture.homeDir], 250);
    assert.notEqual(result.code, 0);
    assert.equal(existsSync(lockPath), true);
  } finally {
    fixture.cleanup();
  }
});

test('reused reclaimer PID markers do not block recovery', async () => {
  const fixture = setup();
  try {
    const first = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    finishExternalProgress({
      runId: first.runId,
      homeDir: fixture.homeDir,
      status: 'completed',
    });
    const lockPath = join(
      externalProgressRunsDir({ cwd: fixture.cwd, homeDir: fixture.homeDir }),
      '.start.lock',
    );
    const marker = `${lockPath}.reclaim-${process.pid}-0000000000000000-dead`;
    writeFileSync(marker, 'orphaned quarantine');
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(script, [fixture.cwd, fixture.homeDir]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(marker), false);
  } finally {
    fixture.cleanup();
  }
});

test('quarantined owners are restored only when their process identity matches', async () => {
  const fixture = setup();
  try {
    const first = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    finishExternalProgress({
      runId: first.runId,
      homeDir: fixture.homeDir,
      status: 'completed',
    });
    const lockPath = join(
      externalProgressRunsDir({ cwd: fixture.cwd, homeDir: fixture.homeDir }),
      '.start.lock',
    );
    const marker = `${lockPath}.reclaim-${Number.MAX_SAFE_INTEGER}-dead`;
    writeFileSync(
      marker,
      JSON.stringify({
        pid: process.pid,
        pidStartedAt: 'reused-owner',
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: 0,
      }),
    );
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(script, [fixture.cwd, fixture.homeDir]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(lockPath), false);
  } finally {
    fixture.cleanup();
  }
});

test('reclaims stale valid JSON with an invalid PID', () => {
  const fixture = setup();
  try {
    const first = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    finishExternalProgress({
      runId: first.runId,
      homeDir: fixture.homeDir,
      status: 'completed',
    });
    const lockPath = join(
      externalProgressRunsDir({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }),
      '.start.lock',
    );
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 0,
        token: '11111111-1111-4111-8111-111111111111',
        createdAt: 0,
      }),
    );
    utimesSync(lockPath, new Date(0), new Date(0));
    const next = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    assert.notEqual(next.runId, first.runId);
  } finally {
    fixture.cleanup();
  }
});

test('does not reclaim a freshly created lock before metadata publication', async () => {
  const fixture = setup();
  try {
    startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    const lockPath = join(
      externalProgressRunsDir({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }),
      '.start.lock',
    );
    writeFileSync(lockPath, '');
    const script = `
      import { startExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'implement-from-issues',
      });
    `;
    const result = await runChild(script, [fixture.cwd, fixture.homeDir], 250);
    assert.notEqual(result.code, 0);
    assert.equal(existsSync(lockPath), true);
  } finally {
    fixture.cleanup();
  }
});

test('raw snapshot creation cannot overwrite an immutable terminal run', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    const finished = finishExternalProgress({
      runId: run.runId,
      homeDir: fixture.homeDir,
      status: 'completed',
      now: new Date(TIME.getTime() + 1),
    });
    const { finishedAt: _finishedAt, ...withoutFinishedAt } = finished;
    assert.throws(() =>
      writeExternalProgressSnapshot(
        {
          ...withoutFinishedAt,
          status: 'running',
          updatedAt: new Date(TIME.getTime() + 2).toISOString(),
        },
        { homeDir: fixture.homeDir },
      ),
    );
    assert.equal(
      readExternalProgressProject({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }).snapshots[0]?.status,
      'completed',
    );
  } finally {
    fixture.cleanup();
  }
});

test('allows ordinary shared Pi ancestors while keeping external progress storage private', () => {
  const fixture = setup();
  try {
    const piDir = join(fixture.homeDir, '.pi');
    const addyDir = join(piDir, 'addy-workflow');
    mkdirSync(addyDir, { recursive: true, mode: 0o755 });
    chmodSync(piDir, 0o755);
    chmodSync(addyDir, 0o755);

    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    const projectKey = externalProgressProjectKey({ cwd: fixture.cwd });
    const externalProgressDir = join(addyDir, 'external-progress');
    const directories = [
      externalProgressDir,
      join(externalProgressDir, 'projects'),
      join(externalProgressDir, 'projects', projectKey),
      join(externalProgressDir, 'projects', projectKey, 'runs'),
    ];

    assert.equal(statSync(piDir).mode & 0o777, 0o755);
    for (const directory of directories) {
      assert.equal(statSync(directory).mode & 0o077, 0, directory);
    }
    assert.equal(
      existsSync(join(directories.at(-1)!, `${run.runId}.json`)),
      true,
    );
  } finally {
    fixture.cleanup();
  }
});

test('accepts synthetic group-readable storage modes on win32 without weakening path anchoring', async () => {
  const fixture = setup();
  try {
    const script = `
      import fs from 'node:fs';
      import { resolve } from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const originalLstatSync = fs.lstatSync;
      fs.lstatSync = (path, options) => {
        const stat = originalLstatSync(path, options);
        const absolutePath = resolve(process.cwd(), String(path));
        if (!absolutePath.includes('external-progress')) return stat;
        return new Proxy(stat, {
          get(target, property) {
            if (property === 'mode') return target.mode | 0o077n;
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };
      syncBuiltinESMExports();
      const { startExternalProgress } = await import(${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)});
      startExternalProgress({
        cwd: process.argv[1],
        homeDir: process.argv[2],
        source: 'df-implement-issues',
      });
    `;
    const result = await runChild(script, [fixture.cwd, fixture.homeDir]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      readExternalProgressProject({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }).snapshots.length,
      1,
    );
  } finally {
    fixture.cleanup();
  }
});

test('rejects traversal keys and symlinked storage outside the configured root', () => {
  const fixture = setup();
  try {
    assert.throws(() =>
      retainTerminalExternalProgress({
        homeDir: fixture.homeDir,
        projectKey: '../../escape',
      }),
    );
    assert.equal(existsSync(join(fixture.homeDir, 'escape')), false);

    const projectKey = externalProgressProjectKey({ cwd: fixture.cwd });
    const projectsDir = join(
      externalProgressRoot({ homeDir: fixture.homeDir }),
      'projects',
    );
    const outside = join(fixture.homeDir, 'outside-storage');
    mkdirSync(projectsDir, { recursive: true, mode: 0o700 });
    mkdirSync(outside);
    symlinkSync(outside, join(projectsDir, projectKey));
    assert.throws(
      () =>
        startExternalProgress({
          cwd: fixture.cwd,
          homeDir: fixture.homeDir,
          source: 'df-implement-issues',
        }),
      /escapes its configured root/,
    );
    assert.equal(existsSync(join(outside, 'runs')), false);
  } finally {
    fixture.cleanup();
  }
});

test('ancestor replacement cannot redirect snapshot writes outside the configured home', async () => {
  const fixture = setup();
  const outside = mkdtempSync(
    join(tmpdir(), 'addy-external-progress-outside-'),
  );
  try {
    const projectKey = externalProgressProjectKey({ cwd: fixture.cwd });
    const runsDir = externalProgressRunsDir({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    mkdirSync(runsDir, { recursive: true, mode: 0o700 });
    const storageAncestor = join(
      fixture.homeDir,
      '.pi',
      'addy-workflow',
      'external-progress',
    );
    const script = `
      import fs from 'node:fs';
      import { renameSync, symlinkSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      let swapped = false;
      const originalWrite = fs.writeFileSync;
      fs.writeFileSync = (...args) => {
        if (!swapped && typeof args[0] === 'string' && args[0].includes('.tmp-')) {
          swapped = true;
          renameSync(process.argv[1], process.argv[1] + '.moved');
          symlinkSync(process.argv[2], process.argv[1]);
        }
        return originalWrite(...args);
      };
      syncBuiltinESMExports();
      process.on('exit', () => process.stdout.write(JSON.stringify({ swapped })));
      const { writeExternalProgressSnapshot } = await import(${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)});
      writeExternalProgressSnapshot(JSON.parse(process.argv[3]), { homeDir: process.argv[4] });
    `;
    const result = await runChild(script, [
      storageAncestor,
      outside,
      JSON.stringify(
        snapshot({
          projectKey,
          runId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
      fixture.homeDir,
    ]);
    assert.deepEqual(JSON.parse(result.stdout), { swapped: true });
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test('bounded mutation reads reject oversized snapshot files', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
    });
    const file = join(
      externalProgressRunsDir({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }),
      `${run.runId}.json`,
    );
    writeFileSync(file, ' '.repeat(64 * 1024 + 1));
    assert.throws(
      () =>
        updateExternalProgress({
          runId: run.runId,
          cwd: fixture.cwd,
          source: run.source,
          homeDir: fixture.homeDir,
          patch: { currentItem: 'must not read unbounded input' },
        }),
      /Cannot read external progress run/,
    );
    assert.equal(
      readExternalProgressProject({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }).diagnostics[0]?.message,
      'Snapshot exceeds the size limit',
    );
  } finally {
    fixture.cleanup();
  }
});

test('start fails safely when corrupt files prevent active-run ownership checks', () => {
  const fixture = setup();
  try {
    startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    const runsDir = externalProgressRunsDir({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    writeFileSync(join(runsDir, 'corrupt.json'), '{');
    assert.throws(
      () =>
        startExternalProgress({
          cwd: fixture.cwd,
          homeDir: fixture.homeDir,
          source: 'implement-from-issues',
        }),
      /Cannot establish external progress run ownership/,
    );
  } finally {
    fixture.cleanup();
  }
});

test('concurrent process updates cannot lower counters or resurrect a terminal run', async () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      completed: 0,
      total: 8,
      now: TIME,
    });
    const updateScript = `
      import { updateExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      updateExternalProgress({
        runId: process.argv[1],
        cwd: process.argv[2],
        source: 'df-implement-issues',
        homeDir: process.argv[3],
        patch: { completed: Number(process.argv[4]) },
      });
    `;
    const updates = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runChild(updateScript, [
          run.runId,
          fixture.cwd,
          fixture.homeDir,
          String(index + 1),
        ]),
      ),
    );
    assert.equal(
      updates.some((result) => result.code === 0),
      true,
    );
    assert.equal(
      readExternalProgressProject({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }).snapshots[0]?.completed,
      8,
    );

    const raceRun = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'implement-from-issues',
    });
    const mutationScript = `
      import { finishExternalProgress, updateExternalProgress } from ${JSON.stringify(EXTERNAL_PROGRESS_MODULE_URL)};
      const base = {
        runId: process.argv[2],
        cwd: process.argv[3],
        source: 'implement-from-issues',
        homeDir: process.argv[4],
      };
      if (process.argv[1] === 'finish')
        finishExternalProgress({ ...base, status: 'completed' });
      else updateExternalProgress({ ...base, patch: { loopPhase: 'queue' } });
    `;
    const [finishedResult] = await Promise.all([
      runChild(mutationScript, [
        'finish',
        raceRun.runId,
        fixture.cwd,
        fixture.homeDir,
      ]),
      ...Array.from({ length: 7 }, () =>
        runChild(mutationScript, [
          'update',
          raceRun.runId,
          fixture.cwd,
          fixture.homeDir,
        ]),
      ),
    ]);
    assert.equal(finishedResult?.code, 0);
    assert.equal(
      readExternalProgressProject({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
      }).snapshots.find((entry) => entry.runId === raceRun.runId)?.status,
      'completed',
    );
  } finally {
    fixture.cleanup();
  }
});

test('selects all active runs and the newest terminal with deterministic ties', () => {
  const fixture = setup();
  try {
    const active = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    const terminalOne = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'implement-from-issues',
      now: TIME,
    });
    finishExternalProgress({
      runId: terminalOne.runId,
      homeDir: fixture.homeDir,
      status: 'completed',
      now: TIME,
    });
    const terminalTwo = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'implement-from-issues',
      now: TIME,
    });
    finishExternalProgress({
      runId: terminalTwo.runId,
      homeDir: fixture.homeDir,
      status: 'failed',
      now: TIME,
    });
    const selected = selectExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      now: TIME,
    });
    assert.deepEqual(
      selected.active.map((entry) => entry.snapshot.runId),
      [active.runId],
    );
    assert.equal(
      selected.terminal?.snapshot.runId,
      [terminalOne.runId, terminalTwo.runId].sort().at(-1),
    );
  } finally {
    fixture.cleanup();
  }
});

test('derives stale after 30 minutes without changing the status', () => {
  const fixture = setup();
  try {
    const run = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    assert.equal(
      isExternalProgressStale(run, new Date(TIME.getTime() + 30 * 60 * 1000)),
      false,
    );
    const selected = selectExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      now: new Date(TIME.getTime() + 30 * 60 * 1000 + 1),
    });
    assert.equal(selected.active[0]?.stale, true);
    assert.equal(selected.active[0]?.snapshot.status, 'running');
  } finally {
    fixture.cleanup();
  }
});

test('readers fail open for corrupt, unsupported, and unreadable snapshots', () => {
  const fixture = setup();
  try {
    const runsDir = externalProgressRunsDir({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    writeExternalProgressSnapshot(
      snapshot({
        projectKey: externalProgressProjectKey({ cwd: fixture.cwd }),
        runId: '22222222-2222-4222-8222-222222222222',
      }),
      { homeDir: fixture.homeDir },
    );
    writeFileSync(join(runsDir, 'corrupt.json'), '{');
    writeFileSync(
      join(runsDir, 'unsupported.json'),
      JSON.stringify(snapshot({ schemaVersion: 2 })),
    );
    const unreadable = join(runsDir, 'unreadable.json');
    writeFileSync(
      unreadable,
      JSON.stringify(
        snapshot({ runId: '33333333-3333-4333-8333-333333333333' }),
      ),
    );
    const canTestUnreadable = process.getuid?.() !== 0;
    if (canTestUnreadable) chmodSync(unreadable, 0o000);
    const result = readExternalProgressProject({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    assert.equal(result.snapshots.length, canTestUnreadable ? 1 : 2);
    assert.ok(result.diagnostics.length >= 2);
    if (canTestUnreadable) chmodSync(unreadable, 0o600);
  } finally {
    fixture.cleanup();
  }
});

test('retention keeps active snapshots and newest ten terminals despite deletion races', () => {
  const fixture = setup();
  try {
    const active = startExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      source: 'df-implement-issues',
      now: TIME,
    });
    for (let index = 0; index < 12; index += 1) {
      const run = startExternalProgress({
        cwd: fixture.cwd,
        homeDir: fixture.homeDir,
        source: 'implement-from-issues',
        now: new Date(TIME.getTime() + index + 1),
      });
      finishExternalProgress({
        runId: run.runId,
        homeDir: fixture.homeDir,
        status: 'completed',
        now: new Date(TIME.getTime() + index + 1),
      });
    }
    retainTerminalExternalProgress({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    const result = readExternalProgressProject({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    assert.equal(
      result.snapshots.filter((entry) => entry.status === 'completed').length,
      10,
    );
    assert.ok(result.snapshots.some((entry) => entry.runId === active.runId));
  } finally {
    fixture.cleanup();
  }
});
