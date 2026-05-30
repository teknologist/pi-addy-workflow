import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAutoFreshReason,
  isAutoPausedReason,
  isWorkflowTestStatus,
} from '../extensions/workflow-monitor/workflow-state-codec-domains.ts';

test('state codec domain guard accepts known fresh continuation reasons', () => {
  assert.equal(isAutoFreshReason('between-tasks'), true);
  assert.equal(isAutoFreshReason('before-step'), true);
  assert.equal(isAutoFreshReason('before-review'), true);
  assert.equal(isAutoFreshReason('after-review'), false);
});

test('state codec domain guard accepts known auto pause reasons', () => {
  assert.equal(isAutoPausedReason('user-stopped'), true);
  assert.equal(isAutoPausedReason('same-phase-retry-limit'), true);
  assert.equal(isAutoPausedReason('paused'), false);
});

test('state codec domain guard accepts known workflow test statuses', () => {
  assert.equal(isWorkflowTestStatus('detected'), true);
  assert.equal(isWorkflowTestStatus('passed'), true);
  assert.equal(isWorkflowTestStatus('failed'), true);
  assert.equal(isWorkflowTestStatus('broken'), false);
});
