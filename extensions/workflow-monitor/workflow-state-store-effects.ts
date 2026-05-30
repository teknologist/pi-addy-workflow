import type { WorkflowState } from './workflow-core.ts';
import {
  WORKFLOW_WIDGET_KEY,
  renderWorkflowWidget,
} from './workflow-widget-presenter.ts';

export type WorkflowStateEffectsContext = {
  cwd?: string;
  ui?: {
    setWidget?: (key: string, value: unknown) => void;
    notify?: (message: string, level?: string) => void;
  };
};

export function applyWorkflowStateUiEffects(
  ctx: WorkflowStateEffectsContext,
  state: WorkflowState,
): void {
  ctx.ui?.setWidget?.(
    WORKFLOW_WIDGET_KEY,
    renderWorkflowWidget(state, ctx.cwd),
  );
  const warning = state.warnings[0];
  if (warning) ctx.ui?.notify?.(warning, 'warning');
}

export function clearWorkflowStateWidget(
  ctx: WorkflowStateEffectsContext,
): void {
  ctx.ui?.setWidget?.(WORKFLOW_WIDGET_KEY, undefined);
}
