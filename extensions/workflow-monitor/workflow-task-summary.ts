import { complete, type UserMessage } from '@earendil-works/pi-ai';
import type { WorkflowContext } from './workflow-state-store.ts';
import {
  setContextWorkflowState,
  type AppendEntry,
} from './workflow-state-store.ts';
import type { WorkflowState } from './workflow-transitions.ts';

function taskNeedsSummary(
  task: string | undefined,
  summary: string | undefined,
): boolean {
  return (
    !!task &&
    task !== 'none' &&
    task !== 'all tasks complete' &&
    (!summary || summary.length > 36 || summary === task)
  );
}

function fallbackTaskSummary(task: string): string {
  const cleaned = task
    .replace(/\s*;.*$/, '')
    .replace(/\s*—.*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length <= 36 ? cleaned : `${cleaned.slice(0, 33).trimEnd()}…`;
}

export function parseWorkflowTaskSummaryResponse(
  text: string,
  state: WorkflowState,
): Pick<WorkflowState, 'currentTaskSummary' | 'nextTaskSummary'> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const current = lines
    .find((line) => /^current\s*:/i.test(line))
    ?.replace(/^current\s*:\s*/i, '');
  const next = lines
    .find((line) => /^next\s*:/i.test(line))
    ?.replace(/^next\s*:\s*/i, '');
  return {
    currentTaskSummary: current
      ? fallbackTaskSummary(current)
      : state.currentTaskSummary,
    nextTaskSummary: next ? fallbackTaskSummary(next) : state.nextTaskSummary,
  };
}

export async function summarizeWorkflowTasks(
  ctx: WorkflowContext,
  state: WorkflowState,
): Promise<WorkflowState> {
  if (
    !taskNeedsSummary(state.currentTask, state.currentTaskSummary) &&
    !taskNeedsSummary(state.nextTask, state.nextTaskSummary)
  )
    return state;

  const fallbackState = {
    ...state,
    currentTaskSummary: state.currentTask
      ? fallbackTaskSummary(state.currentTask)
      : undefined,
    nextTaskSummary: state.nextTask
      ? fallbackTaskSummary(state.nextTask)
      : undefined,
  };

  if (!ctx.model || !ctx.modelRegistry?.getApiKeyAndHeaders)
    return fallbackState;

  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return fallbackState;

    const userMessage: UserMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Summarize these workflow task names for a narrow terminal footer. Each summary must be 2-5 words, <= 32 characters, clear, and meaningful. Keep domain nouns. No markdown.\n\nCurrent: ${state.currentTask ?? 'none'}\nNext: ${state.nextTask ?? 'none'}\n\nReturn exactly:\nCurrent: <summary>\nNext: <summary>`,
        },
      ],
      timestamp: Date.now(),
    };

    const response = await complete(
      ctx.model as never,
      {
        systemPrompt: 'You produce short labels for a coding workflow footer.',
        messages: [userMessage],
      },
      { apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
    );
    if (response.stopReason === 'aborted') return fallbackState;

    const text = response.content
      .filter(
        (content): content is { type: 'text'; text: string } =>
          content.type === 'text',
      )
      .map((content) => content.text)
      .join('\n');
    return {
      ...fallbackState,
      ...parseWorkflowTaskSummaryResponse(text, fallbackState),
    };
  } catch {
    return fallbackState;
  }
}

function workflowTargetChanged(
  latest: WorkflowState,
  source: WorkflowState,
): boolean {
  return (
    latest.current !== source.current ||
    latest.activePlan !== source.activePlan ||
    latest.currentTask !== source.currentTask ||
    latest.nextTask !== source.nextTask
  );
}

export function scheduleWorkflowTaskSummary(
  ctx: WorkflowContext,
  state: WorkflowState,
  appendEntry?: AppendEntry,
): void {
  const source = ctx.state ?? state;
  void summarizeWorkflowTasks(ctx, source).then((summarized) => {
    try {
      const latest = ctx.state ?? state;
      if (workflowTargetChanged(latest, source)) return;
      if (summarized === source) return;

      setContextWorkflowState(
        ctx,
        {
          ...latest,
          currentTaskSummary: summarized.currentTaskSummary,
          nextTaskSummary: summarized.nextTaskSummary,
        },
        appendEntry,
      );
    } catch {
      // Best-effort task summaries may resolve after ctx.newSession() invalidates the old context.
    }
  });
}
