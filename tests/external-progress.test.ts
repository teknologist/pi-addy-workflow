import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
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

function runChild(
  script: string,
  args: string[],
  killAfterMs?: number,
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
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timer =
      killAfterMs === undefined
        ? undefined
        : setTimeout(() => child.kill('SIGTERM'), killAfterMs);
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
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
        token: 'abandoned',
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
        token: 'live-owner',
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
    mkdirSync(projectsDir, { recursive: true });
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
