export const TICKET_COMMAND_USAGE =
  'Use --ticket <ticket-ref> without positional arguments, /addy-auto --tickets [--label <label>], or /addy-ticket claim|status|release|reclaim <ticket-ref>.';

export type TicketLifecycleCommand =
  | '/addy-build'
  | '/addy-code-simplify'
  | '/addy-verify'
  | '/addy-review'
  | '/addy-fix-all'
  | '/addy-finish';

export type TicketQueueSelector = {
  kind: 'default' | 'label' | 'status';
  value: string;
};

export const DEFAULT_TICKET_QUEUE_SELECTOR: TicketQueueSelector = {
  kind: 'default',
  value: 'unbound',
};

export type TicketCommandIntent =
  | {
      kind: 'plan-lifecycle';
      command: TicketLifecycleCommand;
      artifact?: string;
    }
  | {
      kind: 'ticket-lifecycle';
      command: TicketLifecycleCommand;
      ticketRef: string;
      claim: 'create' | 'required';
    }
  | { kind: 'plan-auto'; artifact?: string }
  | { kind: 'auto-stop' }
  | { kind: 'ticket-queue'; selector: TicketQueueSelector }
  | { kind: 'plan-stats'; planPath?: string; all?: true }
  | { kind: 'ticket-stats'; ticketRef: string }
  | {
      kind: 'ticket-management';
      operation: 'claim' | 'status' | 'release' | 'reclaim';
      ticketRef: string;
    }
  | {
      kind: 'ticket-management';
      operation: 'add-repository';
      ticketRef: string;
      repository: string;
    }
  | { kind: 'error'; message: string };

export const TICKET_LIFECYCLE_COMMANDS = new Set<TicketLifecycleCommand>([
  '/addy-build',
  '/addy-code-simplify',
  '/addy-verify',
  '/addy-review',
  '/addy-fix-all',
  '/addy-finish',
]);

function error(): TicketCommandIntent {
  return { kind: 'error', message: TICKET_COMMAND_USAGE };
}

function optionValue(value: string | undefined): value is string {
  return Boolean(value && !value.startsWith('--'));
}

function parseLifecycle(
  command: TicketLifecycleCommand,
  args: string[],
): TicketCommandIntent {
  const ticketIndex = args.indexOf('--ticket');
  if (ticketIndex === -1) {
    if (args.some((arg) => arg.startsWith('--'))) return error();
    return {
      kind: 'plan-lifecycle',
      command,
      ...(args.length ? { artifact: args.join(' ') } : {}),
    };
  }
  if (ticketIndex !== 0 || args.length !== 2 || !optionValue(args[1]))
    return error();
  return {
    kind: 'ticket-lifecycle',
    command,
    ticketRef: args[1],
    claim: command === '/addy-build' ? 'create' : 'required',
  };
}

function parseAuto(args: string[]): TicketCommandIntent {
  if (args[0] === 'stop')
    return args.length === 1 ? { kind: 'auto-stop' } : error();
  if (!args.includes('--tickets')) {
    if (args.some((arg) => arg.startsWith('--'))) return error();
    return {
      kind: 'plan-auto',
      ...(args.length ? { artifact: args.join(' ') } : {}),
    };
  }
  if (args.filter((arg) => arg === '--tickets').length !== 1) return error();
  const remaining = args.filter((arg) => arg !== '--tickets');
  if (remaining.length === 0)
    return { kind: 'ticket-queue', selector: DEFAULT_TICKET_QUEUE_SELECTOR };
  if (
    remaining.length === 2 &&
    remaining[0] === '--label' &&
    optionValue(remaining[1])
  )
    return {
      kind: 'ticket-queue',
      selector: { kind: 'label', value: remaining[1] },
    };
  return error();
}

function parseStats(args: string[]): TicketCommandIntent {
  if (args[0] === '--ticket')
    return args.length === 2 && optionValue(args[1])
      ? { kind: 'ticket-stats', ticketRef: args[1] }
      : error();
  if (args.length === 1 && args[0] === '--all')
    return { kind: 'plan-stats', all: true };
  if (args.some((arg) => arg.startsWith('--'))) return error();
  return {
    kind: 'plan-stats',
    ...(args.length ? { planPath: args.join(' ') } : {}),
  };
}

function parseManagement(args: string[]): TicketCommandIntent {
  const [operation, ticketRef, repository] = args;
  if (
    (operation === 'claim' ||
      operation === 'status' ||
      operation === 'release' ||
      operation === 'reclaim') &&
    args.length === 2 &&
    optionValue(ticketRef)
  )
    return { kind: 'ticket-management', operation, ticketRef };
  if (
    operation === 'add-repository' &&
    args.length === 3 &&
    optionValue(ticketRef) &&
    optionValue(repository)
  )
    return {
      kind: 'ticket-management',
      operation,
      ticketRef,
      repository,
    };
  return error();
}

export function parseTicketCommand(
  command: string,
  args: string[],
): TicketCommandIntent {
  if (TICKET_LIFECYCLE_COMMANDS.has(command as TicketLifecycleCommand))
    return parseLifecycle(command as TicketLifecycleCommand, args);
  if (command === '/addy-auto') return parseAuto(args);
  if (command === '/addy-stats') return parseStats(args);
  if (command === '/addy-ticket') return parseManagement(args);
  return error();
}
