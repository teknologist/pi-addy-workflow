import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveWorkflowStats, getContextWorkflowState, handleWorkflowEvent, initializeWorkflowWidget, openNextWorkflowPrompt, recordWorkflowReviewIssues, recordWorkflowReviewRun, recordWorkflowTaskTurn, resetWorkflow, setContextWorkflowState, type WorkflowStatsTarget } from "./workflow-monitor/workflow-handler.ts";
import { WORKFLOW_PHASES, type WorkflowIssueStats, type WorkflowPhase } from "./workflow-monitor/workflow-transitions.ts";
import { nextWorkflowActionForActivePlanLifecycle, renderWorkflowStatsText } from "./workflow-monitor/workflow-tracker.ts";

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

function appendAutoUnblockGuidance(message: string, command?: string): string {
  const fixAllGuidance = command === "/addy-fix-all" ? `

## Addy Auto Fix-All Handoff

This is an auto-dispatched fix pass. Fix only the surfaced review issues and run narrow validation for the changed scope. Do not invoke or perform \`/addy-verify\` or \`/addy-review\` inside this \`/addy-fix-all\` turn. When this turn ends, the Addy auto monitor will dispatch \`/addy-verify\` first, then \`/addy-review\`.` : "";

  return `${message}

## Addy Auto Mode Recovery

Addy Auto Mode is active. If this step blocks, repeats, or finds missing artifacts, use the Pi \`addy-auto-unblock\` skill before pausing. That skill must apply \`debugging-and-error-recovery\` to reproduce, classify, and safely fix scoped blockers.

Critical rule: do not skip, weaken, or silently reinterpret acceptance criteria, verification, or review. Only mark lifecycle checkboxes when there is real evidence from this run.${fixAllGuidance}`;
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

function autoStatsCommand(command: string | undefined): boolean {
  return command === "/addy-build"
    || command === "/addy-verify"
    || command === "/addy-review"
    || command === "/addy-fix-all"
    || command === "/addy-finish"
    || command === AUTO_TASK_COMMIT_PROMPT;
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

type ReviewIssueSeverity = "critical" | "important" | "suggestion" | "unknown";

type ReviewIssueFinding = { line: string; severity: ReviewIssueSeverity };

function emptyReviewIssueStats(): WorkflowIssueStats {
  return { critical: 0, important: 0, suggestion: 0, unknown: 0, total: 0 };
}

function reviewTextHasActionableFindings(text: string): boolean {
  return reviewIssueFindings(text).length > 0;
}

function reviewFindingsFingerprint(text: string): string {
  const normalized = reviewFindingLines(text).join("\n") || text.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function reviewFindingLines(text: string): string[] {
  return reviewIssueFindings(text).map((finding) => finding.line);
}

function reviewIssueStatsFromText(text: string): WorkflowIssueStats {
  const stats = emptyReviewIssueStats();
  for (const finding of reviewIssueFindings(text)) {
    stats[finding.severity] += 1;
    stats.total += 1;
  }
  return stats;
}

function reviewIssueFindings(text: string): ReviewIssueFinding[] {
  const findings: ReviewIssueFinding[] = [];
  let sectionSeverity: ReviewIssueSeverity | undefined;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim().toLowerCase();
    if (!line) continue;

    const heading = reviewActionableSectionHeading(line);
    if (heading) {
      sectionSeverity = heading.severity;
      if (heading.inlineFinding && !reviewLineIsEmptyFinding(heading.inlineFinding)) findings.push({ line, severity: heading.severity });
      continue;
    }

    if (reviewAnySectionHeading(line)) {
      sectionSeverity = undefined;
      continue;
    }

    if (sectionSeverity && !reviewLineIsEmptyFinding(line)) {
      findings.push({ line, severity: sectionSeverity });
      continue;
    }

    if ((/\b[\w./-]+:\d+\b/.test(line) || /\b(blocking issue|blocker|must fix|should fix)\b/.test(line)) && !reviewLineIsEmptyFinding(line)) {
      findings.push({ line, severity: "unknown" });
    }
  }

  if (findings.length === 0 && reviewTextClearlyFoundIssues(text)) findings.push({ line: text.trim().toLowerCase(), severity: "unknown" });
  return findings;
}

function reviewTextClearlyFoundIssues(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower || /\bno (?:actionable )?(?:issues|findings)(?: found)?\b/.test(lower)) return false;
  return /\b(?:found|surfaced|identified|reported|detected)\b[\s\S]{0,80}\b(?:issues?|findings?|problems?)\b/.test(lower)
    || /\b(?:issues?|findings?|problems?)\b[\s\S]{0,40}\b(?:found|surfaced|identified|reported|detected)\b/.test(lower);
}

function reviewActionableSectionHeading(line: string): { severity: ReviewIssueSeverity; inlineFinding: string } | undefined {
  const match = line.match(/^(?:#+\s*)?(?:\*\*)?(critical(?: issues?)?|important(?: issues?)?|warnings?|suggestions?)(?:\*\*)?\s*:?\s*(.*)$/i);
  if (!match) return undefined;
  const label = match[1]?.toLowerCase() ?? "";
  const severity: ReviewIssueSeverity = label.startsWith("critical") ? "critical" : label.startsWith("suggestion") ? "suggestion" : "important";
  return { severity, inlineFinding: match[2]?.trim() ?? "" };
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

function autoTaskCommitPrompt(state: ReturnType<typeof getContextWorkflowState>, taskTitle?: string): string {
  const task = taskTitle ?? (state.currentTask && state.currentTask !== "none" ? state.currentTask : "the completed task");
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

function sendUserMessage(pi: ExtensionAPI, ctx: unknown, message: string, options: { autoMode?: boolean } = {}): void {
  const expandedMessage = expandPackagedPromptTemplate(message);
  const deliveredMessage = options.autoMode ? appendAutoUnblockGuidance(expandedMessage, commandFromPrompt(message)) : expandedMessage;
  const sender = (pi as ExtensionAPI & { sendUserMessage?: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void }).sendUserMessage;
  if (!sender) {
    (ctx as { ui?: { setEditorText?: (text: string) => void; notify?: (message: string, level?: string) => void } }).ui?.setEditorText?.(deliveredMessage);
    (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(`Prefilled ${message}; submit it to continue Addy auto.`, "info");
    return;
  }

  const isIdle = (ctx as { isIdle?: () => boolean }).isIdle?.() ?? true;
  if (isIdle) sender(deliveredMessage);
  else sender(deliveredMessage, { deliverAs: "followUp" });
}

function autoRetryKey(state: ReturnType<typeof getContextWorkflowState>, prompt: string): string {
  return [prompt, state.activePlan ?? "", state.currentTaskIndex ?? "", state.currentTask ?? "", state.nextTask ?? ""].join("\u001f");
}

function latestActiveStatsTarget(state: ReturnType<typeof getContextWorkflowState>): WorkflowStatsTarget | undefined {
  const task = Object.values(state.stats?.active.tasks ?? {}).at(-1);
  if (!task) return undefined;
  return {
    plan: task.plan,
    sliceIndex: task.sliceIndex,
    taskIndex: task.taskIndex,
    taskTitle: task.taskTitle,
  };
}

function autoPauseWarning(prompt: string, action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>): string {
  const missing = action?.missingStatuses?.join(", ");
  const task = action?.taskTitle ? ` Task: ${action.taskTitle}.` : "";
  const missingText = missing ? ` Missing: ${missing}.` : "";
  return `Addy auto paused at ${prompt}; the current lifecycle step is still incomplete after retry.${task}${missingText} Re-run the step after fixing the work, or update the plan checkbox only if that phase is actually complete.`;
}

function dispatchAutoPrompt(pi: ExtensionAPI, ctx: unknown, prompt: string, state: ReturnType<typeof getContextWorkflowState>, updates: Partial<ReturnType<typeof getContextWorkflowState>> = {}, statsTarget?: WorkflowStatsTarget): void {
  const workflowCtx = ctx as never;
  const nextState = {
    ...state,
    autoLastPrompt: prompt,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    ...updates,
  };
  const command = commandFromPrompt(prompt);
  const target = statsTarget ?? {
    taskIndex: nextState.autoReviewTaskIndex ?? nextState.currentTaskIndex,
    taskTitle: nextState.autoReviewTask ?? nextState.currentTask,
  };
  const stateWithStats = command === "/addy-review"
    ? recordWorkflowReviewRun(nextState, target)
    : autoStatsCommand(command)
      ? recordWorkflowTaskTurn(nextState, target)
      : nextState;
  setContextWorkflowState(workflowCtx, stateWithStats, appendWorkflowEntry(pi));
  sendUserMessage(pi, ctx, prompt, { autoMode: state.autoMode });
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
    dispatchAutoPrompt(pi, ctx, reviewPrompt, state, {
      autoReviewFixNeedsReview: false,
      autoReviewTask: state.currentTask,
      autoReviewTaskIndex: state.currentTaskIndex,
    });
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

function maybeDispatchTaskCommit(pi: ExtensionAPI, ctx: unknown, event: AgentEndEvent, previousState: ReturnType<typeof getContextWorkflowState>, state: ReturnType<typeof getContextWorkflowState>, action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>): boolean {
  if (commandFromPrompt(previousState.autoLastPrompt) !== "/addy-review") return false;
  const reviewText = latestAssistantText(event);
  if (!reviewText.trim() || reviewTextHasActionableFindings(reviewText)) return false;
  const nextCommand = commandFromPrompt(action?.prompt);
  if (nextCommand === "/addy-review") return false;

  const reviewedTask = previousState.autoReviewTask && previousState.autoReviewTask !== "none" ? previousState.autoReviewTask : previousState.currentTask;
  const trackedReviewedTask = Boolean(previousState.autoReviewTask && previousState.autoReviewTask !== "none");
  const planMovedPastReviewTarget = Boolean(reviewedTask && reviewedTask !== "none" && action?.taskTitle && action.taskTitle !== reviewedTask);
  if (!trackedReviewedTask && !planMovedPastReviewTarget && !reviewedTaskWasCompleted(previousState, state)) return false;

  dispatchAutoPrompt(pi, ctx, autoTaskCommitPrompt(previousState, reviewedTask), state, {
    autoLastPrompt: AUTO_TASK_COMMIT_PROMPT,
    autoReviewTask: undefined,
    autoReviewTaskIndex: undefined,
  }, {
    plan: previousState.activePlan,
    sliceIndex: previousState.currentSliceIndex,
    taskIndex: previousState.autoReviewTaskIndex ?? previousState.currentTaskIndex,
    taskTitle: reviewedTask,
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

  const committedTarget = latestActiveStatsTarget(state);
  setContextWorkflowState(ctx as never, {
    ...archiveWorkflowStats(state, "task-commit"),
    autoReviewTask: committedTarget?.taskTitle,
    autoReviewTaskIndex: committedTarget?.taskIndex,
  }, appendWorkflowEntry(pi));
  dispatchNextAutoWorkflowPrompt(pi, ctx);
  return true;
}

function finishTextReportsComplete(text: string): boolean {
  return /(?:^|\s)Finished!(?:\s|$)/i.test(text) || agentTextReportsCommitComplete(text);
}

function maybeCompleteAutoFinish(pi: ExtensionAPI, ctx: unknown, event: AgentEndEvent, state: ReturnType<typeof getContextWorkflowState>, action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>): boolean {
  if (commandFromPrompt(state.autoLastPrompt) !== "/addy-finish") return false;
  if (commandFromPrompt(action?.prompt) !== "/addy-finish") return false;
  if (!finishTextReportsComplete(latestAssistantText(event))) return false;

  const completedState = archiveWorkflowStats({
    ...state,
    phases: {
      ...state.phases,
      finish: "complete",
    },
    autoMode: false,
    autoLastPrompt: undefined,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    autoReviewFixKey: undefined,
    autoReviewFixCount: undefined,
    autoReviewFindingFingerprint: undefined,
    autoReviewFixNeedsReview: undefined,
    autoReviewTask: undefined,
    autoReviewTaskIndex: undefined,
  }, "completed");
  setContextWorkflowState(ctx as never, completedState, appendWorkflowEntry(pi));
  (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(`Finished!\n${renderWorkflowStatsText(completedState)}`, "info");
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

  const reviewTask = phase === "review" ? action.taskTitle ?? refreshedState.currentTask : undefined;
  const finishTask = phase === "finish" ? refreshedState.autoReviewTask : undefined;
  dispatchAutoPrompt(pi, ctx, prompt, refreshedState, {
    autoRetryKey: retryKey,
    autoRetryCount: isSameIncompletePhase ? retryCount + 1 : 0,
    autoReviewTask: reviewTask ?? finishTask,
    autoReviewTaskIndex: phase === "review" ? refreshedState.currentTaskIndex : phase === "finish" ? refreshedState.autoReviewTaskIndex : undefined,
  }, reviewTask || finishTask ? {
    taskIndex: phase === "review" ? refreshedState.currentTaskIndex : refreshedState.autoReviewTaskIndex,
    taskTitle: reviewTask ?? finishTask,
  } : undefined);
}

function dispatchNextAutoWorkflowPromptAfterAgentEnd(pi: ExtensionAPI, ctx: unknown, event: AgentEndEvent): void {
  const workflowCtx = ctx as never;
  const state = getContextWorkflowState(workflowCtx);
  if (maybeContinueAfterTaskCommit(pi, ctx, event, state)) return;
  setContextWorkflowState(workflowCtx, state, appendWorkflowEntry(pi));
  const refreshedState = getContextWorkflowState(workflowCtx);
  const action = nextWorkflowActionForActivePlanLifecycle(refreshedState, (ctx as { cwd?: string }).cwd);
  if (maybeCompleteAutoFinish(pi, ctx, event, refreshedState, action)) return;
  if (maybeDispatchReviewFixLoop(pi, ctx, event, refreshedState, action)) return;
  if (maybeDispatchTaskCommit(pi, ctx, event, state, refreshedState, action)) return;
  dispatchNextAutoWorkflowPrompt(pi, ctx);
}

export default function addyWorkflowMonitor(pi: ExtensionAPI) {
  pi.on("session_start", async (_event: unknown, ctx: unknown) => {
    initializeWorkflowWidget(ctx as never);
  });

  pi.on("input", async (event: InputEvent, ctx: unknown) => {
    const input = event.input ?? event.text ?? "";
    const manualAddyCommand = /^\/addy-(?!auto(?:\s|$))/.test(input.trim());
    handleWorkflowEvent(ctx as never, { source: "user-input", text: workflowTextFromInput(input), manualAddyCommand }, appendWorkflowEntry(pi));
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
    const reviewText = latestAssistantText(event);
    const stateWithReviewIssues = state.reviewStatsKey ? recordWorkflowReviewIssues(state, reviewIssueStatsFromText(reviewText)) : state;
    if (stateWithReviewIssues !== state) setContextWorkflowState(ctx as never, stateWithReviewIssues, appendWorkflowEntry(pi));
    if (!stateWithReviewIssues.autoMode) return;
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
      else {
        const state = getContextWorkflowState(ctx as never);
        (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(`Addy auto stopped.\n${renderWorkflowStatsText(state)}`, "info");
      }
      return { action: "continue" as const };
    },
  });

  pi.registerCommand?.("addy-stats", {
    description: "Show Addy workflow stats for the active or supplied plan.",
    handler: async (event: CommandEvent, ctx: unknown) => {
      const args = parseCommandArgs(event);
      const text = renderWorkflowStatsText(getContextWorkflowState(ctx as never), args.join(" ") || undefined);
      (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(text, "info");
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
