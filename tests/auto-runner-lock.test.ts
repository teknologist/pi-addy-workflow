import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireAutoRunnerLock,
  autoRunnerLockDir,
  consumeAutoRunnerStopIntent,
  recordAutoRunnerStopIntent,
  releaseAutoRunnerLock,
  renewAutoRunnerLock,
  type AutoRunnerLock,
  type AutoRunnerLockDeps,
} from '../extensions/workflow-monitor/auto-runner-lock.ts';

async function withStateDir<T>(
  callback: (stateDir: string) => T | Promise<T>,
): Promise<T> {
  const previous = process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  const stateDir = mkdtempSync(join(tmpdir(), 'addy-auto-lock-'));
  process.env.PI_ADDY_WORKFLOW_STATE_DIR = stateDir;
  try {
    return await callback(stateDir);
  } finally {
    if (previous === undefined) delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
    else process.env.PI_ADDY_WORKFLOW_STATE_DIR = previous;
  }
}

function deps(
  overrides: Partial<AutoRunnerLockDeps> = {},
): Partial<AutoRunnerLockDeps> {
  return {
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    randomUUID: () => `uuid-${Math.random()}`,
    pid: () => 999,
    cwd: (ctx) => ctx?.cwd ?? '/repo',
    processCommand: () => 'pi',
    pidStartedAt: () => undefined,
    isPidAlive: () => true,
    sleep: async () => {},
    isChildProcess: () => false,
    ...overrides,
  };
}

function externalOwner(
  overrides: Partial<AutoRunnerLock> = {},
): AutoRunnerLock {
  return {
    version: 1,
    projectKey: 'project',
    instanceId: 'other-instance',
    runnerId: 'other-runner',
    fencingToken: 'other-token',
    pid: 123,
    cwd: '/other',
    activePlan: 'PLAN.md',
    acquiredAt: '2026-01-01T00:00:00.000Z',
    heartbeatAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:02:00.000Z',
    processCommand: 'pi',
    ...overrides,
  };
}

function writeOwner(ctx: { cwd: string }, owner: AutoRunnerLock): void {
  const lockDir = autoRunnerLockDir(ctx);
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(
    join(lockDir, 'owner.json'),
    `${JSON.stringify(owner)}\n`,
    'utf8',
  );
}

test('auto runner lock is isolated by project key inside a shared state dir', async () => {
  await withStateDir(async () => {
    const resultA = await acquireAutoRunnerLock(
      { cwd: '/project-a' },
      { deps: deps() },
    );
    const resultB = await acquireAutoRunnerLock(
      { cwd: '/project-b' },
      { deps: deps() },
    );

    assert.equal(resultA.status, 'owned');
    assert.equal(resultB.status, 'owned');
    assert.notEqual(
      autoRunnerLockDir({ cwd: '/project-a' }),
      autoRunnerLockDir({ cwd: '/project-b' }),
    );
  });
});

test('auto runner lock can be renewed and released only by its owner', async () => {
  await withStateDir(async () => {
    const ctx = { cwd: '/repo' };
    const first = await acquireAutoRunnerLock(ctx, {
      activePlan: 'PLAN.md',
      deps: deps(),
    });
    assert.equal(first.status, 'owned');
    const renewed = renewAutoRunnerLock(ctx, {
      lastActionKey: 'next',
      deps: deps(),
    });
    assert.equal(renewed.status, 'owned');
    if (renewed.status !== 'owned') throw new Error('expected ownership');
    assert.equal(renewed.lock.activePlan, 'PLAN.md');
    assert.equal(renewed.lock.lastActionKey, 'next');

    const released = releaseAutoRunnerLock(ctx, { deps: deps() });
    assert.equal(released.status, 'owned');
    assert.equal(existsSync(autoRunnerLockDir(ctx)), false);
  });
});

test('auto runner lock blocks a live different owner and ignores non-owner release', async () => {
  await withStateDir(async () => {
    const ctx = { cwd: '/repo' };
    writeOwner(ctx, externalOwner());

    const blocked = await acquireAutoRunnerLock(ctx, { deps: deps() });
    assert.equal(blocked.status, 'blocked');
    const release = releaseAutoRunnerLock(ctx, { deps: deps() });
    assert.equal(release.status, 'blocked');
    assert.equal(existsSync(autoRunnerLockDir(ctx)), true);
  });
});

test('auto runner lock reclaims dead, uncertain stale, reused-pid, and malformed owners', async () => {
  await withStateDir(async () => {
    const deadCtx = { cwd: '/dead' };
    writeOwner(deadCtx, externalOwner());
    assert.equal(
      (
        await acquireAutoRunnerLock(deadCtx, {
          deps: deps({ isPidAlive: () => false }),
        })
      ).status,
      'reclaimed',
    );

    const uncertainCtx = { cwd: '/uncertain' };
    writeOwner(
      uncertainCtx,
      externalOwner({ expiresAt: '2025-12-31T23:59:00.000Z' }),
    );
    assert.equal(
      (
        await acquireAutoRunnerLock(uncertainCtx, {
          staleRecheckMs: 0,
          deps: deps({ isPidAlive: () => 'unknown' }),
        })
      ).status,
      'reclaimed',
    );

    const reusedCtx = { cwd: '/reused' };
    writeOwner(reusedCtx, externalOwner({ pidStartedAt: 'old-start' }));
    assert.equal(
      (
        await acquireAutoRunnerLock(reusedCtx, {
          deps: deps({ pidStartedAt: () => 'new-start' }),
        })
      ).status,
      'reclaimed',
    );

    const malformedCtx = { cwd: '/malformed' };
    const malformedDir = autoRunnerLockDir(malformedCtx);
    mkdirSync(malformedDir, { recursive: true });
    writeFileSync(join(malformedDir, 'owner.json'), '{nope', 'utf8');
    assert.equal(
      (await acquireAutoRunnerLock(malformedCtx, { deps: deps() })).status,
      'reclaimed',
    );
  });
});

test('auto runner lock blocks while owner file is not published yet', async () => {
  await withStateDir(async () => {
    const ctx = { cwd: '/repo' };
    mkdirSync(autoRunnerLockDir(ctx), { recursive: true });

    const result = await acquireAutoRunnerLock(ctx, { deps: deps() });

    assert.equal(result.status, 'blocked');
    assert.equal(
      result.status === 'blocked' ? result.reason : '',
      'acquisition in progress',
    );
    assert.equal(existsSync(autoRunnerLockDir(ctx)), true);
  });
});

test('auto runner lock does not reclaim a live owner only because heartbeat is stale', async () => {
  await withStateDir(async () => {
    const ctx = { cwd: '/repo' };
    writeOwner(ctx, externalOwner({ expiresAt: '2025-12-31T23:59:00.000Z' }));

    const result = await acquireAutoRunnerLock(ctx, {
      deps: deps({ isPidAlive: () => true }),
    });
    assert.equal(result.status, 'blocked');
  });
});

test('auto runner lock records and consumes token-scoped stop intent', async () => {
  await withStateDir(async () => {
    const ctx = { cwd: '/repo' };
    const owner = externalOwner({ fencingToken: 'token-a' });
    writeOwner(ctx, owner);

    const recorded = recordAutoRunnerStopIntent(ctx, { deps: deps() });
    assert.equal(recorded.status, 'recorded');
    const intent = JSON.parse(
      readFileSync(join(autoRunnerLockDir(ctx), 'stop-intent.json'), 'utf8'),
    ) as { fencingToken: string };
    assert.equal(intent.fencingToken, 'token-a');
    assert.equal(
      consumeAutoRunnerStopIntent(
        ctx,
        { ...owner, fencingToken: 'token-b' },
        { deps: deps() },
      ),
      false,
    );
    assert.equal(
      consumeAutoRunnerStopIntent(ctx, owner, { deps: deps() }),
      true,
    );
  });
});

test('auto runner lock keeps child processes passive', async () => {
  await withStateDir(async () => {
    const result = await acquireAutoRunnerLock(
      { cwd: '/repo' },
      { deps: deps({ isChildProcess: () => true }) },
    );
    assert.equal(result.status, 'passive-child');
    assert.equal(
      recordAutoRunnerStopIntent(
        { cwd: '/repo' },
        { deps: deps({ isChildProcess: () => true }) },
      ).status,
      'passive-child',
    );
  });
});
