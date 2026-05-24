import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  ADDY_STATS_MESSAGE_TYPE,
  renderWorkflowStatsMessage,
  showWorkflowStats as showWorkflowStatsPresenter,
} from './workflow-stats-presenter.ts';
import type { WorkflowState } from './workflow-core.ts';

export function registerWorkflowRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer?.(
    ADDY_STATS_MESSAGE_TYPE,
    renderWorkflowStatsMessage,
  );
}

export function showWorkflowStats(
  pi: ExtensionAPI,
  ctx: unknown,
  state: WorkflowState,
  options: { heading?: string; planPath?: string } = {},
  notify: (ctx: unknown, message: string, level?: string) => void,
): void {
  showWorkflowStatsPresenter(pi, ctx, state, options, notify);
}
