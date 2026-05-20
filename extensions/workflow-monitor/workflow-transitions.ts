export const WORKFLOW_PHASES = [
  'define',
  'plan',
  'build',
  'simplify',
  'verify',
  'review',
  'finish',
] as const;
export const ENFORCED_WORKFLOW_PHASES = ['build', 'verify', 'review'] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];
export type PhaseStatus = 'pending' | 'active' | 'complete';

export type WorkflowIssueStats = {
  critical: number;
  important: number;
  suggestion: number;
  unknown: number;
  total: number;
};

export type WorkflowTaskStats = {
  plan?: string;
  sliceIndex?: number;
  taskIndex?: number;
  taskTitle?: string;
  turns: number;
  verifyRuns: number;
  reviewRuns: number;
  issues: WorkflowIssueStats;
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

export type WorkflowState = {
  current?: WorkflowPhase;
  phases: Record<WorkflowPhase, PhaseStatus>;
  warnings: string[];
  stats?: WorkflowStats;
  activeSpec?: string;
  activePlan?: string;
  activeSuitePlan?: string;
  currentTask?: string;
  nextTask?: string;
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
  skipConfirmed?: boolean;
  confirmedSkippedPhases?: WorkflowPhase[];
};

export function createInitialWorkflowState(): WorkflowState {
  return {
    phases: Object.fromEntries(
      WORKFLOW_PHASES.map((phase) => [phase, 'pending']),
    ) as Record<WorkflowPhase, PhaseStatus>,
    warnings: [],
  };
}

export function phaseIndex(phase: WorkflowPhase): number {
  return WORKFLOW_PHASES.indexOf(phase);
}

function enforcedPhaseIndex(phase: WorkflowPhase): number {
  return (ENFORCED_WORKFLOW_PHASES as readonly WorkflowPhase[]).indexOf(phase);
}

function skippedEnforcedPhases(
  state: WorkflowState,
  target: WorkflowPhase,
  next: WorkflowState,
): WorkflowPhase[] {
  const targetIndex =
    target === 'finish'
      ? ENFORCED_WORKFLOW_PHASES.length
      : enforcedPhaseIndex(target);
  if (targetIndex === -1) return [];

  return (ENFORCED_WORKFLOW_PHASES as readonly WorkflowPhase[]).filter(
    (phase) => {
      const index = enforcedPhaseIndex(phase);
      return (
        index < targetIndex &&
        state.phases[phase] !== 'complete' &&
        next.phases[phase] !== 'complete'
      );
    },
  );
}

function completeSpecAndPlanAfterPlanning(
  state: WorkflowState,
  target: WorkflowPhase,
): WorkflowState {
  if (phaseIndex(target) <= phaseIndex('plan')) return state;

  return {
    ...state,
    phases: {
      ...state.phases,
      define: 'complete',
      plan: 'complete',
    },
  };
}

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

function fileWriteTargetPhase(
  path: string,
  current?: WorkflowPhase,
): WorkflowPhase | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/^@/, '');

  if (
    matchesAny(normalized, [
      /(^|\/)(SPEC|spec)\.md$/,
      /(^|\/)docs\/specs\//,
      /(^|\/)docs\/prd\//,
    ])
  )
    return 'define';
  if (matchesAny(normalized, [/(^|\/)docs\/plans\//])) {
    return current && phaseIndex(current) > phaseIndex('plan')
      ? undefined
      : 'plan';
  }
  if (
    matchesAny(normalized, [/(^|\/)[^/]+\.(test|spec)\.[^/]+$/, /^tests\//])
  ) {
    return current && phaseIndex(current) > phaseIndex('verify')
      ? undefined
      : 'verify';
  }
  if (
    matchesAny(normalized, [
      /^CHANGELOG/,
      /^RELEASE/,
      /^docs\/releases\//,
      /^docs\/deploy\//,
    ])
  )
    return 'finish';
  if (
    !matchesAny(normalized, [
      /^tests\//,
      /^docs\//,
      /^tasks\//,
      /^agents\//,
      /^skills\//,
      /^prompts\//,
      /^extensions\//,
    ])
  ) {
    return current && phaseIndex(current) > phaseIndex('build')
      ? undefined
      : 'build';
  }

  return undefined;
}

function unquoteArgument(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return trimmed.length >= 2 &&
    (quote === '"' || quote === "'") &&
    trimmed.endsWith(quote)
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function isLikelySpecArgument(value: string): boolean {
  const trimmed = value.trim();
  const quote = trimmed[0];
  const isQuoted = (quote === '"' || quote === "'") && trimmed.endsWith(quote);
  const unquoted = unquoteArgument(value);
  if (!unquoted) return false;
  if (/\.md$/i.test(unquoted)) return true;
  if (isQuoted && /\s/.test(unquoted)) return false;
  if (
    unquoted.includes('/') ||
    unquoted.includes('\\') ||
    unquoted.startsWith('@')
  )
    return true;
  return !/\s/.test(unquoted);
}

function commandNameFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const [command] = text.trim().split(/\s+/, 1);
  return command?.startsWith('/addy-') ? command : undefined;
}

function artifactFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(/\s+/);
  if (!parts[0]?.startsWith('/addy-')) return undefined;
  if (parts[0] === '/addy-workflow-next')
    return parts.slice(2).join(' ') || undefined;
  return parts.slice(1).join(' ') || undefined;
}

function autoModeArtifactFromText(
  text: string | undefined,
): string | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(/\s+/);
  if (parts[0] !== '/addy-auto') return undefined;
  if (parts[1] === 'stop') return undefined;
  return validAutoModeArtifact(parts.slice(1).join(' ') || undefined);
}

function validAutoModeArtifact(
  artifact: string | undefined,
): string | undefined {
  if (!artifact) return undefined;
  const unquoted = unquoteArgument(artifact);
  if (!unquoted) return undefined;
  return /\.md$/i.test(unquoted) ? artifact : undefined;
}

function applyAutoModeEvent(
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState | undefined {
  const text = event.text ?? event.command ?? '';
  if (!/^\/addy-auto(?:\s|$)/.test(text.trim())) return undefined;

  const lastTrigger = event.text ?? event.command ?? event.agentName;
  if (/^\/addy-auto\s+stop\b/.test(text.trim())) {
    return {
      ...state,
      autoMode: false,
      autoLastPrompt: undefined,
      autoRetryKey: undefined,
      autoRetryCount: undefined,
      autoFreshPrompt: undefined,
      autoFreshExpandedPrompt: undefined,
      autoFreshReason: undefined,
      autoFreshDeliveryKey: undefined,
      autoFreshConsumedKey: undefined,
      autoReviewFixKey: undefined,
      autoReviewFixCount: undefined,
      autoReviewFindingFingerprint: undefined,
      autoReviewFixNeedsReview: undefined,
      autoReviewTask: undefined,
      autoReviewTaskIndex: undefined,
      lastTrigger,
    };
  }

  const pendingFresh =
    state.autoFreshPrompt && state.autoFreshReason
      ? {
          autoFreshPrompt: state.autoFreshPrompt,
          autoFreshExpandedPrompt: state.autoFreshExpandedPrompt,
          autoFreshReason: state.autoFreshReason,
          autoFreshDeliveryKey: state.autoFreshDeliveryKey,
          autoFreshConsumedKey: state.autoFreshConsumedKey,
        }
      : {
          autoFreshPrompt: undefined,
          autoFreshExpandedPrompt: undefined,
          autoFreshReason: undefined,
          autoFreshDeliveryKey: undefined,
          autoFreshConsumedKey: undefined,
        };
  return {
    ...state,
    autoMode: true,
    autoLastPrompt: undefined,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    ...pendingFresh,
    autoReviewFixKey: undefined,
    autoReviewFixCount: undefined,
    autoReviewFindingFingerprint: undefined,
    autoReviewFixNeedsReview: undefined,
    autoReviewTask: undefined,
    autoReviewTaskIndex: undefined,
    activePlan:
      validAutoModeArtifact(event.artifact) ??
      autoModeArtifactFromText(text) ??
      state.activePlan,
    lastTrigger,
    lastArtifact: event.artifact ?? state.lastArtifact,
  };
}

function exitAutoMode(state: WorkflowState): WorkflowState {
  return {
    ...state,
    autoMode: false,
    autoLastPrompt: undefined,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
    autoFreshConsumedKey: undefined,
    autoReviewFixKey: undefined,
    autoReviewFixCount: undefined,
    autoReviewFindingFingerprint: undefined,
    autoReviewFixNeedsReview: undefined,
    autoReviewTask: undefined,
    autoReviewTaskIndex: undefined,
  };
}

function applyActiveArtifact(
  state: WorkflowState,
  event: WorkflowEvent,
  target: WorkflowPhase,
): WorkflowState {
  const artifact = event.artifact ?? artifactFromText(event.text);
  if (!artifact) return state;

  const normalized = artifact.replace(/\\/g, '/');
  const targetFromArtifact = fileWriteTargetPhase(normalized, state.current);
  const commandName = commandNameFromText(event.text);

  if (event.source === 'file-write') {
    if (targetFromArtifact === 'define')
      return { ...state, activeSpec: artifact };
    if (targetFromArtifact === 'plan')
      return { ...state, activePlan: artifact };
    return state;
  }

  if (targetFromArtifact === 'plan') return { ...state, activePlan: artifact };
  if (targetFromArtifact === 'define' || target === 'plan')
    return { ...state, activeSpec: artifact };
  if (
    target === 'define' &&
    (commandName !== '/addy-define' || isLikelySpecArgument(artifact))
  )
    return { ...state, activeSpec: unquoteArgument(artifact) };
  if (phaseIndex(target) > phaseIndex('plan'))
    return { ...state, activePlan: artifact };

  return state;
}

function skippedPhaseWarningConfirmed(
  event: WorkflowEvent,
  target: WorkflowPhase,
  skippedPhases: WorkflowPhase[],
): boolean {
  if (event.skipConfirmed) return true;
  if (skippedPhases.length === 0) return true;

  const confirmed = event.confirmedSkippedPhases ?? [];
  if (skippedPhases.every((phase) => confirmed.includes(phase))) return true;

  const text = `${event.text ?? ''} ${event.command ?? ''}`;
  if (/--skip-workflow-warning-confirmed\b/.test(text)) return true;
  if (
    target === 'review' &&
    skippedPhases.includes('verify') &&
    /--skip-verify-confirmed\b/.test(text)
  )
    return true;
  if (target === 'finish' && /--skip-missing-steps-confirmed\b/.test(text))
    return true;

  return false;
}

export function resolveTargetPhase(
  event: WorkflowEvent,
  current?: WorkflowPhase,
): WorkflowPhase | undefined {
  const text = event.text ?? '';

  if (event.source === 'user-input' || event.source === 'command') {
    const workflowNext = text
      .trim()
      .match(
        /^\/addy-workflow-next\s+(define|plan|build|simplify|verify|review|finish)\b/,
      );
    if (workflowNext) return workflowNext[1] as WorkflowPhase;
    const commandName = commandNameFromText(text);
    if (commandName === '/addy-code-simplify') return 'simplify';
    if (commandName === '/addy-define') return 'define';
    if (commandName === '/addy-plan') return 'plan';
    if (commandName === '/addy-build') return 'build';
    if (commandName === '/addy-verify') return 'verify';
    if (commandName === '/addy-review') return 'review';
    if (commandName === '/addy-finish') return 'finish';
  }

  if (event.source === 'file-write' && event.artifact)
    return fileWriteTargetPhase(event.artifact, current);

  if (event.source === 'tool-result' && event.success !== false) {
    const command = event.command ?? text;
    if (/\b(test|vitest|jest|node --test|npm test|pnpm test)\b/i.test(command))
      return 'verify';
  }

  if (event.source === 'subagent-call') {
    if (
      event.agentName === 'addy-reviewer' ||
      event.agentName === 'addy-spec-reviewer'
    )
      return 'review';
  }

  return undefined;
}

export function transitionWorkflow(
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState {
  const autoModeState = applyAutoModeEvent(state, event);
  if (autoModeState) return autoModeState;

  const commandName = commandNameFromText(event.text ?? event.command);
  const manualAddyCommand =
    event.manualAddyCommand ||
    (event.source === 'command' && commandName !== undefined);
  const baseState = manualAddyCommand ? exitAutoMode(state) : state;

  const target = resolveTargetPhase(event, baseState.current);
  if (!target) return baseState;

  const current = baseState.current;
  if (current === target) {
    return applyActiveArtifact(
      completeSpecAndPlanAfterPlanning(
        {
          ...baseState,
          warnings: [],
          lastTrigger: event.text ?? event.command ?? event.agentName,
          lastArtifact: event.artifact ?? baseState.lastArtifact,
          testStatus:
            target === 'verify' && event.source === 'tool-result'
              ? event.success === false
                ? 'failed'
                : 'detected'
              : baseState.testStatus,
        },
        target,
      ),
      event,
      target,
    );
  }

  const next = completeSpecAndPlanAfterPlanning(
    createInitialWorkflowState(),
    target,
  );
  const warnings: string[] = [];
  const targetIndex = phaseIndex(target);

  for (const phase of WORKFLOW_PHASES) {
    const index = phaseIndex(phase);
    if (index < targetIndex && baseState.phases[phase] === 'complete')
      next.phases[phase] = 'complete';
  }

  if (current && phaseIndex(target) > phaseIndex(current))
    next.phases[current] = 'complete';

  const skippedPhases = skippedEnforcedPhases(baseState, target, next);
  if (skippedPhases.length > 0)
    warnings.push(`${target} started before ${skippedPhases.join(' and ')}.`);

  if (
    current &&
    warnings.length > 0 &&
    (target === 'review' || target === 'finish') &&
    !skippedPhaseWarningConfirmed(event, target, skippedPhases)
  ) {
    return applyActiveArtifact(
      {
        ...baseState,
        warnings,
        lastTrigger: event.text ?? event.command ?? event.agentName,
        lastArtifact: event.artifact ?? baseState.lastArtifact,
      },
      event,
      target,
    );
  }

  next.current = target;
  next.phases[target] = 'active';
  next.warnings = warnings;
  next.activeSpec = baseState.activeSpec;
  next.activePlan = baseState.activePlan;
  next.activeSuitePlan = baseState.activeSuitePlan;
  next.stats = baseState.stats;
  next.autoMode = baseState.autoMode;
  next.autoLastPrompt = baseState.autoLastPrompt;
  next.autoRetryKey = baseState.autoRetryKey;
  next.autoRetryCount = baseState.autoRetryCount;
  next.autoFreshPrompt = baseState.autoFreshPrompt;
  next.autoFreshExpandedPrompt = baseState.autoFreshExpandedPrompt;
  next.autoFreshReason = baseState.autoFreshReason;
  next.autoFreshDeliveryKey = baseState.autoFreshDeliveryKey;
  next.autoFreshConsumedKey = baseState.autoFreshConsumedKey;
  next.autoReviewFixKey = baseState.autoReviewFixKey;
  next.autoReviewFixCount = baseState.autoReviewFixCount;
  next.autoReviewFindingFingerprint = baseState.autoReviewFindingFingerprint;
  next.autoReviewFixNeedsReview = baseState.autoReviewFixNeedsReview;
  next.autoReviewTask = baseState.autoReviewTask;
  next.autoReviewTaskIndex = baseState.autoReviewTaskIndex;
  next.reviewStatsKey = baseState.reviewStatsKey;
  next.reviewStatsAgent = baseState.reviewStatsAgent;
  next.lastTrigger = event.text ?? event.command ?? event.agentName;
  next.lastArtifact = event.artifact;
  next.testStatus =
    target === 'verify' && event.source === 'tool-result'
      ? event.success === false
        ? 'failed'
        : 'detected'
      : baseState.testStatus;

  return applyActiveArtifact(next, event, target);
}
