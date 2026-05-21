import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { complete, type UserMessage } from '@earendil-works/pi-ai';
import {
  WORKFLOW_PHASES,
  createInitialWorkflowState,
  transitionWorkflow,
  type PhaseStatus,
  type WorkflowEvent,
  type WorkflowIssueStats,
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowAutoPendingAction,
  type WorkflowTaskCommitRecord,
  type WorkflowTaskStats,
} from './workflow-transitions.ts';
import {
  WORKFLOW_STATE_ENTRY_TYPE,
  WORKFLOW_WIDGET_KEY,
  createEmptyWorkflowStats,
  nextPromptForPhase,
  parseWorkflowState,
  promptArtifactForPhase,
  refreshWorkflowTasksFromPlan,
  renderWorkflowWidget,
  workflowTaskCommitKey,
} from './workflow-tracker.ts';
import { workflowWarningText } from './warnings.ts';

type SessionEntry =
  | { type?: string; customType?: string; data?: unknown }
  | [string, unknown];

type WorkflowContext = {
  cwd?: string;
  sessionId?: string;
  conversationId?: string;
  id?: string;
  ui?: {
    setWidget?: (key: string, value: unknown) => void;
    notify?: (message: string, level?: string) => void;
  };
  input?: {
    prefill?: (text: string) => void;
  };
  model?: unknown;
  modelRegistry?: {
    getApiKeyAndHeaders?: (model: unknown) => Promise<{
      ok: boolean;
      apiKey?: string;
      headers?: Record<string, string>;
      error?: string;
    }>;
  };
  signal?: AbortSignal;
  sessionManager?: {
    getBranch?: () => SessionEntry[];
  };
  state?: WorkflowState;
};

type AppendEntry = (type: string, data: unknown) => void;

const workflowMemory = new Map<string, WorkflowState>();

function isPhaseStatus(value: unknown): value is PhaseStatus {
  return value === 'pending' || value === 'active' || value === 'complete';
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isWorkflowTaskCommitRecord(
  value: unknown,
): value is WorkflowTaskCommitRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WorkflowTaskCommitRecord>;
  return (
    typeof candidate.plan === 'string' &&
    (candidate.sliceIndex === undefined ||
      isPositiveSafeInteger(candidate.sliceIndex)) &&
    isPositiveSafeInteger(candidate.taskIndex) &&
    typeof candidate.taskTitle === 'string' &&
    typeof candidate.commitSha === 'string' &&
    typeof candidate.committedAt === 'string'
  );
}

function coerceCommittedTasks(
  value: unknown,
): Record<string, WorkflowTaskCommitRecord> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;

  const committedTasks: Record<string, WorkflowTaskCommitRecord> = {};
  for (const [key, record] of Object.entries(value)) {
    if (!isWorkflowTaskCommitRecord(record)) continue;
    committedTasks[key] = record;
  }
  return committedTasks;
}

function isAutoPendingActionReason(
  value: unknown,
): value is WorkflowAutoPendingAction['reason'] {
  return (
    value === 'next-action' ||
    value === 'fresh-fallback' ||
    value === 'idle-retry' ||
    value === 'commit-frontier'
  );
}

function coerceAutoPendingAction(
  value: unknown,
): WorkflowAutoPendingAction | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<WorkflowAutoPendingAction>;
  if (
    typeof candidate.key !== 'string' ||
    candidate.key.length === 0 ||
    typeof candidate.prompt !== 'string' ||
    candidate.prompt.length === 0 ||
    !isAutoPendingActionReason(candidate.reason) ||
    !isNonNegativeSafeInteger(candidate.attempts) ||
    typeof candidate.createdAt !== 'string'
  )
    return undefined;
  if (
    candidate.expandedPrompt !== undefined &&
    typeof candidate.expandedPrompt !== 'string'
  )
    return undefined;
  if (candidate.plan !== undefined && typeof candidate.plan !== 'string')
    return undefined;
  if (
    candidate.taskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.taskIndex)
  )
    return undefined;
  if (
    candidate.taskTitle !== undefined &&
    typeof candidate.taskTitle !== 'string'
  )
    return undefined;
  if (
    candidate.sliceIndex !== undefined &&
    !isPositiveSafeInteger(candidate.sliceIndex)
  )
    return undefined;
  return {
    key: candidate.key,
    prompt: candidate.prompt,
    expandedPrompt: candidate.expandedPrompt,
    plan: candidate.plan,
    taskIndex: candidate.taskIndex,
    taskTitle: candidate.taskTitle,
    sliceIndex: candidate.sliceIndex,
    reason: candidate.reason,
    attempts: candidate.attempts,
    createdAt: candidate.createdAt,
  };
}

function isAutoPausedReason(value: unknown): boolean {
  return (
    value === 'unclear-commit-result' ||
    value === 'max-review-fix-loops' ||
    value === 'repeated-review-finding' ||
    value === 'same-phase-retry-limit' ||
    value === 'user-stopped'
  );
}

function taskStatHasLifecycleEvidence(
  value: Partial<WorkflowTaskStats>,
): boolean {
  return (
    typeof value.verifyRuns === 'number' &&
    value.verifyRuns > 0 &&
    typeof value.reviewRuns === 'number' &&
    value.reviewRuns > 0
  );
}

function backfillCommittedTasksFromStats(
  value: unknown,
): Record<string, WorkflowTaskCommitRecord> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const history = (value as { history?: unknown }).history;
  if (!Array.isArray(history)) return undefined;

  const committedTasks: Record<string, WorkflowTaskCommitRecord> = {};
  for (const session of history) {
    if (typeof session !== 'object' || session === null) continue;
    const candidateSession = session as {
      endedReason?: unknown;
      tasks?: unknown;
    };
    if (candidateSession.endedReason !== 'task-commit') continue;
    if (
      typeof candidateSession.tasks !== 'object' ||
      candidateSession.tasks === null ||
      Array.isArray(candidateSession.tasks)
    )
      continue;

    for (const task of Object.values(candidateSession.tasks)) {
      if (typeof task !== 'object' || task === null) continue;
      const candidate = task as Partial<WorkflowTaskStats>;
      if (
        typeof candidate.plan !== 'string' ||
        !/\.md$/i.test(candidate.plan) ||
        !isPositiveSafeInteger(candidate.taskIndex) ||
        typeof candidate.taskTitle !== 'string' ||
        candidate.taskTitle.length === 0 ||
        !taskStatHasLifecycleEvidence(candidate)
      )
        continue;

      const key = workflowTaskCommitKey(
        candidate.plan,
        candidate.taskIndex,
        candidate.taskTitle,
      );
      committedTasks[key] = {
        plan: candidate.plan,
        sliceIndex: isPositiveSafeInteger(candidate.sliceIndex)
          ? candidate.sliceIndex
          : undefined,
        taskIndex: candidate.taskIndex,
        taskTitle: candidate.taskTitle,
        commitSha: `legacy:${createHash('sha256')
          .update(key)
          .digest('hex')
          .slice(0, 12)}`,
        committedAt: 'legacy-task-commit',
      };
    }
  }

  return Object.keys(committedTasks).length > 0 ? committedTasks : undefined;
}

function migrateCommittedTasks(
  candidate: { stats?: unknown },
  committedTasks: Record<string, WorkflowTaskCommitRecord> | undefined,
): Record<string, WorkflowTaskCommitRecord> | undefined {
  const legacyCommittedTasks = backfillCommittedTasksFromStats(candidate.stats);
  if (!legacyCommittedTasks) return committedTasks;
  return { ...legacyCommittedTasks, ...committedTasks };
}

function hasWorkflowStateShape(
  value: unknown,
): value is { phases: unknown; warnings: unknown } {
  if (typeof value !== 'object') return false;
  if (value === null) return false;
  if (!('phases' in value)) return false;
  return 'warnings' in value;
}

function coerceWorkflowState(value: unknown): WorkflowState | undefined {
  if (!hasWorkflowStateShape(value)) return undefined;

  const candidate = value as Omit<Partial<WorkflowState>, 'current'> & {
    current?: WorkflowPhase | 'ship';
  };
  const rawCurrent = candidate.current;
  const current: WorkflowPhase | undefined =
    rawCurrent === 'ship' ? 'finish' : rawCurrent;
  if (current !== undefined && !WORKFLOW_PHASES.includes(current))
    return undefined;
  if (
    !Array.isArray(candidate.warnings) ||
    !candidate.warnings.every((warning) => typeof warning === 'string')
  )
    return undefined;
  if (
    candidate.activeSpec !== undefined &&
    typeof candidate.activeSpec !== 'string'
  )
    return undefined;
  if (
    candidate.activePlan !== undefined &&
    typeof candidate.activePlan !== 'string'
  )
    return undefined;
  if (
    candidate.activeSuitePlan !== undefined &&
    typeof candidate.activeSuitePlan !== 'string'
  )
    return undefined;
  const committedTasks = coerceCommittedTasks(candidate.committedTasks);
  if (candidate.committedTasks !== undefined && !committedTasks)
    return undefined;
  const migratedCommittedTasks = migrateCommittedTasks(
    candidate,
    committedTasks,
  );
  if (
    candidate.autoMode !== undefined &&
    typeof candidate.autoMode !== 'boolean'
  )
    return undefined;
  const autoPendingAction = coerceAutoPendingAction(
    candidate.autoPendingAction,
  );
  if (candidate.autoPendingAction !== undefined && !autoPendingAction)
    return undefined;
  if (
    candidate.autoPausedReason !== undefined &&
    !isAutoPausedReason(candidate.autoPausedReason)
  )
    return undefined;
  if (
    candidate.autoLastPrompt !== undefined &&
    typeof candidate.autoLastPrompt !== 'string'
  )
    return undefined;
  if (
    candidate.autoFreshPrompt !== undefined &&
    typeof candidate.autoFreshPrompt !== 'string'
  )
    return undefined;
  if (
    candidate.autoFreshExpandedPrompt !== undefined &&
    typeof candidate.autoFreshExpandedPrompt !== 'string'
  )
    return undefined;
  if (
    candidate.autoFreshReason !== undefined &&
    !['between-tasks', 'before-step', 'before-review'].includes(
      candidate.autoFreshReason,
    )
  )
    return undefined;
  if (
    candidate.autoFreshDeliveryKey !== undefined &&
    typeof candidate.autoFreshDeliveryKey !== 'string'
  )
    return undefined;
  if (
    candidate.autoFreshConsumedKey !== undefined &&
    typeof candidate.autoFreshConsumedKey !== 'string'
  )
    return undefined;
  if (
    candidate.autoRetryKey !== undefined &&
    typeof candidate.autoRetryKey !== 'string'
  )
    return undefined;
  if (
    candidate.autoRetryCount !== undefined &&
    !isNonNegativeSafeInteger(candidate.autoRetryCount)
  )
    return undefined;
  if (
    candidate.autoReviewFixKey !== undefined &&
    typeof candidate.autoReviewFixKey !== 'string'
  )
    return undefined;
  if (
    candidate.autoReviewFixCount !== undefined &&
    !isNonNegativeSafeInteger(candidate.autoReviewFixCount)
  )
    return undefined;
  if (
    candidate.autoReviewFindingFingerprint !== undefined &&
    typeof candidate.autoReviewFindingFingerprint !== 'string'
  )
    return undefined;
  if (
    candidate.autoReviewFixNeedsReview !== undefined &&
    typeof candidate.autoReviewFixNeedsReview !== 'boolean'
  )
    return undefined;
  if (
    candidate.autoReviewTask !== undefined &&
    typeof candidate.autoReviewTask !== 'string'
  )
    return undefined;
  if (
    candidate.autoReviewTaskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.autoReviewTaskIndex)
  )
    return undefined;
  if (
    candidate.reviewStatsKey !== undefined &&
    typeof candidate.reviewStatsKey !== 'string'
  )
    return undefined;
  if (
    candidate.reviewStatsAgent !== undefined &&
    typeof candidate.reviewStatsAgent !== 'string'
  )
    return undefined;
  if (
    candidate.currentTask !== undefined &&
    typeof candidate.currentTask !== 'string'
  )
    return undefined;
  if (
    candidate.nextTask !== undefined &&
    typeof candidate.nextTask !== 'string'
  )
    return undefined;
  if (
    candidate.currentTaskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.currentTaskIndex)
  )
    return undefined;
  if (
    candidate.taskCount !== undefined &&
    !isPositiveSafeInteger(candidate.taskCount)
  )
    return undefined;
  if (
    candidate.currentTaskIndex !== undefined &&
    candidate.taskCount !== undefined &&
    candidate.currentTaskIndex > candidate.taskCount
  )
    return undefined;
  if (
    candidate.currentSliceIndex !== undefined &&
    !isPositiveSafeInteger(candidate.currentSliceIndex)
  )
    return undefined;
  if (
    candidate.sliceCount !== undefined &&
    !isPositiveSafeInteger(candidate.sliceCount)
  )
    return undefined;
  if (
    candidate.currentSliceIndex !== undefined &&
    candidate.sliceCount !== undefined &&
    candidate.currentSliceIndex > candidate.sliceCount
  )
    return undefined;
  if (
    candidate.currentTaskSummary !== undefined &&
    typeof candidate.currentTaskSummary !== 'string'
  )
    return undefined;
  if (
    candidate.nextTaskSummary !== undefined &&
    typeof candidate.nextTaskSummary !== 'string'
  )
    return undefined;
  if (typeof candidate.phases !== 'object' || candidate.phases === null)
    return undefined;

  const legacyPhases = candidate.phases as Record<string, unknown>;
  const phases = Object.fromEntries(
    WORKFLOW_PHASES.map((phase) => {
      const status =
        phase === 'finish'
          ? (legacyPhases.finish ?? legacyPhases.ship)
          : legacyPhases[phase];
      return [phase, isPhaseStatus(status) ? status : undefined];
    }),
  ) as Record<WorkflowPhase, PhaseStatus | undefined>;
  if (!WORKFLOW_PHASES.every((phase) => phases[phase])) return undefined;

  return {
    ...candidate,
    committedTasks: migratedCommittedTasks,
    autoPendingAction,
    current,
    phases: phases as Record<WorkflowPhase, PhaseStatus>,
    warnings: candidate.warnings,
  };
}

function parsePersistedWorkflowState(
  value: unknown,
): WorkflowState | undefined {
  const directState = coerceWorkflowState(value);
  if (directState) return parseWorkflowState(directState);

  if (typeof value !== 'string') return undefined;

  try {
    const parsed = JSON.parse(value);
    const parsedState =
      parsed?.type === WORKFLOW_STATE_ENTRY_TYPE
        ? coerceWorkflowState(parsed.state)
        : coerceWorkflowState(parsed);
    if (parsedState) return parseWorkflowState(parsedState);
  } catch {
    return undefined;
  }

  return undefined;
}

function workflowStateFromEntry(
  entry: SessionEntry,
): WorkflowState | undefined {
  if (Array.isArray(entry)) {
    const [type, data] = entry;
    return type === WORKFLOW_STATE_ENTRY_TYPE
      ? parsePersistedWorkflowState(data)
      : undefined;
  }

  if (entry.type === 'custom' && entry.customType === WORKFLOW_STATE_ENTRY_TYPE)
    return parsePersistedWorkflowState(entry.data);
  if (entry.type === WORKFLOW_STATE_ENTRY_TYPE)
    return parsePersistedWorkflowState(entry.data);

  return undefined;
}

function workflowStateKey(ctx: WorkflowContext): string {
  const explicitSessionScope = [ctx.sessionId, ctx.conversationId, ctx.id].find(
    (value) => typeof value === 'string' && value.length > 0,
  );
  const projectScope =
    [ctx.cwd, process.cwd()].find(
      (value) => typeof value === 'string' && value.length > 0,
    ) ?? 'default';
  const scope = explicitSessionScope ?? `${process.pid}:${projectScope}`;
  return createHash('sha256').update(scope).digest('hex').slice(0, 24);
}

function projectWorkflowStateKey(ctx: WorkflowContext): string {
  const projectScope =
    [ctx.cwd, process.cwd()].find(
      (value) => typeof value === 'string' && value.length > 0,
    ) ?? 'default';
  return createHash('sha256')
    .update(`project:${projectScope}`)
    .digest('hex')
    .slice(0, 24);
}

function workflowStateDir(ctx?: WorkflowContext): string {
  const projectScope = [ctx?.cwd, process.cwd()].find(
    (value) => typeof value === 'string' && value.length > 0,
  );
  return (
    process.env.PI_ADDY_WORKFLOW_STATE_DIR ??
    (projectScope
      ? join(projectScope, '.pi', 'addy-workflow', 'state')
      : join(homedir(), '.pi', 'agent', 'state', 'pi-addy-workflow'))
  );
}

function workflowStatePath(key: string, ctx?: WorkflowContext): string {
  return join(workflowStateDir(ctx), `${key}.json`);
}

function readStoredWorkflowState(
  key: string,
  ctx?: WorkflowContext,
): WorkflowState | undefined {
  const path = workflowStatePath(key, ctx);
  if (!existsSync(path)) return undefined;

  try {
    return parsePersistedWorkflowState(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeStoredWorkflowState(
  key: string,
  state: WorkflowState,
  ctx?: WorkflowContext,
): void {
  const path = workflowStatePath(key, ctx);
  try {
    mkdirSync(workflowStateDir(ctx), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state }),
      'utf8',
    );
  } catch {
    // Persistence is best-effort; in-memory/session state still drives the current turn.
  }
}

const PROJECT_FALLBACK_AUTO_CONTROL_FIELDS = [
  'autoLastPrompt',
  'autoPendingAction',
  'autoPausedReason',
  'autoRetryKey',
  'autoRetryCount',
  'autoFreshPrompt',
  'autoFreshExpandedPrompt',
  'autoFreshReason',
  'autoFreshDeliveryKey',
  'autoFreshConsumedKey',
  'autoReviewFixKey',
  'autoReviewFixCount',
  'autoReviewFindingFingerprint',
  'autoReviewFixNeedsReview',
  'autoReviewTask',
  'autoReviewTaskIndex',
  'reviewStatsKey',
  'reviewStatsAgent',
] as const satisfies readonly (keyof WorkflowState)[];

function hasLiveAutoControl(state: WorkflowState | undefined): boolean {
  return Boolean(
    state &&
    (state.autoMode ||
      (state.autoFreshPrompt && state.autoFreshReason) ||
      state.autoPendingAction),
  );
}

function explicitlyStoppedAuto(state: WorkflowState): boolean {
  return Boolean(
    state.autoPausedReason === 'user-stopped' ||
    /^\/addy-auto\s+stop\b/.test(state.lastTrigger ?? ''),
  );
}

function withProjectAutoControl(
  state: WorkflowState,
  projectState: WorkflowState | undefined,
): WorkflowState {
  if (!hasLiveAutoControl(projectState)) return state;
  if (state.autoMode || explicitlyStoppedAuto(state)) return state;

  const merged = { ...state, autoMode: true };
  for (const field of PROJECT_FALLBACK_AUTO_CONTROL_FIELDS) {
    const value = projectState?.[field];
    if (value !== undefined) merged[field] = value as never;
  }
  return merged;
}

function projectFallbackWorkflowState(
  key: string,
  ctx: WorkflowContext,
): WorkflowState | undefined {
  const state = workflowMemory.get(key) ?? readStoredWorkflowState(key, ctx);
  if (!state) return undefined;
  const validPendingFresh = Boolean(
    state.autoFreshPrompt && state.autoFreshReason,
  );
  const validPendingAction = Boolean(state.autoPendingAction);
  const preserveFreshRetry = Boolean(
    validPendingFresh &&
    state.autoRetryKey?.startsWith(`${state.autoFreshPrompt}`),
  );
  const sanitized = {
    ...state,
    autoMode: Boolean(
      state.autoMode || validPendingFresh || validPendingAction,
    ),
  };
  if (!validPendingFresh && !validPendingAction && !state.autoMode) {
    for (const field of PROJECT_FALLBACK_AUTO_CONTROL_FIELDS)
      sanitized[field] = undefined;
    return sanitized;
  }
  sanitized.autoLastPrompt = undefined;
  sanitized.autoReviewFixKey = undefined;
  sanitized.autoReviewFixCount = undefined;
  sanitized.autoReviewFindingFingerprint = undefined;
  sanitized.autoReviewFixNeedsReview = undefined;
  sanitized.autoReviewTask = undefined;
  sanitized.autoReviewTaskIndex = undefined;
  sanitized.reviewStatsKey = undefined;
  sanitized.reviewStatsAgent = undefined;
  if (!preserveFreshRetry) {
    sanitized.autoRetryKey = undefined;
    sanitized.autoRetryCount = undefined;
  }
  return sanitized;
}

export function getContextWorkflowState(ctx: WorkflowContext): WorkflowState {
  const entries = ctx.sessionManager?.getBranch?.() ?? [];
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  const projectState =
    workflowMemory.get(projectKey) ?? readStoredWorkflowState(projectKey, ctx);
  const stateIfNotStalePending = (state: WorkflowState): WorkflowState => {
    const projectConsumedPendingFresh = Boolean(
      projectState &&
      state.autoFreshPrompt &&
      state.autoFreshDeliveryKey &&
      projectState.autoFreshConsumedKey === state.autoFreshDeliveryKey,
    );
    if (
      projectState &&
      projectConsumedPendingFresh &&
      !projectState.autoFreshPrompt
    )
      return parseWorkflowState(projectState);
    return withProjectAutoControl(state, projectState);
  };

  for (const entry of [...entries].reverse()) {
    const state = workflowStateFromEntry(entry);
    if (state) return stateIfNotStalePending(state);
  }

  if (ctx.state) return stateIfNotStalePending(parseWorkflowState(ctx.state));

  return (
    workflowMemory.get(key) ??
    readStoredWorkflowState(key, ctx) ??
    projectFallbackWorkflowState(projectKey, ctx) ??
    createInitialWorkflowState()
  );
}

export function setContextWorkflowState(
  ctx: WorkflowContext,
  state: WorkflowState,
  appendEntry?: AppendEntry,
): void {
  state = refreshWorkflowTasksFromPlan(state, ctx.cwd);
  ctx.state = state;
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  workflowMemory.set(key, state);
  workflowMemory.set(projectKey, state);
  writeStoredWorkflowState(key, state, ctx);
  writeStoredWorkflowState(projectKey, state, ctx);
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
  ctx.ui?.setWidget?.(
    WORKFLOW_WIDGET_KEY,
    renderWorkflowWidget(state, ctx.cwd),
  );
  const warning = workflowWarningText(state);
  if (warning) ctx.ui?.notify?.(warning, 'warning');
}

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

function commandNameFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const [command] = text.trim().split(/\s+/, 1);
  return command?.startsWith('/addy-') ? command : undefined;
}

function manualTurnCommand(command: string | undefined): boolean {
  return (
    command === '/addy-build' ||
    command === '/addy-verify' ||
    command === '/addy-review' ||
    command === '/addy-code-simplify' ||
    command === '/addy-fix-all' ||
    command === '/addy-finish'
  );
}

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

export type WorkflowStatsTarget = {
  plan?: string;
  sliceIndex?: number;
  taskIndex?: number;
  taskTitle?: string;
};

function statsTaskKey(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): string {
  return [
    target.plan ?? state.activePlan ?? '',
    target.sliceIndex ?? state.currentSliceIndex ?? '',
    target.taskIndex ?? state.currentTaskIndex ?? '',
    target.taskTitle ?? state.currentTask ?? '',
  ].join('\u001f');
}

function workflowStatsTarget(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): Required<WorkflowStatsTarget> {
  return {
    plan: target.plan ?? state.activePlan ?? '',
    sliceIndex: target.sliceIndex ?? state.currentSliceIndex ?? 0,
    taskIndex: target.taskIndex ?? state.currentTaskIndex ?? 0,
    taskTitle: target.taskTitle ?? state.currentTask ?? '',
  };
}

function hasWorkflowStatsTarget(
  state: WorkflowState,
  target: WorkflowStatsTarget,
): boolean {
  return Boolean(
    state.activePlan || state.currentTask || target.plan || target.taskTitle,
  );
}

function updateWorkflowTaskStats(
  state: WorkflowState,
  target: WorkflowStatsTarget,
  update: (existing: WorkflowTaskStats) => WorkflowTaskStats,
): WorkflowState {
  if (!hasWorkflowStatsTarget(state, target)) return state;

  const stats = state.stats ?? createEmptyWorkflowStats();
  const resolved = workflowStatsTarget(state, target);
  const key = statsTaskKey(state, target);
  const existing = stats.active.tasks[key] ?? emptyTaskStats(resolved);
  return {
    ...state,
    stats: {
      active: {
        ...stats.active,
        tasks: {
          ...stats.active.tasks,
          [key]: update(existing),
        },
      },
      history: stats.history,
    },
  };
}

function emptyTaskStats(
  target: Required<WorkflowStatsTarget>,
): WorkflowTaskStats {
  return {
    plan: target.plan || undefined,
    sliceIndex: target.sliceIndex || undefined,
    taskIndex: target.taskIndex || undefined,
    taskTitle: target.taskTitle || undefined,
    turns: 0,
    verifyRuns: 0,
    reviewRuns: 0,
    issues: emptyIssueStats(),
  };
}

export function recordWorkflowTaskTurn(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): WorkflowState {
  return updateWorkflowTaskStats(state, target, (existing) => ({
    ...existing,
    turns: existing.turns + 1,
  }));
}

export function recordWorkflowVerifyRun(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): WorkflowState {
  const withTurn = recordWorkflowTaskTurn(state, target);
  const key = statsTaskKey(withTurn, target);
  const stats = withTurn.stats ?? createEmptyWorkflowStats();
  const existing = stats.active.tasks[key];
  if (!existing) return withTurn;

  return {
    ...withTurn,
    stats: {
      active: {
        ...stats.active,
        tasks: {
          ...stats.active.tasks,
          [key]: {
            ...existing,
            verifyRuns: (existing.verifyRuns ?? 0) + 1,
          },
        },
      },
      history: stats.history,
    },
  };
}

export function recordWorkflowReviewRun(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): WorkflowState {
  const withTurn = recordWorkflowTaskTurn(state, target);
  const key = statsTaskKey(withTurn, target);
  const stats = withTurn.stats ?? createEmptyWorkflowStats();
  const existing = stats.active.tasks[key];
  if (!existing) return withTurn;

  return {
    ...withTurn,
    reviewStatsKey: key,
    stats: {
      active: {
        ...stats.active,
        tasks: {
          ...stats.active.tasks,
          [key]: {
            ...existing,
            reviewRuns: (existing.reviewRuns ?? 0) + 1,
          },
        },
      },
      history: stats.history,
    },
  };
}

export function recordWorkflowReviewIssues(
  state: WorkflowState,
  issues: WorkflowIssueStats,
): WorkflowState {
  const key = state.reviewStatsKey;
  if (!key) return state;

  const stats = state.stats ?? createEmptyWorkflowStats();
  const existing = stats.active.tasks[key];
  if (!existing)
    return { ...state, reviewStatsKey: undefined, reviewStatsAgent: undefined };

  return {
    ...state,
    reviewStatsKey: undefined,
    reviewStatsAgent: undefined,
    stats: {
      active: {
        ...stats.active,
        tasks: {
          ...stats.active.tasks,
          [key]: {
            ...existing,
            issues: addIssueStats(existing.issues, issues),
          },
        },
      },
      history: stats.history,
    },
  };
}

function reviewSubagentName(event: WorkflowEvent): string | undefined {
  if (event.source !== 'subagent-call') return undefined;
  if (!event.agentName?.startsWith('addy-')) return undefined;
  if (!event.agentName.includes('review')) return undefined;
  return event.agentName;
}

function recordReviewSubagentStats(
  state: WorkflowState,
  agentName: string,
): WorkflowState {
  if (state.reviewStatsKey) return { ...state, reviewStatsAgent: agentName };
  return { ...recordWorkflowReviewRun(state), reviewStatsAgent: agentName };
}

function recordManualTaskTurn(
  previous: WorkflowState,
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState {
  if (previous.autoMode) return state;
  const reviewAgent = reviewSubagentName(event);
  if (reviewAgent) return recordReviewSubagentStats(state, reviewAgent);
  if (event.source !== 'user-input' && event.source !== 'command') return state;
  const command = commandNameFromText(event.text ?? event.command);
  if (!manualTurnCommand(command)) return state;
  if (command === '/addy-verify') return recordWorkflowVerifyRun(state);
  if (command === '/addy-review') return recordWorkflowReviewRun(state);
  return recordWorkflowTaskTurn(state);
}

export function archiveWorkflowStats(
  state: WorkflowState,
  endedReason: string,
): WorkflowState {
  const stats = state.stats ?? createEmptyWorkflowStats();
  const hasActiveStats = Object.keys(stats.active.tasks).length > 0;
  return {
    ...state,
    stats: hasActiveStats
      ? {
          active: { tasks: {} },
          history: [...stats.history, { ...stats.active, endedReason }],
        }
      : stats,
  };
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
  ctx.state = state;
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  workflowMemory.set(key, state);
  workflowMemory.set(projectKey, state);
  writeStoredWorkflowState(key, state, ctx);
  writeStoredWorkflowState(projectKey, state, ctx);
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
  ctx.ui?.setWidget?.(WORKFLOW_WIDGET_KEY, undefined);
  return state;
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
