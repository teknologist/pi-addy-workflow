import type { TicketRunState } from './workflow-core.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type TicketClarification = NonNullable<TicketRunState['pendingClarification']>;
type PendingTicketClarification = Omit<TicketClarification, 'resolution'>;

function bounded(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !/[\r\n]/.test(value);
}

function updateClarification(
  state: WorkflowState,
  pendingClarification: TicketClarification | undefined,
): WorkflowState {
  if (!state.ticketRun)
    throw new Error('Ticket clarification requires an active Ticket run.');
  const { pendingClarification: _previous, ...ticketRun } = state.ticketRun;
  return {
    ...state,
    ticketRun: {
      ...ticketRun,
      ...(pendingClarification ? { pendingClarification } : {}),
    },
  };
}

export function setTicketClarification(
  state: WorkflowState,
  clarification: PendingTicketClarification,
): WorkflowState {
  if (!bounded(clarification.prompt))
    throw new Error('Ticket clarification prompt must be one bounded line.');
  return updateClarification(state, clarification);
}

export function resolveTicketClarification(
  state: WorkflowState,
  resolution: string,
): WorkflowState {
  const clarification = state.ticketRun?.pendingClarification;
  if (!clarification)
    throw new Error('No pending Ticket clarification to resolve.');
  if (!bounded(resolution))
    throw new Error(
      'Ticket clarification resolution must be one bounded line.',
    );
  return updateClarification(state, { ...clarification, resolution });
}

export function clearTicketClarification(state: WorkflowState): WorkflowState {
  return state.ticketRun?.pendingClarification
    ? updateClarification(state, undefined)
    : state;
}
