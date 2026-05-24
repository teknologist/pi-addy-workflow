import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';
import {
  parseWorkflowTaskSummaryResponse,
  summarizeWorkflowTasks,
} from '../extensions/workflow-monitor/workflow-task-summary.ts';

test('workflow task summary uses deterministic fallback without model support', async () => {
  const summarized = await summarizeWorkflowTasks({} as never, {
    ...createInitialWorkflowState(),
    currentTask: 'Implement runtime adapter — with stale context details',
    nextTask: 'Submit endpoint chooses draft live based on CSV isDraft',
  });

  assert.equal(summarized.currentTaskSummary, 'Implement runtime adapter');
  assert.match(
    summarized.nextTaskSummary ?? '',
    /^Submit endpoint chooses draft liv/,
  );
  assert.ok((summarized.nextTaskSummary ?? '').length <= 36);
});

test('workflow task summary parses model response into compact labels', () => {
  const parsed = parseWorkflowTaskSummaryResponse(
    [
      'Current: Refactor workflow summary labels for a very narrow terminal footer',
      'Next: Verify race tests',
    ].join('\n'),
    {
      ...createInitialWorkflowState(),
      currentTaskSummary: 'Current fallback',
      nextTaskSummary: 'Next fallback',
    },
  );

  assert.match(
    parsed.currentTaskSummary ?? '',
    /^Refactor workflow summary labels/,
  );
  assert.ok((parsed.currentTaskSummary ?? '').length <= 36);
  assert.equal(parsed.nextTaskSummary, 'Verify race tests');
});
