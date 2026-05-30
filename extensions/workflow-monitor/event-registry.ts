import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { AgentEndEvent } from './agent-end-event.ts';
import {
  planSubagentStartEvent,
  planToolCallEvent,
  planToolResultEvent,
} from './event-intake.ts';
import {
  isStaleExtensionContextError,
  type InputEvent,
  type SubagentEvent,
  type ToolCallEvent,
  type ToolEvent,
} from './workflow-host-events.ts';
import type { AppendEntry } from './workflow-state-store.ts';

type EventRegistryDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  handleAgentEnd(
    pi: ExtensionAPI,
    ctx: unknown,
    event: AgentEndEvent,
  ): Promise<void>;
  handleInput(
    pi: ExtensionAPI,
    event: InputEvent,
    ctx: unknown,
  ): Promise<{ action: 'continue' }>;
  handleSessionStart(pi: ExtensionAPI, ctx: unknown): Promise<void>;
  handleWorkflowEvent(
    ctx: unknown,
    event: unknown,
    appendEntry?: AppendEntry,
  ): void;
};

export function registerWorkflowEvents(
  pi: ExtensionAPI,
  deps: EventRegistryDeps,
): void {
  pi.on('session_start', async (_event: unknown, ctx: unknown) => {
    await deps.handleSessionStart(pi, ctx);
  });

  pi.on('input', async (event: InputEvent, ctx: unknown) => {
    return deps.handleInput(pi, event, ctx);
  });

  pi.on('tool_result', (event: ToolEvent, ctx: unknown) => {
    deps.handleWorkflowEvent(
      ctx,
      planToolResultEvent(event),
      deps.appendEntry(pi),
    );
  });

  pi.on('tool_call', (event: ToolCallEvent, ctx: unknown) => {
    const plannedEvent = planToolCallEvent(event);
    if (!plannedEvent) return;
    deps.handleWorkflowEvent(ctx, plannedEvent, deps.appendEntry(pi));
  });

  pi.on('before_agent_start', (event: SubagentEvent, ctx: unknown) => {
    try {
      deps.handleWorkflowEvent(
        ctx,
        planSubagentStartEvent(event),
        deps.appendEntry(pi),
      );
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  });

  pi.on('agent_end', async (event: AgentEndEvent, ctx: unknown) => {
    try {
      await deps.handleAgentEnd(pi, ctx, event);
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  });
}
