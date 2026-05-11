import { truncateToWidth } from "@earendil-works/pi-tui";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
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
  return WORKFLOW_PHASES.map((phase) => renderPhase(phase, state, theme)).join(" → ");
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

type PlanTask = { title: string; complete: boolean };

const STATUS_CHECKBOX = /^\s*[-*]\s+\[[ xX]\]\s+(Implemented|Verified|Reviewed)\b/;
const TASK_CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;
const TASK_HEADING = /^#{2,4}\s+(.+)$/;

function cleanTaskTitle(title: string): string {
  return title
    .replace(/^\s*(?:slice|task)\s*\d+[.:) -]*/i, "")
    .replace(/`/g, "")
    .trim();
}

function taskCompleteFromStatuses(statuses: string[]): boolean {
  return ["Implemented", "Verified", "Reviewed"].every((label) => statuses.includes(label));
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

export function planTasksFromMarkdown(markdown: string): PlanTask[] {
  const headingTasks: PlanTask[] = [];
  const checkboxTasks: PlanTask[] = [];
  let currentHeading: { title: string; statuses: string[]; sawStatus: boolean } | undefined;

  function flushHeadingTask() {
    if (!currentHeading || !currentHeading.sawStatus) return;
    headingTasks.push({ title: cleanTaskTitle(currentHeading.title), complete: taskCompleteFromStatuses(currentHeading.statuses) });
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
      if (/\[[xX]\]/.test(line)) currentHeading.statuses.push(status[1]);
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

export function workflowTaskFooterLine(planPath: string | undefined, baseCwd?: string): string | undefined {
  if (!planPath) return undefined;
  const markdown = readPlanMarkdown(planPath, baseCwd);
  if (!markdown) return undefined;

  const tasks = planTasksFromMarkdown(markdown);
  const currentIndex = tasks.findIndex((task) => !task.complete);
  if (currentIndex === -1) return tasks.length > 0 ? "Current task: all tasks complete | Next task: none" : undefined;

  const current = tasks[currentIndex];
  const next = tasks.slice(currentIndex + 1).find((task) => !task.complete);
  return `Current task: ${current.title} | Next task: ${next?.title ?? "none"}`;
}

export function refreshWorkflowTasksFromPlan(state: WorkflowState, baseCwd?: string): WorkflowState {
  if (!state.activePlan || !state.current || phaseIndex(state.current) <= phaseIndex("plan")) return state;

  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown) return state;

  const tasks = planTasksFromMarkdown(markdown);
  if (tasks.length === 0) return { ...state, currentTask: undefined, nextTask: undefined };

  const currentIndex = tasks.findIndex((task) => !task.complete);
  if (currentIndex === -1) return { ...state, currentTask: "all tasks complete", nextTask: "none" };

  const current = tasks[currentIndex];
  const next = tasks.slice(currentIndex + 1).find((task) => !task.complete);
  return { ...state, currentTask: current.title, nextTask: next?.title ?? "none" };
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
      const label = theme?.fg?.("accent", "Addy Workflow: ") ?? theme?.fg?.("blue", "Addy Workflow: ") ?? "Addy Workflow: ";
      const artifact = workflowArtifactForFooter(state);
      const artifactName = artifact ? workflowArtifactName(artifact) : undefined;
      const styledArtifactName = artifactName ? (theme?.fg?.("mdLinkUrl", artifactName) ?? theme?.fg?.("accent", artifactName) ?? artifactName) : undefined;
      const artifactSuffix = styledArtifactName ? ` | ${styledArtifactName}` : "";
      const line = `${label}${renderWorkflowStrip(state, theme)}${artifactSuffix}`;
      const taskLine = state.currentTask ? `Current task: ${state.currentTask} | Next task: ${state.nextTask ?? "none"}` : workflowTaskFooterLine(state.activePlan, baseCwd);
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
