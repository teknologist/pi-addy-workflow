import {
  getMarkdownTheme,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { Markdown } from '@earendil-works/pi-tui';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureGlobalAddyWorkflowConfig,
  loadAddyWorkflowConfig,
} from './workflow-monitor/config.ts';
import {
  archiveWorkflowStats,
  getContextWorkflowState,
  handleWorkflowEvent,
  initializeWorkflowWidget,
  openNextWorkflowPrompt,
  recordWorkflowReviewIssues,
  recordWorkflowReviewRun,
  recordWorkflowTaskTurn,
  recordWorkflowVerifyRun,
  resetWorkflow,
  setContextWorkflowState,
  type WorkflowStatsTarget,
} from './workflow-monitor/workflow-handler.ts';
import {
  WORKFLOW_PHASES,
  transitionWorkflow,
  type WorkflowIssueStats,
  type WorkflowPhase,
} from './workflow-monitor/workflow-transitions.ts';
import {
  nextUnfinishedSlicePlanPath,
  nextWorkflowActionForActivePlanLifecycle,
  planTasksFromMarkdown,
  renderWorkflowStatsMarkdown,
  renderWorkflowStatsText,
} from './workflow-monitor/workflow-tracker.ts';

type CommandEvent = string | { args?: string[]; input?: string };
type InputEvent = { input?: string; text?: string; source?: string };
type ToolEvent = {
  command?: string;
  text?: string;
  success?: boolean;
  artifact?: string;
};
type ToolCallEvent = {
  toolName?: string;
  name?: string;
  input?: Record<string, unknown>;
};
type SubagentEvent = { agent?: string; agentName?: string };
type AgentEndEvent = {
  agent?: string;
  agentName?: string;
  messages?: AgentMessage[];
  message?: AgentMessage;
};
type AgentMessage = { role?: string; content?: unknown };
type FreshContextReason = 'between-tasks' | 'before-step' | 'before-review';
type DispatchOptions = {
  freshContextBypassReason?: FreshContextReason;
  appendEntry?: boolean;
};
type UserMessageDeliveryOptions = {
  deliverAs?: 'steer' | 'followUp';
  streamingBehavior?: 'steer' | 'followUp';
};
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));

const PROMPT_TEMPLATE_BY_COMMAND: Record<string, string> = {
  '/addy-define': 'addy-define.md',
  '/addy-plan': 'addy-plan.md',
  '/addy-build': 'addy-build.md',
  '/addy-code-simplify': 'addy-code-simplify.md',
  '/addy-verify': 'addy-verify.md',
  '/addy-review': 'addy-review.md',
  '/addy-fix-all': 'addy-fix-all.md',
  '/addy-finish': 'addy-finish.md',
};
const AUTO_REVIEW_FIX_MAX = 5;
const ADDY_STATS_MESSAGE_TYPE = 'pi-addy-workflow-stats';
const AUTO_TASK_COMMIT_PROMPT = '__addy-auto-task-commit__';
const FRESH_CONTEXT_STEP_COMMANDS = new Set([
  '/addy-define',
  '/addy-plan',
  '/addy-build',
  '/addy-code-simplify',
  '/addy-verify',
  '/addy-review',
  '/addy-fix-all',
  '/addy-finish',
]);
const consumedAutoFreshKeys = new Set<string>();
const AUTO_SAME_PHASE_MAX_RETRIES = 12;

function isWorkflowPhase(value: string | undefined): value is WorkflowPhase {
  return WORKFLOW_PHASES.includes(value as WorkflowPhase);
}

function appendWorkflowEntry(pi: ExtensionAPI) {
  return (type: string, data: unknown) => pi.appendEntry?.(type, data);
}

function appendWorkflowEntryFromContext(ctx: unknown) {
  return (type: string, data: unknown) =>
    (
      ctx as {
        sessionManager?: {
          appendCustomEntry?: (type: string, data: unknown) => void;
        };
      }
    ).sessionManager?.appendCustomEntry?.(type, data);
}

function extensionApiFromContext(ctx: unknown): ExtensionAPI {
  return {
    appendEntry: appendWorkflowEntryFromContext(ctx),
    sendUserMessage: (content: string, options?: UserMessageDeliveryOptions) =>
      (
        ctx as {
          sendUserMessage?: (
            content: string,
            options?: UserMessageDeliveryOptions,
          ) => void | Promise<void>;
        }
      ).sendUserMessage?.(content, options),
  } as ExtensionAPI;
}

function parseCommandArgs(event: CommandEvent): string[] {
  if (typeof event === 'string') return event.split(/\s+/).filter(Boolean);
  return event.args ?? event.input?.split(/\s+/).filter(Boolean) ?? [];
}

function parseTemplateArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const char of argsString) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else current += char;
  }
  if (current) args.push(current);
  return args;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

function substituteTemplateArgs(content: string, args: string[]): string {
  let result = content.replace(
    /\$(\d+)/g,
    (_match, rawIndex: string) => args[Number.parseInt(rawIndex, 10) - 1] ?? '',
  );
  result = result.replace(
    /\$\{@:(\d+)(?::(\d+))?\}/g,
    (_match, rawStart: string, rawLength: string | undefined) => {
      const start = Math.max(0, Number.parseInt(rawStart, 10) - 1);
      if (rawLength)
        return args
          .slice(start, start + Number.parseInt(rawLength, 10))
          .join(' ');
      return args.slice(start).join(' ');
    },
  );
  const allArgs = args.join(' ');
  return result.replace(/\$ARGUMENTS/g, allArgs).replace(/\$@/g, allArgs);
}

function expandPackagedPromptTemplate(prompt: string): string {
  const trimmed = prompt.trim();
  const [command] = trimmed.split(/\s+/, 1);
  const templateName = PROMPT_TEMPLATE_BY_COMMAND[command];
  if (!templateName) return prompt;

  try {
    const argsString = trimmed.slice(command.length).trim();
    const template = stripFrontmatter(
      readFileSync(join(PACKAGE_ROOT, '..', 'prompts', templateName), 'utf8'),
    );
    const expanded = substituteTemplateArgs(
      template,
      parseTemplateArgs(argsString),
    ).trimEnd();
    return `${expanded}\n\nInvocation: \`${prompt}\``;
  } catch {
    return prompt;
  }
}

function appendAutoUnblockGuidance(message: string, command?: string): string {
  const fixAllGuidance =
    command === '/addy-fix-all'
      ? `

## Addy Auto Fix-All Handoff

This is an auto-dispatched fix pass. Fix only the surfaced review issues and run narrow validation for the changed scope. Do not invoke or perform \`/addy-verify\` or \`/addy-review\` inside this \`/addy-fix-all\` turn. When this turn ends, the Addy auto monitor will dispatch \`/addy-verify\` first, then \`/addy-review\`.`
      : '';

  return `${message}

## Addy Auto Mode Recovery

Addy Auto Mode is active. If this step blocks, repeats, or finds missing artifacts, use the Pi \`addy-auto-unblock\` skill before pausing. That skill must apply \`debugging-and-error-recovery\` to reproduce, classify, and safely fix scoped blockers.

Critical rule: do not skip, weaken, or silently reinterpret acceptance criteria, verification, or review. Only mark lifecycle checkboxes when there is real evidence from this run.${fixAllGuidance}`;
}

function workflowTextFromInput(text: string): string {
  return text.match(/^Invocation:\s+`([^`]+)`\s*$/m)?.[1] ?? text;
}

function isManualAddyWorkflowCommand(input: string): boolean {
  const command = input.trim().split(/\s+/, 1)[0];
  return (
    command.startsWith('/addy-') &&
    command !== '/addy-auto' &&
    command !== '/addy-auto-continue'
  );
}

function extractWriteArtifact(event: ToolCallEvent): string | undefined {
  const toolName = event.toolName ?? event.name ?? '';
  const input = event.input ?? {};
  if (
    ![
      'write',
      'edit',
      'multi_edit',
      'obsidian_obsidian_append_content',
      'obsidian_obsidian_patch_content',
    ].includes(toolName)
  )
    return undefined;

  for (const key of ['path', 'file_path', 'filepath']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }

  return undefined;
}

function phaseFromWorkflowPrompt(prompt: string): WorkflowPhase | undefined {
  const command = prompt.trim().split(/\s+/, 1)[0];
  if (command === '/addy-code-simplify') return 'simplify';
  if (command === '/addy-define') return 'define';
  if (command === '/addy-plan') return 'plan';
  if (command === '/addy-build') return 'build';
  if (command === '/addy-verify') return 'verify';
  if (command === '/addy-review') return 'review';
  if (command === '/addy-finish') return 'finish';
  return undefined;
}

function commandFromPrompt(prompt: string | undefined): string | undefined {
  const invocation = prompt?.match(/^Invocation:\s+`([^`]+)`\s*$/m)?.[1];
  return (invocation ?? prompt)?.trim().split(/\s+/, 1)[0];
}

function activePlanPrompt(
  command: string,
  state: ReturnType<typeof getContextWorkflowState>,
): string | undefined {
  return state.activePlan ? `${command} ${state.activePlan}` : undefined;
}

function autoStatsCommand(command: string | undefined): boolean {
  return (
    command === '/addy-build' ||
    command === '/addy-verify' ||
    command === '/addy-review' ||
    command === '/addy-fix-all' ||
    command === '/addy-finish' ||
    command === AUTO_TASK_COMMIT_PROMPT
  );
}

function textFromMessage(message: AgentMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map((part) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
        ? part.text
        : '',
    )
    .filter(Boolean)
    .join('\n');
}

function latestAssistantText(event: AgentEndEvent): string {
  const messages = event.messages ?? (event.message ? [event.message] : []);
  return textFromMessage(
    [...messages].reverse().find((message) => message.role === 'assistant') ??
      messages.at(-1),
  );
}

function agentTextReportsCommitComplete(text: string): boolean {
  return (
    /\bCOMMIT:\s*[0-9a-f]{7,40}\b/i.test(text) ||
    /\b(no changes to commit|nothing to commit|working tree clean)\b/i.test(
      text,
    )
  );
}

type ReviewIssueSeverity = 'critical' | 'important' | 'suggestion' | 'unknown';

type ReviewIssueFinding = { line: string; severity: ReviewIssueSeverity };

function emptyReviewIssueStats(): WorkflowIssueStats {
  return { critical: 0, important: 0, suggestion: 0, unknown: 0, total: 0 };
}

function reviewTextHasActionableFindings(text: string): boolean {
  return reviewIssueFindings(text).length > 0;
}

function reviewFindingsFingerprint(text: string): string {
  const normalized =
    reviewFindingLines(text).join('\n') || text.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
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

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().toLowerCase();
    if (!line) continue;

    const heading = reviewActionableSectionHeading(line);
    if (heading) {
      sectionSeverity = heading.severity;
      if (
        heading.inlineFinding &&
        !reviewLineIsEmptyFinding(heading.inlineFinding)
      )
        findings.push({ line, severity: heading.severity });
      continue;
    }

    if (reviewAnySectionHeading(line)) {
      sectionSeverity = undefined;
      continue;
    }

    if (sectionSeverity) {
      if (reviewLineStartsFinding(line) && !reviewLineIsEmptyFinding(line))
        findings.push({ line, severity: sectionSeverity });
      continue;
    }

    if (
      (/\b[\w./-]+:\d+\b/.test(line) ||
        /\b(blocking issue|blocker|must fix|should fix)\b/.test(line)) &&
      !reviewLineIsEmptyFinding(line)
    ) {
      findings.push({ line, severity: 'unknown' });
    }
  }

  if (findings.length === 0 && reviewTextClearlyFoundIssues(text))
    findings.push({ line: text.trim().toLowerCase(), severity: 'unknown' });
  return findings;
}

function reviewTextClearlyFoundIssues(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (
    !lower ||
    /\bno (?:actionable )?(?:issues|findings)(?: found)?\b/.test(lower)
  )
    return false;
  return (
    /\b(?:found|surfaced|identified|reported|detected)\b[\s\S]{0,80}\b(?:issues?|findings?|problems?)\b/.test(
      lower,
    ) ||
    /\b(?:issues?|findings?|problems?)\b[\s\S]{0,40}\b(?:found|surfaced|identified|reported|detected)\b/.test(
      lower,
    )
  );
}

function reviewActionableSectionHeading(
  line: string,
): { severity: ReviewIssueSeverity; inlineFinding: string } | undefined {
  const match = line.match(
    /^(?:#+\s*)?(?:\*\*)?(critical(?: issues?)?|important(?: issues?)?|warnings?|suggestions?)(?:\*\*)?\s*:?\s*(.*)$/i,
  );
  if (!match) return undefined;
  const label = match[1]?.toLowerCase() ?? '';
  const severity: ReviewIssueSeverity = label.startsWith('critical')
    ? 'critical'
    : label.startsWith('suggestion')
      ? 'suggestion'
      : 'important';
  return { severity, inlineFinding: match[2]?.trim() ?? '' };
}

function reviewAnySectionHeading(line: string): boolean {
  return /^(?:#+\s*)?(?:\*\*)?[a-z][\w\s-]{0,40}(?:\*\*)?\s*:?[\s]*$/i.test(
    line,
  );
}

function reviewLineIsEmptyFinding(line: string): boolean {
  return /^(?:[-*•]|\d+\.)?\s*(?:none|none found|n\/a|no issues(?: found)?|no findings|no actionable (?:issues|findings)|critical issues?: none|warnings?: none|suggestions?: none)\.?$/i.test(
    line,
  );
}

function reviewLineStartsFinding(line: string): boolean {
  return /^(?:[-*•]|\d+[.)])\s+\S/.test(line);
}

function reviewFixKey(
  state: ReturnType<typeof getContextWorkflowState>,
): string {
  return [
    state.activePlan ?? '',
    state.currentTaskIndex ?? '',
    state.currentTask ?? '',
  ].join('\u001f');
}

function reviewedTaskWasCompleted(
  previousState: ReturnType<typeof getContextWorkflowState>,
  state: ReturnType<typeof getContextWorkflowState>,
): boolean {
  if (!previousState.activePlan || !state.activePlan) return false;
  if (
    !previousState.currentTask ||
    previousState.currentTask === 'none' ||
    previousState.currentTask === 'all tasks complete'
  )
    return false;
  if (!previousState.currentTaskIndex || !previousState.taskCount) return false;

  return (
    state.activePlan !== previousState.activePlan ||
    state.currentTask !== previousState.currentTask ||
    state.currentTaskIndex !== previousState.currentTaskIndex ||
    state.taskCount !== previousState.taskCount
  );
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function repoScopeValueToPath(
  value: string,
  baseCwd?: string,
): string | undefined {
  const cleaned = value.replace(/\s+only\.?$/i, '').trim();
  if (!cleaned) return undefined;
  if (/^(?:current repo(?:sitory)?|owner repo(?:sitory)?)$/i.test(cleaned))
    return baseCwd;
  if (isAbsolute(cleaned)) return cleaned;
  const relativeRepoPath =
    cleaned.startsWith('./') ||
    cleaned.startsWith('../') ||
    cleaned === '.' ||
    cleaned === '..';
  if (relativeRepoPath) return resolve(baseCwd ?? process.cwd(), cleaned);
  if (baseCwd && basename(baseCwd) === cleaned) return baseCwd;
  return cleaned;
}

function extractBacktickedValues(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function extractRepositoryScopeLineValues(markdown: string): string[] {
  const line = markdown.match(/^Repository scope:\s*(.+)$/im)?.[1];
  if (!line) return [];
  const backticked = extractBacktickedValues(line);
  if (backticked.length > 0) return backticked;
  return line
    .split(/,|\band\b/i)
    .map((value) => value.replace(/\.$/, '').trim())
    .filter(Boolean);
}

function extractIndexPlanPath(markdown: string): string | undefined {
  return markdown.match(/^Index:\s*`([^`]+)`/im)?.[1]?.trim();
}

function labeledMarkdownValue(
  markdown: string,
  label: string,
): string | undefined {
  const prefix = `**${label}:**`;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase()))
      return trimmed.slice(prefix.length).trim();
  }
  return undefined;
}

function extractOwnerAndCompanionRepos(markdown: string): string[] {
  const repos: string[] = [];
  for (const label of ['Owner repo', 'Companion repo']) {
    const line = labeledMarkdownValue(markdown, label);
    if (!line) continue;
    const backticked = extractBacktickedValues(line);
    repos.push(
      ...(backticked.length > 0
        ? backticked
        : [line.replace(/^sibling\s+/i, '').trim()]),
    );
  }
  return repos;
}

function repositoryScopesForPlan(
  planPath: string | undefined,
  baseCwd?: string,
): string[] {
  if (!planPath) return baseCwd ? [baseCwd] : [];

  try {
    const resolvedPlanPath = resolveWorkflowPlanPath(planPath, baseCwd);
    const markdown = readFileSync(resolvedPlanPath, 'utf8');
    const indexPlanPath = extractIndexPlanPath(markdown);
    let indexMarkdown = '';
    if (indexPlanPath) {
      try {
        indexMarkdown = readFileSync(
          resolveWorkflowPlanPathRelativeTo(
            indexPlanPath,
            resolvedPlanPath,
            baseCwd,
          ),
          'utf8',
        );
      } catch {
        indexMarkdown = '';
      }
    }

    return uniqueDefined([
      baseCwd,
      ...extractOwnerAndCompanionRepos(indexMarkdown || markdown).map((value) =>
        repoScopeValueToPath(value, baseCwd),
      ),
      ...extractRepositoryScopeLineValues(markdown).map((value) =>
        repoScopeValueToPath(value, baseCwd),
      ),
    ]);
  } catch {
    return baseCwd ? [baseCwd] : [];
  }
}

function repositoryScopeForPlan(
  planPath: string | undefined,
  baseCwd?: string,
): string | undefined {
  const scopes = repositoryScopesForPlan(planPath, baseCwd);
  return scopes.length > 0 ? scopes.join('; ') : undefined;
}

function autoTaskCommitPrompt(
  state: ReturnType<typeof getContextWorkflowState>,
  taskTitle?: string,
  baseCwd?: string,
): string {
  const task =
    taskTitle ??
    (state.currentTask && state.currentTask !== 'none'
      ? state.currentTask
      : 'the completed task');
  const plan = state.activePlan
    ? `Plan: ${state.activePlan}`
    : 'Plan: active Addy workflow plan';
  const repositoryScope = repositoryScopeForPlan(state.activePlan, baseCwd);
  const repositoryLine = repositoryScope
    ? `Repository scope: ${repositoryScope}`
    : 'Repository scope: current repository';
  return [
    '# Addy Auto Commit',
    '',
    'The current task has Implemented, Verified, and Reviewed checked. Commit the completed task work now, without asking the user for confirmation.',
    '',
    plan,
    repositoryLine,
    `Completed task: ${task}`,
    '',
    'Required steps:',
    '1. Do not try to invoke, search for, or print a `/commit` slash command; this auto prompt is the commit instruction.',
    '2. Use the full repository scope above instead of relying on fresh-session file-touch history.',
    '3. With the available shell/git tools, inspect each repo in scope (for example, `git -C <repo> status --short`).',
    '4. Stage only files for this completed task, including the plan checkbox update when it changed. Do not stage unrelated work.',
    '5. Review the staged diff, then create a concise commit in each repo that has staged task changes.',
    '6. If there are no changes in any relevant repo, say `No changes to commit` and stop.',
    '7. Report each commit hash in the form `COMMIT: <hash>`.',
    '',
    'Do not call ask_user_question. Do not start the next task yourself; Addy auto will continue after this commit turn ends.',
    '',
    `Invocation: \`${AUTO_TASK_COMMIT_PROMPT}\``,
  ].join('\n');
}

function followUpDeliveryOptions(): UserMessageDeliveryOptions {
  return { deliverAs: 'followUp', streamingBehavior: 'followUp' };
}

function sendUserMessage(
  pi: ExtensionAPI,
  ctx: unknown,
  message: string,
  options: { autoMode?: boolean } = {},
): void {
  const expandedMessage = expandPackagedPromptTemplate(message);
  const deliveredMessage = options.autoMode
    ? appendAutoUnblockGuidance(expandedMessage, commandFromPrompt(message))
    : expandedMessage;
  const contextSender = (
    ctx as {
      sendUserMessage?: (
        content: string,
        options?: UserMessageDeliveryOptions,
      ) => void;
    }
  ).sendUserMessage;
  const piSender = (
    pi as ExtensionAPI & {
      sendUserMessage?: (
        content: string,
        options?: UserMessageDeliveryOptions,
      ) => void;
    }
  ).sendUserMessage;
  if (!contextSender && !piSender) {
    (
      ctx as {
        ui?: {
          setEditorText?: (text: string) => void;
          notify?: (message: string, level?: string) => void;
        };
      }
    ).ui?.setEditorText?.(deliveredMessage);
    (
      ctx as { ui?: { notify?: (message: string, level?: string) => void } }
    ).ui?.notify?.(
      `Prefilled ${message}; submit it to continue Addy auto.`,
      'info',
    );
    return;
  }

  const sender = contextSender
    ? (content: string, deliveryOptions?: UserMessageDeliveryOptions) =>
        contextSender.call(ctx, content, deliveryOptions)
    : (content: string, deliveryOptions?: UserMessageDeliveryOptions) =>
        piSender?.call(pi, content, deliveryOptions);
  return sender(deliveredMessage, followUpDeliveryOptions());
}

function autoFreshContinuationKey(
  prompt: string,
  reason: FreshContextReason,
  state: ReturnType<typeof getContextWorkflowState>,
): string {
  return [
    reason,
    prompt,
    state.activePlan ?? '',
    state.currentSliceIndex ?? '',
    state.currentTaskIndex ?? '',
    state.currentTask ?? '',
    state.autoReviewTask ?? '',
    state.autoReviewTaskIndex ?? '',
    state.autoRetryKey ?? '',
    state.autoRetryCount ?? '',
  ].join('\u001f');
}

function validPendingFreshContinuation(
  state: ReturnType<typeof getContextWorkflowState>,
): state is ReturnType<typeof getContextWorkflowState> & {
  autoFreshPrompt: string;
  autoFreshReason: FreshContextReason;
} {
  return Boolean(state.autoFreshPrompt && state.autoFreshReason);
}

function isSubagentChildSession(): boolean {
  return process.env.PI_SUBAGENT_CHILD === '1';
}

function clearAutoFreshUpdates(
  state?: ReturnType<typeof getContextWorkflowState>,
): Partial<ReturnType<typeof getContextWorkflowState>> {
  return {
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
    autoFreshConsumedKey:
      state?.autoFreshDeliveryKey ?? state?.autoFreshConsumedKey,
  };
}

function staleAutoFreshUpdates(): Partial<
  ReturnType<typeof getContextWorkflowState>
> {
  return {
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
  };
}

function pendingAutoFreshUpdates(
  prompt: string,
  reason: FreshContextReason,
  state: ReturnType<typeof getContextWorkflowState>,
  updates: Partial<ReturnType<typeof getContextWorkflowState>> = {},
  deliveryPrompt?: string,
): Partial<ReturnType<typeof getContextWorkflowState>> {
  const pendingState = { ...state, ...updates };
  return {
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    ...updates,
    autoFreshPrompt: prompt,
    autoFreshExpandedPrompt:
      deliveryPrompt ?? expandPackagedPromptTemplate(prompt),
    autoFreshReason: reason,
    autoFreshDeliveryKey: autoFreshContinuationKey(
      prompt,
      reason,
      pendingState,
    ),
    autoFreshConsumedKey: undefined,
  };
}

function stateWithPendingFreshPrompt(
  prompt: string,
  reason: FreshContextReason,
  state: ReturnType<typeof getContextWorkflowState>,
  updates: Partial<ReturnType<typeof getContextWorkflowState>> = {},
  deliveryPrompt?: string,
): ReturnType<typeof getContextWorkflowState> {
  const pendingState = {
    ...state,
    ...pendingAutoFreshUpdates(prompt, reason, state, updates, deliveryPrompt),
  };
  return transitionWorkflow(pendingState, {
    source: 'user-input',
    text: prompt,
    manualAddyCommand: false,
  });
}

function autoRetryKey(
  state: ReturnType<typeof getContextWorkflowState>,
  prompt: string,
): string {
  return [
    prompt,
    state.activePlan ?? '',
    state.currentTaskIndex ?? '',
    state.currentTask ?? '',
    state.nextTask ?? '',
  ].join('\u001f');
}

function latestActiveStatsTarget(
  state: ReturnType<typeof getContextWorkflowState>,
): WorkflowStatsTarget | undefined {
  const task = Object.values(state.stats?.active.tasks ?? {}).at(-1);
  if (!task) return undefined;
  return statsTargetFromTask(task);
}

function statsTargetFromTask(
  task: NonNullable<
    ReturnType<typeof getContextWorkflowState>['stats']
  >['active']['tasks'][string],
): WorkflowStatsTarget {
  return {
    plan: task.plan,
    sliceIndex: task.sliceIndex,
    taskIndex: task.taskIndex,
    taskTitle: task.taskTitle,
  };
}

function resolveWorkflowPlanPath(planPath: string, baseCwd?: string): string {
  const filesystemPath = planPath.startsWith('@')
    ? planPath.slice(1)
    : planPath;
  return isAbsolute(filesystemPath)
    ? filesystemPath
    : resolve(baseCwd ?? process.cwd(), filesystemPath);
}

function resolveWorkflowPlanPathRelativeTo(
  planPath: string,
  relativeTo: string,
  baseCwd?: string,
): string {
  const filesystemPath = planPath.startsWith('@')
    ? planPath.slice(1)
    : planPath;
  if (isAbsolute(filesystemPath)) return filesystemPath;

  const relativeCandidate = resolve(dirname(relativeTo), filesystemPath);
  try {
    statSync(relativeCandidate);
    return relativeCandidate;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    return resolveWorkflowPlanPath(planPath, baseCwd);
  }
}

function planTaskIsComplete(
  planPath: string | undefined,
  baseCwd: string | undefined,
  target: WorkflowStatsTarget,
): boolean {
  if (!planPath || !target.taskTitle) return false;

  try {
    const tasks = planTasksFromMarkdown(
      readFileSync(resolveWorkflowPlanPath(planPath, baseCwd), 'utf8'),
    );
    const task = target.taskIndex
      ? tasks[target.taskIndex - 1]
      : tasks.find((candidate) => candidate.title === target.taskTitle);
    return Boolean(task?.complete && task.title === target.taskTitle);
  } catch {
    return false;
  }
}

function latestCompletedActiveStatsTarget(
  state: ReturnType<typeof getContextWorkflowState>,
  baseCwd?: string,
): WorkflowStatsTarget | undefined {
  const tasks = Object.values(state.stats?.active.tasks ?? {});
  for (const task of [...tasks].reverse()) {
    if (
      !task.taskTitle ||
      task.taskTitle === 'none' ||
      task.taskTitle === 'all tasks complete'
    )
      continue;
    const target = statsTargetFromTask(task);
    if (
      task.verifyRuns > 0 &&
      task.reviewRuns > 0 &&
      planTaskIsComplete(target.plan ?? state.activePlan, baseCwd, target)
    )
      return target;
  }
  return undefined;
}

function activePlanPromptForTarget(
  command: string,
  state: ReturnType<typeof getContextWorkflowState>,
  target?: WorkflowStatsTarget,
): string | undefined {
  const plan = target?.plan ?? state.activePlan;
  return plan ? `${command} ${plan}` : undefined;
}

function autoPauseWarning(
  prompt: string,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
): string {
  const missing = action?.missingStatuses?.join(', ');
  const task = action?.taskTitle ? ` Task: ${action.taskTitle}.` : '';
  const missingText = missing ? ` Missing: ${missing}.` : '';
  return `Addy auto paused at ${prompt}; the current lifecycle step is still incomplete after retry.${task}${missingText} Re-run the step after fixing the work, or update the plan checkbox only if that phase is actually complete.`;
}

function autoRecoveryPrompt(
  prompt: string,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
  retryCount: number,
): string {
  const task = action?.taskTitle ?? 'the current task';
  const missing = action?.missingStatuses?.join(', ') ?? 'the current phase';
  return `${expandPackagedPromptTemplate(prompt)}

## Addy Auto Same-Phase Recovery Pass

This is autonomous retry #${retryCount + 1} for the same incomplete lifecycle phase. Do not stop after a preflight/status report. Grind until the phase is complete or you can prove a hard blocker needs user input.

Target task: ${task}
Missing lifecycle evidence: ${missing}

Required loop:
1. Re-read the plan and the current task acceptance criteria.
2. Self-assess what is still missing for this exact phase.
3. Diagnose the blocker using focused commands and existing tests.
4. Make the smallest safe fix needed for this phase.
5. Run focused verification proving the fix.
6. Update only the lifecycle checkbox(es) backed by evidence from this turn.
7. If verification fails, iterate again in this same turn instead of pausing.

Pause only for a real hard blocker: missing credentials, destructive production risk, unresolved merge conflict, or explicit user decision required. If you pause, name the blocker and the exact command/evidence that proves it.`;
}

function stateWithCompletedLifecyclePhasesFromPlan(
  state: ReturnType<typeof getContextWorkflowState>,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
): ReturnType<typeof getContextWorkflowState> {
  const command = commandFromPrompt(action?.prompt);
  const missingStatuses = action?.missingStatuses;
  const phases = { ...state.phases };

  if (command === '/addy-finish') {
    phases.build = 'complete';
    phases.verify = 'complete';
    phases.review = 'complete';
  } else {
    if (missingStatuses && !missingStatuses.includes('Implemented'))
      phases.build = 'complete';
    if (missingStatuses && !missingStatuses.includes('Verified'))
      phases.verify = 'complete';
  }

  return { ...state, phases };
}

function isStaleExtensionContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      'This extension ctx is stale after session replacement',
    )
  );
}

function freshContextNotice(reason: FreshContextReason): string {
  return reason === 'between-tasks'
    ? 'Addy auto is clearing context and starting a fresh session before the next task.'
    : reason === 'before-review'
      ? 'Addy auto is clearing context and starting a fresh session before review.'
      : 'Addy auto is clearing context and starting a fresh session before the next workflow step.';
}

async function showFreshContextNotice(
  ctx: unknown,
  reason: FreshContextReason,
): Promise<void> {
  const message = freshContextNotice(reason);
  (
    ctx as { ui?: { notify?: (message: string, level?: string) => void } }
  ).ui?.notify?.(message, 'info');
  await (
    ctx as {
      sendMessage?: (
        message: unknown,
        options?: {
          deliverAs?: 'steer' | 'followUp' | 'nextTurn';
          triggerTurn?: boolean;
        },
      ) => void | Promise<void>;
    }
  ).sendMessage?.(
    {
      customType: 'pi-addy-workflow',
      content: message,
      display: true,
    },
    { deliverAs: 'nextTurn' },
  );
}

function addStatsHeading(markdown: string, heading?: string): string {
  if (!heading) return markdown;
  return [`## ${heading}`, '', markdown.replace(/^## /, '### ')].join('\n');
}

function showWorkflowStats(
  pi: ExtensionAPI,
  ctx: unknown,
  state: ReturnType<typeof getContextWorkflowState>,
  options: { heading?: string; planPath?: string } = {},
): void {
  const statsText = renderWorkflowStatsText(state, options.planPath);
  const fallbackText = options.heading
    ? `${options.heading}\n${statsText}`
    : statsText;
  const markdown = addStatsHeading(
    renderWorkflowStatsMarkdown(state, options.planPath),
    options.heading,
  );

  if (pi.sendMessage) {
    pi.sendMessage({
      customType: ADDY_STATS_MESSAGE_TYPE,
      content: fallbackText,
      display: true,
      details: { markdown },
    });
    return;
  }

  (
    ctx as { ui?: { notify?: (message: string, level?: string) => void } }
  ).ui?.notify?.(fallbackText, 'info');
}

function consumeAutoFreshPromptUpdates(
  state: ReturnType<typeof getContextWorkflowState>,
): Partial<ReturnType<typeof getContextWorkflowState>> {
  return {
    ...clearAutoFreshUpdates(state),
    autoRetryKey: state.autoRetryKey,
    autoRetryCount: state.autoRetryCount,
  };
}

function stateAfterAutoPrompt(
  prompt: string,
  state: ReturnType<typeof getContextWorkflowState>,
  updates: Partial<ReturnType<typeof getContextWorkflowState>> = {},
  statsTarget?: WorkflowStatsTarget,
): ReturnType<typeof getContextWorkflowState> {
  const nextState = {
    ...state,
    autoLastPrompt: prompt,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
    ...updates,
  };
  const cmd = commandFromPrompt(prompt);
  const target =
    statsTarget ??
    (cmd === '/addy-review' ||
    cmd === '/addy-finish' ||
    cmd === AUTO_TASK_COMMIT_PROMPT
      ? {
          taskIndex:
            nextState.autoReviewTaskIndex ?? nextState.currentTaskIndex,
          taskTitle: nextState.autoReviewTask ?? nextState.currentTask,
        }
      : {
          taskIndex: nextState.currentTaskIndex,
          taskTitle: nextState.currentTask,
        });
  const stateWithStats =
    cmd === '/addy-verify'
      ? recordWorkflowVerifyRun(nextState, target)
      : cmd === '/addy-review'
        ? recordWorkflowReviewRun(nextState, target)
        : autoStatsCommand(cmd)
          ? recordWorkflowTaskTurn(nextState, target)
          : nextState;
  return cmd?.startsWith('/addy-')
    ? transitionWorkflow(stateWithStats, {
        source: 'user-input',
        text: prompt,
        manualAddyCommand: false,
      })
    : stateWithStats;
}

async function deliverPendingFreshPrompt(
  pi: ExtensionAPI,
  ctx: unknown,
  state: ReturnType<typeof getContextWorkflowState>,
  options: DispatchOptions = {},
): Promise<boolean> {
  if (!validPendingFreshContinuation(state)) return false;
  const prompt = state.autoFreshPrompt;
  const deliveryPrompt = state.autoFreshExpandedPrompt ?? prompt;
  const key =
    state.autoFreshDeliveryKey ??
    autoFreshContinuationKey(prompt, state.autoFreshReason, state);
  const nextState = stateAfterAutoPrompt(prompt, state, {
    ...consumeAutoFreshPromptUpdates({ ...state, autoFreshDeliveryKey: key }),
    autoFreshConsumedKey: key,
  });
  setContextWorkflowState(
    ctx as never,
    nextState,
    options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
  );
  try {
    await sendUserMessage(pi, ctx, deliveryPrompt, {
      autoMode: state.autoMode,
    });
  } catch (error) {
    setContextWorkflowState(
      ctx as never,
      state,
      options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
    );
    throw error;
  }
  consumedAutoFreshKeys.add(key);
  return true;
}

async function runFreshContextContinuation(
  pi: ExtensionAPI,
  ctx: unknown,
  requestedReason: FreshContextReason,
): Promise<void> {
  const notify = (msg: string, level: string) =>
    (
      ctx as { ui?: { notify?: (msg: string, level?: string) => void } }
    ).ui?.notify?.(msg, level);
  const initialState = getContextWorkflowState(ctx as never);
  if (initialState.autoFreshPrompt && !initialState.autoFreshReason) {
    notify(
      'Ignoring stale Addy auto fresh continuation without a recorded reason.',
      'warning',
    );
    setContextWorkflowState(
      ctx as never,
      { ...initialState, ...staleAutoFreshUpdates() },
      appendWorkflowEntry(pi),
    );
    return;
  }
  if (!initialState.autoFreshPrompt && initialState.autoFreshConsumedKey)
    return;
  if (
    initialState.autoFreshDeliveryKey &&
    consumedAutoFreshKeys.has(initialState.autoFreshDeliveryKey)
  )
    return;
  const reason = validPendingFreshContinuation(initialState)
    ? initialState.autoFreshReason
    : requestedReason;
  const newSession = (
    ctx as {
      newSession?: (options: {
        parentSession?: string;
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => Promise<{ cancelled?: boolean } | void>;
    }
  ).newSession;
  if (!newSession) {
    notify(
      'Addy auto could not start a fresh session; continuing in the current session.',
      'warning',
    );
    if (
      await deliverPendingFreshPrompt(pi, ctx, initialState, {
        freshContextBypassReason: reason,
      })
    )
      return;
    await dispatchNextAutoWorkflowPrompt(pi, ctx, false, {
      freshContextBypassReason: reason,
    });
    return;
  }
  await showFreshContextNotice(ctx, reason);
  const parentSession = (
    ctx as { sessionManager?: { getSessionFile?: () => string | undefined } }
  ).sessionManager?.getSessionFile?.();
  const result = await newSession.call(ctx, {
    parentSession,
    withSession: async (newCtx: unknown) => {
      await showFreshContextNotice(newCtx, reason);
      const replacementPi = extensionApiFromContext(newCtx);
      const replacementState = getContextWorkflowState(newCtx as never);
      if (
        replacementState.autoFreshPrompt &&
        !replacementState.autoFreshReason
      ) {
        (
          newCtx as { ui?: { notify?: (msg: string, level?: string) => void } }
        ).ui?.notify?.(
          'Ignoring stale Addy auto fresh continuation without a recorded reason.',
          'warning',
        );
        setContextWorkflowState(
          newCtx as never,
          { ...replacementState, ...staleAutoFreshUpdates() },
          undefined,
        );
        return;
      }
      const deliveryReason = validPendingFreshContinuation(replacementState)
        ? replacementState.autoFreshReason
        : reason;
      if (
        await deliverPendingFreshPrompt(
          replacementPi,
          newCtx,
          replacementState,
          { freshContextBypassReason: deliveryReason },
        )
      )
        return;
      if (replacementState.autoFreshConsumedKey) return;
      await dispatchNextAutoWorkflowPrompt(replacementPi, newCtx, false, {
        freshContextBypassReason: deliveryReason,
      });
    },
  });
  if (result?.cancelled) {
    notify(
      'Addy auto fresh continuation was cancelled; continuing in the current session instead.',
      'warning',
    );
    const latestState = getContextWorkflowState(ctx as never);
    if (
      await deliverPendingFreshPrompt(pi, ctx, latestState, {
        freshContextBypassReason: reason,
      })
    )
      return;
    await dispatchNextAutoWorkflowPrompt(pi, ctx, false, {
      freshContextBypassReason: reason,
    });
  }
}

async function sendFreshContextContinuation(
  pi: ExtensionAPI,
  ctx: unknown,
  reason: FreshContextReason,
): Promise<void> {
  await runFreshContextContinuation(pi, ctx, reason);
}

function parseFreshContextReason(
  event: CommandEvent,
): FreshContextReason | undefined {
  const args = parseCommandArgs(event);
  const freshIndex = args.indexOf('--fresh');
  const value = freshIndex >= 0 ? args[freshIndex + 1] : args[0];
  return value === 'between-tasks' ||
    value === 'before-step' ||
    value === 'before-review'
    ? value
    : undefined;
}

function shouldFreshContextBeforeStep(input: string, ctx: unknown): boolean {
  const command = input.trim().split(/\s+/, 1)[0];
  if (!FRESH_CONTEXT_STEP_COMMANDS.has(command)) return false;
  return loadAddyWorkflowConfig(
    ctx as {
      cwd?: string;
      ui?: { notify?: (message: string, level?: string) => void };
    },
  ).auto.freshContext.beforeEveryStep;
}

async function dispatchManualStepWithFreshContextConfig(
  pi: ExtensionAPI,
  input: string,
  ctx: unknown,
): Promise<boolean> {
  const notify = (message: string, level: string) =>
    (
      ctx as { ui?: { notify?: (message: string, level?: string) => void } }
    ).ui?.notify?.(message, level);
  const expandedInput = expandPackagedPromptTemplate(input);
  notify(
    'Addy beforeEveryStep fresh sessions are applied to auto-dispatched steps; manual workflow commands continue in the current session.',
    'info',
  );
  sendUserMessage(pi, ctx, expandedInput);
  return true;
}

function freshContextReasonForPrompt(
  prompt: string,
  ctx: unknown,
  state: ReturnType<typeof getContextWorkflowState>,
  options: DispatchOptions,
): FreshContextReason | undefined {
  if (options.freshContextBypassReason) return undefined;
  const command = commandFromPrompt(prompt);
  const phase = phaseFromWorkflowPrompt(prompt);
  const freshContext = loadAddyWorkflowConfig(
    ctx as {
      cwd?: string;
      ui?: { notify?: (message: string, level?: string) => void };
    },
  ).auto.freshContext;
  if (command === '/addy-finish' && state.autoMode) return undefined;
  if (phase === 'review' && freshContext.beforeReview) return 'before-review';
  if (
    command &&
    FRESH_CONTEXT_STEP_COMMANDS.has(command) &&
    freshContext.beforeEveryStep
  )
    return 'before-step';
  return undefined;
}

function dispatchAutoPrompt(
  pi: ExtensionAPI,
  ctx: unknown,
  prompt: string,
  state: ReturnType<typeof getContextWorkflowState>,
  updates: Partial<ReturnType<typeof getContextWorkflowState>> = {},
  statsTarget?: WorkflowStatsTarget,
  options: DispatchOptions = {},
  deliveryPrompt = prompt,
): void {
  const stateWithPromptPhase = stateAfterAutoPrompt(
    prompt,
    state,
    updates,
    statsTarget,
  );
  setContextWorkflowState(
    ctx as never,
    stateWithPromptPhase,
    options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
  );
  sendUserMessage(pi, ctx, deliveryPrompt, { autoMode: state.autoMode });
}

async function dispatchAutoPromptFreshAware(
  pi: ExtensionAPI,
  ctx: unknown,
  prompt: string,
  state: ReturnType<typeof getContextWorkflowState>,
  updates: Partial<ReturnType<typeof getContextWorkflowState>> = {},
  statsTarget?: WorkflowStatsTarget,
  options: DispatchOptions = {},
  deliveryPrompt?: string,
): Promise<void> {
  const reason = freshContextReasonForPrompt(prompt, ctx, state, options);
  if (!reason) {
    dispatchAutoPrompt(
      pi,
      ctx,
      prompt,
      state,
      updates,
      statsTarget,
      options,
      deliveryPrompt,
    );
    return;
  }

  setContextWorkflowState(
    ctx as never,
    stateWithPendingFreshPrompt(prompt, reason, state, updates, deliveryPrompt),
    options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
  );
  await sendFreshContextContinuation(pi, ctx, reason);
}

async function dispatchTaskCommitPrompt(
  pi: ExtensionAPI,
  ctx: unknown,
  state: ReturnType<typeof getContextWorkflowState>,
  target: WorkflowStatsTarget,
): Promise<void> {
  await dispatchAutoPromptFreshAware(
    pi,
    ctx,
    autoTaskCommitPrompt(
      { ...state, activePlan: target.plan ?? state.activePlan },
      target.taskTitle,
      (ctx as { cwd?: string }).cwd,
    ),
    state,
    {
      autoLastPrompt: AUTO_TASK_COMMIT_PROMPT,
      autoReviewFixNeedsReview: undefined,
      autoReviewTask: undefined,
      autoReviewTaskIndex: undefined,
    },
    target,
  );
}

async function maybeDispatchReviewFixLoop(
  pi: ExtensionAPI,
  ctx: unknown,
  event: AgentEndEvent,
  state: ReturnType<typeof getContextWorkflowState>,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
): Promise<boolean> {
  const lastCommand = commandFromPrompt(state.autoLastPrompt);

  if (lastCommand === '/addy-fix-all') {
    const verifyPrompt = activePlanPrompt('/addy-verify', state);
    if (!verifyPrompt) return false;
    await dispatchAutoPromptFreshAware(
      pi,
      ctx,
      verifyPrompt,
      state,
      { autoReviewFixNeedsReview: true },
      {
        taskIndex: state.autoReviewTaskIndex ?? state.currentTaskIndex,
        taskTitle: state.autoReviewTask ?? state.currentTask,
      },
    );
    return true;
  }

  if (lastCommand === '/addy-verify' && state.autoReviewFixNeedsReview) {
    const target = {
      plan: state.activePlan,
      sliceIndex: state.currentSliceIndex,
      taskIndex: state.autoReviewTaskIndex ?? state.currentTaskIndex,
      taskTitle:
        state.autoReviewTask && state.autoReviewTask !== 'none'
          ? state.autoReviewTask
          : state.currentTask,
    };
    const reviewPrompt = activePlanPromptForTarget(
      '/addy-review',
      state,
      target,
    );
    if (!reviewPrompt) return false;
    await dispatchAutoPromptFreshAware(
      pi,
      ctx,
      reviewPrompt,
      state,
      {
        autoReviewFixNeedsReview: false,
        autoReviewTask: target.taskTitle,
        autoReviewTaskIndex: target.taskIndex,
      },
      target,
    );
    return true;
  }

  if (lastCommand !== '/addy-review') return false;

  const reviewText = latestAssistantText(event);
  const hasActionableFindings = reviewTextHasActionableFindings(reviewText);
  const cleanReviewNeedsPlanSync = Boolean(
    reviewText.trim() &&
    !hasActionableFindings &&
    commandFromPrompt(action?.prompt) === '/addy-review' &&
    action?.missingStatuses?.includes('Reviewed') &&
    action?.taskTitle &&
    state.currentTask === action.taskTitle,
  );
  if (!hasActionableFindings && !cleanReviewNeedsPlanSync) return false;

  const key = reviewFixKey(state);
  const fixCount =
    state.autoReviewFixKey === key ? (state.autoReviewFixCount ?? 0) : 0;
  const fingerprint = cleanReviewNeedsPlanSync
    ? reviewFindingsFingerprint(`Reviewed checkbox still unchecked for ${key}.`)
    : reviewFindingsFingerprint(reviewText);
  const notify = (message: string) =>
    (
      ctx as { ui?: { notify?: (message: string, level?: string) => void } }
    ).ui?.notify?.(message, 'warning');

  if (fixCount > 0 && state.autoReviewFindingFingerprint === fingerprint) {
    notify(
      `Addy auto paused after /addy-review; the same review finding repeated after a fix attempt. Task: ${action?.taskTitle ?? 'current task'}.`,
    );
    return true;
  }

  if (fixCount >= AUTO_REVIEW_FIX_MAX) {
    notify(
      `Addy auto paused after ${AUTO_REVIEW_FIX_MAX} review fix loops for this task. Task: ${action?.taskTitle ?? 'current task'}.`,
    );
    return true;
  }

  const fixPrompt = activePlanPrompt('/addy-fix-all', state);
  if (!fixPrompt) return false;
  await dispatchAutoPromptFreshAware(pi, ctx, fixPrompt, state, {
    autoReviewFixKey: key,
    autoReviewFixCount: fixCount + 1,
    autoReviewFindingFingerprint: fingerprint,
  });
  return true;
}

async function maybeDispatchTaskCommit(
  pi: ExtensionAPI,
  ctx: unknown,
  event: AgentEndEvent,
  previousState: ReturnType<typeof getContextWorkflowState>,
  state: ReturnType<typeof getContextWorkflowState>,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
): Promise<boolean> {
  if (commandFromPrompt(previousState.autoLastPrompt) !== '/addy-review')
    return false;
  const reviewText = latestAssistantText(event);
  if (!reviewText.trim() || reviewTextHasActionableFindings(reviewText))
    return false;
  const nextCommand = commandFromPrompt(action?.prompt);
  if (nextCommand === '/addy-review') return false;

  const reviewedTask =
    previousState.autoReviewTask && previousState.autoReviewTask !== 'none'
      ? previousState.autoReviewTask
      : previousState.currentTask;
  const trackedReviewedTask = Boolean(
    previousState.autoReviewTask && previousState.autoReviewTask !== 'none',
  );
  const planMovedPastReviewTarget = Boolean(
    reviewedTask &&
    reviewedTask !== 'none' &&
    action?.taskTitle &&
    action.taskTitle !== reviewedTask,
  );
  if (
    !trackedReviewedTask &&
    !planMovedPastReviewTarget &&
    !reviewedTaskWasCompleted(previousState, state)
  )
    return false;

  await dispatchTaskCommitPrompt(pi, ctx, state, {
    plan: previousState.activePlan,
    sliceIndex: previousState.currentSliceIndex,
    taskIndex:
      previousState.autoReviewTaskIndex ?? previousState.currentTaskIndex,
    taskTitle: reviewedTask,
  });
  return true;
}

async function maybeContinueAfterTaskCommit(
  pi: ExtensionAPI,
  ctx: unknown,
  event: AgentEndEvent,
  state: ReturnType<typeof getContextWorkflowState>,
): Promise<boolean> {
  if (commandFromPrompt(state.autoLastPrompt) !== AUTO_TASK_COMMIT_PROMPT)
    return false;

  const text = latestAssistantText(event);
  if (!agentTextReportsCommitComplete(text)) {
    (
      ctx as { ui?: { notify?: (message: string, level?: string) => void } }
    ).ui?.notify?.(
      'Addy auto paused after the task commit step; the commit result was unclear. Commit or clean the worktree, then rerun /addy-auto.',
      'warning',
    );
    return true;
  }

  const committedTarget = latestActiveStatsTarget(state);
  const stateAfterCommit = {
    ...archiveWorkflowStats(state, 'task-commit'),
    autoReviewTask: committedTarget?.taskTitle,
    autoReviewTaskIndex: committedTarget?.taskIndex,
  };
  const cwd = (ctx as { cwd?: string }).cwd;
  const nextSlicePlan = nextUnfinishedSlicePlanPath(stateAfterCommit, cwd);
  const continuationState = nextSlicePlan
    ? {
        ...stateAfterCommit,
        activePlan: nextSlicePlan,
        currentTask: undefined,
        nextTask: undefined,
        currentTaskIndex: undefined,
        taskCount: undefined,
        currentTaskSummary: undefined,
        nextTaskSummary: undefined,
      }
    : stateAfterCommit;
  setContextWorkflowState(
    ctx as never,
    continuationState,
    appendWorkflowEntry(pi),
  );
  const nextAction = nextWorkflowActionForActivePlanLifecycle(
    continuationState,
    cwd,
  );
  if (commandFromPrompt(nextAction?.prompt) === '/addy-finish') {
    await dispatchNextAutoWorkflowPrompt(pi, ctx);
    return true;
  }
  if (
    loadAddyWorkflowConfig(
      ctx as {
        cwd?: string;
        ui?: { notify?: (msg: string, level?: string) => void };
      },
    ).auto.freshContext.betweenTasks
  ) {
    if (!nextAction?.prompt) return true;
    const freshContinuationState = {
      ...continuationState,
      autoReviewTask: undefined,
      autoReviewTaskIndex: undefined,
    };
    setContextWorkflowState(
      ctx as never,
      stateWithPendingFreshPrompt(
        nextAction.prompt,
        'between-tasks',
        freshContinuationState,
      ),
      appendWorkflowEntry(pi),
    );
    await sendFreshContextContinuation(pi, ctx, 'between-tasks');
    return true;
  }
  await dispatchNextAutoWorkflowPrompt(pi, ctx);
  return true;
}

function finishTextReportsComplete(text: string): boolean {
  return (
    /(?:^|\s)Finished!(?:\s|$)/i.test(text) ||
    agentTextReportsCommitComplete(text)
  );
}

function maybeCompleteAutoFinish(
  pi: ExtensionAPI,
  ctx: unknown,
  event: AgentEndEvent,
  state: ReturnType<typeof getContextWorkflowState>,
  action: ReturnType<typeof nextWorkflowActionForActivePlanLifecycle>,
): boolean {
  if (commandFromPrompt(state.autoLastPrompt) !== '/addy-finish') return false;
  if (commandFromPrompt(action?.prompt) !== '/addy-finish') return false;
  if (!finishTextReportsComplete(latestAssistantText(event))) return false;

  const completedState = archiveWorkflowStats(
    {
      ...state,
      phases: {
        ...state.phases,
        finish: 'complete',
      },
      autoMode: false,
      autoLastPrompt: undefined,
      autoRetryKey: undefined,
      autoRetryCount: undefined,
      autoFreshPrompt: undefined,
      autoFreshExpandedPrompt: undefined,
      autoFreshReason: undefined,
      autoFreshDeliveryKey: undefined,
      autoFreshConsumedKey: undefined,
      autoReviewFixKey: undefined,
      autoReviewFixCount: undefined,
      autoReviewFindingFingerprint: undefined,
      autoReviewFixNeedsReview: undefined,
      autoReviewTask: undefined,
      autoReviewTaskIndex: undefined,
    },
    'completed',
  );
  setContextWorkflowState(
    ctx as never,
    completedState,
    appendWorkflowEntry(pi),
  );
  showWorkflowStats(pi, ctx, completedState, { heading: 'Finished!' });
  return true;
}

async function dispatchNextAutoWorkflowPrompt(
  pi: ExtensionAPI,
  ctx: unknown,
  allowSamePhase = false,
  options: DispatchOptions = {},
): Promise<void> {
  const workflowCtx = ctx as never;
  const state = getContextWorkflowState(workflowCtx);
  setContextWorkflowState(
    workflowCtx,
    state,
    options.appendEntry === false ? undefined : appendWorkflowEntry(pi),
  );
  const refreshedState = getContextWorkflowState(workflowCtx);
  const action = nextWorkflowActionForActivePlanLifecycle(
    refreshedState,
    (ctx as { cwd?: string }).cwd,
  );
  const prompt = action?.prompt;
  if (!prompt) {
    (
      ctx as { ui?: { notify?: (message: string, level?: string) => void } }
    ).ui?.notify?.(
      'Addy auto is active, but no active plan is available.',
      'warning',
    );
    return;
  }

  const pendingCommitTarget = latestCompletedActiveStatsTarget(
    refreshedState,
    (ctx as { cwd?: string }).cwd,
  );
  if (
    pendingCommitTarget &&
    commandFromPrompt(refreshedState.autoLastPrompt) !== AUTO_TASK_COMMIT_PROMPT
  ) {
    await dispatchTaskCommitPrompt(
      pi,
      ctx,
      refreshedState,
      pendingCommitTarget,
    );
    return;
  }

  const lifecycleSyncedState = stateWithCompletedLifecyclePhasesFromPlan(
    refreshedState,
    action,
  );
  const phase = phaseFromWorkflowPrompt(prompt);
  const retryKey = autoRetryKey(lifecycleSyncedState, prompt);
  const isSameIncompletePhase = phase && phase === lifecycleSyncedState.current;
  const retryCount =
    lifecycleSyncedState.autoRetryKey === retryKey
      ? (lifecycleSyncedState.autoRetryCount ?? 0)
      : 0;
  if (
    !allowSamePhase &&
    isSameIncompletePhase &&
    retryCount >= AUTO_SAME_PHASE_MAX_RETRIES
  ) {
    (
      ctx as { ui?: { notify?: (message: string, level?: string) => void } }
    ).ui?.notify?.(autoPauseWarning(prompt, action), 'warning');
    return;
  }

  const deliveryPrompt =
    !allowSamePhase && isSameIncompletePhase && retryCount >= 1
      ? autoRecoveryPrompt(prompt, action, retryCount)
      : undefined;

  const reviewTask =
    phase === 'review'
      ? (action.taskTitle ?? lifecycleSyncedState.currentTask)
      : undefined;
  const finishTask =
    phase === 'finish' ? lifecycleSyncedState.autoReviewTask : undefined;
  await dispatchAutoPromptFreshAware(
    pi,
    ctx,
    prompt,
    lifecycleSyncedState,
    {
      autoRetryKey: retryKey,
      autoRetryCount: isSameIncompletePhase ? retryCount + 1 : 0,
      autoReviewTask: reviewTask ?? finishTask,
      autoReviewTaskIndex:
        phase === 'review'
          ? lifecycleSyncedState.currentTaskIndex
          : phase === 'finish'
            ? lifecycleSyncedState.autoReviewTaskIndex
            : undefined,
    },
    reviewTask || finishTask
      ? {
          taskIndex:
            phase === 'review'
              ? lifecycleSyncedState.currentTaskIndex
              : lifecycleSyncedState.autoReviewTaskIndex,
          taskTitle: reviewTask ?? finishTask,
        }
      : undefined,
    options,
    deliveryPrompt,
  );
}

async function dispatchNextAutoWorkflowPromptAfterAgentEnd(
  pi: ExtensionAPI,
  ctx: unknown,
  event: AgentEndEvent,
): Promise<void> {
  const workflowCtx = ctx as never;
  const state = getContextWorkflowState(workflowCtx);
  if (await maybeContinueAfterTaskCommit(pi, ctx, event, state)) return;
  setContextWorkflowState(workflowCtx, state, appendWorkflowEntry(pi));
  const refreshedState = getContextWorkflowState(workflowCtx);
  const action = nextWorkflowActionForActivePlanLifecycle(
    refreshedState,
    (ctx as { cwd?: string }).cwd,
  );
  if (maybeCompleteAutoFinish(pi, ctx, event, refreshedState, action)) return;
  if (await maybeDispatchReviewFixLoop(pi, ctx, event, refreshedState, action))
    return;
  if (
    await maybeDispatchTaskCommit(pi, ctx, event, state, refreshedState, action)
  )
    return;
  await dispatchNextAutoWorkflowPrompt(pi, ctx);
}

export default function addyWorkflowMonitor(pi: ExtensionAPI) {
  pi.registerMessageRenderer?.(ADDY_STATS_MESSAGE_TYPE, (message) => {
    const details = message.details as { markdown?: unknown } | undefined;
    const markdown =
      typeof details?.markdown === 'string'
        ? details.markdown
        : typeof message.content === 'string'
          ? message.content
          : '';
    return new Markdown(markdown, 0, 0, getMarkdownTheme());
  });

  pi.on('session_start', async (_event: unknown, ctx: unknown) => {
    ensureGlobalAddyWorkflowConfig(
      ctx as {
        cwd?: string;
        ui?: { notify?: (message: string, level?: string) => void };
      },
    );
    const state = initializeWorkflowWidget(ctx as never);
    const notify = (message: string, level: string) =>
      (
        ctx as { ui?: { notify?: (message: string, level?: string) => void } }
      ).ui?.notify?.(message, level);
    if (state.autoFreshPrompt && !state.autoFreshReason) {
      notify(
        'Ignoring stale Addy auto fresh continuation without a recorded reason.',
        'warning',
      );
      setContextWorkflowState(
        ctx as never,
        { ...state, ...staleAutoFreshUpdates() },
        appendWorkflowEntry(pi),
      );
    } else if (
      validPendingFreshContinuation(state) &&
      !isSubagentChildSession()
    )
      await sendFreshContextContinuation(pi, ctx, state.autoFreshReason);
  });

  pi.on('input', (event: InputEvent, ctx: unknown) => {
    const input = event.input ?? event.text ?? '';
    const manualAddyCommand = isManualAddyWorkflowCommand(input);
    handleWorkflowEvent(
      ctx as never,
      {
        source: 'user-input',
        text: workflowTextFromInput(input),
        manualAddyCommand,
      },
      appendWorkflowEntry(pi),
    );
    return { action: 'continue' as const };
  });

  pi.on('tool_result', (event: ToolEvent, ctx: unknown) => {
    handleWorkflowEvent(
      ctx as never,
      {
        source: 'tool-result',
        text: event.text,
        command: event.command,
        success: event.success,
        artifact: event.artifact,
      },
      appendWorkflowEntry(pi),
    );
  });

  pi.on('tool_call', (event: ToolCallEvent, ctx: unknown) => {
    const artifact = extractWriteArtifact(event);
    if (!artifact) return;
    handleWorkflowEvent(
      ctx as never,
      {
        source: 'file-write',
        artifact,
      },
      appendWorkflowEntry(pi),
    );
  });

  pi.on('before_agent_start', (event: SubagentEvent, ctx: unknown) => {
    try {
      handleWorkflowEvent(
        ctx as never,
        {
          source: 'subagent-call',
          agentName: event.agentName ?? event.agent,
        },
        appendWorkflowEntry(pi),
      );
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  });

  pi.on('agent_end', async (event: AgentEndEvent, ctx: unknown) => {
    try {
      const state = getContextWorkflowState(ctx as never);
      const reviewAgent = event.agentName ?? event.agent;
      const shouldRecordReviewIssues = Boolean(
        state.reviewStatsKey &&
        (!state.reviewStatsAgent || reviewAgent === state.reviewStatsAgent),
      );
      const reviewText = latestAssistantText(event);
      const stateWithReviewIssues = shouldRecordReviewIssues
        ? recordWorkflowReviewIssues(
            state,
            reviewIssueStatsFromText(reviewText),
          )
        : state;
      if (stateWithReviewIssues !== state)
        setContextWorkflowState(
          ctx as never,
          stateWithReviewIssues,
          appendWorkflowEntry(pi),
        );
      if (!stateWithReviewIssues.autoMode) return;
      await dispatchNextAutoWorkflowPromptAfterAgentEnd(pi, ctx, event);
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  });

  for (const command of FRESH_CONTEXT_STEP_COMMANDS) {
    pi.registerCommand?.(command.slice(1), {
      description: `Run ${command} in a fresh session when Addy fresh context is enabled.`,
      handler: async (event: CommandEvent, ctx: unknown) => {
        const args = parseCommandArgs(event);
        const input = `${command}${args.length ? ` ${args.join(' ')}` : ''}`;
        handleWorkflowEvent(
          ctx as never,
          { source: 'command', text: input, manualAddyCommand: true },
          appendWorkflowEntry(pi),
        );
        if (shouldFreshContextBeforeStep(input, ctx))
          await dispatchManualStepWithFreshContextConfig(pi, input, ctx);
        else sendUserMessage(pi, ctx, input);
        return { action: 'continue' as const };
      },
    });
  }

  pi.registerCommand?.('addy-auto-continue', {
    description: 'Internal Addy auto continuation command.',
    handler: async (event: CommandEvent, ctx: unknown) => {
      const reason = parseFreshContextReason(event);
      const notify = (message: string, level: string) =>
        (
          ctx as { ui?: { notify?: (message: string, level?: string) => void } }
        ).ui?.notify?.(message, level);
      if (!reason) {
        notify(
          'Usage: /addy-auto-continue --fresh <between-tasks|before-step|before-review>',
          'warning',
        );
        return { action: 'continue' as const };
      }

      await runFreshContextContinuation(pi, ctx, reason);
      return { action: 'continue' as const };
    },
  });

  pi.registerCommand?.('addy-auto', {
    description:
      'Run the Addy build, verify, review, and finish loop for the active plan.',
    handler: async (event: CommandEvent, ctx: unknown) => {
      const args = parseCommandArgs(event);
      const notify = (message: string, level: string) =>
        (
          ctx as { ui?: { notify?: (message: string, level?: string) => void } }
        ).ui?.notify?.(message, level);
      if (args[0] !== 'stop') {
        const pending = getContextWorkflowState(ctx as never);
        if (pending.autoFreshPrompt && !pending.autoFreshReason) {
          notify(
            'Ignoring stale Addy auto fresh continuation without a recorded reason.',
            'warning',
          );
          setContextWorkflowState(
            ctx as never,
            { ...pending, ...staleAutoFreshUpdates() },
            appendWorkflowEntry(pi),
          );
        } else if (validPendingFreshContinuation(pending)) {
          await sendFreshContextContinuation(pi, ctx, pending.autoFreshReason);
          return { action: 'continue' as const };
        }
      }
      const text = `/addy-auto${args.length ? ` ${args.join(' ')}` : ''}`;

      handleWorkflowEvent(
        ctx as never,
        {
          source: 'command',
          text,
          artifact:
            args[0] === 'stop' ? undefined : args.join(' ') || undefined,
        },
        appendWorkflowEntry(pi),
      );

      if (args[0] !== 'stop')
        await dispatchNextAutoWorkflowPrompt(pi, ctx, true);
      else {
        const state = getContextWorkflowState(ctx as never);
        showWorkflowStats(pi, ctx, state, { heading: 'Addy auto stopped.' });
      }
      return { action: 'continue' as const };
    },
  });

  pi.registerCommand?.('addy-stats', {
    description: 'Show Addy workflow stats for the active or supplied plan.',
    handler: (event: CommandEvent, ctx: unknown) => {
      const args = parseCommandArgs(event);
      showWorkflowStats(pi, ctx, getContextWorkflowState(ctx as never), {
        planPath: args.join(' ') || undefined,
      });
      return { action: 'continue' as const };
    },
  });

  pi.registerCommand?.('addy-workflow-reset', {
    description: 'Reset Addy workflow state and clear the widget.',
    handler: (_event: CommandEvent, ctx: unknown) => {
      resetWorkflow(ctx as never, appendWorkflowEntry(pi));
      return { action: 'continue' as const };
    },
  });

  pi.registerCommand?.('addy-workflow-next', {
    description: 'Open an Addy workflow prompt for a requested phase.',
    handler: (event: CommandEvent, ctx: unknown) => {
      const [phase, ...artifactParts] = parseCommandArgs(event);
      if (!isWorkflowPhase(phase)) {
        (
          ctx as { ui?: { notify?: (message: string, level?: string) => void } }
        ).ui?.notify?.(
          'Usage: /addy-workflow-next <define|plan|build|simplify|verify|review|finish> [artifact]',
          'warning',
        );
        return { action: 'continue' as const };
      }

      handleWorkflowEvent(
        ctx as never,
        {
          source: 'command',
          text: `/addy-workflow-next ${phase}`,
          artifact: artifactParts.join(' ') || undefined,
        },
        appendWorkflowEntry(pi),
      );
      openNextWorkflowPrompt(
        ctx as never,
        phase,
        artifactParts.join(' ') || undefined,
      );
      return { action: 'continue' as const };
    },
  });
}
