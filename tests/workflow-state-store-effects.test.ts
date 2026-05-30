import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWorkflowStateUiEffects,
  clearWorkflowStateWidget,
} from '../extensions/workflow-monitor/workflow-state-store-effects.ts';
import { WORKFLOW_WIDGET_KEY } from '../extensions/workflow-monitor/workflow-widget-presenter.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('workflow state store effects render widget for stored state', () => {
  const widgets: Array<[string, unknown]> = [];

  applyWorkflowStateUiEffects(
    {
      cwd: process.cwd(),
      ui: { setWidget: (key, value) => widgets.push([key, value]) },
    },
    { ...createInitialWorkflowState(), current: 'build' },
  );

  assert.equal(widgets.length, 1);
  assert.equal(widgets[0]?.[0], WORKFLOW_WIDGET_KEY);
  assert.equal(typeof widgets[0]?.[1], 'function');
});

test('workflow state store effects notify workflow warnings', () => {
  const notices: Array<{ message: string; level?: string }> = [];

  applyWorkflowStateUiEffects(
    {
      ui: {
        setWidget() {},
        notify: (message, level) => notices.push({ message, level }),
      },
    },
    {
      ...createInitialWorkflowState(),
      current: 'finish',
      phases: {
        ...createInitialWorkflowState().phases,
        finish: 'active',
      },
      warnings: ['Skipped verify before finish.'],
    },
  );

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.level, 'warning');
  assert.match(notices[0]?.message ?? '', /Skipped verify/);
});

test('workflow state store effects clear widget on reset', () => {
  const widgets: Array<[string, unknown]> = [];

  clearWorkflowStateWidget({
    ui: { setWidget: (key, value) => widgets.push([key, value]) },
  });

  assert.deepEqual(widgets, [[WORKFLOW_WIDGET_KEY, undefined]]);
});
