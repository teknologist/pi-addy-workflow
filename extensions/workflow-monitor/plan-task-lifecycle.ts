import type {
  WorkflowState,
  WorkflowTaskCommitRecord,
} from './workflow-transitions.ts';
import { workflowTaskIdentityKey } from './workflow-task-identity.ts';

export type PlanTaskStatus = 'Implemented' | 'Verified' | 'Reviewed';

export type PlanTask = {
  title: string;
  taskId?: string;
  complete: boolean;
  missingStatuses?: PlanTaskStatus[];
};

export type PlanTaskFrontier = PlanTask & {
  taskIndex: number;
  missingStatuses: PlanTaskStatus[];
  requiresCommit: boolean;
};

const REQUIRED_TASK_STATUSES: PlanTaskStatus[] = [
  'Implemented',
  'Verified',
  'Reviewed',
];
const STATUS_CHECKBOX =
  /^\s*[-*]\s+\[[ xX]\]\s+(Implemented|Verified|Reviewed)\b/;
const TASK_CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;
const TASK_HEADING = /^#{2,4}\s+(.+)$/;
const TASK_ID_COMMENT = /^\s*<!--\s*addy-task-id:\s*([^\s>]+)\s*-->\s*$/i;

function cleanTaskTitle(title: string): string {
  return title
    .replace(/^\s*(?:slice|task)\s*\d+[.:) -]*/i, '')
    .replace(/`/g, '')
    .trim();
}

function taskMissingStatuses(statuses: PlanTaskStatus[]): PlanTaskStatus[] {
  return REQUIRED_TASK_STATUSES.filter((label) => !statuses.includes(label));
}

function definedTaskFields(task: PlanTask): PlanTask {
  return Object.fromEntries(
    Object.entries(task).filter(([, value]) => value !== undefined),
  ) as PlanTask;
}

function stripDuplicateTaskIds(tasks: PlanTask[]): PlanTask[] {
  const taskIdCounts = new Map<string, number>();
  for (const task of tasks) {
    if (!task.taskId) continue;
    taskIdCounts.set(task.taskId, (taskIdCounts.get(task.taskId) ?? 0) + 1);
  }

  return tasks.map((task) =>
    task.taskId && (taskIdCounts.get(task.taskId) ?? 0) > 1
      ? definedTaskFields({ ...task, taskId: undefined })
      : task,
  );
}

export function planTasksFromMarkdown(markdown: string): PlanTask[] {
  const headingTasks: PlanTask[] = [];
  const checkboxTasks: PlanTask[] = [];
  let currentHeading:
    | {
        title: string;
        taskId?: string;
        statuses: PlanTaskStatus[];
        sawStatus: boolean;
      }
    | undefined;

  function flushHeadingTask() {
    if (!currentHeading || !currentHeading.sawStatus) return;
    const missingStatuses = taskMissingStatuses(currentHeading.statuses);
    headingTasks.push(
      definedTaskFields({
        title: cleanTaskTitle(currentHeading.title),
        taskId: currentHeading.taskId,
        complete: missingStatuses.length === 0,
        missingStatuses,
      }),
    );
  }

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(TASK_HEADING);
    if (heading) {
      flushHeadingTask();
      currentHeading = { title: heading[1], statuses: [], sawStatus: false };
      continue;
    }

    const taskId = line.match(TASK_ID_COMMENT);
    if (taskId && currentHeading && !currentHeading.taskId) {
      currentHeading.taskId = taskId[1];
      continue;
    }

    const status = line.match(STATUS_CHECKBOX);
    if (status && currentHeading) {
      currentHeading.sawStatus = true;
      if (/\[[xX]\]/.test(line))
        currentHeading.statuses.push(status[1] as PlanTaskStatus);
      continue;
    }

    const checkbox = line.match(TASK_CHECKBOX);
    if (checkbox && !STATUS_CHECKBOX.test(line)) {
      checkboxTasks.push({
        title: cleanTaskTitle(checkbox[2]),
        complete: checkbox[1].toLowerCase() === 'x',
      });
    }
  }

  flushHeadingTask();
  const tasks = headingTasks.length > 0 ? headingTasks : checkboxTasks;
  return stripDuplicateTaskIds(tasks.filter((task) => task.title.length > 0));
}

export function workflowTaskCommitKey(
  planPath: string,
  taskIndex: number,
  taskTitle: string,
  taskId?: string,
): string {
  return workflowTaskIdentityKey({
    plan: planPath,
    taskIndex,
    taskTitle,
    taskId,
  });
}

export function taskMatchesPlanTask(
  task: PlanTask,
  index: number,
  candidate: { taskIndex?: number; taskTitle?: string; taskId?: string },
): boolean {
  if (candidate.taskId !== undefined) return candidate.taskId === task.taskId;
  if (candidate.taskIndex !== undefined && candidate.taskIndex !== index + 1)
    return false;
  if (candidate.taskTitle && candidate.taskTitle !== task.title) return false;
  return candidate.taskIndex !== undefined || Boolean(candidate.taskTitle);
}

function taskHasCommitRecord(
  committedTasks: WorkflowState['committedTasks'],
  planPath: string,
  task: PlanTask,
  index: number,
): boolean {
  const key = workflowTaskCommitKey(
    planPath,
    index + 1,
    task.title,
    task.taskId,
  );
  const record = committedTasks?.[key];
  if (!record && task.taskId) {
    const legacyKey = workflowTaskCommitKey(planPath, index + 1, task.title);
    const legacyRecord = committedTasks?.[legacyKey];
    return legacyRecord
      ? legacyRecordMatchesPlanTask(legacyRecord, planPath, task, index)
      : false;
  }
  if (!record) return false;

  return task.taskId
    ? record.plan === planPath && record.taskId === task.taskId
    : legacyRecordMatchesPlanTask(record, planPath, task, index);
}

function legacyRecordMatchesPlanTask(
  record: WorkflowTaskCommitRecord,
  planPath: string,
  task: PlanTask,
  index: number,
): boolean {
  return (
    record.plan === planPath &&
    record.taskIndex === index + 1 &&
    record.taskTitle === task.title
  );
}

export function taskIsClosed(
  committedTasks: WorkflowState['committedTasks'],
  planPath: string,
  task: PlanTask,
  index: number,
): boolean {
  return (
    task.complete && taskHasCommitRecord(committedTasks, planPath, task, index)
  );
}

export function planTaskFrontier({
  committedTasks,
  planPath,
  tasks,
  effectiveMissingStatuses,
}: {
  committedTasks?: WorkflowState['committedTasks'];
  planPath: string;
  tasks: PlanTask[];
  effectiveMissingStatuses?: (
    task: PlanTask,
    index: number,
  ) => PlanTaskStatus[] | undefined;
}): PlanTaskFrontier | undefined {
  return tasks
    .map((candidate, index) => {
      const hasCommit = taskHasCommitRecord(
        committedTasks,
        planPath,
        candidate,
        index,
      );
      const missingStatuses =
        candidate.complete && hasCommit
          ? []
          : (effectiveMissingStatuses?.(candidate, index) ??
            candidate.missingStatuses ??
            []);
      return {
        ...candidate,
        taskIndex: index + 1,
        missingStatuses,
        requiresCommit:
          missingStatuses.length === 0 && candidate.complete && !hasCommit,
      };
    })
    .find(
      (candidate) =>
        !candidate.complete ||
        candidate.missingStatuses.length > 0 ||
        candidate.requiresCommit,
    );
}
