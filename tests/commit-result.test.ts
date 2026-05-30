import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentTextReportsCommitComplete,
  commitShaFromAgentText,
} from '../extensions/workflow-monitor/commit-result.ts';

test('commit result accepts explicit commit hash variants', () => {
  for (const text of [
    'COMMIT: 4386b11c',
    'Created commit 4386b11c.',
    'committed hash is `4386b11c`',
    '[main 4386b11c] fix: continue auto commit prompts',
  ]) {
    assert.equal(agentTextReportsCommitComplete(text), true);
    assert.equal(commitShaFromAgentText(text), '4386b11c');
  }
});

test('commit result accepts no-change variants', () => {
  for (const text of [
    'No changes to commit',
    'nothing to commit, working tree clean',
    'working tree clean',
  ]) {
    assert.equal(agentTextReportsCommitComplete(text), true);
    assert.equal(commitShaFromAgentText(text), 'no-changes');
  }
});

test('commit result rejects failed or unclear commit output', () => {
  for (const text of [
    'commit failed: rejected',
    'failed to commit because tests failed',
    'commit error after hash abc1234',
    'Please choose whether to commit abc1234.',
  ]) {
    assert.equal(agentTextReportsCommitComplete(text), false);
  }
});
