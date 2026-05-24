import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  planTasksFromMarkdown,
  taskIsClosed,
  type PlanTask,
} from './plan-task-lifecycle.ts';
import { resolveWorkflowPlanPath } from './workflow-plan-path.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from './workflow-transitions.ts';

export function readPlanMarkdown(
  planPath: string,
  baseCwd?: string,
): string | undefined {
  try {
    const resolved = resolveWorkflowPlanPath(planPath, baseCwd);
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
      dirname(resolveWorkflowPlanPath(indexPlanPath, baseCwd)),
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

export function currentSlicePlanPathFromIndex(
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
        (task, index) =>
          !taskIsClosed(sliceState.committedTasks, slicePath, task, index),
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
      (task, index) =>
        !taskIsClosed(state.committedTasks, state.activePlan!, task, index),
    )
  )
    return undefined;

  const resolvedPlanPath = resolveWorkflowPlanPath(state.activePlan, baseCwd);
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
          !taskIsClosed(
            candidateState.committedTasks,
            candidatePlanPath,
            task,
            index,
          ),
      )
    ) {
      return candidatePlanPath;
    }
  }
  return undefined;
}

export function sliceProgressForPlanPath(
  planPath: string,
  baseCwd?: string,
): { currentSliceIndex: number; sliceCount: number } | undefined {
  const resolved = resolveWorkflowPlanPath(planPath, baseCwd);
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

export function isValidProgress(
  index: number | undefined,
  count: number | undefined,
): index is number {
  if (!Number.isSafeInteger(index)) return false;
  if (!Number.isSafeInteger(count)) return false;
  if (!index || !count) return false;
  if (index <= 0 || count <= 0) return false;
  return index <= count;
}

export function totalTaskProgressForSlice(
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
  const resolved = resolveWorkflowPlanPath(planPath, baseCwd);
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
