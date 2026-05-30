import test from 'node:test';
import assert from 'node:assert/strict';
import { runWhenIdle } from '../extensions/workflow-monitor/workflow-timer-loop.ts';
import type { WorkflowTimerRegistry } from '../extensions/workflow-monitor/workflow-runtime.ts';

function createFakeRuntime(isBusy: () => boolean) {
  const active = new Map<WorkflowTimerRegistry, Set<string>>();
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  return {
    scheduled,
    isBusy,
    schedule(callback: () => void, delayMs: number) {
      scheduled.push({ callback, delayMs });
    },
    runOnce(
      registry: WorkflowTimerRegistry,
      key: string,
      callback: (release: () => void) => void,
    ) {
      const keys = active.get(registry) ?? new Set<string>();
      active.set(registry, keys);
      if (keys.has(key)) return false;
      keys.add(key);
      callback(() => keys.delete(key));
      return true;
    },
  };
}

async function runNextScheduled(
  runtime: ReturnType<typeof createFakeRuntime>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  const next = runtime.scheduled.shift();
  assert.ok(next, 'expected scheduled callback');
  next.callback();
  await Promise.resolve();
  await Promise.resolve();
}

test('timer loop runs callback when idle', async () => {
  const runtime = createFakeRuntime(() => false);
  let ready = 0;

  assert.equal(
    runWhenIdle({
      runtime,
      registry: 'idle-user-message',
      key: 'ready',
      retryMs: 10,
      maxAttempts: 3,
      onReady: () => {
        ready += 1;
      },
      onTimeout: () => assert.fail('should not time out'),
    }),
    true,
  );

  await runNextScheduled(runtime);

  assert.equal(ready, 1);
  assert.equal(runtime.scheduled.length, 0);
});

test('timer loop retries until runtime is idle', async () => {
  let busyChecks = 0;
  const runtime = createFakeRuntime(() => busyChecks++ < 2);
  let ready = 0;

  runWhenIdle({
    runtime,
    registry: 'auto-fresh',
    key: 'retry',
    retryMs: 50,
    maxAttempts: 5,
    onReady: () => {
      ready += 1;
    },
    onTimeout: () => assert.fail('should not time out'),
  });

  await runNextScheduled(runtime);
  assert.equal(runtime.scheduled[0]?.delayMs, 50);
  await runNextScheduled(runtime);
  assert.equal(runtime.scheduled[0]?.delayMs, 50);
  await runNextScheduled(runtime);

  assert.equal(ready, 1);
});

test('timer loop times out at max attempts boundary', async () => {
  const runtime = createFakeRuntime(() => true);
  let timedOut = 0;
  let ready = 0;

  runWhenIdle({
    runtime,
    registry: 'auto-fresh',
    key: 'timeout',
    retryMs: 25,
    maxAttempts: 2,
    onReady: () => {
      ready += 1;
    },
    onTimeout: () => {
      timedOut += 1;
    },
  });

  await runNextScheduled(runtime);
  await runNextScheduled(runtime);
  await runNextScheduled(runtime);

  assert.equal(ready, 0);
  assert.equal(timedOut, 1);
});

test('timer loop dedupes same registry and key until release', async () => {
  const runtime = createFakeRuntime(() => false);

  const input = {
    runtime,
    registry: 'idle-user-message' as const,
    key: 'dedupe',
    retryMs: 1,
    maxAttempts: 1,
    onReady() {},
    onTimeout() {},
  };

  assert.equal(runWhenIdle(input), true);
  assert.equal(runWhenIdle(input), false);

  await runNextScheduled(runtime);

  assert.equal(runWhenIdle(input), true);
});

test('timer loop releases key after ready error', async () => {
  const runtime = createFakeRuntime(() => false);
  let errors = 0;

  const input = {
    runtime,
    registry: 'idle-user-message' as const,
    key: 'error-release',
    retryMs: 1,
    maxAttempts: 1,
    onReady() {
      throw new Error('boom');
    },
    onTimeout() {},
    onError() {
      errors += 1;
    },
  };

  assert.equal(runWhenIdle(input), true);
  await runNextScheduled(runtime);

  assert.equal(errors, 1);
  assert.equal(runWhenIdle(input), true);
});

test('timer loop releases key before ready callback so policy can reschedule', async () => {
  const runtime = createFakeRuntime(() => false);
  let ready = 0;

  const input = {
    runtime,
    registry: 'idle-user-message' as const,
    key: 'reschedule-during-ready',
    retryMs: 1,
    maxAttempts: 1,
    onReady() {
      ready += 1;
      if (ready === 1) assert.equal(runWhenIdle(input), true);
    },
    onTimeout() {},
  };

  assert.equal(runWhenIdle(input), true);
  await runNextScheduled(runtime);
  await runNextScheduled(runtime);

  assert.equal(ready, 2);
});
