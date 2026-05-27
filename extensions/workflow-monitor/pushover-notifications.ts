import type { AddyWorkflowConfig } from './config.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import {
  WORKFLOW_PHASES,
  type WorkflowState,
  type WorkflowTaskStats,
} from './workflow-transitions.ts';
import { readSlicePlanProgress } from './slice-plan-progress.ts';
import { workflowArtifactName } from './workflow-widget-presenter.ts';

type PushoverConfig = AddyWorkflowConfig['auto']['notifications']['pushover'];

type FetchLike = typeof fetch;

export type TaskFinishedNotificationInput = {
  config: AddyWorkflowConfig;
  state: WorkflowState;
  target?: WorkflowStatsTarget;
  cwd?: string;
  fetch?: FetchLike;
  notifyWarning?: (message: string) => void;
};

function taskMatchesTarget(
  task: WorkflowTaskStats,
  target?: WorkflowStatsTarget,
): boolean {
  if (!target) return true;
  if (target.plan && task.plan && task.plan !== target.plan) return false;
  if (target.taskId && task.taskId && task.taskId !== target.taskId)
    return false;
  if (target.taskIndex && task.taskIndex && task.taskIndex !== target.taskIndex)
    return false;
  if (target.taskTitle && task.taskTitle && task.taskTitle !== target.taskTitle)
    return false;
  return true;
}

function notificationTask(
  state: WorkflowState,
  target?: WorkflowStatsTarget,
): WorkflowTaskStats | undefined {
  return Object.values(state.stats?.active.tasks ?? {})
    .filter((task) => taskMatchesTarget(task, target))
    .at(-1);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours ? `${hours}h` : undefined,
    minutes || hours ? `${minutes}m` : undefined,
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

function percentage(index: number, count: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(count) || count <= 0)
    return 0;
  return Math.max(0, Math.min(100, Math.round((index / count) * 100)));
}

function taskStepDurations(task: WorkflowTaskStats): string | undefined {
  const parts = WORKFLOW_PHASES.map((phase) => {
    const duration = task.phaseDurationsMs?.[phase];
    return duration ? `${phase} ${formatDuration(duration)}` : undefined;
  }).filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

export function buildTaskFinishedPushoverMessage(
  state: WorkflowState,
  target?: WorkflowStatsTarget,
  cwd?: string,
): { title: string; message: string } | undefined {
  const task = notificationTask(state, target);
  if (!task) return undefined;

  const progress = readSlicePlanProgress(state, cwd);
  const total = progress?.totalTaskProgress;
  const finished = total?.currentTaskIndex ?? task.taskIndex ?? 0;
  const totalTasks = total?.taskCount ?? state.taskCount ?? task.taskIndex ?? 0;
  const left = Math.max(0, totalTasks - finished);
  const startedAt = task.startedAt ? Date.parse(task.startedAt) : NaN;
  const finishedAt = task.finishedAt ? Date.parse(task.finishedAt) : NaN;
  const duration = formatDuration(finishedAt - startedAt);
  const verifyRetries = Math.max(0, task.verifyRuns - 1);
  const reviewRetries = Math.max(0, task.reviewRuns - 1);
  const sliceDetails =
    progress?.currentSliceIndex && progress.sliceCount
      ? `Slice ${progress.currentSliceIndex}/${progress.sliceCount}`
      : undefined;
  const taskDetails =
    progress?.currentTaskIndex && progress.taskCount
      ? `Task ${progress.currentTaskIndex}/${progress.taskCount}`
      : undefined;
  const totalDetails = total
    ? `Total ${finished}/${totalTasks} (${percentage(finished, totalTasks)}%)`
    : undefined;
  const plan = task.plan ? workflowArtifactName(task.plan) : undefined;
  const taskName = task.taskTitle ?? target?.taskTitle ?? 'task';
  const stepDurations = taskStepDurations(task);

  return {
    title: 'Addy task finished',
    message: [
      `Addy task finished: ${taskName}`,
      '',
      totalTasks
        ? `Task ${finished}/${totalTasks} finished, ${left} left`
        : undefined,
      [sliceDetails, taskDetails, totalDetails].filter(Boolean).join(' · '),
      `Cycle time: ${duration}`,
      stepDurations ? `Step time: ${stepDurations}` : undefined,
      `Verify retries: ${verifyRetries}`,
      `Review retries: ${reviewRetries}`,
      plan ? `Plan: ${plan}` : undefined,
    ]
      .filter((line) => line !== undefined && line !== '')
      .join('\n'),
  };
}

function validPushoverConfig(config: PushoverConfig): boolean {
  return Boolean(config.enabled && config.appToken && config.userKey);
}

export async function maybeSendTaskFinishedPushoverNotification(
  input: TaskFinishedNotificationInput,
): Promise<void> {
  const pushover = input.config.auto.notifications.pushover;
  if (!validPushoverConfig(pushover)) return;

  const content = buildTaskFinishedPushoverMessage(
    input.state,
    input.target,
    input.cwd,
  );
  if (!content) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  timeout.unref?.();

  try {
    const response = await (input.fetch ?? fetch)(
      'https://api.pushover.net/1/messages.json',
      {
        method: 'POST',
        body: new URLSearchParams({
          token: pushover.appToken!,
          user: pushover.userKey!,
          title: content.title,
          message: content.message,
          priority: String(pushover.priority),
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok)
      input.notifyWarning?.(`Pushover notification failed: ${response.status}`);
  } catch (error) {
    input.notifyWarning?.(
      `Pushover notification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
