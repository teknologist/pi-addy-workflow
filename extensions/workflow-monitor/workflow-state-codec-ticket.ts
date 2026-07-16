import { isAbsolute } from 'node:path';
import {
  isTicketCommitEvidence,
  isTicketTerminalEvidence,
} from './ticket-finish-evidence.ts';
import {
  ticketAutoWorkflowActionKey,
  ticketOperationFromPrompt,
  ticketPendingActionMatches,
} from './auto-action-keys.ts';
import { exitAutoModeControlUpdates } from './workflow-state-control.ts';
import type {
  TicketOperation,
  TicketRecoveryState,
  TicketRunState,
  WorkflowState,
} from './workflow-core.ts';

const SOURCE_KINDS = ['github', 'linear', 'local'] as const;
const SELECTOR_KINDS = ['default', 'label', 'status'] as const;
const OPERATIONS = [
  'select',
  'claim',
  'build',
  'simplify',
  'verify',
  'review',
  'fix-all',
  'finish',
  'status',
  'release',
  'reclaim',
  'add-repository',
  'repository-scope-approval',
] as const;
const OUTCOMES = ['succeeded', 'reconciled', 'blocked', 'failed'] as const;
const FINISH_STAGES = [
  'repository-evidence',
  'final-activity',
  'terminal-transition',
  'terminal-refetch',
] as const;
const COMPLETED_PHASES = [
  'build',
  'simplify',
  'verify',
  'review',
  'fix-all',
  'finish',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || nonEmptyString(value);
}

function boundedLine(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\r\n]/.test(value)
  );
}

function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

export function isTicketSourceKind(
  value: unknown,
): value is TicketRunState['source']['kind'] {
  return oneOf(value, SOURCE_KINDS);
}

export function isTicketOperation(value: unknown): value is TicketOperation {
  return oneOf(value, OPERATIONS);
}

export function coerceTicketRun(value: unknown): TicketRunState | undefined {
  if (
    !record(value) ||
    !exactKeys(
      value,
      ['schemaVersion', 'source', 'runId', 'lifecycle', 'repositoryScope'],
      [
        'claim',
        'repositoryRoot',
        'revision',
        'queueSelector',
        'activityMarker',
        'pendingClarification',
        'pendingScopeRequest',
        'lastValidatedResult',
      ],
    ) ||
    value.schemaVersion !== 1 ||
    !record(value.source) ||
    !exactKeys(value.source, ['kind', 'ref']) ||
    !isTicketSourceKind(value.source.kind) ||
    !nonEmptyString(value.source.ref) ||
    !nonEmptyString(value.runId) ||
    (value.repositoryRoot !== undefined &&
      (!nonEmptyString(value.repositoryRoot) ||
        !isAbsolute(value.repositoryRoot))) ||
    !Array.isArray(value.repositoryScope) ||
    value.repositoryScope.length === 0 ||
    !value.repositoryScope.every(nonEmptyString)
  )
    return undefined;

  if (value.claim !== undefined) {
    if (
      !record(value.claim) ||
      !exactKeys(value.claim, ['id', 'owner', 'claimedAt']) ||
      !nonEmptyString(value.claim.id) ||
      !nonEmptyString(value.claim.owner) ||
      !nonEmptyString(value.claim.claimedAt)
    )
      return undefined;
  }
  if (!optionalString(value.revision) || !optionalString(value.activityMarker))
    return undefined;
  if (value.queueSelector !== undefined) {
    if (
      !record(value.queueSelector) ||
      !exactKeys(value.queueSelector, ['kind', 'value']) ||
      !oneOf(value.queueSelector.kind, SELECTOR_KINDS) ||
      !nonEmptyString(value.queueSelector.value)
    )
      return undefined;
  }
  if (
    !record(value.lifecycle) ||
    !exactKeys(
      value.lifecycle,
      ['implemented', 'verified', 'reviewed'],
      ['lastCompletedPhase'],
    ) ||
    typeof value.lifecycle.implemented !== 'boolean' ||
    typeof value.lifecycle.verified !== 'boolean' ||
    typeof value.lifecycle.reviewed !== 'boolean' ||
    (value.lifecycle.lastCompletedPhase !== undefined &&
      !oneOf(value.lifecycle.lastCompletedPhase, COMPLETED_PHASES))
  )
    return undefined;
  if (value.pendingClarification !== undefined) {
    if (
      !record(value.pendingClarification) ||
      !exactKeys(
        value.pendingClarification,
        ['kind', 'prompt'],
        ['resolution'],
      ) ||
      !oneOf(value.pendingClarification.kind, [
        'tracker-routing',
        'completion-transition',
      ] as const) ||
      !boundedLine(value.pendingClarification.prompt) ||
      (value.pendingClarification.resolution !== undefined &&
        !boundedLine(value.pendingClarification.resolution))
    )
      return undefined;
  }
  if (value.pendingScopeRequest !== undefined) {
    if (
      !record(value.pendingScopeRequest) ||
      !exactKeys(value.pendingScopeRequest, ['repository']) ||
      !nonEmptyString(value.pendingScopeRequest.repository)
    )
      return undefined;
  }
  if (value.lastValidatedResult !== undefined) {
    const result = value.lastValidatedResult;
    if (
      !record(result) ||
      !exactKeys(
        result,
        ['operation', 'outcome', 'actionKey', 'attempt'],
        [
          'revision',
          'claimId',
          'staleClaimId',
          'repository',
          'repositoryAppended',
          'manual',
          'pendingClarification',
          'reviewDisposition',
          'commitEvidence',
          'finishStage',
          'finishActivityKind',
          'terminal',
        ],
      ) ||
      !isTicketOperation(result.operation) ||
      !oneOf(result.outcome, OUTCOMES) ||
      !nonEmptyString(result.actionKey) ||
      !Number.isSafeInteger(result.attempt) ||
      (result.attempt as number) < 0 ||
      !optionalString(result.revision) ||
      !optionalString(result.claimId) ||
      (result.operation === 'reclaim') !== nonEmptyString(result.staleClaimId)
    )
      return undefined;
    if (
      (result.manual !== undefined ||
        result.pendingClarification !== undefined) &&
      (result.manual !== true ||
        !record(result.pendingClarification) ||
        !exactKeys(
          result.pendingClarification,
          ['kind', 'prompt'],
          ['resolution'],
        ) ||
        !oneOf(result.pendingClarification.kind, [
          'tracker-routing',
          'completion-transition',
        ] as const) ||
        !boundedLine(result.pendingClarification.prompt) ||
        (result.pendingClarification.resolution !== undefined &&
          !boundedLine(result.pendingClarification.resolution)))
    )
      return undefined;
    const repositoryOperation =
      result.operation === 'add-repository' ||
      result.operation === 'repository-scope-approval';
    const legacyPendingRepository =
      result.operation === 'add-repository' &&
      result.repository === undefined &&
      record(value.pendingScopeRequest) &&
      nonEmptyString(value.pendingScopeRequest.repository)
        ? value.pendingScopeRequest.repository
        : undefined;
    const repository = result.repository ?? legacyPendingRepository;
    const repositoryAppended =
      result.repositoryAppended ??
      (legacyPendingRepository
        ? false
        : repositoryOperation
          ? (result.outcome === 'succeeded' ||
              result.outcome === 'reconciled') &&
            value.repositoryScope.at(-1) === repository
          : undefined);
    if (
      repositoryOperation !== nonEmptyString(repository) ||
      repositoryOperation !== (typeof repositoryAppended === 'boolean') ||
      (repositoryAppended === true &&
        ((result.outcome !== 'succeeded' && result.outcome !== 'reconciled') ||
          value.repositoryScope.at(-1) !== repository))
    )
      return undefined;
    if (result.reviewDisposition !== undefined) {
      const disposition = result.reviewDisposition;
      if (
        result.operation !== 'review' ||
        !record(disposition) ||
        (disposition.status === 'clean'
          ? !exactKeys(disposition, ['status'])
          : disposition.status === 'findings'
            ? !exactKeys(disposition, ['status', 'count']) ||
              !Number.isSafeInteger(disposition.count) ||
              (disposition.count as number) <= 0
            : true)
      )
        return undefined;
    }
    const finishResult = result.operation === 'finish';
    const successfulFinish =
      finishResult &&
      (result.outcome === 'succeeded' || result.outcome === 'reconciled');
    const commitEvidence = result.commitEvidence;
    const validCommitEvidence =
      Array.isArray(commitEvidence) &&
      commitEvidence.length > 0 &&
      commitEvidence.every(isTicketCommitEvidence);
    const evidenceRepositories = validCommitEvidence
      ? commitEvidence.map((entry) => entry.repository)
      : [];
    const evidenceMatchesScope =
      validCommitEvidence &&
      new Set(evidenceRepositories).size === evidenceRepositories.length &&
      evidenceRepositories.every((repository) =>
        (value.repositoryScope as string[]).includes(repository),
      );
    const terminal = result.terminal;
    const validTerminal = isTicketTerminalEvidence(terminal);
    const finishActivityKind = oneOf(result.finishActivityKind, [
      'failure',
      'final',
    ] as const)
      ? result.finishActivityKind
      : undefined;
    const finishStage = oneOf(result.finishStage, FINISH_STAGES)
      ? result.finishStage
      : undefined;
    const finishStageIndex = finishStage
      ? FINISH_STAGES.indexOf(finishStage)
      : -1;
    const expectedTerminal =
      value.source.kind === 'github'
        ? 'closed'
        : value.source.kind === 'local'
          ? 'resolved'
          : 'completed';
    if (
      (result.finishStage !== undefined &&
        (!finishResult || !oneOf(result.finishStage, FINISH_STAGES))) ||
      (result.finishActivityKind !== undefined &&
        (!finishResult || !finishActivityKind)) ||
      (finishResult &&
        finishStageIndex >= 1 &&
        finishActivityKind !== 'final') ||
      (finishResult &&
        finishStageIndex === 0 &&
        finishActivityKind === 'final') ||
      (terminal !== undefined && !finishResult) ||
      (commitEvidence !== undefined &&
        (!finishResult || !validCommitEvidence || !evidenceMatchesScope)) ||
      (finishResult && !finishStage) ||
      (finishResult &&
        finishStageIndex >= 1 &&
        (!value.lifecycle.implemented ||
          !value.lifecycle.verified ||
          !value.lifecycle.reviewed ||
          !validCommitEvidence ||
          commitEvidence.length !== value.repositoryScope.length)) ||
      (finishResult && finishStageIndex === 0 && terminal !== undefined) ||
      (successfulFinish &&
        (!value.lifecycle.implemented ||
          !value.lifecycle.verified ||
          !value.lifecycle.reviewed ||
          !validCommitEvidence ||
          commitEvidence.length !== value.repositoryScope.length ||
          new Set(commitEvidence.map((entry) => entry.repository)).size !==
            commitEvidence.length ||
          !value.repositoryScope.every((repository) =>
            commitEvidence.some((entry) => entry.repository === repository),
          ) ||
          finishStage !== 'terminal-refetch' ||
          !validTerminal ||
          terminal.state !== expectedTerminal)) ||
      (!successfulFinish && terminal !== undefined && !validTerminal)
    )
      return undefined;
  }
  if (value.lastValidatedResult !== undefined) {
    const result = value.lastValidatedResult as Record<string, unknown>;
    const repositoryOperation =
      result.operation === 'add-repository' ||
      result.operation === 'repository-scope-approval';
    if (repositoryOperation) {
      const legacyRepository =
        result.repository ??
        (record(value.pendingScopeRequest)
          ? value.pendingScopeRequest.repository
          : undefined);
      return {
        ...value,
        lastValidatedResult: {
          ...result,
          repository: legacyRepository,
          repositoryAppended:
            result.repositoryAppended ??
            (result.repository === undefined
              ? false
              : (result.outcome === 'succeeded' ||
                  result.outcome === 'reconciled') &&
                value.repositoryScope.at(-1) === legacyRepository),
        },
      } as TicketRunState;
    }
  }
  return value as TicketRunState;
}

function coerceRecovery(value: unknown): TicketRecoveryState | undefined {
  if (
    !record(value) ||
    !exactKeys(value, ['possibleClaim', 'reason'], ['ticketRef']) ||
    value.possibleClaim !== true ||
    !nonEmptyString(value.reason) ||
    !optionalString(value.ticketRef)
  )
    return undefined;
  return value as TicketRecoveryState;
}

function possibleTicketRef(value: unknown): string | undefined {
  if (!record(value)) return undefined;
  if (record(value.source) && nonEmptyString(value.source.ref))
    return value.source.ref;
  if (nonEmptyString(value.ticketRef)) return value.ticketRef;
  return undefined;
}

export function coerceTicketHistory(
  value: unknown,
): TicketRunState[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const history = value.map(coerceTicketRun);
  return history.every(
    (run): run is TicketRunState =>
      run?.lastValidatedResult?.operation === 'finish' &&
      (run.lastValidatedResult.outcome === 'succeeded' ||
        run.lastValidatedResult.outcome === 'reconciled'),
  )
    ? history
    : undefined;
}

export function hasTicketAssociation(value: unknown): boolean {
  if (!record(value)) return false;
  return Boolean(
    value.executionSource === 'ticket' ||
    value.ticketRun !== undefined ||
    value.ticketRecovery !== undefined ||
    (record(value.autoPendingAction) &&
      value.autoPendingAction.executionSource === 'ticket'),
  );
}

function withRecoveryWarning(
  warnings: string[],
  recovery: TicketRecoveryState,
): string[] {
  const warning = ticketRecoveryWarning(recovery);
  return warnings.includes(warning) ? warnings : [warning, ...warnings];
}

function ticketPendingActionMatchesRun(
  state: WorkflowState,
  run: TicketRunState,
): boolean {
  const pending = state.autoPendingAction;
  if (!pending) return true;
  if (pending.executionSource !== 'ticket') return false;

  return (
    ticketPendingActionMatches(pending, run, pending.operation) &&
    ticketOperationFromPrompt(pending.prompt) === pending.operation &&
    pending.key ===
      ticketAutoWorkflowActionKey(
        {
          source: 'ticket',
          sourceKind: pending.sourceKind,
          ticketRef: pending.ticketRef,
          runId: pending.runId,
          claimId: pending.claimId,
          staleClaimId: pending.staleClaimId,
          selector: pending.selector,
          repository: pending.repository,
        },
        pending.operation,
        pending.attemptMarker,
      )
  );
}

export function coerceTicketExecution(
  candidate: Record<string, unknown>,
  base: WorkflowState,
): WorkflowState | undefined {
  const hasTicketData =
    candidate.ticketRun !== undefined || candidate.ticketRecovery !== undefined;
  if (
    candidate.ticketRun !== undefined &&
    candidate.ticketRecovery !== undefined
  )
    return corruptTicketExecution(candidate, base);
  if (
    candidate.executionSource !== undefined &&
    candidate.executionSource !== 'plan' &&
    candidate.executionSource !== 'ticket'
  )
    return hasTicketData ? corruptTicketExecution(candidate, base) : undefined;
  if (candidate.executionSource === 'plan')
    return hasTicketData ? corruptTicketExecution(candidate, base) : base;
  if (candidate.executionSource !== 'ticket')
    return hasTicketData ? corruptTicketExecution(candidate, base) : base;

  const ticketRun = coerceTicketRun(candidate.ticketRun);
  if (ticketRun) {
    if (!ticketPendingActionMatchesRun(base, ticketRun))
      return corruptTicketExecution(candidate, base);
    return {
      ...base,
      executionSource: 'ticket',
      ticketRun,
      ticketRecovery: undefined,
    };
  }
  const recovery = coerceRecovery(candidate.ticketRecovery);
  if (candidate.ticketRun === undefined && recovery)
    return {
      ...base,
      executionSource: 'ticket',
      ticketRun: undefined,
      ticketRecovery: recovery,
      warnings: withRecoveryWarning(base.warnings, recovery),
    };
  if (
    candidate.ticketRun === undefined &&
    candidate.ticketRecovery === undefined &&
    base.autoPendingAction?.executionSource === 'ticket' &&
    ['select', 'status', 'claim'].includes(base.autoPendingAction.operation)
  )
    return { ...base, executionSource: 'ticket' };
  return corruptTicketExecution(candidate, base);
}

export function ticketRecoveryWarning(recovery: TicketRecoveryState): string {
  const ref = recovery.ticketRef ? ` ${recovery.ticketRef}` : '';
  return `Addy Ticket state${ref} is corrupt and may own a live claim. Use /addy-ticket status${ref} and repair or release the claim before switching execution source.`;
}

export function corruptTicketExecution(
  candidate: Record<string, unknown>,
  base: WorkflowState,
): WorkflowState {
  const ticketRef =
    possibleTicketRef(candidate.ticketRun) ??
    possibleTicketRef(candidate.ticketRecovery) ??
    possibleTicketRef(candidate.autoPendingAction);
  const recovery: TicketRecoveryState = {
    possibleClaim: true,
    reason: 'Persisted Ticket state failed strict validation.',
    ...(ticketRef ? { ticketRef } : {}),
  };
  return {
    ...base,
    ...exitAutoModeControlUpdates(),
    executionSource: 'ticket',
    ticketRun: undefined,
    ticketRecovery: recovery,
    warnings: withRecoveryWarning(base.warnings, recovery),
  };
}
