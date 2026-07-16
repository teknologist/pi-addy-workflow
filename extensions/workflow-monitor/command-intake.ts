import { FRESH_CONTEXT_STEP_COMMANDS } from './command-router.ts';
import {
  commandFromArgs,
  parseAutoFreshReason,
  parseCommandArgs,
  type CommandEvent,
} from './workflow-host-events.ts';
import {
  WORKFLOW_PHASES,
  type AutoFreshReason,
  type WorkflowPhase,
} from './workflow-transitions.ts';
import {
  parseTicketCommand,
  TICKET_COMMAND_USAGE,
  type TicketCommandIntent,
} from './ticket-command.ts';

export const AUTO_CONTINUE_USAGE =
  'Usage: /addy-auto-continue --fresh <between-tasks|before-step|before-review>';

export const WORKFLOW_NEXT_USAGE =
  'Usage: /addy-workflow-next <define|plan|build|simplify|verify|review|finish> [artifact]';

export function registeredFreshStepCommandNames(): string[] {
  return FRESH_CONTEXT_STEP_COMMANDS.map((command) => command.slice(1));
}

function commandArgs(event: CommandEvent): string[] | undefined {
  try {
    return parseCommandArgs(event);
  } catch {
    return undefined;
  }
}

export function planFreshStepCommand(
  command: string,
  event: CommandEvent,
):
  | {
      kind: 'run';
      input: string;
      intent?: Exclude<TicketCommandIntent, { kind: 'error' }>;
      workflowEvent: {
        source: 'command';
        text: string;
        manualAddyCommand: true;
      };
    }
  | { kind: 'warn'; message: string } {
  const args = commandArgs(event);
  if (!args) return { kind: 'warn', message: TICKET_COMMAND_USAGE };
  const intent =
    command === '/addy-define' || command === '/addy-plan'
      ? undefined
      : parseTicketCommand(command, args);
  if (intent?.kind === 'error')
    return { kind: 'warn', message: intent.message };
  const input =
    intent?.kind === 'ticket-lifecycle'
      ? commandFromArgs(command, args)
      : `${command}${args.length ? ` ${args.join(' ')}` : ''}`;
  return {
    kind: 'run',
    input,
    ...(intent ? { intent } : {}),
    workflowEvent: { source: 'command', text: input, manualAddyCommand: true },
  };
}

export function planAutoContinueCommand(
  event: CommandEvent,
):
  | { kind: 'run'; reason: AutoFreshReason }
  | { kind: 'warn'; message: string } {
  const reason = parseAutoFreshReason(event);
  return reason
    ? { kind: 'run', reason }
    : { kind: 'warn', message: AUTO_CONTINUE_USAGE };
}

export function planStatsCommand(event: CommandEvent): TicketCommandIntent {
  const args = commandArgs(event);
  return args
    ? parseTicketCommand('/addy-stats', args)
    : { kind: 'error', message: TICKET_COMMAND_USAGE };
}

export function planTicketManagementCommand(
  event: CommandEvent,
): TicketCommandIntent {
  const args = commandArgs(event);
  return args
    ? parseTicketCommand('/addy-ticket', args)
    : { kind: 'error', message: TICKET_COMMAND_USAGE };
}

function isWorkflowPhase(value: string | undefined): value is WorkflowPhase {
  return WORKFLOW_PHASES.includes(value as WorkflowPhase);
}

export function planWorkflowNextCommand(event: CommandEvent):
  | {
      kind: 'open';
      phase: WorkflowPhase;
      artifact?: string;
      workflowEvent: { source: 'command'; text: string; artifact?: string };
    }
  | { kind: 'warn'; message: string } {
  const args = commandArgs(event);
  if (!args) return { kind: 'warn', message: WORKFLOW_NEXT_USAGE };
  const [phase, ...artifactParts] = args;
  if (!isWorkflowPhase(phase))
    return { kind: 'warn', message: WORKFLOW_NEXT_USAGE };

  const artifact = artifactParts.join(' ') || undefined;
  return {
    kind: 'open',
    phase,
    artifact,
    workflowEvent: {
      source: 'command',
      text: `/addy-workflow-next ${phase}`,
      artifact,
    },
  };
}
