import { FRESH_CONTEXT_STEP_COMMANDS } from './command-router.ts';
import {
  parseAutoFreshReason,
  parseCommandArgs,
  type CommandEvent,
} from './workflow-host-events.ts';
import {
  WORKFLOW_PHASES,
  type AutoFreshReason,
  type WorkflowPhase,
} from './workflow-transitions.ts';

export const AUTO_CONTINUE_USAGE =
  'Usage: /addy-auto-continue --fresh <between-tasks|before-step|before-review>';

export const WORKFLOW_NEXT_USAGE =
  'Usage: /addy-workflow-next <define|plan|build|simplify|verify|review|finish> [artifact]';

export function registeredFreshStepCommandNames(): string[] {
  return FRESH_CONTEXT_STEP_COMMANDS.map((command) => command.slice(1));
}

export function planFreshStepCommand(
  command: string,
  event: CommandEvent,
): {
  input: string;
  workflowEvent: { source: 'command'; text: string; manualAddyCommand: true };
} {
  const args = parseCommandArgs(event);
  const input = `${command}${args.length ? ` ${args.join(' ')}` : ''}`;
  return {
    input,
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

export function planStatsCommand(event: CommandEvent): { planPath?: string } {
  const args = parseCommandArgs(event);
  return { planPath: args.join(' ') || undefined };
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
  const [phase, ...artifactParts] = parseCommandArgs(event);
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
