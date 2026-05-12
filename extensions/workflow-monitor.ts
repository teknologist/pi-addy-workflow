import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getContextWorkflowState, handleWorkflowEvent, initializeWorkflowWidget, openNextWorkflowPrompt, resetWorkflow, setContextWorkflowState } from "./workflow-monitor/workflow-handler.ts";
import { WORKFLOW_PHASES, type WorkflowPhase } from "./workflow-monitor/workflow-transitions.ts";
import { nextPromptForActivePlanLifecycle } from "./workflow-monitor/workflow-tracker.ts";

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

function phaseFromWorkflowPrompt(prompt: string): WorkflowPhase | undefined {
  const command = prompt.trim().split(/\s+/, 1)[0];
  if (command === "/addy-code-simplify") return "simplify";
  if (command === "/addy-define") return "define";
  if (command === "/addy-plan") return "plan";
  if (command === "/addy-build") return "build";
  if (command === "/addy-verify") return "verify";
  if (command === "/addy-review") return "review";
  if (command === "/addy-finish") return "finish";
  return undefined;
}

function sendUserMessage(pi: ExtensionAPI, ctx: unknown, message: string): void {
  const sender = (pi as ExtensionAPI & { sendUserMessage?: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void }).sendUserMessage;
  if (!sender) {
    (ctx as { ui?: { setEditorText?: (text: string) => void; notify?: (message: string, level?: string) => void } }).ui?.setEditorText?.(message);
    (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(`Prefilled ${message}; submit it to continue Addy auto.`, "info");
    return;
  }

  const isIdle = (ctx as { isIdle?: () => boolean }).isIdle?.() ?? true;
  if (isIdle) sender(message);
  else sender(message, { deliverAs: "followUp" });
}

function autoRetryKey(state: ReturnType<typeof getContextWorkflowState>, prompt: string): string {
  return [prompt, state.activePlan ?? "", state.currentTaskIndex ?? "", state.currentTask ?? "", state.nextTask ?? ""].join("\u001f");
}

function dispatchNextAutoWorkflowPrompt(pi: ExtensionAPI, ctx: unknown, allowSamePhase = false): void {
  const workflowCtx = ctx as never;
  const state = getContextWorkflowState(workflowCtx);
  setContextWorkflowState(workflowCtx, state, appendWorkflowEntry(pi));
  const refreshedState = getContextWorkflowState(workflowCtx);
  const prompt = nextPromptForActivePlanLifecycle(refreshedState, (ctx as { cwd?: string }).cwd);
  if (!prompt) {
    (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.("Addy auto is active, but no active plan is available.", "warning");
    return;
  }

  const phase = phaseFromWorkflowPrompt(prompt);
  const retryKey = autoRetryKey(refreshedState, prompt);
  const isSameIncompletePhase = phase && phase === refreshedState.current;
  const retryCount = refreshedState.autoRetryKey === retryKey ? refreshedState.autoRetryCount ?? 0 : 0;
  if (!allowSamePhase && isSameIncompletePhase && retryCount >= 1) {
    (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(`Addy auto paused at ${prompt}; the current lifecycle step is still incomplete after retry.`, "warning");
    return;
  }

  setContextWorkflowState(workflowCtx, {
    ...refreshedState,
    autoLastPrompt: prompt,
    autoRetryKey: retryKey,
    autoRetryCount: isSameIncompletePhase ? retryCount + 1 : 0,
  }, appendWorkflowEntry(pi));

  sendUserMessage(pi, ctx, prompt);
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

  pi.on("agent_end", async (_event: unknown, ctx: unknown) => {
    const state = getContextWorkflowState(ctx as never);
    if (!state.autoMode) return;
    dispatchNextAutoWorkflowPrompt(pi, ctx);
  });

  pi.registerCommand?.("addy-auto", {
    description: "Run the Addy build, verify, review, and finish loop for the active plan.",
    handler: async (event: CommandEvent, ctx: unknown) => {
      const args = parseCommandArgs(event);
      const text = `/addy-auto${args.length ? ` ${args.join(" ")}` : ""}`;

      handleWorkflowEvent(ctx as never, {
        source: "command",
        text,
        artifact: args[0] === "stop" ? undefined : args.join(" ") || undefined,
      }, appendWorkflowEntry(pi));

      if (args[0] !== "stop") dispatchNextAutoWorkflowPrompt(pi, ctx, true);
      return { action: "continue" as const };
    },
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
