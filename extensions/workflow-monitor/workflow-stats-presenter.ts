import {
  getMarkdownTheme,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { Markdown } from '@earendil-works/pi-tui';
import { latestActiveStatsTarget } from './workflow-stats-target.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import {
  renderWorkflowStatsMarkdown,
  renderWorkflowStatsText,
} from './workflow-stats-report.ts';

export const ADDY_STATS_MESSAGE_TYPE = 'pi-addy-workflow-stats';

type Notify = (ctx: unknown, message: string, level?: string) => void;

export { latestActiveStatsTarget } from './workflow-stats-target.ts';

function addStatsHeading(markdown: string, heading?: string): string {
  if (!heading) return markdown;
  return [`## ${heading}`, '', markdown.replace(/^## /, '### ')].join('\n');
}

export function statsMarkdownWithHeading(
  state: WorkflowState,
  options: { heading?: string; planPath?: string } = {},
): string {
  return addStatsHeading(
    renderWorkflowStatsMarkdown(state, options.planPath),
    options.heading,
  );
}

export function showWorkflowStats(
  pi: ExtensionAPI,
  ctx: unknown,
  state: WorkflowState,
  options: { heading?: string; planPath?: string } = {},
  notify: Notify,
): void {
  const statsText = renderWorkflowStatsText(state, options.planPath);
  const fallbackText = options.heading
    ? `${options.heading}\n${statsText}`
    : statsText;
  const markdown = statsMarkdownWithHeading(state, options);

  if (pi.sendMessage) {
    pi.sendMessage({
      customType: ADDY_STATS_MESSAGE_TYPE,
      content: fallbackText,
      display: true,
      details: { markdown },
    });
    return;
  }

  notify(ctx, fallbackText, 'info');
}

export function renderWorkflowStatsMessage(message: {
  content?: unknown;
  details?: unknown;
}): Markdown {
  const details = message.details as { markdown?: unknown } | undefined;
  const markdown =
    typeof details?.markdown === 'string'
      ? details.markdown
      : typeof message.content === 'string'
        ? message.content
        : '';
  return new Markdown(markdown, 0, 0, getMarkdownTheme());
}
