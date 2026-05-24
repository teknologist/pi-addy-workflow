import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceWorkflowAutoControl } from '../extensions/workflow-monitor/workflow-state-codec-auto-control.ts';

test('auto control codec accepts valid persisted auto fields', () => {
  assert.deepEqual(
    coerceWorkflowAutoControl({
      autoMode: true,
      autoPausedReason: 'user-stopped',
      autoLastPrompt: '/addy-build docs/plans/task.md',
      autoFreshPrompt: '/addy-review docs/plans/task.md',
      autoFreshExpandedPrompt: 'expanded review prompt',
      autoFreshReason: 'before-review',
      autoFreshDeliveryKey: 'fresh:key',
      autoFreshConsumedKey: 'consumed:key',
      autoRetryKey: 'retry:key',
      autoRetryCount: 2,
    }),
    {
      autoMode: true,
      autoPausedReason: 'user-stopped',
      autoLastPrompt: '/addy-build docs/plans/task.md',
      autoFreshPrompt: '/addy-review docs/plans/task.md',
      autoFreshExpandedPrompt: 'expanded review prompt',
      autoFreshReason: 'before-review',
      autoFreshDeliveryKey: 'fresh:key',
      autoFreshConsumedKey: 'consumed:key',
      autoRetryKey: 'retry:key',
      autoRetryCount: 2,
    },
  );
});

test('auto control codec accepts omitted optional auto fields', () => {
  assert.deepEqual(coerceWorkflowAutoControl({}), {
    autoMode: undefined,
    autoPausedReason: undefined,
    autoLastPrompt: undefined,
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
    autoFreshConsumedKey: undefined,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
  });
});

test('auto control codec rejects invalid persisted auto fields', () => {
  assert.equal(
    coerceWorkflowAutoControl({ autoMode: 'yes' as never }),
    undefined,
  );
  assert.equal(
    coerceWorkflowAutoControl({ autoPausedReason: 'paused' as never }),
    undefined,
  );
  assert.equal(
    coerceWorkflowAutoControl({ autoFreshReason: 'after-review' as never }),
    undefined,
  );
  assert.equal(coerceWorkflowAutoControl({ autoRetryCount: -1 }), undefined);
  assert.equal(
    coerceWorkflowAutoControl({ autoFreshPrompt: false as never }),
    undefined,
  );
});
