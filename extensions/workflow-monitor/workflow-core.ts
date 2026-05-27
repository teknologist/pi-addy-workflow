import {
  WORKFLOW_PHASES,
  type PhaseStatus,
  type WorkflowPhase,
} from './workflow-phases.ts';

export type { PhaseStatus, WorkflowPhase } from './workflow-phases.ts';

export type WorkflowIssueStats = {
  critical: number;
  important: number;
  suggestion: number;
  unknown: number;
  total: number;
};

export type WorkflowTaskStats = {
  plan?: string;
  taskId?: string;
  sliceIndex?: number;
  taskIndex?: number;
  taskTitle?: string;
  startedAt?: string;
  finishedAt?: string;
  activePhase?: WorkflowPhase;
  phaseStartedAt?: string;
  phaseDurationsMs?: Partial<Record<WorkflowPhase, number>>;
  turns: number;
  verifyRuns: number;
  reviewRuns: number;
  issues: WorkflowIssueStats;
};

export type WorkflowTaskCommitRecord = {
  plan: string;
  taskId?: string;
  sliceIndex?: number;
  taskIndex: number;
  taskTitle: string;
  commitSha: string;
  committedAt: string;
};

export type WorkflowStatsSession = {
  tasks: Record<string, WorkflowTaskStats>;
  endedReason?: string;
};

export type WorkflowStats = {
  active: WorkflowStatsSession;
  history: WorkflowStatsSession[];
};

export type AutoFreshReason = 'between-tasks' | 'before-step' | 'before-review';

export type AutoPendingActionReason =
  | 'next-action'
  | 'fresh-fallback'
  | 'idle-retry'
  | 'commit-frontier';

export type WorkflowAutoPendingAction = {
  key: string;
  prompt: string;
  expandedPrompt?: string;
  plan?: string;
  taskId?: string;
  taskIndex?: number;
  taskTitle?: string;
  sliceIndex?: number;
  reason: AutoPendingActionReason;
  attempts: number;
  createdAt: string;
};

export type WorkflowAutoPausedReason =
  | 'max-review-fix-loops'
  | 'repeated-review-finding'
  | 'same-phase-retry-limit'
  | 'user-stopped';

export type WorkflowState = {
  current?: WorkflowPhase;
  phases: Record<WorkflowPhase, PhaseStatus>;
  warnings: string[];
  stats?: WorkflowStats;
  committedTasks?: Record<string, WorkflowTaskCommitRecord>;
  activeSpec?: string;
  activePlan?: string;
  activeSuitePlan?: string;
  currentTask?: string;
  currentTaskId?: string;
  nextTask?: string;
  nextTaskId?: string;
  currentTaskIndex?: number;
  taskCount?: number;
  currentSliceIndex?: number;
  sliceCount?: number;
  currentTaskSummary?: string;
  nextTaskSummary?: string;
  lastTrigger?: string;
  lastArtifact?: string;
  testStatus?: 'detected' | 'passed' | 'failed';
  autoMode?: boolean;
  autoPendingAction?: WorkflowAutoPendingAction;
  autoPausedReason?: WorkflowAutoPausedReason;
  autoLastPrompt?: string;
  autoRetryKey?: string;
  autoRetryCount?: number;
  autoFreshPrompt?: string;
  autoFreshExpandedPrompt?: string;
  autoFreshReason?: AutoFreshReason;
  autoFreshDeliveryKey?: string;
  autoFreshConsumedKey?: string;
  autoReviewFixKey?: string;
  autoReviewFixCount?: number;
  autoReviewFindingFingerprint?: string;
  autoReviewFixNeedsReview?: boolean;
  autoReviewTask?: string;
  autoReviewTaskId?: string;
  autoReviewTaskIndex?: number;
  reviewStatsKey?: string;
  reviewStatsAgent?: string;
};

export type WorkflowEvent = {
  source:
    | 'user-input'
    | 'file-write'
    | 'tool-result'
    | 'subagent-call'
    | 'command';
  text?: string;
  command?: string;
  manualAddyCommand?: boolean;
  agentName?: string;
  success?: boolean;
  artifact?: string;
};

export function createInitialWorkflowState(): WorkflowState {
  return {
    phases: Object.fromEntries(
      WORKFLOW_PHASES.map((phase) => [phase, 'pending']),
    ) as Record<WorkflowPhase, PhaseStatus>,
    warnings: [],
  };
}
