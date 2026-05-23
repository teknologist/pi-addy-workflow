import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowRuntime } from '../extensions/workflow-monitor/workflow-runtime.ts';

test('workflow runtime prefers context prompt delivery over extension fallback', async () => {
  const delivered: Array<{ content: string; mode?: string }> = [];
  const ctx = {
    sendUserMessage(content: string, options?: { deliverAs?: string }) {
      delivered.push({ content, mode: options?.deliverAs });
    },
  };
  const pi = {
    sendUserMessage() {
      throw new Error('extension fallback should not be used');
    },
  };

  const runtime = createWorkflowRuntime(pi as never, ctx);
  await runtime.sendUserMessage('hello', { deliverAs: 'followUp' });

  assert.deepEqual(delivered, [{ content: 'hello', mode: 'followUp' }]);
});

test('workflow runtime reports busy only when context idle probe says busy', () => {
  assert.equal(createWorkflowRuntime({} as never, {}).isBusy(), false);
  assert.equal(
    createWorkflowRuntime({} as never, { isIdle: () => false }).isBusy(),
    true,
  );
  assert.equal(
    createWorkflowRuntime({} as never, { isIdle: () => true }).isBusy(),
    false,
  );
  assert.equal(
    createWorkflowRuntime({} as never, {
      isIdle() {
        throw new Error('stale context');
      },
    }).isBusy(),
    false,
  );
});

test('workflow runtime suppresses duplicate scheduled work until released', () => {
  const runtime = createWorkflowRuntime({} as never, {});
  let runs = 0;

  assert.equal(
    runtime.runOnce('idle-user-message', 'dedupe-key', () => {
      runs += 1;
    }),
    true,
  );
  assert.equal(
    runtime.runOnce('idle-user-message', 'dedupe-key', () => {
      runs += 1;
    }),
    false,
  );
  assert.equal(runs, 1);
});

test('workflow runtime releases scheduled work after callback cleanup', () => {
  const runtime = createWorkflowRuntime({} as never, {});
  let releaseScheduled: (() => void) | undefined;

  assert.equal(
    runtime.runOnce('auto-watchdog', 'cleanup-key', (release) => {
      releaseScheduled = release;
    }),
    true,
  );
  assert.equal(
    runtime.runOnce('auto-watchdog', 'cleanup-key', () => {}),
    false,
  );

  releaseScheduled?.();

  assert.equal(
    runtime.runOnce('auto-watchdog', 'cleanup-key', (release) => release()),
    true,
  );
});

test('workflow runtime schedules retry callbacks through timer seam', async () => {
  const runtime = createWorkflowRuntime({} as never, {});
  let attempts = 0;

  await new Promise<void>((resolve) => {
    const attempt = () => {
      attempts += 1;
      if (attempts === 3) {
        resolve();
        return;
      }
      runtime.schedule(attempt, 1);
    };
    runtime.schedule(attempt, 1);
  });

  assert.equal(attempts, 3);
});

test('workflow runtime starts fresh sessions with parent session and inherited cwd', async () => {
  let parentSession: string | undefined;
  const childCtx: { cwd?: string } = {};
  const runtime = createWorkflowRuntime({} as never, {
    cwd: '/repo/project',
    sessionManager: { getSessionFile: () => '/tmp/parent-session.jsonl' },
    newSession: async (options: {
      parentSession?: string;
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      parentSession = options.parentSession;
      await options.withSession(childCtx);
    },
  });

  assert.equal(runtime.getParentSession(), '/tmp/parent-session.jsonl');
  assert.equal(runtime.canStartFreshSession(), true);
  assert.deepEqual(await runtime.startFreshSession({ withSession() {} }), {
    status: 'started',
  });
  assert.equal(parentSession, '/tmp/parent-session.jsonl');
  assert.equal(childCtx.cwd, '/repo/project');
});

test('workflow runtime reports missing fresh-session support', async () => {
  const runtime = createWorkflowRuntime({} as never, {});

  assert.equal(runtime.canStartFreshSession(), false);
  assert.deepEqual(await runtime.startFreshSession({ withSession() {} }), {
    status: 'missing',
  });
});

test('workflow runtime reports cancelled fresh sessions', async () => {
  const runtime = createWorkflowRuntime({} as never, {
    newSession: async () => ({ cancelled: true }),
  });

  assert.deepEqual(await runtime.startFreshSession({ withSession() {} }), {
    status: 'cancelled',
  });
});
