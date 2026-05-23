import { complete, type UserMessage } from '@earendil-works/pi-ai';
import {
  createInitialWorkflowState,
  transitionWorkflow,
  type WorkflowEvent,
  type WorkflowPhase,
  type WorkflowState,
} from './workflow-transitions.ts';
import {
  nextPromptForPhase,
  promptArtifactForPhase,
  refreshWorkflowTasksFromPlan,
} from './workflow-tracker.ts';
import {
  type AppendEntry,
  getContextWorkflowState,
  setContextWorkflowState,
  type WorkflowContext,
  workflowStateStore,
} from './workflow-state-store.ts';
import {
  archiveWorkflowStats,
  recordManualTaskTurn,
  type WorkflowStatsTarget,
} from './workflow-stats.ts';

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

function parseTaskSummaryResponse(
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
      ...parseTaskSummaryResponse(text, fallbackState),
    };
  } catch {
    return fallbackState;
  }
}

export function handleWorkflowEvent(
  ctx: WorkflowContext,
  event: WorkflowEvent,
  appendEntry?: AppendEntry,
): WorkflowState {
  const previous = getContextWorkflowState(ctx);
  const transitioned = transitionWorkflow(previous, event);
  const next = recordManualTaskTurn(
    previous,
    refreshWorkflowTasksFromPlan(transitioned, ctx.cwd),
    event,
  );
  setContextWorkflowState(ctx, next, appendEntry);
  const source = ctx.state ?? next;
  void summarizeWorkflowTasks(ctx, source).then((summarized) => {
    try {
      const latest = ctx.state ?? next;
      const workflowTargetChanged =
        latest.current !== source.current ||
        latest.activePlan !== source.activePlan ||
        latest.currentTask !== source.currentTask ||
        latest.nextTask !== source.nextTask;
      if (workflowTargetChanged) return;

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
  return ctx.state ?? next;
}

export function initializeWorkflowWidget(ctx: WorkflowContext): WorkflowState {
  const state = getContextWorkflowState(ctx);
  setContextWorkflowState(ctx, state);
  return ctx.state ?? state;
}

export function resetWorkflow(
  ctx: WorkflowContext,
  appendEntry?: AppendEntry,
): WorkflowState {
  const previous = getContextWorkflowState(ctx);
  const state = {
    ...createInitialWorkflowState(),
    stats: archiveWorkflowStats(previous, 'reset').stats,
  };
  return workflowStateStore.reset(ctx, state, appendEntry);
}

export function openNextWorkflowPrompt(
  ctx: WorkflowContext,
  phase: WorkflowPhase,
  artifact?: string,
): string {
  const prompt = nextPromptForPhase(
    phase,
    artifact ?? promptArtifactForPhase(getContextWorkflowState(ctx), phase),
  );
  ctx.input?.prefill?.(prompt);
  return prompt;
}
