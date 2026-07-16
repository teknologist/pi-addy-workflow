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

export type TicketOperation =
  | 'select'
  | 'claim'
  | 'build'
  | 'simplify'
  | 'verify'
  | 'review'
  | 'fix-all'
  | 'finish'
  | 'status'
  | 'release'
  | 'reclaim'
  | 'add-repository'
  | 'repository-scope-approval';

export type TicketCommitEvidence =
  | {
      repository: string;
      result: 'committed';
      commitSha: string;
      recordedAt: string;
    }
  | {
      repository: string;
      result: 'no-changes';
      recordedAt: string;
    };

export type TicketTerminalEvidence = {
  state: 'closed' | 'completed' | 'resolved';
  confirmedAt: string;
};

export type TicketRunState = {
  schemaVersion: 1;
  source: { kind: 'github' | 'linear' | 'local'; ref: string };
  runId: string;
  repositoryRoot?: string;
  claim?: { id: string; owner: string; claimedAt: string };
  revision?: string;
  queueSelector?: {
    kind: 'default' | 'label' | 'status';
    value: string;
  };
  queueDrainId?: string;
  lifecycle: {
    implemented: boolean;
    verified: boolean;
    reviewed: boolean;
    lastCompletedPhase?:
      | 'build'
      | 'simplify'
      | 'verify'
      | 'review'
      | 'fix-all'
      | 'finish';
  };
  repositoryScope: string[];
  activityMarker?: string;
  pendingClarification?: {
    kind: 'tracker-routing' | 'completion-transition';
    prompt: string;
    resolution?: string;
  };
  pendingScopeRequest?: { repository: string };
  lastValidatedResult?: {
    operation: TicketOperation;
    outcome: 'succeeded' | 'reconciled' | 'blocked' | 'failed';
    actionKey: string;
    attempt: number;
    revision?: string;
    claimId?: string;
    staleClaimId?: string;
    repository?: string;
    repositoryAppended?: boolean;
    manual?: true;
    pendingClarification?: {
      kind: 'tracker-routing' | 'completion-transition';
      prompt: string;
      resolution?: string;
    };
    reviewDisposition?:
      | { status: 'clean' }
      | { status: 'findings'; count: number };
    commitEvidence?: TicketCommitEvidence[];
    finishStage?:
      | 'repository-evidence'
      | 'final-activity'
      | 'terminal-transition'
      | 'terminal-refetch';
    finishActivityKind?: 'failure' | 'final';
    terminal?: TicketTerminalEvidence;
  };
};

export type TicketQueueState = {
  schemaVersion: 1;
  selector: NonNullable<TicketRunState['queueSelector']>;
  drainId: string;
};

export type TicketRecoveryState = {
  possibleClaim: true;
  ticketRef?: string;
  reason: string;
};

export type AutoPendingActionReason =
  | 'next-action'
  | 'fresh-fallback'
  | 'idle-retry'
  | 'commit-frontier';

type WorkflowAutoPendingActionBase = {
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

export type WorkflowPlanPendingAction = WorkflowAutoPendingActionBase & {
  executionSource?: 'plan';
};

export type WorkflowTicketPendingAction = WorkflowAutoPendingActionBase & {
  executionSource: 'ticket';
  sourceKind?: TicketRunState['source']['kind'];
  ticketRef: string;
  runId: string;
  claimId?: string;
  staleClaimId?: string;
  selector?: TicketRunState['queueSelector'];
  repository?: string;
  operation: TicketOperation;
  attemptMarker: string;
};

export type WorkflowAutoPendingAction =
  | WorkflowPlanPendingAction
  | WorkflowTicketPendingAction;

export type WorkflowAutoPausedReason =
  | 'max-review-fix-loops'
  | 'repeated-review-finding'
  | 'same-phase-retry-limit'
  | 'ticket-operation-blocked'
  | 'ticket-operation-failed'
  | 'configuration-ambiguous'
  | 'scope-expansion-required'
  | 'user-stopped';

export type WorkflowState = {
  current?: WorkflowPhase;
  executionSource?: 'plan' | 'ticket';
  ticketQueue?: TicketQueueState;
  ticketRun?: TicketRunState;
  ticketHistory?: TicketRunState[];
  ticketRecovery?: TicketRecoveryState;
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
