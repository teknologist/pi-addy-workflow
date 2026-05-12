import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleWorkflowEvent, initializeWorkflowWidget, openNextWorkflowPrompt, resetWorkflow } from "./workflow-monitor/workflow-handler.ts";
import { WORKFLOW_PHASES, type WorkflowPhase } from "./workflow-monitor/workflow-transitions.ts";

type CommandEvent = string | { args?: string[]; input?: string };
type InputEvent = { input?: string; text?: string };
type ToolEvent = { command?: string; text?: string; success?: boolean; artifact?: string };
type ToolCallEvent = { toolName?: string; name?: string; input?: Record<string, unknown> };
type SubagentEvent = { agent?: string; agentName?: string };

function isWorkflowPhase(value: string | undefined): value is WorkflowPhase {
  return WORKFLOW_PHASES.includes(value as WorkflowPhase);
}

function appendWorkflowEntry(pi: ExtensionAPI) {
  return (type: string, data: unknown) => pi.appendEntry?.(type, data);
}

function parseCommandArgs(event: CommandEvent): string[] {
  if (typeof event === "string") return event.split(/\s+/).filter(Boolean);
  return event.args ?? event.input?.split(/\s+/).filter(Boolean) ?? [];
}

function extractWriteArtifact(event: ToolCallEvent): string | undefined {
  const toolName = event.toolName ?? event.name ?? "";
  const input = event.input ?? {};
  if (!["write", "edit", "multi_edit", "obsidian_obsidian_append_content", "obsidian_obsidian_patch_content"].includes(toolName)) return undefined;

  for (const key of ["path", "file_path", "filepath"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }

  return undefined;
}

export default function addyWorkflowMonitor(pi: ExtensionAPI) {
  pi.on("session_start", async (_event: unknown, ctx: unknown) => {
    initializeWorkflowWidget(ctx as never);
  });

  pi.on("input", async (event: InputEvent, ctx: unknown) => {
    handleWorkflowEvent(ctx as never, { source: "user-input", text: event.input ?? event.text ?? "" }, appendWorkflowEntry(pi));
    return { action: "continue" as const };
  });

  pi.on("tool_result", async (event: ToolEvent, ctx: unknown) => {
    handleWorkflowEvent(ctx as never, {
      source: "tool-result",
      text: event.text,
      command: event.command,
      success: event.success,
      artifact: event.artifact,
    }, appendWorkflowEntry(pi));
  });

  pi.on("tool_call", async (event: ToolCallEvent, ctx: unknown) => {
    const artifact = extractWriteArtifact(event);
    if (!artifact) return;
    handleWorkflowEvent(ctx as never, {
      source: "file-write",
      artifact,
    }, appendWorkflowEntry(pi));
  });

  pi.on("before_agent_start", async (event: SubagentEvent, ctx: unknown) => {
    handleWorkflowEvent(ctx as never, {
      source: "subagent-call",
      agentName: event.agentName ?? event.agent,
    }, appendWorkflowEntry(pi));
  });

  pi.registerCommand?.("addy-workflow-reset", {
    description: "Reset Addy workflow state and clear the widget.",
    handler: async (_event: CommandEvent, ctx: unknown) => {
      resetWorkflow(ctx as never, appendWorkflowEntry(pi));
      return { action: "continue" as const };
    },
  });

  pi.registerCommand?.("addy-workflow-next", {
    description: "Open an Addy workflow prompt for a requested phase.",
    handler: async (event: CommandEvent, ctx: unknown) => {
      const [phase, ...artifactParts] = parseCommandArgs(event);
      if (!isWorkflowPhase(phase)) {
      (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(
        "Usage: /addy-workflow-next <define|plan|build|simplify|verify|review|finish> [artifact]",
        "warning",
      );
        return { action: "continue" as const };
      }

      handleWorkflowEvent(ctx as never, {
        source: "command",
        text: `/addy-workflow-next ${phase}`,
        artifact: artifactParts.join(" ") || undefined,
      }, appendWorkflowEntry(pi));
      openNextWorkflowPrompt(ctx as never, phase, artifactParts.join(" ") || undefined);
      return { action: "continue" as const };
    },
  });
}
