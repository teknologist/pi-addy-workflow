import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyTaskIdentityMatches,
  taskIdentityKeyParts,
  taskIdForIdentity,
  workflowTaskIdentityKey,
} from '../extensions/workflow-monitor/workflow-task-identity.ts';

test('workflow task identity keys prefer stable task id', () => {
  assert.equal(
    workflowTaskIdentityKey({
      plan: 'PLAN.md',
      taskId: 'task-123',
      sliceIndex: 2,
      taskIndex: 4,
      taskTitle: 'Renamed task',
    }),
    'PLAN.md\u001ftask-id\u001ftask-123',
  );
});

test('workflow task identity keys can include legacy slice scope', () => {
  assert.equal(
    workflowTaskIdentityKey(
      {
        plan: 'PLAN.md',
        sliceIndex: 2,
        taskIndex: 4,
        taskTitle: 'Legacy task',
      },
      { includeSlice: true },
    ),
    'PLAN.md\u001f2\u001f4\u001fLegacy task',
  );
});

test('workflow task identity resolves stable id from matching legacy identity', () => {
  assert.equal(
    taskIdForIdentity({ taskIndex: 1, taskTitle: 'Current task' }, [
      { taskId: 'wrong', taskIndex: 2, taskTitle: 'Other task' },
      { taskId: 'task-current', taskIndex: 1, taskTitle: 'Current task' },
    ]),
    'task-current',
  );
  assert.equal(
    legacyTaskIdentityMatches(
      { taskIndex: 1, taskTitle: 'Current task' },
      { taskIndex: 1, taskTitle: 'Current task' },
    ),
    true,
  );
});

test('workflow task identity parts preserve auto key shape', () => {
  assert.deepEqual(taskIdentityKeyParts({ taskId: 'task-1' }), [
    'task-id',
    'task-1',
  ]);
  assert.deepEqual(
    taskIdentityKeyParts({ taskIndex: 3, taskTitle: 'Legacy task' }),
    ['3', 'Legacy task'],
  );
});
