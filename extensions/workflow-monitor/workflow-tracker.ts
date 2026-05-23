import { truncateToWidth } from '@earendil-works/pi-tui';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  WORKFLOW_PHASES,
  phaseIndex,
  type WorkflowIssueStats,
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowStats,
  type WorkflowStatsSession,
  type WorkflowTaskStats,
  createInitialWorkflowState,
} from './workflow-transitions.ts';

export const WORKFLOW_WIDGET_KEY = 'pi-addy-workflow';
export const WORKFLOW_STATE_ENTRY_TYPE = 'pi-addy-workflow-state';
export const ADDY_AUTO_TASK_COMMIT_PROMPT = '__addy-auto-task-commit__';
const OPTIONAL_PHASES = new Set<WorkflowPhase>(['simplify']);

function emptyIssueStats(): WorkflowIssueStats {
  return { critical: 0, important: 0, suggestion: 0, unknown: 0, total: 0 };
}

function addIssueStats(
  left: WorkflowIssueStats,
  right: WorkflowIssueStats,
): WorkflowIssueStats {
  return {
    critical: left.critical + right.critical,
    important: left.important + right.important,
    suggestion: left.suggestion + right.suggestion,
    unknown: left.unknown + right.unknown,
    total: left.total + right.total,
  };
}

function normalizeIssueStats(value: unknown): WorkflowIssueStats {
  if (typeof value !== 'object' || value === null) return emptyIssueStats();
  const candidate = value as Partial<WorkflowIssueStats>;
  const nonNegative = (number: unknown) =>
    typeof number === 'number' && Number.isSafeInteger(number) && number >= 0
      ? number
      : 0;
  return {
    critical: nonNegative(candidate.critical),
    important: nonNegative(candidate.important),
    suggestion: nonNegative(candidate.suggestion),
    unknown: nonNegative(candidate.unknown),
    total: nonNegative(candidate.total),
  };
}

function normalizeTaskStats(value: unknown): WorkflowTaskStats | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<WorkflowTaskStats>;
  const nonNegative = (number: unknown) =>
    typeof number === 'number' && Number.isSafeInteger(number) && number >= 0
      ? number
      : 0;
  return {
    plan: typeof candidate.plan === 'string' ? candidate.plan : undefined,
    sliceIndex:
      typeof candidate.sliceIndex === 'number' &&
      Number.isSafeInteger(candidate.sliceIndex) &&
      candidate.sliceIndex > 0
        ? candidate.sliceIndex
        : undefined,
    taskIndex:
      typeof candidate.taskIndex === 'number' &&
      Number.isSafeInteger(candidate.taskIndex) &&
      candidate.taskIndex > 0
        ? candidate.taskIndex
        : undefined,
    taskTitle:
      typeof candidate.taskTitle === 'string' ? candidate.taskTitle : undefined,
    turns: nonNegative(candidate.turns),
    verifyRuns: nonNegative(candidate.verifyRuns),
    reviewRuns: nonNegative(candidate.reviewRuns),
    issues: normalizeIssueStats(candidate.issues),
  };
}

function normalizeStatsSession(value: unknown): WorkflowStatsSession {
  if (typeof value !== 'object' || value === null) return { tasks: {} };
  const candidate = value as Partial<WorkflowStatsSession>;
  const tasks: Record<string, WorkflowTaskStats> = {};
  if (typeof candidate.tasks === 'object' && candidate.tasks !== null) {
    for (const [key, task] of Object.entries(candidate.tasks)) {
      const normalized = normalizeTaskStats(task);
      if (normalized) tasks[key] = normalized;
    }
  }
  return {
    tasks,
    endedReason:
      typeof candidate.endedReason === 'string'
        ? candidate.endedReason
        : undefined,
  };
}

export function createEmptyWorkflowStats(): WorkflowStats {
  return { active: { tasks: {} }, history: [] };
}

function normalizeWorkflowStats(value: unknown): WorkflowStats {
  if (typeof value !== 'object' || value === null)
    return createEmptyWorkflowStats();
  const candidate = value as Partial<WorkflowStats>;
  return {
    active: normalizeStatsSession(candidate.active),
    history: Array.isArray(candidate.history)
      ? candidate.history.map(normalizeStatsSession)
      : [],
  };
}

function normalizeWorkflowState(state: WorkflowState): WorkflowState {
  const sanitizedState = sanitizeWorkflowArtifacts(state);
  const normalizedTasks =
    sanitizedState.currentTask || sanitizedState.nextTask
      ? {
          currentTask: sanitizedState.currentTask,
          nextTask: sanitizedState.nextTask,
          currentTaskIndex: sanitizedState.currentTaskIndex,
          taskCount: sanitizedState.taskCount,
          currentSliceIndex: sanitizedState.currentSliceIndex,
          sliceCount: sanitizedState.sliceCount,
          currentTaskSummary: sanitizedState.currentTaskSummary,
          nextTaskSummary: sanitizedState.nextTaskSummary,
        }
      : {};

  const normalizedStats = {
    stats: normalizeWorkflowStats(sanitizedState.stats),
  };

  if (
    !sanitizedState.current ||
    phaseIndex(sanitizedState.current) <= phaseIndex('plan')
  )
    return { ...sanitizedState, ...normalizedTasks, ...normalizedStats };

  return {
    ...sanitizedState,
    ...normalizedTasks,
    ...normalizedStats,
    phases: {
      ...sanitizedState.phases,
      define: 'complete',
      plan: 'complete',
    },
  };
}

function sanitizeWorkflowArtifacts(state: WorkflowState): WorkflowState {
  const activePlan = sanitizePlanArtifact(state.activePlan);
  const activeSuitePlan = sanitizePlanArtifact(state.activeSuitePlan);
  if (
    activePlan === state.activePlan &&
    activeSuitePlan === state.activeSuitePlan
  )
    return state;
  return { ...state, activePlan, activeSuitePlan };
}

function sanitizePlanArtifact(
  planPath: string | undefined,
): string | undefined {
  if (planPath?.startsWith('/') && !/\.md$/i.test(planPath)) return undefined;
  return planPath;
}

export function serializeWorkflowState(state: WorkflowState): string {
  return JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state });
}

export function parseWorkflowState(value: unknown): WorkflowState {
  if (!value) return createInitialWorkflowState();

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === WORKFLOW_STATE_ENTRY_TYPE && parsed.state)
        return normalizeWorkflowState(parsed.state as WorkflowState);
      if (parsed?.phases)
        return normalizeWorkflowState(parsed as WorkflowState);
    } catch {
      return createInitialWorkflowState();
    }
  }

  if (typeof value === 'object' && value !== null && 'phases' in value)
    return normalizeWorkflowState(value as WorkflowState);
  return createInitialWorkflowState();
}

function currentWorkflowTaskStats(
  state: WorkflowState,
): WorkflowTaskStats | undefined {
  const tasks = Object.values(state.stats?.active.tasks ?? {});
  return tasks.find((task) => {
    if (state.activePlan && task.plan && task.plan !== state.activePlan)
      return false;
    if (
      state.currentTaskIndex &&
      task.taskIndex &&
      task.taskIndex !== state.currentTaskIndex
    )
      return false;
    if (
      state.currentTask &&
      task.taskTitle &&
      task.taskTitle !== state.currentTask
    )
      return false;
    return !!task.taskTitle || !!task.taskIndex;
  });
}

export function renderWorkflowStrip(
  state: WorkflowState,
  theme?: { fg?: (name: string, text: string) => string },
): string {
  const currentStats = currentWorkflowTaskStats(state);
  const setupPhases = WORKFLOW_PHASES.slice(0, phaseIndex('build')).map(
    (phase) => renderPhase(phase, state, theme, currentStats),
  );
  const loopPhases = WORKFLOW_PHASES.slice(phaseIndex('build')).map((phase) =>
    renderPhase(phase, state, theme, currentStats),
  );
  return `${setupPhases.join(' → ')} => { ${loopPhases.join(' → ')} }`;
}

export function workflowArtifactForFooter(
  state: WorkflowState,
): string | undefined {
  if (!state.current) return undefined;

  if (state.current === 'define' || state.current === 'plan')
    return state.activeSpec;
  if (phaseIndex(state.current) > phaseIndex('plan')) return state.activePlan;

  return undefined;
}

export function workflowArtifactName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;
}

function styledArtifactName(
  path: string | undefined,
  theme?: { fg?: (name: string, text: string) => string },
): string | undefined {
  if (!path) return undefined;
  const name = workflowArtifactName(path);
  return theme?.fg?.('mdLinkUrl', name) ?? theme?.fg?.('accent', name) ?? name;
}

type PlanTaskStatus = 'Implemented' | 'Verified' | 'Reviewed';
type PlanTask = {
  title: string;
  complete: boolean;
  missingStatuses?: PlanTaskStatus[];
};

type PlanTaskFrontier = PlanTask & {
  taskIndex: number;
  missingStatuses: PlanTaskStatus[];
  requiresCommit: boolean;
};

function definedWorkflowActionFields(fields: {
  prompt: string;
  plan?: string;
  taskTitle?: string;
  taskIndex?: number;
  currentSliceIndex?: number;
  missingStatuses?: PlanTaskStatus[];
  requiresCommit?: boolean;
}) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as typeof fields;
}

const REQUIRED_TASK_STATUSES: PlanTaskStatus[] = [
  'Implemented',
  'Verified',
  'Reviewed',
];
const STATUS_CHECKBOX =
  /^\s*[-*]\s+\[[ xX]\]\s+(Implemented|Verified|Reviewed)\b/;
const TASK_CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;
const TASK_HEADING = /^#{2,4}\s+(.+)$/;

function cleanTaskTitle(title: string): string {
  return title
    .replace(/^\s*(?:slice|task)\s*\d+[.:) -]*/i, '')
    .replace(/`/g, '')
    .trim();
}

function taskMissingStatuses(statuses: PlanTaskStatus[]): PlanTaskStatus[] {
  return REQUIRED_TASK_STATUSES.filter((label) => !statuses.includes(label));
}

function commandFromPrompt(prompt?: string): string | undefined {
  if (!prompt) return undefined;
  const invocation = prompt.match(/Invocation:\s*`([^`]+)`/i)?.[1];
  const text = invocation ?? prompt;
  return text.trim().split(/\s+/)[0];
}

function taskMatchesPlanTask(
  task: PlanTask,
  index: number,
  candidate: { taskIndex?: number; taskTitle?: string },
): boolean {
  if (candidate.taskIndex !== undefined && candidate.taskIndex !== index + 1)
    return false;
  if (candidate.taskTitle && candidate.taskTitle !== task.title) return false;
  return candidate.taskIndex !== undefined || Boolean(candidate.taskTitle);
}

export function workflowTaskCommitKey(
  planPath: string,
  taskIndex: number,
  taskTitle: string,
): string {
  return [planPath, taskIndex, taskTitle].join('\u001f');
}

function taskHasCommitRecord(
  state: WorkflowState,
  planPath: string,
  task: PlanTask,
  index: number,
): boolean {
  const key = workflowTaskCommitKey(planPath, index + 1, task.title);
  const record = state.committedTasks?.[key];
  return Boolean(
    record &&
    record.plan === planPath &&
    record.taskIndex === index + 1 &&
    record.taskTitle === task.title,
  );
}

function taskIsClosed(
  state: WorkflowState,
  planPath: string,
  task: PlanTask,
  index: number,
): boolean {
  return task.complete && taskHasCommitRecord(state, planPath, task, index);
}

function taskFrontier(
  state: WorkflowState,
  planPath: string,
  tasks: PlanTask[],
): PlanTaskFrontier | undefined {
  return tasks
    .map((candidate, index) => {
      const hasCommit = taskHasCommitRecord(state, planPath, candidate, index);
      const missingStatuses =
        candidate.complete && hasCommit
          ? []
          : (effectiveTaskMissingStatuses(state, planPath, candidate, index) ??
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

export function allTasksInCurrentPlanAreClosed(
  state: WorkflowState,
  baseCwd?: string,
): boolean {
  if (!state.activePlan) return false;
  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown) return false;
  const tasks = planTasksFromMarkdown(markdown);
  return (
    tasks.length > 0 &&
    tasks.every((task, index) =>
      taskIsClosed(state, state.activePlan!, task, index),
    )
  );
}

function stateTargetsPlanTask(
  state: WorkflowState,
  task: PlanTask,
  index: number,
): boolean {
  return (
    taskMatchesPlanTask(task, index, {
      taskIndex: state.currentTaskIndex,
      taskTitle: state.currentTask,
    }) ||
    taskMatchesPlanTask(task, index, {
      taskIndex: state.autoReviewTaskIndex,
      taskTitle: state.autoReviewTask,
    })
  );
}

function statsForPlanTask(
  state: WorkflowState,
  planPath: string,
  task: PlanTask,
  index: number,
): WorkflowTaskStats | undefined {
  const sessions = state.stats
    ? [state.stats.active, ...state.stats.history]
    : [];
  const tasks = sessions
    .flatMap((session) => Object.values(session.tasks))
    .filter(
      (candidate) =>
        (!candidate.plan || candidate.plan === planPath) &&
        taskMatchesPlanTask(task, index, candidate),
    );
  if (tasks.length === 0) return undefined;
  return tasks.reduce(
    (total, candidate) => ({
      ...candidate,
      turns: total.turns + candidate.turns,
      verifyRuns: total.verifyRuns + candidate.verifyRuns,
      reviewRuns: total.reviewRuns + candidate.reviewRuns,
      issues: addIssueStats(total.issues, candidate.issues),
    }),
    {
      turns: 0,
      verifyRuns: 0,
      reviewRuns: 0,
      issues: emptyIssueStats(),
    } as WorkflowTaskStats,
  );
}

function lifecycleEvidenceMissingStatuses(
  state: WorkflowState,
  planPath: string,
  task: PlanTask,
  index: number,
): PlanTaskStatus[] {
  if (!task.missingStatuses) return [];

  const stats = statsForPlanTask(state, planPath, task, index);
  const taskIsCurrentTarget = stateTargetsPlanTask(state, task, index);
  if (!taskIsCurrentTarget && !stats) return [];

  const command = commandFromPrompt(state.autoLastPrompt);
  const missing = new Set<PlanTaskStatus>();

  if (
    !task.missingStatuses.includes('Verified') &&
    (stats?.verifyRuns ?? 0) === 0 &&
    (stats || command === '/addy-build') &&
    command !== '/addy-verify' &&
    command !== '/addy-review'
  ) {
    missing.add('Verified');
  }

  if (
    !task.missingStatuses.includes('Reviewed') &&
    (stats?.reviewRuns ?? 0) === 0 &&
    !(taskIsCurrentTarget && command === '/addy-review')
  ) {
    missing.add('Reviewed');
  }

  return [...missing];
}

function effectiveTaskMissingStatuses(
  state: WorkflowState,
  planPath: string,
  task: PlanTask,
  index: number,
): PlanTaskStatus[] | undefined {
  if (!task.missingStatuses) return undefined;
  return [
    ...task.missingStatuses,
    ...lifecycleEvidenceMissingStatuses(state, planPath, task, index),
  ].filter(
    (status, statusIndex, statuses) => statuses.indexOf(status) === statusIndex,
  );
}

function resolvePlanPath(planPath: string, baseCwd?: string): string {
  const filesystemPath = planPath.startsWith('@')
    ? planPath.slice(1)
    : planPath;
  return isAbsolute(filesystemPath)
    ? filesystemPath
    : resolve(baseCwd ?? process.cwd(), filesystemPath);
}

function readPlanMarkdown(
  planPath: string,
  baseCwd?: string,
): string | undefined {
  try {
    const resolved = resolvePlanPath(planPath, baseCwd);
    if (!statSync(resolved).isFile()) return undefined;
    return readFileSync(resolved, 'utf8');
  } catch {
    return undefined;
  }
}

function readablePlanFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function planPathForDisplay(
  resolvedPlanPath: string,
  previousPlanPath: string,
  baseCwd?: string,
): string {
  if (isAbsolute(previousPlanPath.replace(/^@/, ''))) return resolvedPlanPath;

  const cwd = baseCwd ?? process.cwd();
  const relativePath = relative(cwd, resolvedPlanPath).replace(/\\/g, '/');
  return previousPlanPath.startsWith('@') ? `@${relativePath}` : relativePath;
}

function numberedSliceParts(
  planPath: string,
): { prefix: string; number: number; width: number } | undefined {
  const name = basename(planPath);
  const sliceMatch = name.match(/^(.*?slice[-_]?)(\d+)(.*\.md)$/i);
  const match =
    sliceMatch ??
    (/^\d{4}[-_]\d{2}[-_]\d{2}/.test(name)
      ? undefined
      : name.match(/^()(\d+)([-_].*\.md)$/i));
  if (!match) return undefined;

  return {
    prefix: match[1],
    number: Number.parseInt(match[2], 10),
    width: match[2].length,
  };
}

function slicePlanPathFromIndexCandidate(
  rawPath: string,
  indexPlanPath: string,
  baseCwd?: string,
): string | undefined {
  const path = rawPath.replace(/^@/, '');
  const direct = isAbsolute(path)
    ? path
    : resolve(baseCwd ?? process.cwd(), path);
  if (readablePlanFile(direct))
    return planPathForDisplay(direct, indexPlanPath, baseCwd);

  if (!isAbsolute(path)) {
    const sibling = resolve(
      dirname(resolvePlanPath(indexPlanPath, baseCwd)),
      path,
    );
    if (readablePlanFile(sibling))
      return planPathForDisplay(sibling, indexPlanPath, baseCwd);
  }

  return undefined;
}

function slicePlanPathsFromIndexMarkdown(
  markdown: string,
  indexPlanPath: string,
  baseCwd?: string,
): string[] {
  const candidates =
    markdown.match(
      /@?(?:\.\.?\/|[A-Za-z0-9._~/-]+\/)?(?:[A-Za-z0-9._~-]*slice[-_]?\d+[A-Za-z0-9._~-]*|\d{1,3}[-_][A-Za-z0-9._~-]+)\.md\b/gi,
    ) ?? [];
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const path = slicePlanPathFromIndexCandidate(
      candidate,
      indexPlanPath,
      baseCwd,
    );
    if (!path || path === indexPlanPath || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  return paths;
}

function currentSlicePlanPathFromIndex(
  planPath: string,
  markdown: string,
  baseCwd?: string,
  state?: WorkflowState,
): string | undefined {
  const slicePaths = slicePlanPathsFromIndexMarkdown(
    markdown,
    planPath,
    baseCwd,
  );
  let lastTaskSlice: string | undefined;
  for (const slicePath of slicePaths) {
    const sliceMarkdown = readPlanMarkdown(slicePath, baseCwd);
    if (!sliceMarkdown) continue;
    const tasks = planTasksFromMarkdown(sliceMarkdown);
    if (tasks.length === 0) continue;
    lastTaskSlice = slicePath;
    const sliceState = state
      ? { ...state, activePlan: slicePath }
      : { ...createInitialWorkflowState(), activePlan: slicePath };
    if (
      tasks.some(
        (task, index) => !taskIsClosed(sliceState, slicePath, task, index),
      )
    )
      return slicePath;
  }
  return lastTaskSlice;
}

export function nextUnfinishedSlicePlanPath(
  state: WorkflowState,
  baseCwd?: string,
): string | undefined {
  if (!state.activePlan) return undefined;
  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown) return undefined;
  const tasks = planTasksFromMarkdown(markdown);
  if (tasks.length === 0) {
    const slicePlan = currentSlicePlanPathFromIndex(
      state.activePlan,
      markdown,
      baseCwd,
      state,
    );
    return slicePlan && slicePlan !== state.activePlan ? slicePlan : undefined;
  }
  if (
    tasks.some(
      (task, index) => !taskIsClosed(state, state.activePlan!, task, index),
    )
  )
    return undefined;

  const resolvedPlanPath = resolvePlanPath(state.activePlan, baseCwd);
  const current = numberedSliceParts(resolvedPlanPath);
  if (!current) return undefined;
  const currentPrefix = current.prefix.toLowerCase();
  const currentNumber = current.number;

  let candidates: string[];
  try {
    candidates = readdirSync(dirname(resolvedPlanPath))
      .map((entry) => resolve(dirname(resolvedPlanPath), entry))
      .filter((candidate) => readablePlanFile(candidate));
  } catch {
    return undefined;
  }

  const nextCandidates = candidates
    .map((candidate) => {
      const parts = numberedSliceParts(candidate);
      return parts
        ? {
            path: candidate,
            prefix: parts.prefix.toLowerCase(),
            number: parts.number,
          }
        : undefined;
    })
    .filter(
      (
        candidate,
      ): candidate is { path: string; prefix: string; number: number } =>
        Boolean(
          candidate &&
          candidate.number > currentNumber &&
          candidate.prefix === currentPrefix,
        ),
    )
    .sort((left, right) => left.number - right.number);

  for (const candidate of nextCandidates) {
    const candidateMarkdown = readPlanMarkdown(candidate.path, baseCwd);
    if (!candidateMarkdown) continue;
    const candidateTasks = planTasksFromMarkdown(candidateMarkdown);
    const candidatePlanPath = planPathForDisplay(
      candidate.path,
      state.activePlan,
      baseCwd,
    );
    const candidateState = { ...state, activePlan: candidatePlanPath };
    if (
      candidateTasks.length === 0 ||
      candidateTasks.some(
        (task, index) =>
          !taskIsClosed(candidateState, candidatePlanPath, task, index),
      )
    ) {
      return candidatePlanPath;
    }
  }
  return undefined;
}

function sliceProgressForPlanPath(
  planPath: string,
  baseCwd?: string,
): { currentSliceIndex: number; sliceCount: number } | undefined {
  const resolved = resolvePlanPath(planPath, baseCwd);
  const current = numberedSliceParts(resolved);
  if (!current || current.number <= 0) return undefined;

  let candidates: string[];
  try {
    candidates = readdirSync(dirname(resolved)).filter((entry) =>
      entry.endsWith('.md'),
    );
  } catch {
    return undefined;
  }

  const sliceNumbers = candidates
    .map((candidate) => numberedSliceParts(candidate))
    .filter(
      (parts): parts is NonNullable<ReturnType<typeof numberedSliceParts>> => {
        if (!parts) return false;
        if (parts.number <= 0) return false;
        return parts.prefix.toLowerCase() === current.prefix.toLowerCase();
      },
    )
    .map((parts) => parts.number);
  const sliceCount = Math.max(...sliceNumbers, 0);

  return sliceCount >= current.number
    ? { currentSliceIndex: current.number, sliceCount }
    : undefined;
}

function isValidProgress(
  index: number | undefined,
  count: number | undefined,
): index is number {
  if (!Number.isSafeInteger(index)) return false;
  if (!Number.isSafeInteger(count)) return false;
  if (!index || !count) return false;
  if (index <= 0 || count <= 0) return false;
  return index <= count;
}

function progressSuffix(
  label: string,
  index: number | undefined,
  count: number | undefined,
  styleLabel: (text: string) => string,
): string {
  return isValidProgress(index, count)
    ? ` | ${styleLabel(label)}${index}/${count}`
    : '';
}

function darkGrayBg(text: string): string {
  return `\x1b[48;5;236m${text}\x1b[0m`;
}

function darkGrayBgBoldWhite(text: string): string {
  return `\x1b[48;5;236;1;37m${text}\x1b[0m`;
}

function darkAccent(text: string): string {
  return `\x1b[38;5;32m${text}\x1b[0m`;
}

const DARK_ACCENT_BG = '\x1b[48;5;32m';

function bgBoldWhite(bgAnsi: string, text: string): string {
  return `${bgAnsi}\x1b[1;37m${text}\x1b[0m`;
}

function createProgressBar(
  percentage: number | null,
  width = 15,
  label?: string | null,
  styleFilled: (text: string) => string = (text) => text,
  styleEmpty: (text: string) => string = (text) => text,
  styleFilledLabel: (text: string) => string = (text) => text,
  styleEmptyLabel: (text: string) => string = styleFilledLabel,
): string {
  const filled =
    percentage === null ? 0 : Math.round((percentage / 100) * width);
  const renderRange = (start: number, end: number) => {
    const filledCount = Math.max(0, Math.min(end, filled) - start);
    const emptyCount = Math.max(0, end - Math.max(start, filled));
    const filledPart =
      filledCount > 0 ? styleFilled('█'.repeat(filledCount)) : '';
    const emptyPart = emptyCount > 0 ? styleEmpty(' '.repeat(emptyCount)) : '';
    return filledPart + emptyPart;
  };

  if (!label || label.length > width) {
    return `[${renderRange(0, width)}]`;
  }

  const labelStart = Math.floor((width - label.length) / 2);
  const labelEnd = labelStart + label.length;
  const styledLabel = [...label]
    .map((character, index) =>
      labelStart + index < filled
        ? styleFilledLabel(character)
        : styleEmptyLabel(character),
    )
    .join('');
  return `[${renderRange(0, labelStart)}${styledLabel}${renderRange(labelEnd, width)}]`;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function taskCompletionProgressBar(index: number, count: number): string {
  const percentage = clampPercentage((index / count) * 100);
  return createProgressBar(
    percentage,
    15,
    `${percentage}%`,
    darkAccent,
    darkGrayBg,
    (text) => bgBoldWhite(DARK_ACCENT_BG, text),
    darkGrayBgBoldWhite,
  );
}

function sliceProgressSuffix(
  planPath: string | undefined,
  baseCwd: string | undefined,
  styleLabel: (text: string) => string,
): string {
  const progress = planPath
    ? sliceProgressForPlanPath(planPath, baseCwd)
    : undefined;
  return progressSuffix(
    'Slice ',
    progress?.currentSliceIndex,
    progress?.sliceCount,
    styleLabel,
  );
}

function totalTaskProgressForSlice(
  planPath: string | undefined,
  currentTaskIndex: number | undefined,
  baseCwd?: string,
): { currentTaskIndex: number; taskCount: number } | undefined {
  if (
    !planPath ||
    typeof currentTaskIndex !== 'number' ||
    !Number.isSafeInteger(currentTaskIndex)
  )
    return undefined;
  const resolved = resolvePlanPath(planPath, baseCwd);
  const current = numberedSliceParts(resolved);
  if (!current || current.number <= 0) return undefined;

  let candidates: string[];
  try {
    candidates = readdirSync(dirname(resolved))
      .map((entry) => resolve(dirname(resolved), entry))
      .filter((candidate) => readablePlanFile(candidate));
  } catch {
    return undefined;
  }

  const sliceTasks = candidates
    .map((candidate) => {
      const parts = numberedSliceParts(candidate);
      if (!parts || parts.number <= 0) return undefined;
      if (parts.prefix.toLowerCase() !== current.prefix.toLowerCase())
        return undefined;
      const markdown = readPlanMarkdown(candidate, baseCwd);
      if (!markdown) return undefined;
      const tasks = planTasksFromMarkdown(markdown);
      return tasks.length > 0
        ? { number: parts.number, taskCount: tasks.length }
        : undefined;
    })
    .filter((candidate): candidate is { number: number; taskCount: number } =>
      Boolean(candidate),
    )
    .sort((left, right) => left.number - right.number);

  if (!sliceTasks.some((slice) => slice.number === current.number))
    return undefined;

  const totalTaskCount = sliceTasks.reduce(
    (sum, slice) => sum + slice.taskCount,
    0,
  );
  const priorTaskCount = sliceTasks
    .filter((slice) => slice.number < current.number)
    .reduce((sum, slice) => sum + slice.taskCount, 0);
  const totalCurrentTaskIndex = priorTaskCount + currentTaskIndex;

  return isValidProgress(totalCurrentTaskIndex, totalTaskCount)
    ? { currentTaskIndex: totalCurrentTaskIndex, taskCount: totalTaskCount }
    : undefined;
}

function totalTaskProgressSuffix(
  planPath: string | undefined,
  currentTaskIndex: number | undefined,
  baseCwd: string | undefined,
  styleLabel: (text: string) => string,
): string {
  const progress = totalTaskProgressForSlice(
    planPath,
    currentTaskIndex,
    baseCwd,
  );
  if (!progress) return '';
  return ` | ${styleLabel('Total tasks ')}${taskCompletionProgressBar(
    progress.currentTaskIndex,
    progress.taskCount,
  )} ${progress.currentTaskIndex}/${progress.taskCount}`;
}

export function planTasksFromMarkdown(markdown: string): PlanTask[] {
  const headingTasks: PlanTask[] = [];
  const checkboxTasks: PlanTask[] = [];
  let currentHeading:
    | { title: string; statuses: PlanTaskStatus[]; sawStatus: boolean }
    | undefined;

  function flushHeadingTask() {
    if (!currentHeading || !currentHeading.sawStatus) return;
    const missingStatuses = taskMissingStatuses(currentHeading.statuses);
    headingTasks.push({
      title: cleanTaskTitle(currentHeading.title),
      complete: missingStatuses.length === 0,
      missingStatuses,
    });
  }

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(TASK_HEADING);
    if (heading) {
      flushHeadingTask();
      currentHeading = { title: heading[1], statuses: [], sawStatus: false };
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
  return tasks.filter((task) => task.title.length > 0);
}

export function unfinishedLifecycleStepsFromMarkdown(
  markdown: string,
): Array<{ title: string; missingStatuses: PlanTaskStatus[] }> {
  return planTasksFromMarkdown(markdown)
    .map((task) => ({
      title: task.title,
      allMissingStatuses: task.missingStatuses ?? [],
    }))
    .filter((task) => !task.allMissingStatuses.includes('Implemented'))
    .map((task) => ({
      title: task.title,
      missingStatuses: task.allMissingStatuses.filter(
        (status) => status !== 'Implemented',
      ),
    }))
    .filter((task) => task.missingStatuses.length > 0);
}

export function workflowTaskFooterLine(
  planPath: string | undefined,
  baseCwd?: string,
  theme?: { fg?: (name: string, text: string) => string },
  state?: WorkflowState,
): string | undefined {
  if (!planPath) return undefined;
  const markdown = readPlanMarkdown(planPath, baseCwd);
  if (!markdown) return undefined;
  const effectiveState = state ?? {
    ...createInitialWorkflowState(),
    activePlan: planPath,
  };
  const taskClosed = (task: PlanTask, index: number) =>
    taskIsClosed(
      { ...effectiveState, activePlan: planPath },
      planPath,
      task,
      index,
    );

  const tasks = planTasksFromMarkdown(markdown);
  if (tasks.length === 0) {
    const slicePlan = currentSlicePlanPathFromIndex(
      planPath,
      markdown,
      baseCwd,
      effectiveState,
    );
    if (slicePlan && slicePlan !== planPath)
      return workflowTaskFooterLine(slicePlan, baseCwd, theme, {
        ...effectiveState,
        activePlan: slicePlan,
      });
  }

  const styleLabel = (text: string) =>
    theme?.fg?.('accent', text) ?? theme?.fg?.('blue', text) ?? text;
  const sliceProgress = sliceProgressSuffix(planPath, baseCwd, styleLabel);
  const currentIndex = tasks.findIndex(
    (task, index) => !taskClosed(task, index),
  );
  if (currentIndex === -1)
    return tasks.length > 0
      ? `${styleLabel('Current task: ')}all tasks complete | ${styleLabel('Next task: ')}none${sliceProgress}${progressSuffix('Task ', tasks.length, tasks.length, styleLabel)}${totalTaskProgressSuffix(planPath, tasks.length, baseCwd, styleLabel)}`
      : undefined;

  const current = tasks[currentIndex];
  const next = tasks
    .slice(currentIndex + 1)
    .find((task, offset) => !taskClosed(task, currentIndex + 1 + offset));
  return `${styleLabel('Current task: ')}${current.title} | ${styleLabel('Next task: ')}${next?.title ?? 'none'}${sliceProgress}${progressSuffix('Task ', currentIndex + 1, tasks.length, styleLabel)}${totalTaskProgressSuffix(planPath, currentIndex + 1, baseCwd, styleLabel)}`;
}

export function refreshWorkflowTasksFromPlan(
  state: WorkflowState,
  baseCwd?: string,
): WorkflowState {
  if (!state.activePlan) return state;

  const sliceProgress = sliceProgressForPlanPath(state.activePlan, baseCwd);

  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown) return state;

  const tasks = planTasksFromMarkdown(markdown);
  if (tasks.length === 0) {
    const slicePlan = currentSlicePlanPathFromIndex(
      state.activePlan,
      markdown,
      baseCwd,
      state,
    );
    if (slicePlan && slicePlan !== state.activePlan)
      return refreshWorkflowTasksFromPlan(
        {
          ...state,
          activePlan: slicePlan,
          activeSuitePlan: state.activeSuitePlan ?? state.activePlan,
        },
        baseCwd,
      );

    return {
      ...state,
      currentTask: undefined,
      nextTask: undefined,
      currentTaskIndex: undefined,
      taskCount: undefined,
      currentSliceIndex: sliceProgress?.currentSliceIndex,
      sliceCount: sliceProgress?.sliceCount,
      currentTaskSummary: undefined,
      nextTaskSummary: undefined,
    };
  }

  const currentIndex = tasks.findIndex(
    (task, index) => !taskIsClosed(state, state.activePlan!, task, index),
  );
  if (currentIndex === -1) {
    const currentTask = 'all tasks complete';
    const nextTask = 'none';
    return {
      ...state,
      currentTask,
      nextTask,
      currentTaskIndex: tasks.length,
      taskCount: tasks.length,
      currentSliceIndex: sliceProgress?.currentSliceIndex,
      sliceCount: sliceProgress?.sliceCount,
      currentTaskSummary:
        state.currentTask === currentTask
          ? state.currentTaskSummary
          : undefined,
      nextTaskSummary:
        state.nextTask === nextTask ? state.nextTaskSummary : undefined,
    };
  }

  const current = tasks[currentIndex];
  const next = tasks
    .slice(currentIndex + 1)
    .find(
      (task, offset) =>
        !taskIsClosed(
          state,
          state.activePlan!,
          task,
          currentIndex + 1 + offset,
        ),
    );
  const currentTask = current.title;
  const nextTask = next?.title ?? 'none';
  return {
    ...state,
    currentTask,
    nextTask,
    currentTaskIndex: currentIndex + 1,
    taskCount: tasks.length,
    currentSliceIndex: sliceProgress?.currentSliceIndex,
    sliceCount: sliceProgress?.sliceCount,
    currentTaskSummary:
      state.currentTask === currentTask ? state.currentTaskSummary : undefined,
    nextTaskSummary:
      state.nextTask === nextTask ? state.nextTaskSummary : undefined,
  };
}

export function promptArtifactForPhase(
  state: WorkflowState,
  phase: WorkflowPhase,
): string | undefined {
  if (phase === 'plan') return state.activeSpec;
  if (phaseIndex(phase) > phaseIndex('plan')) return state.activePlan;
  return undefined;
}

function shouldRenderTaskFooter(state: WorkflowState): boolean {
  return Boolean(
    state.current && phaseIndex(state.current) > phaseIndex('plan'),
  );
}

export function renderWorkflowWidget(state: WorkflowState, baseCwd?: string) {
  return (
    _tui?: unknown,
    theme?: { fg?: (name: string, text: string) => string },
  ) => ({
    invalidate() {},
    render(width?: number): string[] {
      const styleLabel = (text: string) =>
        theme?.fg?.('accent', text) ?? theme?.fg?.('blue', text) ?? text;
      const label = styleLabel(
        state.autoMode ? '🔁 Addy Workflow: ' : 'Addy Workflow: ',
      );
      const artifact = workflowArtifactForFooter(state);
      const styledArtifact = styledArtifactName(artifact, theme);
      const styledSuiteArtifact =
        state.activeSuitePlan && state.activeSuitePlan !== artifact
          ? styledArtifactName(state.activeSuitePlan, theme)
          : undefined;
      const suiteSuffix = styledSuiteArtifact
        ? ` | ${styleLabel('suite: ')}${styledSuiteArtifact}`
        : '';
      const artifactSuffix = styledArtifact
        ? ` | ${styledArtifact}${suiteSuffix}`
        : suiteSuffix;
      const line = `${label}${renderWorkflowStrip(state, theme)}${artifactSuffix}`;
      const currentTask = state.currentTaskSummary ?? state.currentTask;
      const nextTask = state.nextTaskSummary ?? state.nextTask;
      const taskProgress = progressSuffix(
        'Task ',
        state.currentTaskIndex,
        state.taskCount,
        styleLabel,
      );
      const sliceProgress = progressSuffix(
        'Slice ',
        state.currentSliceIndex,
        state.sliceCount,
        styleLabel,
      );
      const totalTaskProgress = totalTaskProgressSuffix(
        state.activePlan,
        state.currentTaskIndex,
        baseCwd,
        styleLabel,
      );
      const taskLine = shouldRenderTaskFooter(state)
        ? currentTask
          ? `${styleLabel('Current task: ')}${currentTask} | ${styleLabel('Next task: ')}${nextTask ?? 'none'}${sliceProgress}${taskProgress}${totalTaskProgress}`
          : workflowTaskFooterLine(state.activePlan, baseCwd, theme, state)
        : undefined;
      const lines = taskLine ? [line, taskLine] : [line];
      return width
        ? lines.map((value) =>
            truncateToWidth(value, Math.max(1, width), '', true),
          )
        : lines;
    },
  });
}

function phaseRunCountSuffix(
  phase: WorkflowPhase,
  stats?: WorkflowTaskStats,
): string {
  const count =
    phase === 'verify'
      ? stats?.verifyRuns
      : phase === 'review'
        ? stats?.reviewRuns
        : undefined;
  return count && count > 1 ? ` (${count})` : '';
}

function renderPhase(
  phase: WorkflowPhase,
  state: WorkflowState,
  theme?: { fg?: (name: string, text: string) => string },
  currentStats?: WorkflowTaskStats,
): string {
  const status = state.phases[phase];
  const countSuffix = phaseRunCountSuffix(phase, currentStats);
  if (status === 'complete') return `✓${phase}${countSuffix}`;
  if (status === 'active') {
    const text = `[${phase}]${countSuffix}`;
    return theme?.fg?.('success', text) ?? theme?.fg?.('green', text) ?? text;
  }
  if (OPTIONAL_PHASES.has(phase))
    return theme?.fg?.('dim', phase) ?? theme?.fg?.('muted', phase) ?? phase;
  return `${phase}${countSuffix}`;
}

function totalStatsTasks(
  session: WorkflowStatsSession,
  planPath?: string,
): WorkflowTaskStats[] {
  return Object.values(session.tasks).filter(
    (task) => !planPath || task.plan === planPath,
  );
}

function sumTaskStats(tasks: WorkflowTaskStats[]): {
  turns: number;
  verifyRuns: number;
  reviewRuns: number;
  issues: WorkflowIssueStats;
} {
  return tasks.reduce(
    (total, task) => ({
      turns: total.turns + task.turns,
      verifyRuns: total.verifyRuns + task.verifyRuns,
      reviewRuns: total.reviewRuns + task.reviewRuns,
      issues: {
        critical: total.issues.critical + task.issues.critical,
        important: total.issues.important + task.issues.important,
        suggestion: total.issues.suggestion + task.issues.suggestion,
        unknown: total.issues.unknown + task.issues.unknown,
        total: total.issues.total + task.issues.total,
      },
    }),
    { turns: 0, verifyRuns: 0, reviewRuns: 0, issues: emptyIssueStats() },
  );
}

function statsTaskIdentity(task: WorkflowTaskStats): string {
  return [
    task.plan ?? '',
    task.sliceIndex ?? '',
    task.taskIndex ?? '',
    task.taskTitle ?? '',
  ].join('\u001f');
}

function mergeTaskStats(tasks: WorkflowTaskStats[]): WorkflowTaskStats[] {
  const merged = new Map<string, WorkflowTaskStats>();
  for (const task of tasks) {
    const key = statsTaskIdentity(task);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...task, issues: { ...task.issues } });
      continue;
    }
    merged.set(key, {
      ...existing,
      turns: existing.turns + task.turns,
      verifyRuns: existing.verifyRuns + task.verifyRuns,
      reviewRuns: existing.reviewRuns + task.reviewRuns,
      issues: addIssueStats(existing.issues, task.issues),
    });
  }
  return [...merged.values()];
}

function renderTaskStatsLine(
  task: WorkflowTaskStats,
  current: boolean,
): string {
  const slice = task.sliceIndex ? `slice ${task.sliceIndex}, ` : '';
  const taskLabel = task.taskIndex ? `task ${task.taskIndex}` : 'task';
  const title = task.taskTitle ? `: ${task.taskTitle}` : '';
  return `${current ? 'Current' : 'Completed'} ${slice}${taskLabel}${title} — ${task.turns} turns, verify ${task.verifyRuns}, review ${task.reviewRuns}, issues ${task.issues.total}`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTaskStatsMarkdownRow(
  task: WorkflowTaskStats,
  current: boolean,
): string {
  const scope = task.sliceIndex ? `Slice ${task.sliceIndex}` : '—';
  const taskLabel = [
    task.taskIndex ? `Task ${task.taskIndex}` : 'Task',
    task.taskTitle,
  ]
    .filter(Boolean)
    .join(': ');
  return `| ${current ? 'Current' : 'Completed'} | ${escapeMarkdownTableCell(scope)} | ${escapeMarkdownTableCell(taskLabel)} | ${task.turns} | ${task.verifyRuns} | ${task.reviewRuns} | ${task.issues.total} |`;
}

export function renderWorkflowStatsText(
  state: WorkflowState,
  planPath?: string,
): string {
  const stats = normalizeWorkflowStats(state.stats);
  const activeTasks = totalStatsTasks(stats.active, planPath);
  const historyTasks = stats.history.flatMap((session) =>
    totalStatsTasks(session, planPath),
  );
  const allTasks = [...activeTasks, ...historyTasks];
  if (allTasks.length === 0) return 'No Addy stats recorded yet';

  const totals = sumTaskStats(allTasks);
  const activeKeys = new Set(activeTasks.map(statsTaskIdentity));
  const lines = [
    'Addy stats',
    `Turns: ${totals.turns}`,
    `Verify runs: ${totals.verifyRuns}`,
    `Review runs: ${totals.reviewRuns}`,
    `Issues: ${totals.issues.total} (Critical ${totals.issues.critical}, Important ${totals.issues.important}, Suggestions ${totals.issues.suggestion}, Unknown ${totals.issues.unknown})`,
  ];

  for (const task of mergeTaskStats(allTasks)) {
    lines.push(
      renderTaskStatsLine(task, activeKeys.has(statsTaskIdentity(task))),
    );
  }

  return lines.join('\n');
}

export function renderWorkflowStatsMarkdown(
  state: WorkflowState,
  planPath?: string,
): string {
  const stats = normalizeWorkflowStats(state.stats);
  const activeTasks = totalStatsTasks(stats.active, planPath);
  const historyTasks = stats.history.flatMap((session) =>
    totalStatsTasks(session, planPath),
  );
  const allTasks = [...activeTasks, ...historyTasks];
  if (allTasks.length === 0)
    return '## Addy stats\n\nNo Addy stats recorded yet';

  const totals = sumTaskStats(allTasks);
  const activeKeys = new Set(activeTasks.map(statsTaskIdentity));
  const taskRows = mergeTaskStats(allTasks).map((task) =>
    renderTaskStatsMarkdownRow(task, activeKeys.has(statsTaskIdentity(task))),
  );

  return [
    '## Addy stats',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Turns | ${totals.turns} |`,
    `| Verify runs | ${totals.verifyRuns} |`,
    `| Review runs | ${totals.reviewRuns} |`,
    `| Issues | ${totals.issues.total} |`,
    `| Critical | ${totals.issues.critical} |`,
    `| Important | ${totals.issues.important} |`,
    `| Suggestions | ${totals.issues.suggestion} |`,
    `| Unknown | ${totals.issues.unknown} |`,
    '',
    '| Status | Scope | Task | Turns | Verify | Review | Issues |',
    '|---|---|---|---:|---:|---:|---:|',
    ...taskRows,
  ].join('\n');
}

export function nextPromptForPhase(
  phase: WorkflowPhase,
  artifact?: string,
): string {
  const promptByPhase: Record<WorkflowPhase, string> = {
    define: '/addy-define',
    plan: '/addy-plan',
    build: '/addy-build',
    simplify: '/addy-code-simplify',
    verify: '/addy-verify',
    review: '/addy-review',
    finish: '/addy-finish',
  };

  return artifact
    ? `${promptByPhase[phase]} ${artifact}`
    : promptByPhase[phase];
}

export function nextPromptForActivePlanLifecycle(
  state: WorkflowState,
  baseCwd?: string,
): string | undefined {
  return nextWorkflowActionForActivePlanLifecycle(state, baseCwd)?.prompt;
}

export function nextWorkflowActionForActivePlanLifecycle(
  state: WorkflowState,
  baseCwd?: string,
):
  | {
      prompt: string;
      plan?: string;
      taskTitle?: string;
      taskIndex?: number;
      currentSliceIndex?: number;
      missingStatuses?: PlanTaskStatus[];
      requiresCommit?: boolean;
    }
  | undefined {
  if (!state.activePlan) return undefined;

  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown)
    return { prompt: nextPromptForPhase('build', state.activePlan) };

  const tasks = planTasksFromMarkdown(markdown);
  if (tasks.length === 0) {
    const slicePlan = currentSlicePlanPathFromIndex(
      state.activePlan,
      markdown,
      baseCwd,
      state,
    );
    if (slicePlan && slicePlan !== state.activePlan)
      return nextWorkflowActionForActivePlanLifecycle(
        {
          ...state,
          activePlan: slicePlan,
          activeSuitePlan: state.activeSuitePlan ?? state.activePlan,
        },
        baseCwd,
      );
  }

  const task = taskFrontier(state, state.activePlan, tasks);
  if (!task)
    return {
      prompt:
        tasks.length > 0
          ? nextPromptForPhase('finish', state.activePlan)
          : nextPromptForPhase('build', state.activePlan),
    };

  const missingStatuses = task.missingStatuses ?? ['Implemented'];
  if (missingStatuses.includes('Implemented'))
    return definedWorkflowActionFields({
      prompt: nextPromptForPhase('build', state.activePlan),
      plan: state.activePlan,
      taskTitle: task.title,
      taskIndex: task.taskIndex,
      currentSliceIndex: sliceProgressForPlanPath(state.activePlan, baseCwd)
        ?.currentSliceIndex,
      missingStatuses,
    });
  if (missingStatuses.includes('Verified'))
    return definedWorkflowActionFields({
      prompt: nextPromptForPhase('verify', state.activePlan),
      plan: state.activePlan,
      taskTitle: task.title,
      taskIndex: task.taskIndex,
      currentSliceIndex: sliceProgressForPlanPath(state.activePlan, baseCwd)
        ?.currentSliceIndex,
      missingStatuses,
    });
  if (missingStatuses.includes('Reviewed'))
    return definedWorkflowActionFields({
      prompt: nextPromptForPhase('review', state.activePlan),
      plan: state.activePlan,
      taskTitle: task.title,
      taskIndex: task.taskIndex,
      currentSliceIndex: sliceProgressForPlanPath(state.activePlan, baseCwd)
        ?.currentSliceIndex,
      missingStatuses,
    });

  if (task.requiresCommit)
    return definedWorkflowActionFields({
      prompt: ADDY_AUTO_TASK_COMMIT_PROMPT,
      plan: state.activePlan,
      taskTitle: task.title,
      taskIndex: task.taskIndex,
      currentSliceIndex: sliceProgressForPlanPath(state.activePlan, baseCwd)
        ?.currentSliceIndex,
      missingStatuses,
      requiresCommit: true,
    });

  return definedWorkflowActionFields({
    prompt: nextPromptForPhase('build', state.activePlan),
    plan: state.activePlan,
    taskTitle: task.title,
    taskIndex: task.taskIndex,
    currentSliceIndex: sliceProgressForPlanPath(state.activePlan, baseCwd)
      ?.currentSliceIndex,
    missingStatuses,
  });
}
