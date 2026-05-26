import assert from 'node:assert/strict';
import addyWorkflowMonitor from '../../extensions/workflow-monitor.ts';
import type { WorkflowState } from '../../extensions/workflow-monitor/workflow-transitions.ts';

type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
type CommandConfig = { description: string; handler: Handler };

type SentMessage = {
  text: string;
  options?: { deliverAs?: string; streamingBehavior?: string };
};

export type AddyAutoLoopProofStep = {
  label: string;
  state: {
    activePlan?: string;
    activeSuitePlan?: string;
    current?: string;
    currentSliceIndex?: number;
    currentTaskId?: string;
    currentTaskIndex?: number;
    currentTask?: string;
    nextTask?: string;
    autoMode?: boolean;
    pendingAction?: string;
    committedTaskCount: number;
  };
  execution: {
    event:
      | 'input'
      | 'file-write'
      | 'tool-result'
      | 'agent-end'
      | 'idle-flush'
      | 'session-start';
    promptCommand?: string;
    promptPlan?: string;
    agentText?: string;
  };
  footer: {
    line?: string;
    containsTaskProgress: boolean;
    containsSliceProgress: boolean;
  };
};

export type AddyWorkflowHarness = ReturnType<typeof createAddyWorkflowHarness>;

export function createAddyWorkflowHarness(options: {
  cwd: string;
  id: string;
  idle?: boolean;
  canStartFreshSession?: boolean;
  freshSessionCancelled?: boolean;
  useContextSender?: boolean;
}) {
  const events = new Map<string, Handler>();
  const commands = new Map<string, CommandConfig>();
  const entries: Array<[string, unknown]> = [];
  const sentMessages: SentMessage[] = [];
  const notices: Array<{ message: string; level?: string }> = [];
  const widgets: Array<{ key: string; value: unknown; lines: string[] }> = [];
  const freshSessions: Array<{ parentSession?: string; ctx: unknown }> = [];
  const scheduled: Array<() => void> = [];
  const proof: AddyAutoLoopProofStep[] = [];
  let idle = options.idle ?? true;

  const recordSentMessage = (
    text: string,
    messageOptions?: { deliverAs?: string; streamingBehavior?: string },
  ) => sentMessages.push({ text, options: messageOptions });

  const ctx: any = {
    cwd: options.cwd,
    id: options.id,
    sessionManager: { getSessionFile: () => `${options.id}.jsonl` },
    isIdle: () => idle,
    ui: {
      setWidget: (key: string, value: unknown) => {
        widgets.push({ key, value, lines: renderWidget(value) });
      },
      setEditorText: (text: string) => sentMessages.push({ text }),
      notify: (message: string, level?: string) =>
        notices.push({ message, level }),
    },
  };
  if (options.useContextSender) ctx.sendUserMessage = recordSentMessage;
  if (options.canStartFreshSession) {
    ctx.newSession = async (freshOptions: {
      parentSession?: string;
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      if (options.freshSessionCancelled) return { cancelled: true };
      const freshCtx: any = {
        cwd: options.cwd,
        id: `${options.id}-fresh-${freshSessions.length + 1}`,
        isIdle: () => true,
        sendUserMessage: recordSentMessage,
        ui: ctx.ui,
      };
      freshSessions.push({
        parentSession: freshOptions.parentSession,
        ctx: freshCtx,
      });
      await freshOptions.withSession(freshCtx);
      return { cancelled: false };
    };
  }

  const pi = {
    on: (name: string, handler: Handler) => events.set(name, handler),
    registerCommand: (name: string, config: CommandConfig) =>
      commands.set(name, config),
    registerMessageRenderer() {},
    appendEntry: (type: string, data: unknown) => entries.push([type, data]),
    sendUserMessage: recordSentMessage,
  };
  addyWorkflowMonitor(pi as never);

  function setIdle(value: boolean) {
    idle = value;
  }

  async function flushIdle() {
    await new Promise((resolve) => setTimeout(resolve, 75));
    recordProof('idle flush', 'idle-flush');
  }

  function recordProof(
    label: string,
    event: AddyAutoLoopProofStep['execution']['event'],
    agentText?: string,
  ) {
    const state = ctx.state as WorkflowState | undefined;
    const latestPrompt = sentMessages.at(-1)?.text;
    const footer = latestFooterLine();
    proof.push({
      label,
      state: {
        activePlan: state?.activePlan,
        activeSuitePlan: state?.activeSuitePlan,
        current: state?.current,
        currentSliceIndex: state?.currentSliceIndex,
        currentTaskId: state?.currentTaskId,
        currentTaskIndex: state?.currentTaskIndex,
        currentTask: state?.currentTask,
        nextTask: state?.nextTask,
        autoMode: state?.autoMode,
        pendingAction: state?.autoPendingAction?.prompt,
        committedTaskCount: Object.keys(state?.committedTasks ?? {}).length,
      },
      execution: {
        event,
        promptCommand: commandFromPrompt(latestPrompt),
        promptPlan: planFromPrompt(latestPrompt),
        agentText,
      },
      footer: {
        line: footer,
        containsTaskProgress: Boolean(footer?.includes('Task ')),
        containsSliceProgress: Boolean(footer?.includes('Slice ')),
      },
    });
  }

  function latestFooterLine(): string | undefined {
    const lines = widgets.at(-1)?.lines;
    return (
      lines?.find((line) => line.includes('Current task:')) ?? lines?.at(-1)
    );
  }

  return {
    pi,
    ctx,
    commands,
    events,
    entries,
    sentMessages,
    notices,
    widgets,
    freshSessions,
    scheduled,
    proof,
    setIdle,
    flushIdle,
    recordProof,
    latestFooterLine,
    lastPrompt: () => sentMessages.at(-1)?.text,
    takeLastPrompt: () => sentMessages.pop()?.text,
  };
}

export function assertWorkflowPrompt(
  message: string | undefined,
  command: string,
  heading: string,
): void {
  assert.ok(message, 'expected a dispatched workflow prompt');
  assert.match(message, new RegExp(`# ${heading}`));
  assert.ok(
    message.includes(`Invocation: \`${command}\``),
    `expected invocation for ${command}`,
  );
}

export function agentEndEvent(text: string) {
  return {
    messages: [{ role: 'assistant', content: [{ type: 'text', text }] }],
  };
}

export function stripAnsi(value: string | undefined): string | undefined {
  return value?.replace(/\x1b\[[0-9;]*m/g, '');
}

function renderWidget(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'function') {
    const instance = value();
    if (
      instance &&
      typeof instance === 'object' &&
      'render' in instance &&
      typeof instance.render === 'function'
    ) {
      return instance.render();
    }
  }
  return [];
}

function commandFromPrompt(prompt: string | undefined): string | undefined {
  return prompt?.match(/Invocation: `([^`]+)`/)?.[1]?.split(/\s+/)[0];
}

function planFromPrompt(prompt: string | undefined): string | undefined {
  return prompt?.match(/Invocation: `[^`]+\s+([^`]+)`/)?.[1];
}
