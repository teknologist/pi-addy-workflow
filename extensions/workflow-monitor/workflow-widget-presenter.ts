import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import {
  WORKFLOW_PHASES,
  phaseIndex,
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowTaskStats,
  createInitialWorkflowState,
} from './workflow-transitions.ts';
import {
  isValidProgress,
  readSlicePlanProgress,
} from './slice-plan-progress.ts';

export const WORKFLOW_WIDGET_KEY = 'pi-addy-workflow';
const MIN_ARTIFACT_NAME_WIDTH = 12;

const OPTIONAL_PHASES = new Set<WorkflowPhase>(['simplify']);

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

function shortenArtifactName(name: string, maxWidth: number): string {
  if (visibleWidth(name) <= maxWidth) return name;

  const extension = name.match(/\.[^./]+$/)?.[0] ?? '';
  const stem = extension ? name.slice(0, -extension.length) : name;
  const lastWord = stem
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .at(-1);
  const suffix = `${lastWord ?? stem}${extension}`;
  const suffixWidth = Math.max(1, maxWidth - 3);
  return `...${
    visibleWidth(suffix) <= suffixWidth
      ? suffix
      : truncateToWidth(suffix, suffixWidth, '', false).trimEnd()
  }`;
}

function styledArtifactName(
  path: string | undefined,
  theme?: { fg?: (name: string, text: string) => string },
  maxWidth?: number,
): string | undefined {
  if (!path) return undefined;
  const name = maxWidth
    ? shortenArtifactName(workflowArtifactName(path), maxWidth)
    : workflowArtifactName(path);
  return theme?.fg?.('mdLinkUrl', name) ?? theme?.fg?.('accent', name) ?? name;
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

function artifactNameWidthsForLine(
  width: number | undefined,
  artifactName: string | undefined,
  suiteName: string | undefined,
  makeLine: (artifactWidth?: number, suiteWidth?: number) => string,
): { artifactWidth?: number; suiteWidth?: number } {
  if (!width) return {};

  const maxWidth = Math.max(1, width);
  let overflow = visibleWidth(makeLine()) - maxWidth;
  if (overflow <= 0) return {};

  let artifactWidth = artifactName ? visibleWidth(artifactName) : undefined;
  let suiteWidth = suiteName ? visibleWidth(suiteName) : undefined;
  const artifactReduction = Math.min(
    overflow,
    Math.max(0, (artifactWidth ?? 0) - MIN_ARTIFACT_NAME_WIDTH),
  );
  if (artifactWidth) artifactWidth -= artifactReduction;
  overflow = visibleWidth(makeLine(artifactWidth, suiteWidth)) - maxWidth;
  if (overflow <= 0) return { artifactWidth, suiteWidth };

  const suiteReduction = Math.min(
    overflow,
    Math.max(0, (suiteWidth ?? 0) - MIN_ARTIFACT_NAME_WIDTH),
  );
  if (suiteWidth) suiteWidth -= suiteReduction;
  return { artifactWidth, suiteWidth };
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

function totalTaskProgressSuffixFromProgress(
  progress: { currentTaskIndex: number; taskCount: number } | undefined,
  styleLabel: (text: string) => string,
): string {
  if (!progress) return '';
  return ` | ${styleLabel('Total tasks ')}${taskCompletionProgressBar(
    progress.currentTaskIndex,
    progress.taskCount,
  )} ${progress.currentTaskIndex}/${progress.taskCount}`;
}

export function workflowTaskFooterLine(
  planPath: string | undefined,
  baseCwd?: string,
  theme?: { fg?: (name: string, text: string) => string },
  state?: WorkflowState,
): string | undefined {
  if (!planPath) return undefined;
  const effectiveState = state ?? {
    ...createInitialWorkflowState(),
    activePlan: planPath,
  };
  const progress = readSlicePlanProgress(effectiveState, baseCwd);
  if (!progress?.hasTasks) return undefined;

  const styleLabel = (text: string) =>
    theme?.fg?.('accent', text) ?? theme?.fg?.('blue', text) ?? text;
  const sliceProgress = progressSuffix(
    'Slice ',
    progress.currentSliceIndex,
    progress.sliceCount,
    styleLabel,
  );
  const taskProgress = progressSuffix(
    'Task ',
    progress.currentTaskIndex,
    progress.taskCount,
    styleLabel,
  );
  const totalTaskProgress = totalTaskProgressSuffixFromProgress(
    progress.totalTaskProgress,
    styleLabel,
  );

  if (progress.allTasksClosed)
    return `${styleLabel('Current task: ')}all tasks complete | ${styleLabel('Next task: ')}none${sliceProgress}${taskProgress}${totalTaskProgress}`;

  return `${styleLabel('Current task: ')}${progress.currentTask} | ${styleLabel('Next task: ')}${progress.nextTask ?? 'none'}${sliceProgress}${taskProgress}${totalTaskProgress}`;
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
      const suiteArtifact =
        state.activeSuitePlan && state.activeSuitePlan !== artifact
          ? state.activeSuitePlan
          : undefined;
      const workflowStrip = renderWorkflowStrip(state, theme);
      const line = `${label}${workflowStrip}`;
      const artifactName = artifact
        ? workflowArtifactName(artifact)
        : undefined;
      const suiteName = suiteArtifact
        ? workflowArtifactName(suiteArtifact)
        : undefined;
      const makeArtifactLine = (
        artifactWidth?: number,
        suiteWidth?: number,
      ) => {
        const styledArtifact = styledArtifactName(
          artifact,
          theme,
          artifactWidth,
        );
        const styledSuiteArtifact = styledArtifactName(
          suiteArtifact,
          theme,
          suiteWidth,
        );
        if (styledArtifact && styledSuiteArtifact)
          return `${styleLabel('Slice: ')}${bold(styledArtifact)} | ${styleLabel('Plan: ')}${bold(styledSuiteArtifact)}`;
        if (styledArtifact) {
          const artifactLabel =
            state.current === 'define' || state.current === 'plan'
              ? 'Spec: '
              : 'Plan: ';
          return `${styleLabel(artifactLabel)}${bold(styledArtifact)}`;
        }
        return undefined;
      };
      const { artifactWidth, suiteWidth } = artifactNameWidthsForLine(
        width,
        artifactName,
        suiteName,
        (nextArtifactWidth, nextSuiteWidth) =>
          makeArtifactLine(nextArtifactWidth, nextSuiteWidth) ?? '',
      );
      const artifactLine = makeArtifactLine(artifactWidth, suiteWidth);
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
      const totalTaskProgress = totalTaskProgressSuffixFromProgress(
        readSlicePlanProgress(state, baseCwd)?.totalTaskProgress,
        styleLabel,
      );
      const taskLine = shouldRenderTaskFooter(state)
        ? currentTask
          ? `${styleLabel('Current task: ')}${currentTask} | ${styleLabel('Next task: ')}${nextTask ?? 'none'}${sliceProgress}${taskProgress}${totalTaskProgress}`
          : workflowTaskFooterLine(state.activePlan, baseCwd, theme, state)
        : undefined;
      const lines = [line, artifactLine, taskLine].filter(
        (value): value is string => Boolean(value),
      );
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
