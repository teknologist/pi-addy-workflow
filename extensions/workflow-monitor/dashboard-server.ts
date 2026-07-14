import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WORKFLOW_PHASES } from './workflow-phases.ts';
import { readSlicePlanProgress } from './slice-plan-snapshot.ts';
import {
  projectWorkflowStateKey,
  workflowStateDir,
} from './workflow-state-store-scope.ts';
import {
  parsePersistedWorkflowState,
  type WorkflowState,
} from './workflow-state.ts';
import type { WorkflowPhase, WorkflowTaskStats } from './workflow-core.ts';
import {
  selectExternalProgress,
  type SelectedExternalProgress,
} from './external-progress.ts';

type DashboardOptions = {
  cwd?: string;
  host?: string;
  port?: number;
  stateDir?: string;
  externalProgressHomeDir?: string;
  externalProgressCacheMs?: number;
};

type StoredState = {
  path: string;
  mtimeMs: number;
  state: WorkflowState;
};

export type DashboardSnapshot = {
  cwd: string;
  stateDir: string;
  updatedAt: string;
  stateFile?: string;
  stateLastUpdatedAt?: string;
  stateCount: number;
  activePlan?: string;
  activePlanDisplayName?: string;
  activeSuitePlan?: string;
  activeSuitePlanDisplayName?: string;
  autoMode: boolean;
  autoPausedReason?: string;
  currentPhase?: string;
  phases: { name: string; status: string }[];
  currentTask?: string;
  currentTaskId?: string;
  currentTaskIndex?: number;
  taskCount?: number;
  currentTaskSummary?: string;
  nextTask?: string;
  nextTaskId?: string;
  nextTaskSummary?: string;
  currentSliceIndex?: number;
  sliceCount?: number;
  progress?: DashboardProgress;
  warnings: string[];
  autoPendingAction?: WorkflowState['autoPendingAction'];
  activeTask?: DashboardTask;
  tasks: DashboardTask[];
  sliceGroups: DashboardSliceGroup[];
  planGroups: DashboardPlanGroup[];
  externalRuns?: DashboardExternalRun[];
  externalProgressWarning?: string;
};

type DashboardExternalRun = {
  source: string;
  status: string;
  loopPhase: string;
  progressUnit?: string;
  currentItem?: string;
  completed?: number;
  total?: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  stale: boolean;
};

type DashboardProgress = {
  slice?: { current: number; total: number; percent: number };
  task?: { current: number; total: number; percent: number };
  totalTasks?: { current: number; total: number; percent: number };
};

type DashboardTask = {
  status: 'active' | 'completed';
  currentPhase?: WorkflowPhase;
  phaseStatuses?: Partial<Record<WorkflowPhase, string>>;
  plan?: string;
  planDisplayName?: string;
  taskId?: string;
  taskIndex?: number;
  taskTitle?: string;
  startedAt?: string;
  finishedAt?: string;
  duration: string;
  durationMs: number;
  turns: number;
  verifyRuns: number;
  reviewRuns: number;
  issues: number;
  phaseDurations: { phase: WorkflowPhase; duration: string; ms: number }[];
};

type DashboardSliceGroup = {
  plan: string;
  displayName: string;
  active: boolean;
  taskCount: number;
  duration: string;
  durationMs: number;
  turns: number;
  verifyRuns: number;
  reviewRuns: number;
  issues: number;
  tasks: DashboardTask[];
};

type DashboardPlanGroup = {
  plan: string;
  displayName: string;
  active: boolean;
  activeSlice?: string;
  taskCount: number;
  completedTaskCount: number;
  completionPercent: number;
  duration: string;
  averageTaskDuration: string;
  timedTaskCount: number;
  turns: number;
  verifyRuns: number;
  reviewRuns: number;
  issues: number;
  slices: DashboardSliceGroup[];
};

const DEFAULT_PORT = 3848;
const DEFAULT_HOST = '127.0.0.1';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function text(
  res: ServerResponse,
  status: number,
  body: string,
  type: string,
): void {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readStoredStates(stateDir: string): StoredState[] {
  if (!existsSync(stateDir)) return [];
  return readdirSync(stateDir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name): StoredState[] => {
      const path = join(stateDir, name);
      try {
        const state = parsePersistedWorkflowState(readFileSync(path, 'utf8'));
        if (!state) return [];
        return [{ path, mtimeMs: statSync(path).mtimeMs, state }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function projectStoredState(
  cwd: string,
  stateDir: string,
): StoredState | undefined {
  const key = projectWorkflowStateKey({ cwd });
  const path = join(stateDir, `${key}.json`);
  if (!existsSync(path)) return undefined;

  try {
    const state = parsePersistedWorkflowState(readFileSync(path, 'utf8'));
    if (!state) return undefined;
    return { path, mtimeMs: statSync(path).mtimeMs, state };
  } catch {
    return undefined;
  }
}

function planKey(slicePath: string): string {
  if (slicePath === 'Unscoped tasks') return slicePath;
  const index = slicePath.lastIndexOf('/');
  return index === -1 ? slicePath : slicePath.slice(0, index);
}

function planDisplayName(plan: string): string {
  if (plan === 'Unscoped tasks') return plan;
  const base = plan.split('/').pop() ?? plan;
  return base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function sliceDisplayName(plan: string): string {
  if (plan === 'Unscoped tasks') return plan;
  const base = plan.split('/').pop() ?? plan;
  return base.replace(/\.mdx?$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function durationFromMs(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms < 0) return '-';
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

function percent(
  current: number | undefined,
  total: number | undefined,
): number {
  if (!current || !total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function progressItem(
  current: number | undefined,
  total: number | undefined,
): { current: number; total: number; percent: number } | undefined {
  if (!current || !total) return undefined;
  return { current, total, percent: percent(current, total) };
}

function activePhaseElapsedMs(task: WorkflowTaskStats): number {
  if (!task.activePhase || !task.phaseStartedAt) return 0;
  const startedAt = Date.parse(task.phaseStartedAt);
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Date.now() - startedAt);
}

function taskAccumulatedMs(
  task: WorkflowTaskStats,
  active: boolean,
): number | undefined {
  const base = WORKFLOW_PHASES.reduce(
    (sum, phase) => sum + (task.phaseDurationsMs?.[phase] ?? 0),
    0,
  );
  const total = base + (active ? activePhaseElapsedMs(task) : 0);
  return total > 0 ? total : undefined;
}

function dashboardTask(
  task: WorkflowTaskStats,
  status: 'active' | 'completed',
  phaseStatuses?: Partial<Record<WorkflowPhase, string>>,
): DashboardTask {
  const active = status === 'active';
  const phaseDurations = WORKFLOW_PHASES.map((phase) => {
    const ms =
      (task.phaseDurationsMs?.[phase] ?? 0) +
      (active && task.activePhase === phase ? activePhaseElapsedMs(task) : 0);
    return ms > 0 ? { phase, ms, duration: durationFromMs(ms) } : undefined;
  }).filter(
    (value): value is { phase: WorkflowPhase; duration: string; ms: number } =>
      Boolean(value),
  );

  return {
    status,
    currentPhase: active ? task.activePhase : undefined,
    phaseStatuses: active ? phaseStatuses : undefined,
    plan: task.plan,
    planDisplayName: task.plan ? sliceDisplayName(task.plan) : undefined,
    taskId: task.taskId,
    taskIndex: task.taskIndex,
    taskTitle: task.taskTitle,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    duration: durationFromMs(taskAccumulatedMs(task, active)),
    durationMs: taskAccumulatedMs(task, active) ?? 0,
    turns: task.turns,
    verifyRuns: task.verifyRuns,
    reviewRuns: task.reviewRuns,
    issues: task.issues.total,
    phaseDurations,
  };
}

function taskList(state: WorkflowState, planPath?: string): DashboardTask[] {
  const byTaskIndex = (left: DashboardTask, right: DashboardTask) =>
    (left.taskIndex ?? 0) - (right.taskIndex ?? 0) ||
    (Date.parse(left.startedAt ?? '') || 0) -
      (Date.parse(right.startedAt ?? '') || 0);
  const active = Object.values(state.stats?.active.tasks ?? {})
    .filter((task) => !planPath || task.plan === planPath)
    .map((task) => dashboardTask(task, 'active', state.phases))
    .sort(byTaskIndex);
  const completed = (state.stats?.history ?? [])
    .flatMap((session) =>
      Object.values(session.tasks)
        .filter((task) => !planPath || task.plan === planPath)
        .map((task) => dashboardTask(task, 'completed')),
    )
    .sort(byTaskIndex);
  return [...active, ...completed];
}

function sliceGroups(
  tasks: DashboardTask[],
  activePlan?: string,
): DashboardSliceGroup[] {
  const groups = new Map<string, DashboardTask[]>();
  for (const task of tasks) {
    const plan = task.plan ?? 'Unscoped tasks';
    groups.set(plan, [...(groups.get(plan) ?? []), task]);
  }

  return [...groups.entries()]
    .map(([plan, groupTasks]) => {
      const durationMs = groupTasks.reduce(
        (sum, task) =>
          sum +
          task.phaseDurations.reduce((taskSum, step) => taskSum + step.ms, 0),
        0,
      );
      return {
        plan,
        active: plan === activePlan,
        displayName: sliceDisplayName(plan),
        taskCount: groupTasks.length,
        duration: durationFromMs(durationMs),
        durationMs,
        turns: groupTasks.reduce((sum, task) => sum + task.turns, 0),
        verifyRuns: groupTasks.reduce((sum, task) => sum + task.verifyRuns, 0),
        reviewRuns: groupTasks.reduce((sum, task) => sum + task.reviewRuns, 0),
        issues: groupTasks.reduce((sum, task) => sum + task.issues, 0),
        tasks: groupTasks,
      };
    })
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      const leftLatest = Math.max(
        ...left.tasks.map((task) => Date.parse(task.startedAt ?? '') || 0),
      );
      const rightLatest = Math.max(
        ...right.tasks.map((task) => Date.parse(task.startedAt ?? '') || 0),
      );
      return rightLatest - leftLatest;
    });
}

function sliceLatestStartedAt(slice: DashboardSliceGroup): number {
  return Math.max(
    0,
    ...slice.tasks.map((task) => Date.parse(task.startedAt ?? '') || 0),
  );
}

function sliceIndex(slice: DashboardSliceGroup): number | undefined {
  const match = slice.displayName.match(/slice-(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function compareSlicesMostRecentFirst(
  left: DashboardSliceGroup,
  right: DashboardSliceGroup,
): number {
  const leftIndex = sliceIndex(left);
  const rightIndex = sliceIndex(right);
  if (leftIndex !== undefined && rightIndex !== undefined) {
    return rightIndex - leftIndex;
  }
  return sliceLatestStartedAt(right) - sliceLatestStartedAt(left);
}

function planGroups(
  slices: DashboardSliceGroup[],
  activePlan?: string,
): DashboardPlanGroup[] {
  const groups = new Map<string, DashboardSliceGroup[]>();
  for (const slice of slices) {
    const plan = planKey(slice.plan);
    groups.set(plan, [...(groups.get(plan) ?? []), slice]);
  }

  const activePlanKey = activePlan ? planKey(activePlan) : undefined;
  return [...groups.entries()]
    .map(([plan, planSlices]) => {
      const tasks = planSlices.flatMap((slice) => slice.tasks);
      const completedTaskCount = tasks.filter(
        (task) => task.status === 'completed',
      ).length;
      const durationMs = tasks.reduce((sum, task) => sum + task.durationMs, 0);
      const timedTaskCount = tasks.filter((task) => task.durationMs > 0).length;
      return {
        plan,
        displayName: planDisplayName(plan),
        active: plan === activePlanKey,
        activeSlice: plan === activePlanKey ? activePlan : undefined,
        taskCount: tasks.length,
        completedTaskCount,
        completionPercent: percent(completedTaskCount, tasks.length),
        duration: durationFromMs(durationMs),
        averageTaskDuration: durationFromMs(
          timedTaskCount ? durationMs / timedTaskCount : undefined,
        ),
        timedTaskCount,
        turns: planSlices.reduce((sum, slice) => sum + slice.turns, 0),
        verifyRuns: planSlices.reduce(
          (sum, slice) => sum + slice.verifyRuns,
          0,
        ),
        reviewRuns: planSlices.reduce(
          (sum, slice) => sum + slice.reviewRuns,
          0,
        ),
        issues: planSlices.reduce((sum, slice) => sum + slice.issues, 0),
        slices: planSlices.sort(compareSlicesMostRecentFirst),
      };
    })
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      const leftLatest = Math.max(
        ...left.slices.flatMap((slice) =>
          slice.tasks.map((task) => Date.parse(task.startedAt ?? '') || 0),
        ),
      );
      const rightLatest = Math.max(
        ...right.slices.flatMap((slice) =>
          slice.tasks.map((task) => Date.parse(task.startedAt ?? '') || 0),
        ),
      );
      return rightLatest - leftLatest;
    });
}

function dashboardExternalRun({
  snapshot,
  stale,
}: SelectedExternalProgress): DashboardExternalRun {
  return {
    source: snapshot.source,
    status: snapshot.status,
    loopPhase: snapshot.loopPhase,
    progressUnit: snapshot.progressUnit,
    currentItem: snapshot.currentItem,
    completed: snapshot.completed,
    total: snapshot.total,
    startedAt: snapshot.startedAt,
    updatedAt: snapshot.updatedAt,
    finishedAt: snapshot.finishedAt,
    stale,
  };
}

type DashboardExternalProgress = Pick<
  DashboardSnapshot,
  'externalRuns' | 'externalProgressWarning'
>;

const dashboardExternalProgressCache = new Map<
  string,
  { expiresAt: number; value: DashboardExternalProgress }
>();

function dashboardExternalProgress(
  cwd: string,
  homeDir: string | undefined,
  cacheMs: number,
): DashboardExternalProgress {
  const cacheKey = `${homeDir ?? ''}\0${cwd}`;
  const now = Date.now();
  const cached = dashboardExternalProgressCache.get(cacheKey);
  if (cacheMs > 0 && cached && cached.expiresAt > now) return cached.value;
  let value: DashboardExternalProgress;
  try {
    const selected = selectExternalProgress({ cwd, homeDir });
    const runs = [
      ...selected.active,
      ...(selected.terminal === undefined ? [] : [selected.terminal]),
    ].map(dashboardExternalRun);
    value = {
      ...(runs.length === 0 ? {} : { externalRuns: runs }),
      ...(selected.diagnostics.length === 0
        ? {}
        : {
            externalProgressWarning:
              'Some issue workflow snapshots could not be read.',
          }),
    };
  } catch {
    value = {
      externalProgressWarning: 'Issue workflow progress is unavailable.',
    };
  }
  if (cacheMs > 0)
    dashboardExternalProgressCache.set(cacheKey, {
      expiresAt: now + cacheMs,
      value,
    });
  return value;
}

export function dashboardSnapshot(
  options: DashboardOptions = {},
): DashboardSnapshot {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stateDir = resolve(options.stateDir ?? workflowStateDir({ cwd }));
  const fallbackStates = readStoredStates(stateDir);
  const selected = projectStoredState(cwd, stateDir) ?? fallbackStates[0];
  const state = selected?.state;
  const planProgress = state ? readSlicePlanProgress(state, cwd) : undefined;
  const phases = WORKFLOW_PHASES.map((phase) => ({
    name: phase,
    status: state?.phases[phase] ?? 'pending',
  }));
  const tasks = state ? taskList(state) : [];
  const slices = sliceGroups(tasks, state?.activePlan);
  const externalProgress = dashboardExternalProgress(
    cwd,
    options.externalProgressHomeDir,
    options.externalProgressCacheMs ?? 1_000,
  );

  return {
    cwd,
    stateDir,
    updatedAt: new Date().toISOString(),
    stateFile: selected?.path,
    stateLastUpdatedAt: selected
      ? new Date(selected.mtimeMs).toISOString()
      : undefined,
    stateCount: fallbackStates.length,
    activePlan: state?.activePlan,
    activePlanDisplayName: state?.activePlan
      ? planDisplayName(planKey(state.activePlan))
      : undefined,
    activeSuitePlan: state?.activeSuitePlan,
    activeSuitePlanDisplayName: state?.activeSuitePlan
      ? sliceDisplayName(state.activeSuitePlan)
      : undefined,
    autoMode: state?.autoMode ?? false,
    autoPausedReason: state?.autoPausedReason,
    currentPhase: state?.current,
    phases,
    currentTask: state?.currentTask,
    currentTaskId: state?.currentTaskId,
    currentTaskIndex: state?.currentTaskIndex,
    taskCount: state?.taskCount,
    currentTaskSummary: state?.currentTaskSummary,
    nextTask: state?.nextTask,
    nextTaskId: state?.nextTaskId,
    nextTaskSummary: state?.nextTaskSummary,
    currentSliceIndex: state?.currentSliceIndex,
    sliceCount: state?.sliceCount,
    progress: {
      slice: progressItem(
        planProgress?.currentSliceIndex ?? state?.currentSliceIndex,
        planProgress?.sliceCount ?? state?.sliceCount,
      ),
      task: progressItem(
        planProgress?.currentTaskIndex ?? state?.currentTaskIndex,
        planProgress?.taskCount ?? state?.taskCount,
      ),
      totalTasks: progressItem(
        planProgress?.totalTaskProgress?.currentTaskIndex,
        planProgress?.totalTaskProgress?.taskCount,
      ),
    },
    warnings: state?.warnings ?? [],
    autoPendingAction: state?.autoPendingAction,
    activeTask: tasks.find((task) => task.status === 'active'),
    tasks,
    sliceGroups: slices,
    planGroups: planGroups(slices, state?.activePlan),
    ...externalProgress,
  };
}

function dashboardHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Addy Auto Dashboard</title>
  <script>document.documentElement.dataset.theme = localStorage.getItem('addy-dashboard-theme') || 'amber';</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px; color-scheme: dark; font-family: var(--font-ui); font-size: 16px; font-kerning: normal; font-feature-settings: "kern" 1, "liga" 1, "tnum" 1; --font-ui: "IBM Plex Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace; --ease-out: cubic-bezier(0.16, 1, 0.3, 1); --ease-snap: cubic-bezier(0.22, 1, 0.36, 1); }
    :root, [data-theme="amber"] { background: oklch(0.13 0.018 85); color: oklch(0.91 0.01 85); --canvas: oklch(0.13 0.018 85); --surface: oklch(0.17 0.02 85); --surface-2: oklch(0.21 0.025 85); --line: oklch(0.32 0.035 82); --line-soft: oklch(0.25 0.028 82); --muted: oklch(0.67 0.025 85); --accent: oklch(0.76 0.14 78); --accent-soft: oklch(0.25 0.06 78); --info: oklch(0.68 0.09 215); --info-soft: oklch(0.23 0.04 215); --success: oklch(0.7 0.09 135); --success-soft: oklch(0.24 0.045 135); --warn: oklch(0.78 0.14 78); --warn-soft: oklch(0.25 0.06 78); --review: oklch(0.68 0.08 48); --review-soft: oklch(0.24 0.05 48); --danger: oklch(0.72 0.14 28); --text: oklch(0.9 0.01 85); --text-strong: oklch(0.94 0.008 85); --bar-track: oklch(0.12 0.015 85); --table-line: oklch(0.24 0.025 85); }
    [data-theme="cyan"] { background: oklch(0.13 0.018 240); color: oklch(0.91 0.01 235); --canvas: oklch(0.13 0.018 240); --surface: oklch(0.17 0.018 240); --surface-2: oklch(0.21 0.018 240); --line: oklch(0.31 0.018 240); --line-soft: oklch(0.25 0.016 240); --muted: oklch(0.66 0.018 235); --accent: oklch(0.72 0.12 205); --accent-soft: oklch(0.24 0.05 205); --info: oklch(0.74 0.12 215); --info-soft: oklch(0.24 0.045 215); --success: oklch(0.72 0.13 155); --success-soft: oklch(0.22 0.045 155); --warn: oklch(0.78 0.14 82); --warn-soft: oklch(0.25 0.055 82); --review: oklch(0.76 0.12 292); --review-soft: oklch(0.25 0.05 292); --danger: oklch(0.72 0.14 28); --text: oklch(0.91 0.01 235); --text-strong: oklch(0.94 0.006 245); --bar-track: oklch(0.13 0.01 245); --table-line: oklch(0.24 0.01 245); }
    [data-theme="graphite"] { background: oklch(0.13 0.004 250); color: oklch(0.9 0.006 250); --canvas: oklch(0.13 0.004 250); --surface: oklch(0.18 0.005 250); --surface-2: oklch(0.22 0.006 250); --line: oklch(0.33 0.008 250); --line-soft: oklch(0.26 0.007 250); --muted: oklch(0.66 0.008 250); --accent: oklch(0.68 0.07 235); --accent-soft: oklch(0.24 0.03 235); --info: oklch(0.68 0.07 235); --info-soft: oklch(0.24 0.03 235); --success: oklch(0.68 0.06 175); --success-soft: oklch(0.23 0.03 175); --warn: oklch(0.75 0.08 82); --warn-soft: oklch(0.25 0.04 82); --review: oklch(0.68 0.045 295); --review-soft: oklch(0.24 0.025 295); --danger: oklch(0.7 0.1 28); --text: oklch(0.9 0.006 250); --text-strong: oklch(0.94 0.004 250); --bar-track: oklch(0.13 0.004 250); --table-line: oklch(0.24 0.006 250); }
    [data-theme="nordic"] { background: oklch(0.15 0.025 245); color: oklch(0.91 0.012 240); --canvas: oklch(0.15 0.025 245); --surface: oklch(0.2 0.028 245); --surface-2: oklch(0.25 0.03 245); --line: oklch(0.35 0.035 245); --line-soft: oklch(0.29 0.03 245); --muted: oklch(0.69 0.025 240); --accent: oklch(0.75 0.085 220); --accent-soft: oklch(0.28 0.045 220); --info: oklch(0.75 0.085 220); --info-soft: oklch(0.28 0.045 220); --success: oklch(0.75 0.09 165); --success-soft: oklch(0.27 0.045 165); --warn: oklch(0.8 0.1 90); --warn-soft: oklch(0.29 0.045 90); --review: oklch(0.74 0.08 295); --review-soft: oklch(0.28 0.04 295); --danger: oklch(0.72 0.12 28); --text: oklch(0.91 0.012 240); --text-strong: oklch(0.94 0.01 240); --bar-track: oklch(0.14 0.02 245); --table-line: oklch(0.27 0.025 245); }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 1rem 1.25rem; background: var(--canvas); font-family: var(--font-ui); line-height: 1.45; text-rendering: optimizeLegibility; }
    main { max-width: 1440px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; gap: var(--space-4); align-items: start; margin-bottom: var(--space-2); }
    h1 { margin: 0; font-size: 1.375rem; font-weight: 720; letter-spacing: -0.025em; line-height: 1.12; color: var(--text-strong); }
    .muted { color: var(--muted); }
    .topline { margin-bottom: var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--line-soft); font-size: .75rem; line-height: 1.4; max-width: none; }
    .header-actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .pill { display: inline-flex; align-items: center; gap: .375rem; padding: .3125rem .625rem; border-radius: 2px; border: 1px solid var(--line); background: var(--surface-2); font-size: .8125rem; line-height: 1.25; white-space: nowrap; font-variant-numeric: tabular-nums; transition: border-color .18s var(--ease-out), background-color .18s var(--ease-out), color .18s var(--ease-out), transform .18s var(--ease-out); }
    select.pill { color: inherit; max-width: 360px; padding-right: 26px; text-overflow: ellipsis; cursor: pointer; }
    select.pill:hover { transform: translateY(-1px); border-color: var(--accent); }
    .on { color: var(--success); border-color: oklch(0.36 0.06 150); background: var(--success-soft); }
    .on::before { content: ""; width: .45rem; height: .45rem; border-radius: 999px; background: currentColor; animation: statusPulse 1.8s var(--ease-out) infinite; }
    .off { color: var(--danger); border-color: oklch(0.36 0.06 24); background: oklch(0.2 0.03 24); }
    .panel { background: var(--surface); border: 1px solid var(--line-soft); border-radius: 2px; transition: border-color .22s var(--ease-out), background-color .22s var(--ease-out), transform .22s var(--ease-out); }
    .status-strip { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-4); align-items: center; padding: var(--space-3) var(--space-4); margin-bottom: var(--space-2); background: var(--surface); border: 1px solid var(--line-soft); border-radius: 2px; }
    .summary { display: grid; grid-template-columns: minmax(280px, 1.05fr) minmax(220px, .7fr) minmax(360px, 1.25fr); gap: 1px; margin-bottom: var(--space-2); background: var(--line-soft); border: 1px solid var(--line-soft); }
    .metric { padding: var(--space-4); min-width: 0; background: var(--surface); border: 0; }
    .metric-label { font-size: .6875rem; font-weight: 680; line-height: 1.15; text-transform: uppercase; letter-spacing: .105em; color: var(--muted); }
    .metric-value { margin-top: .375rem; font-size: 1.125rem; font-weight: 690; letter-spacing: -0.012em; line-height: 1.22; overflow-wrap: anywhere; color: var(--text-strong); font-variant-numeric: tabular-nums; }
    .metric-note { margin-top: .375rem; font-size: .8125rem; color: var(--muted); line-height: 1.45; font-variant-numeric: tabular-nums; }
    .next-line { margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line-soft); }
    .bar { height: 8px; overflow: hidden; border-radius: 2px; background: var(--bar-track); border: 1px solid var(--line-soft); margin: 9px 0 6px; }
    .fill { height: 100%; width: 0%; border-radius: 2px; background: var(--accent); transform-origin: left center; transition: width .42s var(--ease-out); }
    .progress-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-2); margin-bottom: var(--space-2); }
    .progress-card { padding: 12px 14px; border-left: 3px solid var(--accent); }
    .progress-head { display: flex; justify-content: space-between; gap: .75rem; align-items: baseline; font-variant-numeric: tabular-nums; }
    .section { margin-top: var(--space-2); padding: var(--space-4); }
    .section-head { display: flex; justify-content: space-between; gap: var(--space-3); align-items: center; margin-bottom: var(--space-3); }
    .section-title { font-size: .75rem; font-weight: 700; line-height: 1.15; text-transform: uppercase; letter-spacing: .095em; color: var(--accent); }
    .phases { display: flex; gap: var(--space-1); flex-wrap: wrap; }
    .phase { padding: .1875rem .4375rem; border-radius: 2px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--line-soft); font-size: .8125rem; line-height: 1.2; font-variant-numeric: tabular-nums; transition: background-color .22s var(--ease-out), color .22s var(--ease-out), transform .22s var(--ease-out); }
    .phase.complete { color: var(--success); border-color: oklch(0.42 0.08 150); background: var(--success-soft); }
    .phase.active { color: var(--warn); border-color: oklch(0.5 0.1 78); background: var(--warn-soft); transform: translateY(-1px); }
    .phase.phase-build.active, .step.phase-build.current { color: var(--info); border-color: oklch(0.5 0.1 220); background: var(--info-soft); }
    .phase.phase-simplify.active, .step.phase-simplify.current { color: oklch(0.76 0.1 275); border-color: oklch(0.48 0.09 275); background: oklch(0.24 0.045 275); }
    .phase.phase-verify.active, .step.phase-verify.current { color: var(--warn); border-color: oklch(0.5 0.1 78); background: var(--warn-soft); }
    .phase.phase-review.active, .step.phase-review.current { color: var(--review); border-color: oklch(0.5 0.1 315); background: var(--review-soft); }
    .phase.phase-finish.active, .step.phase-finish.current { color: var(--success); border-color: oklch(0.42 0.08 150); background: var(--success-soft); }
    .slice-list { display: grid; gap: var(--space-2); }
    details.slice { background: var(--surface); border: 1px solid var(--line-soft); border-radius: 2px; overflow: hidden; transition: border-color .22s var(--ease-out), background-color .22s var(--ease-out); }
    details.slice[open] { border-color: var(--line); background: var(--surface-2); }
    summary.slice-summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: minmax(260px, 1fr) repeat(6, max-content); gap: var(--space-4); align-items: center; padding: 10px 12px; transition: background-color .18s var(--ease-out); }
    summary.slice-summary:hover { background: var(--surface-2); }
    summary.slice-summary::-webkit-details-marker { display: none; }
    .slice-name { min-width: 0; font-size: .9375rem; font-weight: 690; line-height: 1.25; letter-spacing: -0.01em; overflow-wrap: anywhere; color: var(--text-strong); }
    .slice-meta { color: var(--muted); font-size: .8125rem; line-height: 1.35; margin-top: .1875rem; }
    .slice-stat { text-align: right; color: var(--text); font-variant-numeric: tabular-nums; font-size: .8125rem; line-height: 1.25; }
    .active-dot { display: inline-block; width: 7px; height: 7px; border-radius: 999px; background: var(--accent); margin-right: 7px; vertical-align: 1px; animation: statusPulse 1.8s var(--ease-out) infinite; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 860px; }
    th, td { padding: .5625rem .625rem; text-align: left; border-bottom: 1px solid var(--table-line); vertical-align: top; font-size: .8125rem; line-height: 1.4; font-variant-numeric: tabular-nums; }
    th { color: var(--accent); font-size: .6875rem; font-weight: 700; line-height: 1.15; text-transform: uppercase; letter-spacing: .085em; }
    tbody tr.active-row { background: var(--accent-soft); }
    tbody tr { transition: background-color .18s var(--ease-out); }
    .task-title { font-weight: 660; color: var(--text-strong); line-height: 1.35; }
    .status-active { color: var(--warn); font-weight: 700; }
    .status-completed { color: var(--success); font-weight: 650; }
    .steps { display: flex; flex-wrap: wrap; gap: 6px; }
    .step { padding: .1875rem .4375rem; border-radius: 2px; background: var(--surface-2); color: var(--text); border: 1px solid transparent; font-size: .75rem; line-height: 1.2; white-space: nowrap; font-variant-numeric: tabular-nums; transition: transform .18s var(--ease-out), border-color .18s var(--ease-out), background-color .18s var(--ease-out), color .18s var(--ease-out); }
    .step.complete { color: var(--success); border-color: oklch(0.39 0.07 150); background: var(--success-soft); }
    .step.current { color: var(--warn); border-color: oklch(0.5 0.1 78); background: var(--warn-soft); transform: translateY(-1px); animation: currentStepPulse 1.8s var(--ease-out) infinite; font-weight: 750; }
    .step.pending { color: var(--muted); border-color: var(--line-soft); background: var(--canvas); }
    .empty { color: var(--muted); padding: 14px; border: 1px dashed var(--line); border-radius: 2px; }
    .issue-workflow-list { display: grid; gap: var(--space-2); }
    .issue-workflow { display: grid; grid-template-columns: minmax(180px, 1fr) max-content; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line-soft); background: var(--surface-2); }
    .issue-workflow-primary { color: var(--text-strong); font-weight: 690; }
    .issue-workflow-meta { color: var(--muted); font-size: .8125rem; margin-top: .25rem; overflow-wrap: anywhere; }
    .issue-workflow-status { align-self: start; color: var(--muted); font-size: .8125rem; text-align: right; }
    .issue-workflow-boundary { color: var(--muted); font-size: .8125rem; }
    .issue-workflow-warning { color: var(--warn); }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-family: var(--font-mono); font-size: .75rem; line-height: 1.5; color: var(--text); font-variant-numeric: tabular-nums; }

    .is-refreshing { border-color: var(--accent); }
    @keyframes statusPulse { 0%, 100% { opacity: .58; transform: scale(.9); } 45% { opacity: 1; transform: scale(1.15); } }
    @keyframes currentStepPulse { 0%, 100% { border-color: oklch(0.42 0.07 78); } 50% { border-color: var(--warn); } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
    @media (max-width: 1120px) { .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .progress-grid { grid-template-columns: 1fr; } summary.slice-summary { grid-template-columns: 1fr repeat(3, max-content); } .hide-md { display: none; } }
    @media (max-width: 720px) { body { padding: .875rem; } header { flex-direction: column; align-items: stretch; } .header-actions { justify-content: flex-start; } h1 { font-size: 1.3125rem; } .summary { grid-template-columns: 1fr; } .metric, .section { padding: 12px; } .section-head { align-items: start; flex-direction: column; } .phase { flex: 1 1 96px; text-align: center; } summary.slice-summary { grid-template-columns: 1fr; gap: 6px; } .slice-stat { text-align: left; } table { min-width: 760px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>Addy Auto Dashboard</h1></div>
      <div class="header-actions"><select id="themePicker" class="pill" aria-label="Theme"><option value="amber">Amber Ops</option><option value="cyan">Terminal Cyan</option><option value="graphite">Graphite Mono+</option><option value="nordic">Nordic Slate</option></select><select id="planPicker" class="pill" aria-label="Plan"></select><span id="refresh" class="pill">Auto-refresh 5s</span><span id="mode" class="pill">Loading…</span></div>
    </header>
    <div class="muted topline" id="cwd"></div>
    <section class="status-strip"><div><div class="metric-label">Phase</div><div class="metric-value" id="phase">-</div></div><div class="phases" id="phases"></div></section>
    <section class="summary">
      <div class="metric"><div class="metric-label">Active plan</div><div class="metric-value" id="plan">-</div><div class="metric-note" id="planSuite"></div></div>
      <div class="metric"><div class="metric-label">Total tasks</div><div class="metric-value" id="totalPercent">-</div><div class="bar"><div class="fill" id="totalFill"></div></div><div class="metric-note" id="totalLabel"></div></div>
      <div class="metric"><div class="metric-label">Current task</div><div class="metric-value" id="task">-</div><div class="metric-note" id="taskSummary"></div><div class="metric-note next-line">Next: <span id="nextTask">-</span><span id="nextSummary"></span></div></div>
    </section>
    <section class="progress-grid" id="progress"></section>
    <section class="panel section" id="issueWorkflows" hidden><div class="section-head"><div class="section-title">Issue workflows</div></div><div class="issue-workflow-list" id="issueWorkflowRuns"></div></section>
    <section class="panel section"><div class="section-head"><div class="section-title">Slices</div></div><div class="slice-list" id="slices"></div></section>
    <section class="panel section"><div class="section-head"><div class="section-title">Raw state summary</div></div><pre id="raw"></pre></section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    function value(v, fallback = '-') { return v === undefined || v === null || v === '' ? fallback : v; }
    function escapeHtml(v) { return String(value(v, '')).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }
    function progressCard(title, item) {
      if (!item) return '';
      return '<div class="panel progress-card"><div class="progress-head"><div class="metric-label">' + escapeHtml(title) + '</div><strong>' + item.percent + '%</strong></div><div class="bar"><div class="fill" style="width:' + item.percent + '%"></div></div><div class="metric-note">' + item.current + ' / ' + item.total + '</div></div>';
    }
    const taskStepPhases = ['build', 'simplify', 'verify', 'review', 'finish'];
    function taskSteps(task) {
      if (task.status === 'active') {
        const complete = new Map((task.phaseDurations || []).map((step) => [step.phase, step.duration]));
        const current = task.currentPhase;
        return taskStepPhases.map((phase) => {
          const phaseStatus = task.phaseStatuses && task.phaseStatuses[phase];
          const status = phaseStatus === 'active' ? 'current' : phaseStatus || (phase === current ? 'current' : complete.has(phase) ? 'complete' : 'pending');
          const detail = phase === current ? complete.get(phase) || 'now' : complete.get(phase) || 'pending';
          return '<span class="step phase-' + escapeHtml(phase) + ' ' + status + '">' + escapeHtml(phase) + ' ' + escapeHtml(detail) + '</span>';
        }).join('');
      }
      return (task.phaseDurations || []).map((step) => '<span class="step complete">' + escapeHtml(step.phase) + ' ' + escapeHtml(step.duration) + '</span>').join('') || '<span class="muted">-</span>';
    }
    function setHtmlIfChanged(element, html) { if (element.innerHTML !== html) element.innerHTML = html; }
    function taskRows(tasks) {
      return (tasks || []).map((task) => '<tr class="' + (task.status === 'active' ? 'active-row' : '') + '"><td class="status-' + escapeHtml(task.status) + '">' + escapeHtml(task.status) + '</td><td><div class="task-title">' + escapeHtml(task.taskTitle || task.taskId) + '</div><div class="muted" title="' + escapeHtml(task.plan || '') + '">' + escapeHtml(task.planDisplayName || task.taskId || '') + '</div></td><td>' + escapeHtml(task.duration) + '</td><td>' + escapeHtml(task.turns) + '</td><td>' + escapeHtml(task.verifyRuns) + '</td><td>' + escapeHtml(task.reviewRuns) + '</td><td>' + escapeHtml(task.issues) + '</td><td><div class="steps">' + taskSteps(task) + '</div></td></tr>').join('');
    }
    const sliceOpenState = new Map();
    function sliceKey(slice) { return slice.plan || slice.displayName || ''; }
    function captureSliceOpenState() {
      document.querySelectorAll('details.slice[data-slice-key]').forEach((slice) => {
        sliceOpenState.set(slice.dataset.sliceKey, slice.open);
      });
    }
    function sliceIsOpen(slice, activeSlicePath) {
      const key = sliceKey(slice);
      return sliceOpenState.has(key) ? sliceOpenState.get(key) : slice.plan === activeSlicePath;
    }
    function sliceBlock(slice, activeSlicePath) {
      const rows = taskRows(slice.tasks);
      const open = sliceIsOpen(slice, activeSlicePath);
      return '<details class="slice" data-slice-key="' + escapeHtml(sliceKey(slice)) + '"' + (open ? ' open' : '') + ' title="' + escapeHtml(slice.plan) + '"><summary class="slice-summary"><div><div class="slice-name">' + (slice.active ? '<span class="active-dot"></span>' : '') + escapeHtml(slice.displayName || slice.plan) + '</div><div class="slice-meta">' + (slice.active ? 'Current slice · ' : 'Completed slice · ') + 'accumulated totals</div></div><div class="slice-stat">' + slice.taskCount + ' tasks</div><div class="slice-stat">' + escapeHtml(slice.duration) + '</div><div class="slice-stat hide-md">' + slice.turns + ' turns</div><div class="slice-stat hide-md">' + slice.verifyRuns + ' verify</div><div class="slice-stat hide-md">' + slice.reviewRuns + ' review</div><div class="slice-stat">' + slice.issues + ' issues</div></summary><div class="table-wrap"><table><thead><tr><th>Status</th><th>Task</th><th>Duration</th><th>Turns</th><th>Verify</th><th>Review</th><th>Issues</th><th>Step time</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
    }
    let currentPlan = null;
    function planDefault(data) {
      const groups = data.planGroups || [];
      if (currentPlan && groups.some((group) => group.plan === currentPlan)) return currentPlan;
      const active = groups.find((group) => group.active);
      return (active && active.plan) || (groups[0] && groups[0].plan) || null;
    }
    function renderPlanPicker(groups) {
      const picker = $('planPicker');
      const signature = groups.map((group) => group.plan).join('|');
      if (picker.dataset.signature !== signature) {
        picker.dataset.signature = signature;
        picker.innerHTML = groups.map((group) => '<option value="' + escapeHtml(group.plan) + '">' + escapeHtml(group.displayName || group.plan) + (group.active ? ' · active' : '') + '</option>').join('');
      }
    }
    function planProgressCard(selected) {
      if (!selected) return '';
      return progressCard('Tasks recorded', { current: selected.completedTaskCount || 0, total: selected.taskCount || 0, percent: selected.completionPercent || 0 });
    }
    function planKpiCard(selected) {
      if (!selected) return '';
      return '<div class="panel progress-card"><div class="progress-head"><div class="metric-label">Plan performance</div><strong>' + escapeHtml(selected.duration) + '</strong></div><div class="metric-note">avg ' + escapeHtml(selected.averageTaskDuration) + ' / timed task · ' + selected.timedTaskCount + ' timed · ' + selected.turns + ' turns</div><div class="metric-note">' + selected.verifyRuns + ' verify · ' + selected.reviewRuns + ' review · ' + selected.issues + ' issues</div></div>';
    }
    function issueWorkflowProgress(run) {
      const unit = run.progressUnit ? ' ' + run.progressUnit : '';
      if (Number.isInteger(run.completed) && Number.isInteger(run.total)) return run.completed + ' / ' + run.total + unit;
      if (Number.isInteger(run.completed)) return run.completed + ' completed' + unit;
      if (Number.isInteger(run.total)) return run.total + ' total' + unit;
      return run.progressUnit || '';
    }
    function issueWorkflow(run) {
      const boundary = run.loopPhase === 'pre-loop' || run.loopPhase === 'post-loop';
      const phase = escapeHtml(run.loopPhase);
      const progress = escapeHtml(issueWorkflowProgress(run));
      return '<div class="issue-workflow"><div><div class="issue-workflow-primary">' + phase + (progress ? ' · ' + progress : '') + '</div><div class="issue-workflow-meta">' + escapeHtml(run.currentItem) + '</div><div class="issue-workflow-meta">' + escapeHtml(run.source) + (boundary ? ' <span class="issue-workflow-boundary">boundary state</span>' : '') + '</div></div><div class="issue-workflow-status">' + escapeHtml(run.status) + (run.stale ? ' · stale' : '') + '</div></div>';
    }
    function renderIssueWorkflows(data) {
      const runs = data.externalRuns || [];
      const warning = data.externalProgressWarning;
      const panel = $('issueWorkflows');
      panel.hidden = runs.length === 0 && !warning;
      setHtmlIfChanged($('issueWorkflowRuns'), runs.map(issueWorkflow).join('') + (warning ? '<div class="issue-workflow-warning">' + escapeHtml(warning) + '</div>' : ''));
    }
    async function refresh() {
      const res = await fetch('/api/state');
      const data = await res.json();
      const groups = data.planGroups || [];
      renderPlanPicker(groups);
      currentPlan = planDefault(data);
      $('planPicker').value = currentPlan || '';
      const selected = groups.find((group) => group.plan === currentPlan);
      const isActive = Boolean(selected && selected.active);
      const selectedTasks = selected ? selected.slices.flatMap((slice) => slice.tasks) : [];
      const selectedActiveTask = selectedTasks.find((task) => task.status === 'active');
      $('refresh').classList.remove('is-refreshing');
      void $('refresh').offsetWidth;
      $('refresh').classList.add('is-refreshing');
      $('cwd').textContent = data.cwd + ' · ' + data.stateCount + ' state file(s) · updated ' + value(data.stateLastUpdatedAt ? new Date(data.stateLastUpdatedAt).toLocaleTimeString() : undefined) + ' · refreshed ' + new Date(data.updatedAt).toLocaleTimeString();
      $('mode').textContent = data.autoMode ? 'Addy auto running' : 'Addy auto idle';
      $('mode').className = 'pill ' + (data.autoMode ? 'on' : 'off');
      $('plan').textContent = value(selected ? selected.displayName : data.activePlanDisplayName || data.activePlan);
      $('plan').title = value(selected ? selected.plan : data.activePlan, '');
      $('planSuite').textContent = isActive && data.activeSuitePlanDisplayName ? 'Suite: ' + data.activeSuitePlanDisplayName : '';
      $('phase').textContent = isActive ? value(data.currentPhase) : selected ? 'Archived plan' : '-';
      const totalProgress = isActive ? data.progress && data.progress.totalTasks : undefined;
      if (totalProgress) {
        $('totalPercent').textContent = totalProgress.percent + '%';
        $('totalFill').style.width = totalProgress.percent + '%';
        $('totalLabel').textContent = totalProgress.current + ' / ' + totalProgress.total + ' total tasks · ' + (selected ? selected.duration : '-') + ' accumulated';
      } else if (selected) {
        $('totalPercent').textContent = selected.completionPercent + '%';
        $('totalFill').style.width = selected.completionPercent + '%';
        $('totalLabel').textContent = selected.completedTaskCount + ' / ' + selected.taskCount + ' tasks recorded · ' + selected.duration + ' accumulated';
      } else {
        $('totalPercent').textContent = '-';
        $('totalFill').style.width = '0%';
        $('totalLabel').textContent = 'No plan selected';
      }
      $('task').textContent = isActive ? value([data.currentTaskIndex && ('#' + data.currentTaskIndex), data.currentTask].filter(Boolean).join(' ')) : selectedActiveTask ? value(selectedActiveTask.taskTitle || selectedActiveTask.taskId) : '-';
      $('taskSummary').textContent = isActive ? value(data.currentTaskSummary, '') : selected ? 'No active task for this archived plan.' : '';
      $('nextTask').textContent = isActive ? value(data.nextTask) : '-';
      $('nextSummary').textContent = isActive ? (data.nextTaskSummary && data.nextTaskSummary !== data.nextTask ? ' · ' + data.nextTaskSummary : '') : selected ? ' · Select another plan from the dropdown to inspect its history.' : '';
      setHtmlIfChanged($('progress'), isActive ? progressCard('Current slice', data.progress && data.progress.slice) + progressCard('Current slice tasks', data.progress && data.progress.task) + planKpiCard(selected) : planProgressCard(selected) + planKpiCard(selected));
      setHtmlIfChanged($('phases'), isActive ? (data.phases || []).map((phase) => '<span class="phase phase-' + escapeHtml(phase.name) + ' ' + escapeHtml(phase.status) + '">' + escapeHtml(phase.name) + '</span>').join('') : '<span class="phase complete">archived: complete</span>');
      renderIssueWorkflows(data);
      captureSliceOpenState();
      setHtmlIfChanged($('slices'), selected ? selected.slices.map((slice) => sliceBlock(slice, data.activePlan)).join('') : '<div class="empty">' + (data.activePlan ? 'No stats recorded for the selected plan.' : "No active plan in this directory's state.") + '</div>');
      $('raw').textContent = JSON.stringify({ selectedPlan: selected && selected.plan, activePlan: data.activePlan, stateFile: data.stateFile, pending: data.autoPendingAction, warnings: data.warnings, paused: data.autoPausedReason }, null, 2);
    }
    const themeKey = 'addy-dashboard-theme';
    const themePicker = $('themePicker');
    themePicker.value = localStorage.getItem(themeKey) || 'amber';
    document.documentElement.dataset.theme = themePicker.value;
    themePicker.addEventListener('change', (event) => {
      const theme = event.target.value || 'amber';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(themeKey, theme);
    });
    $('planPicker').addEventListener('change', (event) => {
      currentPlan = event.target.value;
      refresh();
    });
    const refreshIntervalMs = 5000;
    $('refresh').textContent = 'Auto-refresh ' + Math.round(refreshIntervalMs / 1000) + 's';
    refresh();
    setInterval(refresh, refreshIntervalMs);
  </script>
</body>
</html>`;
}

function handleRequest(
  options: DashboardOptions,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/state')
    return json(res, 200, dashboardSnapshot(options));
  if (url.pathname === '/' || url.pathname === '/index.html')
    return text(res, 200, dashboardHtml(), 'text/html');
  text(res, 404, 'Not found', 'text/plain');
}

export function startAddyDashboard(options: DashboardOptions = {}): void {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const server = createServer((req, res) => handleRequest(options, req, res));
  server.listen(port, host, () => {
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`Addy dashboard listening on ${url}`);
  });
}
