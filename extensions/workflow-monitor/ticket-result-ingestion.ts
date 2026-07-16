import {
  currentAutoWorkflowActionKey,
  ticketOperationFromPrompt,
  ticketOperationIdentityFromPrompt,
} from './auto-action-keys.ts';
import {
  extractTicketResultEnvelope,
  queuePauseSummary,
  type TicketPhaseResult,
  type TicketResultExpectation,
} from './ticket-phase-result.ts';
import type {
  TicketOperation,
  TicketRunState,
  WorkflowTicketPendingAction,
} from './workflow-core.ts';
import { exitAutoModeControlUpdates } from './workflow-state-control.ts';
import type { WorkflowState } from './workflow-transitions.ts';

export type TicketResultIngestion = {
  state: WorkflowState;
  status: 'none' | 'accepted' | 'duplicate' | 'rejected';
  outcome?: TicketPhaseResult['outcome'];
};

function numericAttempt(marker: string): number | undefined {
  const match = /(?:^|\u001f)attempt-(\d+)$/.exec(marker);
  return match ? Number(match[1]) : undefined;
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
    ...(pending.staleClaimId ? { staleClaimId: pending.staleClaimId } : {}),
    ...(pending.selector ? { selector: pending.selector } : {}),
    ...(pending.repository ? { repository: pending.repository } : {}),
    previousLifecycle: state.ticketRun?.lifecycle,
    previousRepositoryScope: state.ticketRun?.repositoryScope,
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
          last.operation === 'repository-scope-approval' && last.repository
            ? run.repositoryScope.slice(0, -1)
            : run.repositoryScope,
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
  const expected = expectationFromState(state);
  if (!expected) return { state, status: 'none' };
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
  if (
    duplicateRun &&
    lastResult?.actionKey === parsed.actionKey &&
    lastResult.attempt === parsed.attempt
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
    const stopped =
      parsed.outcome === 'blocked' || parsed.outcome === 'failed'
        ? {
            autoMode: false,
            autoPausedReason: `ticket-operation-${parsed.outcome}` as const,
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
  const {
    claim: _previousClaim,
    pendingScopeRequest: previousScopeRequest,
    ...runWithoutClaim
  } = run;
  const completed =
    parsed.outcome === 'succeeded' || parsed.outcome === 'reconciled';
  const phase = completed ? completedPhase(parsed.operation) : undefined;
  const pendingScopeRequest =
    completed && parsed.operation === 'add-repository' && expected.repository
      ? { repository: expected.repository }
      : completed && parsed.operation === 'repository-scope-approval'
        ? undefined
        : previousScopeRequest;
  const stopped =
    parsed.outcome === 'blocked' || parsed.outcome === 'failed'
      ? {
          autoMode: false,
          autoPausedReason: `ticket-operation-${parsed.outcome}` as const,
        }
      : completed && parsed.operation === 'finish'
        ? exitAutoModeControlUpdates()
        : {};
  return {
    state: {
      ...state,
      ...stopped,
      autoPendingAction: undefined,
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
          ...(parsed.operation === 'repository-scope-approval' &&
          parsed.repository
            ? { repository: parsed.repository }
            : {}),
          ...(parsed.reviewDisposition
            ? { reviewDisposition: parsed.reviewDisposition }
            : {}),
          ...(parsed.commitEvidence
            ? { commitEvidence: parsed.commitEvidence }
            : {}),
        },
      },
    },
    status: 'accepted',
    outcome: parsed.outcome,
  };
}
