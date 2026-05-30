import {
  extractWriteArtifact,
  subagentNameFromEvent,
  type SubagentEvent,
  type ToolCallEvent,
  type ToolEvent,
} from './workflow-host-events.ts';

export type PlannedWorkflowEvent =
  | {
      source: 'tool-result';
      text?: string;
      command?: string;
      success?: boolean;
      artifact?: string;
    }
  | { source: 'file-write'; artifact: string }
  | { source: 'subagent-call'; agentName?: string };

export function planToolResultEvent(event: ToolEvent): PlannedWorkflowEvent {
  return {
    source: 'tool-result',
    text: event.text,
    command: event.command,
    success: event.success,
    artifact: event.artifact,
  };
}

export function planToolCallEvent(
  event: ToolCallEvent,
): PlannedWorkflowEvent | undefined {
  const artifact = extractWriteArtifact(event);
  return artifact ? { source: 'file-write', artifact } : undefined;
}

export function planSubagentStartEvent(
  event: SubagentEvent,
): PlannedWorkflowEvent {
  return {
    source: 'subagent-call',
    agentName: subagentNameFromEvent(event),
  };
}
