import { truncateToWidth } from "@earendil-works/pi-tui";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { WORKFLOW_PHASES, type WorkflowPhase, type WorkflowState, createInitialWorkflowState } from "./workflow-transitions.ts";

export const WORKFLOW_WIDGET_KEY = "pi-addy-workflow";
export const WORKFLOW_STATE_ENTRY_TYPE = "pi-addy-workflow-state";
const OPTIONAL_PHASES = new Set<WorkflowPhase>(["simplify"]);

function phaseIndex(phase: WorkflowPhase): number {
  return WORKFLOW_PHASES.indexOf(phase);
}

function normalizeWorkflowState(state: WorkflowState): WorkflowState {
  const normalizedTasks = state.currentTask || state.nextTask
    ? {
      currentTask: state.currentTask,
      nextTask: state.nextTask,
      currentTaskIndex: state.currentTaskIndex,
      taskCount: state.taskCount,
      currentSliceIndex: state.currentSliceIndex,
      sliceCount: state.sliceCount,
      currentTaskSummary: state.currentTaskSummary,
      nextTaskSummary: state.nextTaskSummary,
    }
    : {};

  if (!state.current || phaseIndex(state.current) <= phaseIndex("plan")) return { ...state, ...normalizedTasks };

  return {
    ...state,
    ...normalizedTasks,
    phases: {
      ...state.phases,
      define: "complete",
      plan: "complete",
    },
  };
}

export function serializeWorkflowState(state: WorkflowState): string {
  return JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state });
}

export function parseWorkflowState(value: unknown): WorkflowState {
  if (!value) return createInitialWorkflowState();

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === WORKFLOW_STATE_ENTRY_TYPE && parsed.state) return normalizeWorkflowState(parsed.state as WorkflowState);
      if (parsed?.phases) return normalizeWorkflowState(parsed as WorkflowState);
    } catch {
      return createInitialWorkflowState();
    }
  }

  if (typeof value === "object" && value !== null && "phases" in value) return normalizeWorkflowState(value as WorkflowState);
  return createInitialWorkflowState();
}

export function renderWorkflowStrip(state: WorkflowState, theme?: { fg?: (name: string, text: string) => string }): string {
  const setupPhases = WORKFLOW_PHASES.slice(0, phaseIndex("build")).map((phase) => renderPhase(phase, state, theme));
  const loopPhases = WORKFLOW_PHASES.slice(phaseIndex("build")).map((phase) => renderPhase(phase, state, theme));
  return `${setupPhases.join(" → ")} => { ${loopPhases.join(" → ")} }`;
}

export function workflowArtifactForFooter(state: WorkflowState): string | undefined {
  if (!state.current) return undefined;

  if (state.current === "define" || state.current === "plan") return state.activeSpec;
  if (phaseIndex(state.current) > phaseIndex("plan")) return state.activePlan;

  return undefined;
}

export function workflowArtifactName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
}

type PlanTaskStatus = "Implemented" | "Verified" | "Reviewed";
type PlanTask = { title: string; complete: boolean; missingStatuses?: PlanTaskStatus[] };

const REQUIRED_TASK_STATUSES: PlanTaskStatus[] = ["Implemented", "Verified", "Reviewed"];
const STATUS_CHECKBOX = /^\s*[-*]\s+\[[ xX]\]\s+(Implemented|Verified|Reviewed)\b/;
const TASK_CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;
const TASK_HEADING = /^#{2,4}\s+(.+)$/;

function cleanTaskTitle(title: string): string {
  return title
    .replace(/^\s*(?:slice|task)\s*\d+[.:) -]*/i, "")
    .replace(/`/g, "")
    .trim();
}

function taskMissingStatuses(statuses: PlanTaskStatus[]): PlanTaskStatus[] {
  return REQUIRED_TASK_STATUSES.filter((label) => !statuses.includes(label));
}

function resolvePlanPath(planPath: string, baseCwd?: string): string {
  const filesystemPath = planPath.startsWith("@") ? planPath.slice(1) : planPath;
  return isAbsolute(filesystemPath) ? filesystemPath : resolve(baseCwd ?? process.cwd(), filesystemPath);
}

function readPlanMarkdown(planPath: string, baseCwd?: string): string | undefined {
  try {
    const resolved = resolvePlanPath(planPath, baseCwd);
    if (!statSync(resolved).isFile()) return undefined;
    return readFileSync(resolved, "utf8");
  } catch {
    return undefined;
  }
}

function planPathForDisplay(resolvedPlanPath: string, previousPlanPath: string, baseCwd?: string): string {
  if (isAbsolute(previousPlanPath.replace(/^@/, ""))) return resolvedPlanPath;

  const cwd = baseCwd ?? process.cwd();
  const relativePath = relative(cwd, resolvedPlanPath).replace(/\\/g, "/");
  return previousPlanPath.startsWith("@") ? `@${relativePath}` : relativePath;
}

function numberedSliceParts(planPath: string): { prefix: string; number: number; width: number } | undefined {
  const name = basename(planPath);
  const match = name.match(/^(.*?slice[-_]?)(\d+)(.*\.md)$/i) ?? name.match(/^()(\d+)([-_].*\.md)$/i);
  if (!match) return undefined;

  return {
    prefix: match[1],
    number: Number.parseInt(match[2], 10),
    width: match[2].length,
  };
}

function findNextNumberedPlanPath(planPath: string, baseCwd?: string): string | undefined {
  const resolved = resolvePlanPath(planPath, baseCwd);
  const current = numberedSliceParts(resolved);
  if (!current) return undefined;

  const nextNumber = current.number + 1;
  const padded = String(nextNumber).padStart(current.width, "0");

  let candidates: string[];
  try {
    candidates = readdirSync(dirname(resolved))
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => resolve(dirname(resolved), entry));
  } catch {
    return undefined;
  }

  const matches = candidates.filter((candidate) => {
    const parts = numberedSliceParts(candidate);
    if (!parts || parts.number !== nextNumber) return false;
    if (parts.prefix.toLowerCase() !== current.prefix.toLowerCase()) return false;
    const name = basename(candidate).toLowerCase();
    return name.includes(`slice-${padded}`) || name.includes(`slice_${padded}`) || name.includes(`slice-${nextNumber}`) || name.includes(`slice_${nextNumber}`);
  });

  return matches.length === 1 ? planPathForDisplay(matches[0], planPath, baseCwd) : undefined;
}

function sliceProgressForPlanPath(planPath: string, baseCwd?: string): { currentSliceIndex: number; sliceCount: number } | undefined {
  const resolved = resolvePlanPath(planPath, baseCwd);
  const current = numberedSliceParts(resolved);
  if (!current || current.number <= 0) return undefined;

  let candidates: string[];
  try {
    candidates = readdirSync(dirname(resolved)).filter((entry) => entry.endsWith(".md"));
  } catch {
    return undefined;
  }

  const sliceNumbers = candidates
    .map((candidate) => numberedSliceParts(candidate))
    .filter((parts): parts is NonNullable<ReturnType<typeof numberedSliceParts>> => !!parts && parts.number > 0 && parts.prefix.toLowerCase() === current.prefix.toLowerCase())
    .map((parts) => parts.number);
  const sliceCount = Math.max(...sliceNumbers, 0);

  return sliceCount >= current.number ? { currentSliceIndex: current.number, sliceCount } : undefined;
}

function isValidProgress(index: number | undefined, count: number | undefined): index is number {
  return Number.isSafeInteger(index) && Number.isSafeInteger(count) && !!index && !!count && index > 0 && count > 0 && index <= count;
}

function progressSuffix(label: string, index: number | undefined, count: number | undefined, styleLabel: (text: string) => string): string {
  return isValidProgress(index, count) ? ` | ${styleLabel(label)}${index}/${count}` : "";
}

function sliceProgressSuffix(planPath: string | undefined, baseCwd: string | undefined, styleLabel: (text: string) => string): string {
  const progress = planPath ? sliceProgressForPlanPath(planPath, baseCwd) : undefined;
  return progressSuffix("Slice ", progress?.currentSliceIndex, progress?.sliceCount, styleLabel);
}

export function planTasksFromMarkdown(markdown: string): PlanTask[] {
  const headingTasks: PlanTask[] = [];
  const checkboxTasks: PlanTask[] = [];
  let currentHeading: { title: string; statuses: PlanTaskStatus[]; sawStatus: boolean } | undefined;

  function flushHeadingTask() {
    if (!currentHeading || !currentHeading.sawStatus) return;
    const missingStatuses = taskMissingStatuses(currentHeading.statuses);
    headingTasks.push({ title: cleanTaskTitle(currentHeading.title), complete: missingStatuses.length === 0, missingStatuses });
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
      if (/\[[xX]\]/.test(line)) currentHeading.statuses.push(status[1] as PlanTaskStatus);
      continue;
    }

    const checkbox = line.match(TASK_CHECKBOX);
    if (checkbox && !STATUS_CHECKBOX.test(line)) {
      checkboxTasks.push({ title: cleanTaskTitle(checkbox[2]), complete: checkbox[1].toLowerCase() === "x" });
    }
  }

  flushHeadingTask();
  const tasks = headingTasks.length > 0 ? headingTasks : checkboxTasks;
  return tasks.filter((task) => task.title.length > 0);
}

export function unfinishedLifecycleStepsFromMarkdown(markdown: string): Array<{ title: string; missingStatuses: PlanTaskStatus[] }> {
  return planTasksFromMarkdown(markdown)
    .map((task) => ({
      title: task.title,
      allMissingStatuses: task.missingStatuses ?? [],
    }))
    .filter((task) => !task.allMissingStatuses.includes("Implemented"))
    .map((task) => ({
      title: task.title,
      missingStatuses: task.allMissingStatuses.filter((status) => status !== "Implemented"),
    }))
    .filter((task) => task.missingStatuses.length > 0);
}

export function workflowTaskFooterLine(planPath: string | undefined, baseCwd?: string, theme?: { fg?: (name: string, text: string) => string }): string | undefined {
  if (!planPath) return undefined;
  const markdown = readPlanMarkdown(planPath, baseCwd);
  if (!markdown) return undefined;

  const tasks = planTasksFromMarkdown(markdown);
  const styleLabel = (text: string) => theme?.fg?.("accent", text) ?? theme?.fg?.("blue", text) ?? text;
  const sliceProgress = sliceProgressSuffix(planPath, baseCwd, styleLabel);
  const currentIndex = tasks.findIndex((task) => !task.complete);
  if (currentIndex === -1) return tasks.length > 0 ? `${styleLabel("Current task: ")}all tasks complete | ${styleLabel("Next task: ")}none${sliceProgress}${progressSuffix("Task ", tasks.length, tasks.length, styleLabel)}` : undefined;

  const current = tasks[currentIndex];
  const next = tasks.slice(currentIndex + 1).find((task) => !task.complete);
  return `${styleLabel("Current task: ")}${current.title} | ${styleLabel("Next task: ")}${next?.title ?? "none"}${sliceProgress}${progressSuffix("Task ", currentIndex + 1, tasks.length, styleLabel)}`;
}

export function refreshWorkflowTasksFromPlan(state: WorkflowState, baseCwd?: string): WorkflowState {
  if (!state.activePlan || !state.current || phaseIndex(state.current) <= phaseIndex("plan")) return state;

  const sliceProgress = sliceProgressForPlanPath(state.activePlan, baseCwd);

  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown) return state;

  const tasks = planTasksFromMarkdown(markdown);
  if (tasks.length === 0) {
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

  const currentIndex = tasks.findIndex((task) => !task.complete);
  if (currentIndex === -1) {
    const nextPlan = findNextNumberedPlanPath(state.activePlan, baseCwd);
    if (nextPlan) {
      const nextMarkdown = readPlanMarkdown(nextPlan, baseCwd);
      const nextTasks = nextMarkdown ? planTasksFromMarkdown(nextMarkdown) : [];
      const nextCurrentIndex = nextTasks.findIndex((task) => !task.complete);
      const nextSliceProgress = sliceProgressForPlanPath(nextPlan, baseCwd);

      if (nextCurrentIndex !== -1) {
        const current = nextTasks[nextCurrentIndex];
        const next = nextTasks.slice(nextCurrentIndex + 1).find((task) => !task.complete);
        const currentTask = current.title;
        const nextTask = next?.title ?? "none";
        return {
          ...state,
          activePlan: nextPlan,
          currentTask,
          nextTask,
          currentTaskIndex: nextCurrentIndex + 1,
          taskCount: nextTasks.length,
          currentSliceIndex: nextSliceProgress?.currentSliceIndex,
          sliceCount: nextSliceProgress?.sliceCount,
          currentTaskSummary: state.currentTask === currentTask ? state.currentTaskSummary : undefined,
          nextTaskSummary: state.nextTask === nextTask ? state.nextTaskSummary : undefined,
        };
      }
    }

    const currentTask = "all tasks complete";
    const nextTask = "none";
    return {
      ...state,
      currentTask,
      nextTask,
      currentTaskIndex: tasks.length,
      taskCount: tasks.length,
      currentSliceIndex: sliceProgress?.currentSliceIndex,
      sliceCount: sliceProgress?.sliceCount,
      currentTaskSummary: state.currentTask === currentTask ? state.currentTaskSummary : undefined,
      nextTaskSummary: state.nextTask === nextTask ? state.nextTaskSummary : undefined,
    };
  }

  const current = tasks[currentIndex];
  const next = tasks.slice(currentIndex + 1).find((task) => !task.complete);
  const currentTask = current.title;
  const nextTask = next?.title ?? "none";
  return {
    ...state,
    currentTask,
    nextTask,
    currentTaskIndex: currentIndex + 1,
    taskCount: tasks.length,
    currentSliceIndex: sliceProgress?.currentSliceIndex,
    sliceCount: sliceProgress?.sliceCount,
    currentTaskSummary: state.currentTask === currentTask ? state.currentTaskSummary : undefined,
    nextTaskSummary: state.nextTask === nextTask ? state.nextTaskSummary : undefined,
  };
}

export function promptArtifactForPhase(state: WorkflowState, phase: WorkflowPhase): string | undefined {
  if (phase === "plan") return state.activeSpec;
  if (phaseIndex(phase) > phaseIndex("plan")) return state.activePlan;
  return undefined;
}

export function renderWorkflowWidget(state: WorkflowState, baseCwd?: string) {
  return (_tui?: unknown, theme?: { fg?: (name: string, text: string) => string }) => ({
    invalidate() {},
    render(width?: number): string[] {
      const styleLabel = (text: string) => theme?.fg?.("accent", text) ?? theme?.fg?.("blue", text) ?? text;
      const label = styleLabel("Addy Workflow: ");
      const artifact = workflowArtifactForFooter(state);
      const artifactName = artifact ? workflowArtifactName(artifact) : undefined;
      const styledArtifactName = artifactName ? (theme?.fg?.("mdLinkUrl", artifactName) ?? theme?.fg?.("accent", artifactName) ?? artifactName) : undefined;
      const artifactSuffix = styledArtifactName ? ` | ${styledArtifactName}` : "";
      const line = `${label}${renderWorkflowStrip(state, theme)}${artifactSuffix}`;
      const currentTask = state.currentTaskSummary ?? state.currentTask;
      const nextTask = state.nextTaskSummary ?? state.nextTask;
      const taskProgress = progressSuffix("Task ", state.currentTaskIndex, state.taskCount, styleLabel);
      const sliceProgress = progressSuffix("Slice ", state.currentSliceIndex, state.sliceCount, styleLabel);
      const taskLine = currentTask
        ? `${styleLabel("Current task: ")}${currentTask} | ${styleLabel("Next task: ")}${nextTask ?? "none"}${sliceProgress}${taskProgress}`
        : workflowTaskFooterLine(state.activePlan, baseCwd, theme);
      const lines = taskLine ? [line, taskLine] : [line];
      return width ? lines.map((value) => truncateToWidth(value, Math.max(1, width), "", true)) : lines;
    },
  });
}

function renderPhase(phase: WorkflowPhase, state: WorkflowState, theme?: { fg?: (name: string, text: string) => string }): string {
  const status = state.phases[phase];
  if (status === "complete") return `✓${phase}`;
  if (status === "active") {
    const text = `[${phase}]`;
    return theme?.fg?.("success", text) ?? theme?.fg?.("green", text) ?? text;
  }
  if (OPTIONAL_PHASES.has(phase)) return theme?.fg?.("dim", phase) ?? theme?.fg?.("muted", phase) ?? phase;
  return phase;
}

export function nextPromptForPhase(phase: WorkflowPhase, artifact?: string): string {
  const promptByPhase: Record<WorkflowPhase, string> = {
    define: "/addy-define",
    plan: "/addy-plan",
    build: "/addy-build",
    simplify: "/addy-code-simplify",
    verify: "/addy-verify",
    review: "/addy-review",
    finish: "/addy-finish",
  };

  return artifact ? `${promptByPhase[phase]} ${artifact}` : promptByPhase[phase];
}
