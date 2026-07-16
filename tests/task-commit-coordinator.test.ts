import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentTextReportsCommitComplete,
  commitShaFromAgentText,
} from '../extensions/workflow-monitor/task-commit-coordinator.ts';
import { autoTaskCommitPrompt } from '../extensions/workflow-monitor/task-commit-prompt.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('legacy plan commit prose and prompt remain unchanged by Ticket FINISH evidence', () => {
  assert.equal(agentTextReportsCommitComplete('COMMIT: 4386b11c'), true);
  assert.equal(commitShaFromAgentText('COMMIT: 4386b11c'), '4386b11c');
  assert.equal(agentTextReportsCommitComplete('working tree clean'), true);
  assert.equal(commitShaFromAgentText('working tree clean'), 'no-changes');

  const prompt = autoTaskCommitPrompt(
    {
      ...createInitialWorkflowState(),
      activePlan: 'docs/plans/current.md',
      currentTask: 'Legacy task',
    },
    undefined,
    process.cwd(),
  );
  assert.match(prompt, /COMMIT: <hash>/);
  assert.doesNotMatch(prompt, /ADDY-TICKET-RESULT|commitEvidence/);
});
