import { workflowTextFromInput } from './command-router.ts';
import { tokenizeCommandLine } from './workflow-host-events.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import {
  parseTicketCommand,
  TICKET_LIFECYCLE_COMMANDS,
  type TicketLifecycleCommand,
} from './ticket-command.ts';

export function ticketStateBlocksReset(state: WorkflowState): boolean {
  return Boolean(state.ticketRun?.claim || state.ticketRecovery?.possibleClaim);
}

function managementCommandAllowed(
  ticketRef: string | undefined,
  command: string,
  args: string[],
): boolean {
  if (command !== '/addy-ticket') return false;
  const intent = parseTicketCommand(command, args);
  if (intent.kind !== 'ticket-management') return false;
  if (intent.operation === 'status') return true;
  if (
    !ticketRef &&
    (intent.operation === 'release' || intent.operation === 'reclaim')
  )
    return true;
  return intent.ticketRef === ticketRef;
}

function recoveryCommandAllowed(
  ticketRef: string | undefined,
  command: string,
  args: string[],
): boolean {
  if (command === '/addy-auto' && args.length === 1 && args[0] === 'stop')
    return true;
  const intent = parseTicketCommand(command, args);
  if (
    intent.kind !== 'ticket-management' ||
    !['status', 'release', 'reclaim'].includes(intent.operation)
  )
    return false;
  return (
    intent.operation === 'status' ||
    !ticketRef ||
    intent.ticketRef === ticketRef
  );
}

function activeTicketCommandAllowed(
  ticketRef: string,
  command: string,
  args: string[],
): boolean {
  if (
    recoveryCommandAllowed(ticketRef, command, args) ||
    managementCommandAllowed(ticketRef, command, args)
  )
    return true;
  if (TICKET_LIFECYCLE_COMMANDS.has(command as TicketLifecycleCommand)) {
    if (args.length === 0) return true;
    return args.length === 2 && args[0] === '--ticket' && args[1] === ticketRef;
  }
  return (
    command === '/addy-stats' &&
    args.length === 2 &&
    args[0] === '--ticket' &&
    args[1] === ticketRef
  );
}

export function ticketClaimSafetyWarning(
  state: WorkflowState,
  input: string,
): string | undefined {
  if (!ticketStateBlocksReset(state)) return undefined;
  let command = '/addy-invalid';
  let args: string[] = [];
  try {
    [command, ...args] = tokenizeCommandLine(
      workflowTextFromInput(input).trim(),
    );
  } catch {
    // A malformed command cannot be allowed through a live-claim guard.
  }
  if (!command.startsWith('/addy-')) return undefined;

  if (state.ticketRecovery?.possibleClaim) {
    const ref = state.ticketRecovery.ticketRef;
    if (recoveryCommandAllowed(ref, command, args)) return undefined;
    const status = ref
      ? `/addy-ticket status ${ref}`
      : '/addy-ticket status <ticket-ref>';
    return `Addy refused ${command}: corrupt Ticket state may own a live claim. Run ${status}; use release when safe, or perform manual repair before switching source, reset, planning, or shipping.`;
  }

  const ticketRef = state.ticketRun?.source.ref;
  if (!ticketRef || activeTicketCommandAllowed(ticketRef, command, args))
    return undefined;
  return `Addy refused ${command}: Ticket ${ticketRef} has a live claim. Run /addy-ticket status ${ticketRef} or /addy-ticket release ${ticketRef} before switching execution source, resetting, planning, or shipping.`;
}
