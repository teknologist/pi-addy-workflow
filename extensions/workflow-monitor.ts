import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getContextWorkflowState, handleWorkflowEvent, initializeWorkflowWidget, openNextWorkflowPrompt, resetWorkflow, setContextWorkflowState } from "./workflow-monitor/workflow-handler.ts";
import { WORKFLOW_PHASES, type WorkflowPhase } from "./workflow-monitor/workflow-transitions.ts";
import { nextWorkflowActionForActivePlanLifecycle } from "./workflow-monitor/workflow-tracker.ts";

type CommandEvent = string | { args?: string[]; input?: string };
type InputEvent = { input?: string; text?: string };
type ToolEvent = { command?: string; text?: string; success?: boolean; artifact?: string };
type ToolCallEvent = { toolName?: string; name?: string; input?: Record<string, unknown> };
type SubagentEvent = { agent?: string; agentName?: string };
type AgentEndEvent = { messages?: AgentMessage[]; message?: AgentMessage };
type AgentMessage = { role?: string; content?: unknown };
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));

const PROMPT_TEMPLATE_BY_COMMAND: Record<string, string> = {
  "/addy-build": "addy-build.md",
  "/addy-code-simplify": "addy-code-simplify.md",
  "/addy-verify": "addy-verify.md",
  "/addy-review": "addy-review.md",
  "/addy-fix-all": "addy-fix-all.md",
  "/addy-finish": "addy-finish.md",
};
const AUTO_REVIEW_FIX_MAX = 5;
const AUTO_TASK_COMMIT_PROMPT = "__addy-auto-task-commit__";

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

function parseTemplateArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const char of argsString) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else current += char;
  }
  if (current) args.push(current);
  return args;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

function substituteTemplateArgs(content: string, args: string[]): string {
  let result = content.replace(/\$(\d+)/g, (_match, rawIndex: string) => args[Number.parseInt(rawIndex, 10) - 1] ?? "");
  result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_match, rawStart: string, rawLength: string | undefined) => {
    const start = Math.max(0, Number.parseInt(rawStart, 10) - 1);
    if (rawLength) return args.slice(start, start + Number.parseInt(rawLength, 10)).join(" ");
    return args.slice(start).join(" ");
  });
  const allArgs = args.join(" ");
  return result.replace(/\$ARGUMENTS/g, allArgs).replace(/\$@/g, allArgs);
}

function expandPackagedPromptTemplate(prompt: string): string {
  const trimmed = prompt.trim();
  const [command] = trimmed.split(/\s+/, 1);
  const templateName = PROMPT_TEMPLATE_BY_COMMAND[command];
  if (!templateName) return prompt;

  try {
    const argsString = trimmed.slice(command.length).trim();
    const template = stripFrontmatter(readFileSync(join(PACKAGE_ROOT, "..", "prompts", templateName), "utf8"));
    const expanded = substituteTemplateArgs(template, parseTemplateArgs(argsString)).trimEnd();
    return `${expanded}\n\nInvocation: \`${prompt}\``;
  } catch {
    return prompt;
  }
}

function workflowTextFromInput(text: string): string {
  return text.match(/^Invocation:\s+`([^`]+)`\s*$/m)?.[1] ?? text;
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

function commandFromPrompt(prompt: string | undefined): string | undefined {
  const invocation = prompt?.match(/^Invocation:\s+`([^`]+)`\s*$/m)?.[1];
  return (invocation ?? prompt)?.trim().split(/\s+/, 1)[0];
}

function activePlanPrompt(command: string, state: ReturnType<typeof getContextWorkflowState>): string | undefined {
  return state.activePlan ? `${command} ${state.activePlan}` : undefined;
}

function textFromMessage(message: AgentMessage | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part) => (typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function latestAssistantText(event: AgentEndEvent): string {
  const messages = event.messages ?? (event.message ? [event.message] : []);
  return textFromMessage([...messages].reverse().find((message) => message.role === "assistant") ?? messages.at(-1));
}

function agentTextReportsCommitComplete(text: string): boolean {
  return /\bCOMMIT:\s*[0-9a-f]{7,40}\b/i.test(text) || /\b(no changes to commit|nothing to commit|working tree clean)\b/i.test(text);
}

function reviewTextHasActionableFindings(text: string): boolean {
  return reviewFindingLines(text).length > 0;
}

function reviewFindingsFingerprint(text: string): string {
  const normalized = reviewFindingLines(text).join("\n") || text.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function reviewFindingLines(text: string): string[] {
  let inActionableSection = false;
  return text
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => {
      if (!line) return false;
      if (/\b[\w./-]+:\d+\b/.test(line) || /\b(blocking issue|blocker|must fix|should fix)\b/.test(line)) return !reviewLineIsEmptyFinding(line);

      const heading = reviewActionableSectionHeading(line);
      if (heading) {
        inActionableSection = true;
        const inlineFinding = heading.inlineFinding;
        return Boolean(inlineFinding && !reviewLineIsEmptyFinding(inlineFinding));
      }
      if (reviewAnySectionHeading(line)) {
        inActionableSection = false;
        return false;
      }
      return inActionableSection && !reviewLineIsEmptyFinding(line);
    });
}

function reviewActionableSectionHeading(line: string): { inlineFinding: string } | undefined {
  const match = line.match(/^(?:#+\s*)?(?:\*\*)?(critical issues?|important issues?|warnings?|suggestions?)(?:\*\*)?\s*:?\s*(.*)$/i);
  return match ? { inlineFinding: match[2]?.trim() ?? "" } : undefined;
}

function reviewAnySectionHeading(line: string): boolean {
  return /^(?:#+\s*)?(?:\*\*)?[a-z][\w\s-]{0,40}(?:\*\*)?\s*:?[\s]*$/i.test(line);
}

function reviewLineIsEmptyFinding(line: string): boolean {
  return /^(?:[-*•]|\d+\.)?\s*(?:none|none found|n\/a|no issues(?: found)?|no findings|no actionable (?:issues|findings)|critical issues?: none|warnings?: none|suggestions?: none)\.?$/i.test(line);
}

function reviewFixKey(state: ReturnType<typeof getContextWorkflowState>): string {
  return [state.activePlan ?? "", state.currentTaskIndex ?? "", state.currentTask ?? ""].join("\u001f");
}

function reviewedTaskWasCompleted(previousState: ReturnType<typeof getContextWorkflowState>, state: ReturnType<typeof getContextWorkflowState>): boolean {
  if (!previousState.activePlan || !state.activePlan) return false;
  if (!previousState.currentTask || previousState.currentTask === "none" || previousState.currentTask === "all tasks complete") return false;
  if (!previousState.currentTaskIndex || !previousState.taskCount) return false;

  return state.activePlan !== previousState.activePlan
    || state.currentTask !== previousState.currentTask
    || state.currentTaskIndex !== previousState.currentTaskIndex
    || state.taskCount !== previousState.taskCount;
}

function autoTaskCommitPrompt(state: ReturnType<typeof getContextWorkflowState>): string {
  const task = state.currentTask && state.currentTask !== "none" ? state.currentTask : "the completed task";
  const plan = state.activePlan ? `Plan: ${state.activePlan}` : "Plan: active Addy workflow plan";
  return [
    "# Addy Auto Commit",
    "",
    "The current task has Implemented, Verified, and Reviewed checked. Commit the completed task work now, without asking the user for confirmation.",
    "",
    plan,
    `Completed task: ${task}`,
    "",
    "Required steps:",
    "1. Inspect `git status --short`.",
    "2. If there are no changes, say `No changes to commit` and stop.",
    "3. Stage all current changed files for this completed task, including the plan checkbox update.",
    "4. Inspect the staged diff.",
    "5. Create one concise git commit for the completed task.",
    "6. Report the commit hash in the form `COMMIT: <hash>`.",
    "",
    "Do not call ask_user_question. Do not start the next task yourself; Addy auto will continue after this commit turn ends.",
    "",
    `Invocation: \`${AUTO_TASK_COMMIT_PROMPT}\``,
  ].join("\n");
}

function sendUserMessage(pi: ExtensionAPI, ctx: unknown, message: string): void {
  const expandedMessage = expandPackagedPromptTemplate(message);
  const sender = (pi as ExtensionAPI & { sendUserMessage?: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void }).sendUserMessage;
  if (!sender) {
    (ctx as { ui?: { setEditorText?: (text: string) => void; notify?: (message: string, level?: string) => void } }).ui?.setEditorText?.(expandedMessage);
    (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(`Prefilled ${message}; submit it to continue Addy auto.`, "info");
    return;
  }

  const isIdle = (ctx as { isIdle?: () => boolean }).isIdle?.() ?? true;
  if (isIdle) sender(expandedMessage);
  else sender(expandedMessage, { deliverAs: "followUp" });
}

function autoRetryKey(state: ReturnType<typeof getContextWorkflowState>, prompt: string): string {
  return [prompt, state.activePlan ?? "", state.currentTaskIndex ?? "", state.currentTask ?? "", state.nextTask ?? ""].join("\u001f");
}

function autoPauseWarning(prompt: string, action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>): string {
  const missing = action?.missingStatuses?.join(", ");
  const task = action?.taskTitle ? ` Task: ${action.taskTitle}.` : "";
  const missingText = missing ? ` Missing: ${missing}.` : "";
  return `Addy auto paused at ${prompt}; the current lifecycle step is still incomplete after retry.${task}${missingText} Re-run the step after fixing the work, or update the plan checkbox only if that phase is actually complete.`;
}

function dispatchAutoPrompt(pi: ExtensionAPI, ctx: unknown, prompt: string, state: ReturnType<typeof getContextWorkflowState>, updates: Partial<ReturnType<typeof getContextWorkflowState>> = {}): void {
  const workflowCtx = ctx as never;
  setContextWorkflowState(workflowCtx, {
    ...state,
    autoLastPrompt: prompt,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    ...updates,
  }, appendWorkflowEntry(pi));
  sendUserMessage(pi, ctx, prompt);
}

function maybeDispatchReviewFixLoop(pi: ExtensionAPI, ctx: unknown, event: AgentEndEvent, state: ReturnType<typeof getContextWorkflowState>, action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>): boolean {
  const lastCommand = commandFromPrompt(state.autoLastPrompt);

  if (lastCommand === "/addy-fix-all") {
    const verifyPrompt = activePlanPrompt("/addy-verify", state);
    if (!verifyPrompt) return false;
    dispatchAutoPrompt(pi, ctx, verifyPrompt, state, { autoReviewFixNeedsReview: true });
    return true;
  }

  if (lastCommand === "/addy-verify" && state.autoReviewFixNeedsReview) {
    const reviewPrompt = activePlanPrompt("/addy-review", state);
    if (!reviewPrompt) return false;
    dispatchAutoPrompt(pi, ctx, reviewPrompt, state, { autoReviewFixNeedsReview: false });
    return true;
  }

  if (lastCommand !== "/addy-review") return false;

  const reviewText = latestAssistantText(event);
  const hasActionableFindings = reviewTextHasActionableFindings(reviewText);
  const cleanReviewNeedsPlanSync = Boolean(
    reviewText.trim()
    && !hasActionableFindings
    && commandFromPrompt(action?.prompt) === "/addy-review"
    && action?.missingStatuses?.includes("Reviewed")
    && action?.taskTitle
    && state.currentTask === action.taskTitle,
  );
  if (!hasActionableFindings && !cleanReviewNeedsPlanSync) return false;

  const key = reviewFixKey(state);
  const fixCount = state.autoReviewFixKey === key ? state.autoReviewFixCount ?? 0 : 0;
  const fingerprint = cleanReviewNeedsPlanSync ? reviewFindingsFingerprint(`Reviewed checkbox still unchecked for ${key}.`) : reviewFindingsFingerprint(reviewText);
  const notify = (message: string) => (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(message, "warning");

  if (fixCount > 0 && state.autoReviewFindingFingerprint === fingerprint) {
    notify(`Addy auto paused after /addy-review; the same review finding repeated after a fix attempt. Task: ${action?.taskTitle ?? "current task"}.`);
    return true;
  }

  if (fixCount >= AUTO_REVIEW_FIX_MAX) {
    notify(`Addy auto paused after ${AUTO_REVIEW_FIX_MAX} review fix loops for this task. Task: ${action?.taskTitle ?? "current task"}.`);
    return true;
  }

  const fixPrompt = activePlanPrompt("/addy-fix-all", state);
  if (!fixPrompt) return false;
  dispatchAutoPrompt(pi, ctx, fixPrompt, state, {
    autoReviewFixKey: key,
    autoReviewFixCount: fixCount + 1,
    autoReviewFindingFingerprint: fingerprint,
  });
  return true;
}

function maybeDispatchTaskCommit(pi: ExtensionAPI, ctx: unknown, previousState: ReturnType<typeof getContextWorkflowState>, state: ReturnType<typeof getContextWorkflowState>, action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>): boolean {
  if (commandFromPrompt(previousState.autoLastPrompt) !== "/addy-review") return false;
  if (commandFromPrompt(action?.prompt) === "/addy-review") return false;
  if (!reviewedTaskWasCompleted(previousState, state)) return false;

  dispatchAutoPrompt(pi, ctx, autoTaskCommitPrompt(previousState), state, {
    autoLastPrompt: AUTO_TASK_COMMIT_PROMPT,
  });
  return true;
}

function maybeContinueAfterTaskCommit(pi: ExtensionAPI, ctx: unknown, event: AgentEndEvent, state: ReturnType<typeof getContextWorkflowState>): boolean {
  if (commandFromPrompt(state.autoLastPrompt) !== AUTO_TASK_COMMIT_PROMPT) return false;

  const text = latestAssistantText(event);
  if (!agentTextReportsCommitComplete(text)) {
    (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(
      "Addy auto paused after the task commit step; the commit result was unclear. Commit or clean the worktree, then rerun /addy-auto.",
      "warning",
    );
    return true;
  }

  dispatchNextAutoWorkflowPrompt(pi, ctx);
  return true;
}

function dispatchNextAutoWorkflowPrompt(pi: ExtensionAPI, ctx: unknown, allowSamePhase = false): void {
  const workflowCtx = ctx as never;
  const state = getContextWorkflowState(workflowCtx);
  setContextWorkflowState(workflowCtx, state, appendWorkflowEntry(pi));
  const refreshedState = getContextWorkflowState(workflowCtx);
  const action = nextWorkflowActionForActivePlanLifecycle(refreshedState, (ctx as { cwd?: string }).cwd);
  const prompt = action?.prompt;
  if (!prompt) {
    (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.("Addy auto is active, but no active plan is available.", "warning");
    return;
  }

  const phase = phaseFromWorkflowPrompt(prompt);
  const retryKey = autoRetryKey(refreshedState, prompt);
  const isSameIncompletePhase = phase && phase === refreshedState.current;
  const retryCount = refreshedState.autoRetryKey === retryKey ? refreshedState.autoRetryCount ?? 0 : 0;
  if (!allowSamePhase && isSameIncompletePhase && retryCount >= 1) {
    (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(autoPauseWarning(prompt, action), "warning");
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

function dispatchNextAutoWorkflowPromptAfterAgentEnd(pi: ExtensionAPI, ctx: unknown, event: AgentEndEvent): void {
  const workflowCtx = ctx as never;
  const state = getContextWorkflowState(workflowCtx);
  if (maybeContinueAfterTaskCommit(pi, ctx, event, state)) return;
  setContextWorkflowState(workflowCtx, state, appendWorkflowEntry(pi));
  const refreshedState = getContextWorkflowState(workflowCtx);
  const action = nextWorkflowActionForActivePlanLifecycle(refreshedState, (ctx as { cwd?: string }).cwd);
  if (maybeDispatchReviewFixLoop(pi, ctx, event, refreshedState, action)) return;
  if (maybeDispatchTaskCommit(pi, ctx, state, refreshedState, action)) return;
  dispatchNextAutoWorkflowPrompt(pi, ctx);
}

export default function addyWorkflowMonitor(pi: ExtensionAPI) {
  pi.on("session_start", async (_event: unknown, ctx: unknown) => {
    initializeWorkflowWidget(ctx as never);
  });

  pi.on("input", async (event: InputEvent, ctx: unknown) => {
    handleWorkflowEvent(ctx as never, { source: "user-input", text: workflowTextFromInput(event.input ?? event.text ?? "") }, appendWorkflowEntry(pi));
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

  pi.on("agent_end", async (event: AgentEndEvent, ctx: unknown) => {
    const state = getContextWorkflowState(ctx as never);
    if (!state.autoMode) return;
    dispatchNextAutoWorkflowPromptAfterAgentEnd(pi, ctx, event);
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
