import {
  currentAutoWorkflowActionKey,
  ticketOperationFromPrompt,
  ticketOperationIdentityFromPrompt,
} from './auto-action-keys.ts';
import { sameTicketCommitEvidenceList } from './ticket-finish-evidence.ts';
import {
  extractTicketResultEnvelope,
  queuePauseSummary,
  type TicketPhaseResult,
  type TicketResultExpectation,
} from './ticket-phase-result.ts';
import {
  autoFreshContinuationKey,
  pendingAutoActionForPrompt,
} from './auto-control.ts';
import { buildTicketPrompt } from './ticket-prompt.ts';
import { commandFromArgs } from './workflow-host-events.ts';
import {
  clearTicketClarification,
  resolveTicketClarification,
  setTicketClarification,
} from './ticket-clarification.ts';
import { repositoryScopesFromMarkdown } from './repository-scope.ts';
import type {
  TicketOperation,
  TicketRunState,
  WorkflowTicketPendingAction,
} from './workflow-core.ts';
import { exitAutoModeControlUpdates } from './workflow-state-control.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import { recordValidatedTicketAttempt } from './workflow-stats.ts';

export type TicketResultIngestion = {
  state: WorkflowState;
  status: 'none' | 'accepted' | 'duplicate' | 'rejected';
  outcome?: TicketPhaseResult['outcome'];
};

function numericAttempt(marker: string): number | undefined {
  const match = /(?:^|\u001f)attempt-(\d+)$/.exec(marker);
  return match ? Number(match[1]) : undefined;
}

function finishFrontierExpectation(
  run: TicketRunState | undefined,
  operation: TicketOperation,
): Partial<TicketResultExpectation> {
  const last = run?.lastValidatedResult;
  return operation === 'finish' && last?.operation === 'finish'
    ? {
        previousCommitEvidence: last.commitEvidence,
        previousFinishStage: last.finishStage,
        previousFinishActivityKind: last.finishActivityKind,
      }
    : {};
}

function expectationFromPending(
  state: WorkflowState,
  pending: WorkflowTicketPendingAction,
): TicketResultExpectation {
  return {
    operation: pending.operation,
    actionKey: pending.key,
    attempt: numericAttempt(pending.attemptMarker) ?? pending.attempts,
    sourceKind: pending.sourceKind,
    ticketRef: pending.ticketRef,
    runId: pending.runId,
    ...(pending.claimId ? { claimId: pending.claimId } : {}),
    ...(state.ticketRun &&
    !['claim', 'release', 'reclaim'].includes(pending.operation)
      ? { claim: state.ticketRun.claim ?? null }
      : {}),
    ...(pending.staleClaimId ? { staleClaimId: pending.staleClaimId } : {}),
    ...(pending.selector ? { selector: pending.selector } : {}),
    ...(pending.repository ? { repository: pending.repository } : {}),
    previousLifecycle: state.ticketRun?.lifecycle,
    previousRepositoryScope: state.ticketRun?.repositoryScope,
    manual: !state.autoMode,
    pendingClarification: state.ticketRun?.pendingClarification,
    ...finishFrontierExpectation(state.ticketRun, pending.operation),
    ...(pending.operation === 'select'
      ? {
          excludedTickets: (state.ticketHistory ?? [])
            .filter((run) => run.queueDrainId === state.ticketQueue?.drainId)
            .map((run) => run.source),
        }
      : {}),
  };
}

function expectationFromLastResult(
  run: TicketRunState,
): TicketResultExpectation | undefined {
  const last = run.lastValidatedResult;
  return last
    ? {
        operation: last.operation,
        actionKey: last.actionKey,
        attempt: last.attempt,
        source: run.source,
        sourceKind: run.source.kind,
        ticketRef: run.source.ref,
        runId: run.runId,
        ...(last.claimId ? { claimId: last.claimId } : {}),
        ...(last.operation === 'reclaim'
          ? { staleClaimId: last.staleClaimId }
          : {}),
        claim: run.claim ?? null,
        outcome: last.outcome,
        ...(last.operation === 'select' && run.queueSelector
          ? { selector: run.queueSelector }
          : last.repository
            ? { repository: last.repository }
            : last.operation === 'add-repository' && run.pendingScopeRequest
              ? { repository: run.pendingScopeRequest.repository }
              : {}),
        previousLifecycle: run.lifecycle,
        previousRepositoryScope:
          last.repositoryAppended === true
            ? run.repositoryScope.slice(0, -1)
            : run.repositoryScope,
        ...(last.manual
          ? {
              manual: true,
              pendingClarification: last.pendingClarification,
            }
          : {}),
        ...finishFrontierExpectation(run, last.operation),
      }
    : undefined;
}

function expectationFromState(
  state: WorkflowState,
): TicketResultExpectation | undefined {
  if (state.executionSource !== 'ticket') return undefined;
  const pending = state.autoPendingAction;
  if (pending?.executionSource === 'ticket')
    return expectationFromPending(state, pending);

  const run = state.ticketRun;
  if (!run) return undefined;
  if (state.autoLastPrompt) {
    const operation = ticketOperationFromPrompt(state.autoLastPrompt);
    const actionKey = currentAutoWorkflowActionKey(state);
    const attempt = actionKey ? numericAttempt(actionKey) : undefined;
    if (operation && actionKey && attempt !== undefined)
      return {
        operation,
        actionKey,
        attempt,
        sourceKind: run.source.kind,
        ticketRef: run.source.ref,
        runId: run.runId,
        ...(operation === 'reclaim' && run.claim
          ? { staleClaimId: run.claim.id }
          : run.claim
            ? { claimId: run.claim.id }
            : {}),
        ...ticketOperationIdentityFromPrompt(
          state.autoLastPrompt,
          run,
          operation,
        ),
        previousLifecycle: run.lifecycle,
        previousRepositoryScope: run.repositoryScope,
        manual: !state.autoMode,
        pendingClarification: run.pendingClarification,
      };
  }

  return expectationFromLastResult(run);
}

function completedPhase(
  operation: TicketOperation,
):
  | 'build'
  | 'simplify'
  | 'verify'
  | 'review'
  | 'fix-all'
  | 'finish'
  | undefined {
  return [
    'build',
    'simplify',
    'verify',
    'review',
    'fix-all',
    'finish',
  ].includes(operation)
    ? (operation as
        | 'build'
        | 'simplify'
        | 'verify'
        | 'review'
        | 'fix-all'
        | 'finish')
    : undefined;
}

function rejected(state: WorkflowState, error: unknown): TicketResultIngestion {
  const warning = `Ticket result rejected: ${error instanceof Error ? error.message : String(error)}`;
  return {
    state: {
      ...state,
      warnings: state.warnings.includes(warning)
        ? state.warnings
        : [...state.warnings, warning],
    },
    status: 'rejected',
  };
}

export function ingestTicketResult(
  state: WorkflowState,
  text: string,
  repositoryRoot?: string,
): TicketResultIngestion {
  const baseExpectation = expectationFromState(state);
  if (!baseExpectation) return { state, status: 'none' };
  const repositoryScopeRoot = repositoryRoot ?? state.ticketRun?.repositoryRoot;
  const expected: TicketResultExpectation =
    baseExpectation.operation === 'claim' &&
    !state.ticketRun?.claim &&
    repositoryScopeRoot
      ? {
          ...baseExpectation,
          initialRepositoryScope: repositoryScopesFromMarkdown(
            text,
            repositoryScopeRoot,
          ),
        }
      : baseExpectation;
  const hasEnvelope = text.includes('<!-- ADDY-TICKET-RESULT ');
  const pendingTicket = state.autoPendingAction?.executionSource === 'ticket';
  if (!hasEnvelope && !pendingTicket) return { state, status: 'none' };

  let parsed;
  try {
    parsed = extractTicketResultEnvelope(text);
  } catch (error) {
    return rejected(state, error);
  }
  const duplicateRun = state.ticketRun;
  const lastResult = duplicateRun?.lastValidatedResult;
  const continuingInterruptedFinish =
    parsed.kind === 'ticket-phase-result' &&
    parsed.operation === 'finish' &&
    (lastResult?.outcome === 'failed' || lastResult?.outcome === 'blocked') &&
    state.autoPendingAction?.executionSource === 'ticket' &&
    state.autoPendingAction.operation === 'finish';
  const sameFinishFrontier =
    parsed.kind === 'ticket-phase-result' &&
    parsed.outcome === lastResult?.outcome &&
    parsed.finishStage === lastResult.finishStage &&
    parsed.activity?.kind === lastResult.finishActivityKind &&
    sameTicketCommitEvidenceList(
      parsed.commitEvidence,
      lastResult.commitEvidence,
    );
  if (
    duplicateRun &&
    (!duplicateRun.pendingClarification ||
      (parsed.kind === 'ticket-phase-result' &&
        parsed.clarification?.resolution === undefined)) &&
    lastResult?.actionKey === parsed.actionKey &&
    lastResult.attempt === parsed.attempt &&
    (!continuingInterruptedFinish || sameFinishFrontier)
  ) {
    try {
      parsed = extractTicketResultEnvelope(
        text,
        expectationFromLastResult(duplicateRun),
      );
    } catch (error) {
      return rejected(state, error);
    }
    return { state, status: 'duplicate', outcome: parsed.outcome };
  }
  try {
    parsed = extractTicketResultEnvelope(text, expected);
  } catch (error) {
    return rejected(state, error);
  }

  if (parsed.kind === 'ticket-queue-result') {
    const queueComplete = parsed.terminalReason === 'empty';
    const clearExecutionSource =
      !parsed.selected &&
      !state.ticketRun &&
      !state.ticketRecovery &&
      !(
        state.autoPendingAction?.executionSource === 'ticket' &&
        state.autoPendingAction.operation === 'claim'
      );
    const stopped = !parsed.selected
      ? {
          ...exitAutoModeControlUpdates(),
          autoPausedReason: queueComplete
            ? undefined
            : parsed.terminalReason === 'configuration-ambiguous'
              ? ('configuration-ambiguous' as const)
              : (`ticket-operation-${parsed.outcome}` as const),
        }
      : {};
    if (parsed.selected && !expected.runId)
      return rejected(state, new Error('Selected Ticket run is missing.'));
    const selectedRun: TicketRunState | undefined = parsed.selected
      ? {
          schemaVersion: 1,
          source: parsed.selected.source,
          runId: expected.runId!,
          ...(repositoryRoot ? { repositoryRoot } : {}),
          queueSelector: parsed.selector,
          ...(state.ticketQueue
            ? { queueDrainId: state.ticketQueue.drainId }
            : {}),
          lifecycle: {
            implemented: false,
            verified: false,
            reviewed: false,
          },
          repositoryScope: ['.'],
          lastValidatedResult: {
            operation: 'select',
            outcome: parsed.outcome,
            actionKey: parsed.actionKey,
            attempt: parsed.attempt,
          },
        }
      : undefined;
    return {
      state: {
        ...state,
        ...stopped,
        ...(selectedRun ? { ticketRun: selectedRun } : {}),
        ...(clearExecutionSource ? { executionSource: undefined } : {}),
        autoPendingAction: undefined,
        autoLastPrompt: undefined,
        warnings: [...state.warnings, queuePauseSummary(parsed)],
      },
      status: 'accepted',
      outcome: parsed.outcome,
    };
  }

  const pending = state.autoPendingAction;
  const run: TicketRunState | undefined = state.ticketRun ?? {
    schemaVersion: 1 as const,
    source: parsed.source,
    runId:
      parsed.runId ??
      (pending?.executionSource === 'ticket' ? pending.runId : ''),
    ...(repositoryRoot ? { repositoryRoot } : {}),
    lifecycle: parsed.lifecycle,
    repositoryScope: parsed.repositoryScope,
  };
  if (!run?.runId) return rejected(state, new Error('Ticket run is missing.'));
  const runQueue =
    state.ticketQueue?.drainId === run.queueDrainId
      ? state.ticketQueue
      : undefined;
  const {
    claim: _previousClaim,
    pendingScopeRequest: previousScopeRequest,
    ...runWithoutClaim
  } = run;
  const completed =
    parsed.outcome === 'succeeded' || parsed.outcome === 'reconciled';
  const phase = completed ? completedPhase(parsed.operation) : undefined;
  const pendingScopeRequest =
    completed &&
    (parsed.operation === 'add-repository' ||
      parsed.operation === 'repository-scope-approval')
      ? undefined
      : previousScopeRequest;
  const stopped =
    parsed.outcome === 'blocked' || parsed.outcome === 'failed'
      ? {
          autoMode: false,
          autoPausedReason:
            parsed.blockedReason ??
            (`ticket-operation-${parsed.outcome}` as const),
        }
      : completed && parsed.operation === 'finish' && !runQueue
        ? exitAutoModeControlUpdates()
        : {};
  const retryInterruptedFinish = parsed.operation === 'finish' && !completed;
  let nextState: WorkflowState = {
    ...state,
    ...stopped,
    autoPendingAction: retryInterruptedFinish ? pending : undefined,
    autoLastPrompt: undefined,
    ticketRun: {
      ...runWithoutClaim,
      ...(parsed.claim ? { claim: parsed.claim } : {}),
      revision: parsed.postRevision,
      lifecycle: {
        ...parsed.lifecycle,
        ...(phase ? { lastCompletedPhase: phase } : {}),
      },
      repositoryScope: parsed.repositoryScope,
      ...(pendingScopeRequest ? { pendingScopeRequest } : {}),
      activityMarker: parsed.activity?.marker ?? run.activityMarker,
      lastValidatedResult: {
        operation: parsed.operation,
        outcome: parsed.outcome,
        actionKey: parsed.actionKey,
        attempt: parsed.attempt,
        revision: parsed.postRevision,
        ...(parsed.claimId ? { claimId: parsed.claimId } : {}),
        ...(parsed.staleClaimId ? { staleClaimId: parsed.staleClaimId } : {}),
        ...((parsed.operation === 'add-repository' ||
          parsed.operation === 'repository-scope-approval') &&
        parsed.repository
          ? {
              repository: parsed.repository,
              repositoryAppended: !expected.previousRepositoryScope?.includes(
                parsed.repository,
              ),
            }
          : {}),
        ...(parsed.reviewDisposition
          ? { reviewDisposition: parsed.reviewDisposition }
          : {}),
        ...(parsed.commitEvidence
          ? { commitEvidence: parsed.commitEvidence }
          : {}),
        ...(parsed.finishStage ? { finishStage: parsed.finishStage } : {}),
        ...(parsed.operation === 'finish' && parsed.activity?.kind
          ? { finishActivityKind: parsed.activity.kind }
          : {}),
        ...(parsed.terminal ? { terminal: parsed.terminal } : {}),
        ...(parsed.clarification
          ? {
              manual: true as const,
              pendingClarification: parsed.clarification,
            }
          : {}),
      },
    },
  };
  if (completed && phase) {
    nextState = recordValidatedTicketAttempt(
      nextState,
      { kind: 'ticket', source: parsed.source },
      {
        operation: parsed.operation,
        outcome: parsed.outcome,
        actionKey: parsed.actionKey,
        attempt: parsed.attempt,
        ...(parsed.reviewDisposition?.status === 'findings'
          ? { findings: parsed.reviewDisposition.count }
          : {}),
      },
      pending?.createdAt,
    );
  }
  if (parsed.clarification) {
    const { resolution, ...clarification } = parsed.clarification;
    nextState = setTicketClarification(nextState, clarification);
    if (resolution !== undefined)
      nextState = clearTicketClarification(
        resolveTicketClarification(nextState, resolution),
      );
  }
  if (completed && parsed.operation === 'finish') {
    const completedRun = nextState.ticketRun!;
    nextState = {
      ...nextState,
      executionSource: runQueue ? 'ticket' : undefined,
      ticketRun: undefined,
      ticketHistory: [...(state.ticketHistory ?? []), completedRun],
    };
    if (runQueue && state.autoMode) {
      const selector = runQueue.selector;
      const queuePrompt = commandFromArgs(
        '/addy-auto',
        selector.kind === 'default'
          ? ['--tickets']
          : ['--tickets', `--${selector.kind}`, selector.value],
      );
      const pending = pendingAutoActionForPrompt(
        queuePrompt,
        nextState,
        undefined,
        'next-action',
        '',
      );
      if (pending.executionSource !== 'ticket')
        throw new Error('Queue continuation did not produce a Ticket action.');
      const freshState = { ...nextState, autoPendingAction: pending };
      nextState = {
        ...freshState,
        autoFreshPrompt: queuePrompt,
        autoFreshExpandedPrompt: buildTicketPrompt({
          operation: 'select',
          selector: pending.selector,
          queueDrainId: runQueue.drainId,
          excludedTickets: (nextState.ticketHistory ?? [])
            .filter((run) => run.queueDrainId === runQueue.drainId)
            .map((run) => run.source),
          runId: pending.runId,
          actionKey: pending.key,
          attempt: numericAttempt(pending.attemptMarker) ?? pending.attempts,
        }),
        autoFreshReason: 'between-tasks',
        autoFreshDeliveryKey: autoFreshContinuationKey(
          queuePrompt,
          'between-tasks',
          freshState,
        ),
      };
    }
  }
  return {
    state: nextState,
    status: 'accepted',
    outcome: parsed.outcome,
  };
}
