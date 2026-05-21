import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import addyWorkflowMonitor from '../extensions/workflow-monitor.ts';
import { loadAddyWorkflowConfig } from '../extensions/workflow-monitor/config.ts';
import {
  getContextWorkflowState,
  handleWorkflowEvent,
  openNextWorkflowPrompt,
  setContextWorkflowState,
} from '../extensions/workflow-monitor/workflow-handler.ts';
import {
  WORKFLOW_STATE_ENTRY_TYPE,
  renderWorkflowStatsMarkdown,
  renderWorkflowStatsText,
  workflowTaskCommitKey,
} from '../extensions/workflow-monitor/workflow-tracker.ts';
import { expectedTotalTasksProgress } from './helpers.ts';

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type CommandConfig = { description: string; handler: Handler };

const stateDir = mkdtempSync(join(tmpdir(), 'pi-addy-workflow-test-'));
const previousHomeEnv = process.env.HOME;
const previousBeforeEveryStepEnv =
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
const previousSubagentChildEnv = process.env.PI_SUBAGENT_CHILD;
process.env.HOME = join(stateDir, 'home');
process.env.PI_ADDY_WORKFLOW_STATE_DIR = stateDir;
process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = '0';
delete process.env.PI_SUBAGENT_CHILD;

test.after(() => {
  if (previousHomeEnv === undefined) delete process.env.HOME;
  else process.env.HOME = previousHomeEnv;
  delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  if (previousBeforeEveryStepEnv === undefined)
    delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  else
    process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP =
      previousBeforeEveryStepEnv;
  if (previousSubagentChildEnv === undefined)
    delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = previousSubagentChildEnv;
  rmSync(stateDir, { recursive: true, force: true });
});

function createPiMock() {
  const events = new Map<string, Handler>();
  const commands = new Map<string, CommandConfig>();
  const messageRenderers = new Map<string, unknown>();
  const entries: Array<[string, unknown]> = [];
  const sentMessages: string[] = [];
  const sentMessageOptions: Array<
    { deliverAs?: string; streamingBehavior?: string } | undefined
  > = [];
  const pi = {
    on: (name: string, handler: Handler) => events.set(name, handler),
    registerCommand: (name: string, config: CommandConfig) =>
      commands.set(name, config),
    registerMessageRenderer: (name: string, renderer: unknown) =>
      messageRenderers.set(name, renderer),
    appendEntry: (type: string, data: unknown) => entries.push([type, data]),
    sendUserMessage: (
      message: string,
      options?: { deliverAs?: string; streamingBehavior?: string },
    ) => {
      sentMessages.push(message);
      sentMessageOptions.push(options);
    },
  };
  return {
    pi,
    events,
    commands,
    messageRenderers,
    entries,
    sentMessages,
    sentMessageOptions,
  };
}

function workflowPromptText(
  message: string | { message: string } | undefined,
): string | undefined {
  return typeof message === 'string' ? message : message?.message;
}

function assertSentWorkflowPrompt(
  message: string | { message: string } | undefined,
  command: string,
  heading: string,
) {
  const text = workflowPromptText(message);
  assert.ok(text, 'expected a dispatched workflow prompt');
  assert.match(text, new RegExp(`# ${heading}`));
  assert.ok(
    text.includes(`Invocation: \`${command}\``),
    `expected invocation for ${command}`,
  );
}

function committedTasksFor(
  planPath: string,
  tasks: Array<{ taskIndex: number; taskTitle: string; sliceIndex?: number }>,
) {
  return Object.fromEntries(
    tasks.map((task) => [
      workflowTaskCommitKey(planPath, task.taskIndex, task.taskTitle),
      {
        plan: planPath,
        sliceIndex: task.sliceIndex,
        taskIndex: task.taskIndex,
        taskTitle: task.taskTitle,
        commitSha: 'abc1234',
        committedAt: '2026-05-21T00:00:00.000Z',
      },
    ]),
  );
}

function reviewFingerprintForTest(lines: string[]): string {
  return createHash('sha256')
    .update(lines.map((line) => line.trim().toLowerCase()).join('\n'))
    .digest('hex')
    .slice(0, 16);
}

test('registers workflow commands and handlers', () => {
  const { pi, events, commands, messageRenderers } = createPiMock();

  addyWorkflowMonitor(pi as never);

  assert.ok(events.has('session_start'));
  assert.ok(events.has('input'));
  assert.ok(events.has('tool_result'));
  assert.ok(events.has('tool_call'));
  assert.equal(events.has('file_write'), false);
  assert.ok(events.has('before_agent_start'));
  assert.ok(events.has('agent_end'));
  assert.ok(commands.has('addy-auto'));
  assert.ok(commands.has('addy-auto-continue'));
  assert.ok(commands.has('addy-stats'));
  assert.ok(commands.has('addy-workflow-reset'));
  assert.ok(commands.has('addy-workflow-next'));
  assert.ok(messageRenderers.has('pi-addy-workflow-stats'));
});

test('subagent lifecycle ignores stale extension context events', async () => {
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const staleContextMessage =
    'This extension ctx is stale after session replacement or reload.';
  const ctx: any = { id: 'stale-subagent-context', cwd: stateDir };
  Object.defineProperty(ctx, 'state', {
    get() {
      throw new Error(staleContextMessage);
    },
  });

  assert.doesNotThrow(() =>
    events.get('before_agent_start')?.({ agentName: 'addy-reviewer' }, ctx),
  );
  await assert.doesNotReject(async () => {
    await events.get('agent_end')?.({ agentName: 'addy-reviewer' }, ctx);
  });
});

test('subagent lifecycle rethrows non-stale context errors', async () => {
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = { id: 'broken-subagent-context', cwd: stateDir };
  Object.defineProperty(ctx, 'state', {
    get() {
      throw new Error('unexpected state failure');
    },
  });

  assert.throws(
    () =>
      events.get('before_agent_start')?.({ agentName: 'addy-reviewer' }, ctx),
    /unexpected state failure/,
  );
});

test('session start creates the global Addy workflow config with defaults', async () => {
  const previousHome = process.env.HOME;
  const home = join(stateDir, 'config-home');
  process.env.HOME = home;
  try {
    const { pi, events } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const ctx: any = { id: 'config-startup', ui: { setWidget() {} } };

    await events.get('session_start')?.({}, ctx);

    const configPath = join(home, '.pi', 'agent', 'addy-workflow.json');
    assert.equal(existsSync(configPath), true);
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')).auto, {
      freshContext: {
        beforeEveryStep: true,
        betweenTasks: true,
        beforeReview: false,
      },
      review: { maxFixLoops: 3 },
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test('Addy workflow config uses fresh-context defaults and env overrides', () => {
  const config = loadAddyWorkflowConfig(
    {},
    {
      PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP: 'false',
      PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS: '0',
      PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW: 'true',
      PI_ADDY_AUTO_REVIEW_MAX_FIX_LOOPS: '2',
    },
  );

  assert.deepEqual(config.auto, {
    freshContext: {
      beforeEveryStep: false,
      betweenTasks: false,
      beforeReview: true,
    },
    review: { maxFixLoops: 2 },
  });
});

test('Addy workflow config lets project config override defaults', () => {
  const cwd = join(stateDir, 'config-project');
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  writeFileSync(
    join(cwd, '.pi', 'addy-workflow.json'),
    JSON.stringify({
      auto: {
        freshContext: { betweenTasks: false, beforeReview: true },
        review: { maxFixLoops: 4 },
      },
    }),
  );

  const config = loadAddyWorkflowConfig({ cwd }, {});

  assert.deepEqual(config.auto, {
    freshContext: {
      beforeEveryStep: true,
      betweenTasks: false,
      beforeReview: true,
    },
    review: { maxFixLoops: 4 },
  });
});

test('Addy workflow config ignores malformed project config safely', () => {
  const cwd = join(stateDir, 'config-invalid-project');
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  writeFileSync(join(cwd, '.pi', 'addy-workflow.json'), '{');
  const notices: Array<[string, string | undefined]> = [];

  const config = loadAddyWorkflowConfig(
    {
      cwd,
      ui: {
        notify: (message: string, level?: string) =>
          notices.push([message, level]),
      },
    },
    {},
  );

  assert.deepEqual(config.auto, {
    freshContext: {
      beforeEveryStep: true,
      betweenTasks: true,
      beforeReview: false,
    },
    review: { maxFixLoops: 3 },
  });
  assert.match(
    notices.at(-1)?.[0] ?? '',
    /Ignoring invalid Addy workflow config/,
  );
  assert.equal(notices.at(-1)?.[1], 'warning');
});

test('auto command activates the first unfinished slice when given an index plan', async () => {
  const cwd = join(stateDir, 'auto-command-index-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(
    join(plansDir, 'migration-index.md'),
    [
      '# Migration Index',
      '',
      '| Slice | File |',
      '| --- | --- |',
      '| 01 | `docs/plans/migration-slice-01-api.md` |',
      '| 02 | `docs/plans/migration-slice-02-runtime.md` |',
    ].join('\n'),
  );
  writeFileSync(
    join(plansDir, 'migration-slice-01-api.md'),
    [
      '## Task 1: Complete API',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(plansDir, 'migration-slice-02-runtime.md'),
    [
      '## Task 1: Migrate runtime',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const widgets: Array<[string, unknown]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-command-index',
    ui: {
      setWidget: (key: string, value: unknown) => widgets.push([key, value]),
    },
    isIdle: () => true,
  };

  await commands
    .get('addy-auto')
    ?.handler('@docs/plans/migration-index.md', ctx);

  assert.equal(ctx.state.activePlan, '@docs/plans/migration-slice-01-api.md');
  assert.equal(ctx.state.activeSuitePlan, '@docs/plans/migration-index.md');
  assert.equal(ctx.state.currentTask, 'Complete API');
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), [
    '🔁 Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish } | migration-slice-01-api.md | suite: migration-index.md',
    `Current task: Complete API | Next task: none | Slice 1/2 | Task 1/1 | ${expectedTotalTasksProgress(1, 2)}`,
  ]);
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    '/addy-build @docs/plans/migration-slice-01-api.md',
    'Addy Build',
  );
});

test('auto command dispatches the real next workflow command', async () => {
  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const ctx: any = {
    cwd: join(stateDir, 'auto-command-dispatch-project'),
    id: 'auto-command-dispatch',
    ui: { setWidget() {} },
    isIdle: () => true,
  };
  const result = await commands
    .get('addy-auto')
    ?.handler('docs/plans/auto.md', ctx);

  assert.deepEqual(result, { action: 'continue' });
  assert.equal(ctx.state.autoMode, true);
  assert.equal(ctx.state.activePlan, 'docs/plans/auto.md');
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    '/addy-build docs/plans/auto.md',
    'Addy Build',
  );
  assert.match(sentMessages[0], /Addy Auto Mode Recovery/);
  assert.match(sentMessages[0], /addy-auto-unblock/);
  assert.match(
    sentMessages[0],
    /do not skip, weaken, or silently reinterpret acceptance criteria/i,
  );
});

test('auto loop dispatches verify after the current task is implemented', async () => {
  const cwd = join(stateDir, 'auto-loop-dispatch-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-dispatch',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      autoMode: true,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.({}, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
  assert.equal(ctx.state.current, 'verify');
  assert.equal(ctx.state.phases.verify, 'active');
});

test('auto loop waits for idle before sending verify as a new turn', async () => {
  const cwd = join(stateDir, 'auto-loop-verify-idle-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages, sentMessageOptions } = createPiMock();
  addyWorkflowMonitor(pi as never);
  let idle = false;
  const ctx: any = {
    cwd,
    id: 'auto-loop-verify-idle',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-build ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify() {} },
    isIdle: () => idle,
  };

  await events.get('agent_end')?.({}, ctx);

  assert.equal(sentMessages.length, 0);
  assert.equal(ctx.state.autoPendingAction?.prompt, `/addy-verify ${planPath}`);
  idle = true;
  await new Promise((resolve) => setTimeout(resolve, 75));

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
  assert.deepEqual(sentMessageOptions[0], {
    streamingBehavior: 'followUp',
  });
  assert.equal(ctx.state.autoPendingAction, undefined);
});

test('auto loop waits for idle before sending review as a new turn', async () => {
  const cwd = join(stateDir, 'auto-loop-review-idle-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages, sentMessageOptions } = createPiMock();
  addyWorkflowMonitor(pi as never);
  let idle = false;
  const ctx: any = {
    cwd,
    id: 'auto-loop-review-idle',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'active',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-verify ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify() {} },
    isIdle: () => idle,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Verified.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.equal(ctx.state.autoPendingAction?.prompt, `/addy-review ${planPath}`);
  idle = true;
  await new Promise((resolve) => setTimeout(resolve, 75));

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-review ${planPath}`,
    'Addy Review',
  );
  assert.deepEqual(sentMessageOptions[0], {
    streamingBehavior: 'followUp',
  });
  assert.equal(ctx.state.autoPendingAction, undefined);
});

test('auto loop starts verify from an implemented plan without skipped-build warning', async () => {
  const cwd = join(stateDir, 'auto-loop-implemented-entry-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-implemented-entry',
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await commands.get('addy-auto')?.handler(planPath, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
  assert.equal(ctx.state.current, 'verify');
  assert.equal(ctx.state.phases.build, 'complete');
  assert.equal(ctx.state.phases.verify, 'active');
  assert.deepEqual(ctx.state.warnings, []);
  assert.equal(
    notices.some(
      ([message, level]) =>
        level === 'warning' && /verify started before build/.test(message),
    ),
    false,
  );
});

test('auto-dispatched workflow prompts advance the footer phase', async () => {
  const cwd = join(stateDir, 'auto-loop-footer-phase-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages, sentMessageOptions } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-footer-phase',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'active',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      autoMode: true,
      autoLastPrompt: `/addy-verify ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Verified.' }] },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-review ${planPath}`,
    'Addy Review',
  );
  assert.deepEqual(sentMessageOptions[0], {
    streamingBehavior: 'followUp',
  });
  assert.equal(ctx.state.current, 'review');
  assert.equal(ctx.state.phases.verify, 'complete');
  assert.equal(ctx.state.phases.review, 'active');
});

test('real workflow commands preserve auto mode so the loop can continue', async () => {
  const cwd = join(stateDir, 'auto-loop-preserve-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-preserve',
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await commands.get('addy-auto')?.handler(planPath, ctx);
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-build ${planPath}`,
    'Addy Build',
  );

  await events.get('input')?.({ input: sentMessages.at(-1) }, ctx);
  assert.equal(ctx.state.autoMode, true);
  assert.equal(ctx.state.current, 'build');

  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  await events.get('agent_end')?.({}, ctx);
  assert.equal(sentMessages.length, 2);
  assertSentWorkflowPrompt(
    sentMessages[1],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
});

test('manual Addy command exits auto mode', async () => {
  const cwd = join(stateDir, 'manual-command-exits-auto-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'manual-command-exits-auto',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      autoMode: true,
      autoLastPrompt: `/addy-build ${planPath}`,
      autoRetryKey: 'retry',
      autoRetryCount: 1,
      autoFreshPrompt: `/addy-build ${planPath}`,
      autoReviewTask: 'Current',
      activePlan: planPath,
    },
    ui: { setWidget() {} },
  };

  await events.get('input')?.({ input: `/addy-verify ${planPath}` }, ctx);

  assert.equal(ctx.state.autoMode, false);
  assert.equal(ctx.state.autoLastPrompt, undefined);
  assert.equal(ctx.state.autoRetryKey, undefined);
  assert.equal(ctx.state.autoRetryCount, undefined);
  assert.equal(ctx.state.autoFreshPrompt, undefined);
  assert.equal(ctx.state.autoReviewTask, undefined);
  assert.equal(ctx.state.current, 'verify');
});

test('registered manual workflow step command exits auto mode', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'false';
  try {
    const cwd = join(stateDir, 'registered-step-exits-auto-project');
    const planPath = join('docs', 'plans', 'auto-loop.md');
    const { pi, commands, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const ctx: any = {
      cwd,
      id: 'registered-step-exits-auto',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'active',
          simplify: 'pending',
          verify: 'pending',
          review: 'pending',
          finish: 'pending',
        },
        warnings: [],
        current: 'build',
        autoMode: true,
        autoLastPrompt: `/addy-build ${planPath}`,
        autoRetryKey: 'retry',
        autoRetryCount: 1,
        autoFreshPrompt: `/addy-build ${planPath}`,
        autoReviewTask: 'Current',
        activePlan: planPath,
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await commands.get('addy-verify')?.handler({ args: [planPath] }, ctx);

    assert.equal(ctx.state.autoMode, false);
    assert.equal(ctx.state.autoLastPrompt, undefined);
    assert.equal(ctx.state.autoRetryKey, undefined);
    assert.equal(ctx.state.autoRetryCount, undefined);
    assert.equal(ctx.state.autoFreshPrompt, undefined);
    assert.equal(ctx.state.autoReviewTask, undefined);
    assert.equal(ctx.state.current, 'verify');
    assertSentWorkflowPrompt(
      sentMessages[0],
      `/addy-verify ${planPath}`,
      'Addy Verify',
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('manual build command redirects to frontier verify instead of later build', async () => {
  const cwd = join(stateDir, 'manual-build-frontier-guard-project');
  const planPath = join('docs', 'plans', 'frontier.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Needs verification',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 2: Later build',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'manual-build-frontier-guard',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      activePlan: planPath,
      currentTask: 'Needs verification',
      currentTaskIndex: 1,
      taskCount: 2,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };

  await commands.get('addy-build')?.handler({ args: [planPath] }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
  assert.match(
    notices.at(-1)?.[0] ?? '',
    /frontier task requires \/addy-verify/,
  );
});

test('raw manual build input redirects to frontier verify instead of later build', async () => {
  const cwd = join(stateDir, 'raw-manual-build-frontier-guard-project');
  const planPath = join('docs', 'plans', 'frontier.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Needs verification',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 2: Later build',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'raw-manual-build-frontier-guard',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      activePlan: planPath,
      currentTask: 'Needs verification',
      currentTaskIndex: 1,
      taskCount: 2,
    },
    ui: { setWidget() {}, notify() {} },
  };

  await events.get('input')?.({ input: `/addy-build ${planPath}` }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
});

test('registered workflow next command exits auto mode', async () => {
  const cwd = join(stateDir, 'workflow-next-exits-auto-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const prefills: string[] = [];
  const ctx: any = {
    cwd,
    id: 'workflow-next-exits-auto',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      autoMode: true,
      autoLastPrompt: `/addy-build ${planPath}`,
      autoRetryKey: 'retry',
      autoRetryCount: 1,
      autoFreshPrompt: `/addy-build ${planPath}`,
      autoReviewTask: 'Current',
      activePlan: planPath,
    },
    input: { prefill: (value: string) => prefills.push(value) },
    ui: { setWidget() {} },
  };

  await commands
    .get('addy-workflow-next')
    ?.handler({ args: ['verify', planPath] }, ctx);

  assert.equal(ctx.state.autoMode, false);
  assert.equal(ctx.state.autoLastPrompt, undefined);
  assert.equal(ctx.state.autoRetryKey, undefined);
  assert.equal(ctx.state.autoRetryCount, undefined);
  assert.equal(ctx.state.autoFreshPrompt, undefined);
  assert.equal(ctx.state.autoReviewTask, undefined);
  assert.equal(ctx.state.current, 'verify');
  assert.deepEqual(prefills, [`/addy-verify ${planPath}`]);
});

test('auto loop self-unblocks repeated incomplete same-phase steps', async () => {
  const cwd = join(stateDir, 'auto-loop-pause-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-pause',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      autoMode: true,
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.({}, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-build ${planPath}`,
    'Addy Build',
  );

  await events.get('input')?.({ input: sentMessages.at(-1) }, ctx);
  await events.get('agent_end')?.({}, ctx);

  assert.equal(sentMessages.length, 2);
  assertSentWorkflowPrompt(
    sentMessages[1],
    `/addy-build ${planPath}`,
    'Addy Build',
  );
  assert.match(sentMessages[1], /Addy Auto Same-Phase Recovery Pass/);
  assert.match(sentMessages[1], /Grind until the phase is complete/);
  assert.equal(notices.length, 0);
});

test('auto loop same-phase retry works for verify and review too', async () => {
  const cases: Array<{
    phase: 'verify' | 'review';
    statuses: string[];
    command: string;
  }> = [
    {
      phase: 'verify',
      statuses: ['- [x] Implemented', '- [ ] Verified', '- [ ] Reviewed'],
      command: '/addy-verify',
    },
    {
      phase: 'review',
      statuses: ['- [x] Implemented', '- [x] Verified', '- [ ] Reviewed'],
      command: '/addy-review',
    },
  ];

  for (const testCase of cases) {
    const cwd = join(stateDir, `auto-loop-${testCase.phase}-retry-project`);
    const planPath = join('docs', 'plans', 'auto-loop.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      ['## Task 1: Current', ...testCase.statuses].join('\n'),
    );

    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const notices: Array<[string, string | undefined]> = [];
    const ctx: any = {
      cwd,
      id: `auto-loop-${testCase.phase}-retry`,
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: testCase.phase === 'verify' ? 'active' : 'complete',
          review: testCase.phase === 'review' ? 'active' : 'pending',
          finish: 'pending',
        },
        warnings: [],
        current: testCase.phase,
        autoMode: true,
        activePlan: planPath,
      },
      ui: {
        setWidget() {},
        notify: (message: string, level?: string) =>
          notices.push([message, level]),
      },
      isIdle: () => true,
    };

    await events.get('agent_end')?.({}, ctx);
    assert.equal(sentMessages.length, 1);
    assertSentWorkflowPrompt(
      sentMessages[0],
      `${testCase.command} ${planPath}`,
      testCase.phase === 'verify' ? 'Addy Verify' : 'Addy Review',
    );

    await events.get('input')?.({ input: sentMessages.at(-1) }, ctx);
    await events.get('agent_end')?.({}, ctx);
    assert.equal(sentMessages.length, 2);
    assertSentWorkflowPrompt(
      sentMessages[1],
      `${testCase.command} ${planPath}`,
      testCase.phase === 'verify' ? 'Addy Verify' : 'Addy Review',
    );
    assert.match(sentMessages[1], /Addy Auto Same-Phase Recovery Pass/);
    assert.equal(notices.length, 0);
  }
});

test('auto loop pauses only after the same-phase retry safety cap', async () => {
  const cwd = join(stateDir, 'auto-loop-retry-cap-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const retryPrompt = `/addy-build ${planPath}`;
  const retryKey = [retryPrompt, planPath, 1, 'Current', 'none'].join('\u001f');
  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-retry-cap',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      currentTask: 'Current',
      nextTask: 'none',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      activePlan: planPath,
      autoRetryKey: retryKey,
      autoRetryCount: 12,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.({}, ctx);

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /paused at \/addy-build/);
  assert.equal(notices.at(-1)?.[1], 'warning');
  assert.equal(ctx.state.autoPausedReason, 'same-phase-retry-limit');
});

test('auto loop runs fix-all when review surfaces actionable findings', async () => {
  const cwd = join(stateDir, 'auto-loop-review-fix-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-review-fix',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Important: fix tests/unit/example.test.ts:12 before review can pass.',
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-fix-all ${planPath}`,
    'Addy Fix All',
  );
  assert.match(sentMessages[0], /Addy Auto Fix-All Handoff/);
  assert.match(
    sentMessages[0],
    /Do not invoke or perform `\/addy-verify` or `\/addy-review` inside this `\/addy-fix-all` turn/,
  );
  assert.match(
    sentMessages[0],
    /dispatch `\/addy-verify` first, then `\/addy-review`/,
  );
  assert.equal(ctx.state.autoReviewFixCount, 1);
});

test('auto loop verifies again after fix-all', async () => {
  const cwd = join(stateDir, 'auto-loop-fix-verify-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-fix-verify',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      autoLastPrompt: `/addy-fix-all ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Fixed surfaced review findings.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
  assert.equal(ctx.state.autoReviewFixNeedsReview, true);
});

test('auto loop reviews again after post-fix verify even when plan is already reviewed', async () => {
  const cwd = join(stateDir, 'auto-loop-fix-verify-review-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-fix-verify-review',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'active',
        review: 'complete',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-verify ${planPath}`,
      autoReviewFixNeedsReview: true,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Verification passed after review fixes.' },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-review ${planPath}`,
    'Addy Review',
  );
  assert.equal(ctx.state.autoReviewFixNeedsReview, false);
});

test('auto loop commits a completed reviewed task before moving to the next task', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      'Repository scope: `../invoices-converter` only.',
      '',
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'No issues found. Marked Reviewed.' },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^# Addy Auto Commit/);
  assert.match(sentMessages[0], /Completed task: Current/);
  assert.match(
    sentMessages[0],
    new RegExp(
      `Repository scope: ${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}; `,
    ),
  );
  assert.match(sentMessages[0], /invoices-converter/);
  assert.match(
    sentMessages[0],
    /Do not try to invoke, search for, or print a `\/commit` slash command/,
  );
  assert.match(sentMessages[0], /`git -C <repo> status --short`/);
  assert.match(sentMessages[0], /run the project formatter/);
  assert.match(sentMessages[0], /project lint\/format check/);
  assert.match(sentMessages[0], /Stage all current changed files/);
  assert.match(sentMessages[0], /tracked, unstaged, untracked/);
  assert.match(sentMessages[0], /Invocation: `__addy-auto-task-commit__`/);
  assert.match(sentMessages[0], /Do not call ask_user_question/);
});

test('auto loop waits for idle before sending task commit as a new turn', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-idle-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages, sentMessageOptions } = createPiMock();
  addyWorkflowMonitor(pi as never);
  let idle = false;
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-idle',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify() {} },
    isIdle: () => idle,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  idle = true;
  await new Promise((resolve) => setTimeout(resolve, 75));

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^# Addy Auto Commit/);
  assert.deepEqual(sentMessageOptions[0], {
    streamingBehavior: 'followUp',
  });
});

test('auto loop drops stale delayed task commit before idle delivery', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-stale-idle-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  let idle = false;
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-stale-idle',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify() {} },
    isIdle: () => idle,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  setContextWorkflowState(ctx, {
    ...getContextWorkflowState(ctx),
    autoLastPrompt: `/addy-build ${planPath}`,
  });
  idle = true;
  await new Promise((resolve) => setTimeout(resolve, 75));

  assert.equal(sentMessages.length, 0);
});

test('auto loop preserves delayed prompt when session is compacted before idle delivery', async () => {
  const cwd = join(stateDir, 'auto-loop-stale-idle-review-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  let idle = false;
  const ctx: any = {
    cwd,
    id: 'auto-loop-stale-idle-review',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'active',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 1,
      stats: {
        active: {
          tasks: {
            [`${planPath}\u001f\u001f1\u001fCurrent`]: {
              plan: planPath,
              taskIndex: 1,
              taskTitle: 'Current',
              turns: 1,
              verifyRuns: 1,
              reviewRuns: 0,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
      autoMode: true,
      autoLastPrompt: `/addy-verify ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify() {} },
    isIdle: () => idle,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Verified.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(ctx.state.autoPendingAction?.prompt, `/addy-review ${planPath}`);
  ctx.sessionManager = {
    getBranch() {
      throw new Error('This extension ctx is stale after session replacement');
    },
  };
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.once('uncaughtException', onUncaught);
  idle = true;
  await new Promise((resolve) => setTimeout(resolve, 75));
  process.off('uncaughtException', onUncaught);

  assert.equal(sentMessages.length, 0);
  assert.deepEqual(uncaught, []);
  assert.equal(ctx.state.autoPendingAction?.prompt, `/addy-review ${planPath}`);

  const nextCtx: any = {
    cwd,
    id: 'auto-loop-stale-idle-review-next',
    ui: { setWidget() {}, notify() {} },
    isIdle: () => true,
  };
  await events.get('session_start')?.({}, nextCtx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-review ${planPath}`,
    'Addy Review',
  );
});

test('auto loop preserves retry path when delayed task commit delivery fails', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-idle-failure-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const sentMessages: string[] = [];
  const notices: Array<[string, string | undefined]> = [];
  let idle = false;
  let shouldReject = true;
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-idle-failure',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    sendUserMessage: (message: string) => {
      if (shouldReject) return Promise.reject(new Error('sender unavailable'));
      sentMessages.push(message);
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => idle,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );

  idle = true;
  await new Promise((resolve) => setTimeout(resolve, 75));

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /could not deliver/);
  assert.equal(notices.at(-1)?.[1], 'warning');
  assert.equal(
    getContextWorkflowState(ctx).autoLastPrompt,
    '__addy-auto-task-commit__',
  );

  shouldReject = false;
  await commands.get('addy-auto')?.handler({ args: [] }, ctx);

  assert.match(sentMessages.at(-1) ?? '', /^# Addy Auto Commit/);
});

test('auto loop preserves retry path when immediate task commit delivery fails', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-immediate-failure-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const sentMessages: string[] = [];
  const notices: Array<[string, string | undefined]> = [];
  let shouldReject = true;
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-immediate-failure',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    sendUserMessage: (message: string) => {
      if (shouldReject) return Promise.reject(new Error('sender unavailable'));
      sentMessages.push(message);
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /could not deliver/);
  assert.equal(
    getContextWorkflowState(ctx).autoLastPrompt,
    '__addy-auto-task-commit__',
  );

  await commands.get('addy-auto')?.handler({ args: [] }, ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /could not deliver/);
  assert.equal(
    getContextWorkflowState(ctx).autoLastPrompt,
    '__addy-auto-task-commit__',
  );

  shouldReject = false;
  await commands.get('addy-auto')?.handler({ args: [] }, ctx);

  assert.match(sentMessages.at(-1) ?? '', /^# Addy Auto Commit/);
});

test('auto loop does not accept reviewed checkbox written by build without review evidence', async () => {
  const cwd = join(stateDir, 'auto-loop-build-illegal-reviewed-project');
  const planPath = join('docs', 'plans', 'auto-loop-build-illegal-reviewed.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const statsKey = `${planPath}\u001f\u001f1\u001fCurrent`;
  const ctx: any = {
    cwd,
    id: 'auto-loop-build-illegal-reviewed',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-build ${planPath}`,
      activePlan: planPath,
      stats: {
        active: {
          tasks: {
            [statsKey]: {
              plan: planPath,
              taskIndex: 1,
              taskTitle: 'Current',
              turns: 1,
              verifyRuns: 0,
              reviewRuns: 0,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Built, tested, and self-reviewed.' },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
  assert.doesNotMatch(sentMessages[0], /^# Addy Auto Commit/);
});

test('auto loop extracts cross-repo scope from slice index metadata', async () => {
  const cwd = join(stateDir, 'invoicehub-files-to-api');
  const planPath = join('docs', 'plans', 'slice-01.md');
  const indexPath = join('docs', 'plans', 'index.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, indexPath),
    [
      '# Index',
      '**Owner repo:** `invoicehub-files-to-api`',
      '**Companion repo:** sibling `../invoices-converter`',
    ].join('\n'),
  );
  writeFileSync(
    join(cwd, planPath),
    [
      'Index: `docs/plans/index.md`',
      'Repository scope: `../invoices-converter` only.',
      '',
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-cross-repo-scope',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'No issues found. Marked Reviewed.' },
          ],
        },
      ],
    },
    ctx,
  );

  assert.match(
    sentMessages[0],
    new RegExp(
      `Repository scope: ${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}; `,
    ),
  );
  assert.match(
    sentMessages[0],
    new RegExp(
      join(stateDir, 'invoices-converter').replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      ),
    ),
  );
  assert.match(
    sentMessages[0],
    /Use the full repository scope above instead of relying on fresh-session file-touch history/,
  );
});

test('auto loop resolves relative Index paths from the slice plan directory', async () => {
  const cwd = join(stateDir, 'relative-index-owner');
  const planPath = join('docs', 'plans', 'slice-01.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, 'docs', 'plans', 'index.md'),
    [
      '# Index',
      '**Companion repo:** sibling `../relative-index-companion`',
    ].join('\n'),
  );
  writeFileSync(
    join(cwd, planPath),
    [
      'Index: `index.md`',
      '',
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-relative-index-scope',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'No issues found. Marked Reviewed.' },
          ],
        },
      ],
    },
    ctx,
  );

  assert.match(
    sentMessages[0],
    new RegExp(
      join(stateDir, 'relative-index-companion').replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      ),
    ),
  );
});

test('auto loop commits reviewed task even when refreshed state already points at next task', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-advanced-state-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 18: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 19: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-advanced-state',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Next',
      currentTaskIndex: 2,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewTask: 'Current',
      autoReviewTaskIndex: 1,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'No issues found. Marked Reviewed.' },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^# Addy Auto Commit/);
  assert.match(sentMessages[0], /Completed task: Current/);
  assert.doesNotMatch(sentMessages[0], /Completed task: Next/);
});

test('auto loop preserves project auto state over stale non-auto branch state after review', async () => {
  const cwd = join(stateDir, 'auto-loop-stale-non-auto-review-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const projectCtx: any = {
    cwd,
    id: 'auto-loop-stale-non-auto-review-project-state',
    ui: { setWidget() {} },
  };
  setContextWorkflowState(projectCtx, {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'complete',
      simplify: 'pending',
      verify: 'complete',
      review: 'active',
      finish: 'pending',
    },
    warnings: [],
    current: 'review',
    currentTask: 'Current',
    currentTaskIndex: 1,
    taskCount: 2,
    autoMode: true,
    autoLastPrompt: `/addy-review ${planPath}`,
    activePlan: planPath,
  });

  const staleBranchState = {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'complete',
      simplify: 'pending',
      verify: 'complete',
      review: 'complete',
      finish: 'active',
    },
    warnings: [],
    current: 'finish',
    currentTask: 'Current',
    currentTaskIndex: 1,
    taskCount: 2,
    autoMode: false,
    autoLastPrompt: undefined,
    lastTrigger: '/addy-finish',
    activePlan: planPath,
  };
  const ctx: any = {
    cwd,
    id: 'auto-loop-stale-non-auto-review-session',
    sessionManager: {
      getBranch: () => [[WORKFLOW_STATE_ENTRY_TYPE, staleBranchState]],
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  assert.equal(getContextWorkflowState(ctx).autoMode, true);
  assert.equal(
    getContextWorkflowState(ctx).autoLastPrompt,
    `/addy-review ${planPath}`,
  );

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'No issues found. Marked Reviewed.' },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^# Addy Auto Commit/);
  assert.match(sentMessages[0], /Completed task: Current/);
  assert.equal(getContextWorkflowState(ctx).autoMode, true);
});

test('explicit addy-auto stop is not resurrected by older project auto state', () => {
  const cwd = join(stateDir, 'auto-loop-stop-not-resurrected-project');
  const { pi } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const projectCtx: any = {
    cwd,
    id: 'auto-loop-stop-not-resurrected-project-state',
    ui: { setWidget() {} },
  };
  setContextWorkflowState(projectCtx, {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'active',
      simplify: 'pending',
      verify: 'pending',
      review: 'pending',
      finish: 'pending',
    },
    warnings: [],
    current: 'build',
    autoMode: true,
    autoLastPrompt: '/addy-build docs/plans/current.md',
    activePlan: 'docs/plans/current.md',
  });

  const stoppedState = {
    ...projectCtx.state,
    autoMode: false,
    autoLastPrompt: undefined,
    autoPausedReason: 'user-stopped',
    lastTrigger: '/addy-auto stop',
  };
  const ctx: any = {
    cwd,
    id: 'auto-loop-stop-not-resurrected-session',
    sessionManager: {
      getBranch: () => [[WORKFLOW_STATE_ENTRY_TYPE, stoppedState]],
    },
    ui: { setWidget() {} },
  };

  assert.equal(getContextWorkflowState(ctx).autoMode, false);
  assert.equal(getContextWorkflowState(ctx).autoLastPrompt, undefined);
});

test('auto loop fixes review findings even when plan was incorrectly marked reviewed', async () => {
  const cwd = join(stateDir, 'auto-loop-reviewed-with-findings-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-reviewed-with-findings',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Critical: fix src/foo.ts:10 before review can pass.',
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-fix-all ${planPath}`,
    'Addy Fix All',
  );
});

test('auto loop fixes mixed clean and warning review output', async () => {
  const cwd = join(stateDir, 'auto-loop-reviewed-with-warning-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const cases = [
    'No issues found in Critical issues.\nWarnings:\n- Retry counter is stale.',
    'Critical issues: none\nWarnings:\n- This can auto-commit unrelated changes.',
    'No actionable findings\nSuggestions:\n- Prefer a smaller guard.',
  ];

  for (const [index, reviewText] of cases.entries()) {
    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const ctx: any = {
      cwd,
      id: `auto-loop-reviewed-with-warning-${index}`,
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'complete',
          review: 'active',
          finish: 'pending',
        },
        warnings: [],
        current: 'review',
        currentTask: 'Current',
        currentTaskIndex: 1,
        taskCount: 2,
        autoMode: true,
        autoLastPrompt: `/addy-review ${planPath}`,
        activePlan: planPath,
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await events.get('agent_end')?.(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: reviewText }] },
        ],
      },
      ctx,
    );

    assert.equal(sentMessages.length, 1, reviewText);
    assertSentWorkflowPrompt(
      sentMessages[0],
      `/addy-fix-all ${planPath}`,
      'Addy Fix All',
    );
  }
});

test('auto loop treats clean structured review output as clean', async () => {
  const cwd = join(stateDir, 'auto-loop-clean-structured-review-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-clean-structured-review',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Critical issues: none\nWarnings: none\nSuggestions: none',
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^# Addy Auto Commit/);
});

test('auto loop runs fix-all when clean review leaves reviewed unchecked', async () => {
  const cwd = join(stateDir, 'auto-loop-clean-review-unchecked-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-clean-review-unchecked',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-fix-all ${planPath}`,
    'Addy Fix All',
  );
  assert.equal(ctx.state.autoReviewFixCount, 1);
});

test('auto loop commits when clean review has checked reviewed but lifecycle evidence is stale', async () => {
  const cwd = join(stateDir, 'auto-loop-clean-review-stale-evidence-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-clean-review-stale-evidence',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^# Addy Auto Commit/);
  assert.match(sentMessages[0], /Completed task: Current/);
  assert.equal(ctx.state.autoReviewFixCount, undefined);
});

test('addy-auto advances from stale completed numeric slice to next unfinished slice', async () => {
  const cwd = join(stateDir, 'auto-loop-stale-completed-numeric-slice-project');
  const plansDir = join(cwd, 'docs', 'plans', 'suite');
  const firstPlan = join(
    'docs',
    'plans',
    'suite',
    '02-b2bd-first-vertical-proof.md',
  );
  const secondPlan = join('docs', 'plans', 'suite', '03-b2bi-context-slice.md');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(
    join(cwd, firstPlan),
    [
      '## Task 1: Finished slice task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(cwd, secondPlan),
    [
      '## Task 1: Next slice task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-stale-completed-numeric-slice',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Finished slice task',
      currentTaskIndex: 1,
      taskCount: 1,
      activePlan: firstPlan,
      committedTasks: committedTasksFor(firstPlan, [
        { taskIndex: 1, taskTitle: 'Finished slice task', sliceIndex: 2 },
      ]),
    },
    ui: { setWidget() {}, notify() {} },
    isIdle: () => true,
  };

  await commands.get('addy-auto')?.handler({ args: [firstPlan] }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-build ${secondPlan}`,
    'Addy Build',
  );
  assert.equal(ctx.state.activePlan, secondPlan);
  assert.equal(ctx.state.activeSuitePlan, firstPlan);
});

test('agent_end auto loop continues next task in current session after task commit', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-continue-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const replacementMessages: string[] = [];
  let newSessionParent: string | undefined;
  let replacementCtx: any;
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-continue',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      autoLastPrompt: [
        '# Addy Auto Commit',
        '',
        'Invocation: `__addy-auto-task-commit__`',
      ].join('\n'),
      activePlan: planPath,
    },
    sessionManager: { getSessionFile: () => 'old-session.jsonl' },
    newSession: async (options: {
      parentSession?: string;
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      newSessionParent = options.parentSession;
      replacementCtx = {
        cwd,
        id: 'replacement-session',
        ui: { setWidget() {}, notify() {} },
        isIdle: () => true,
        sendUserMessage: (message: string) => replacementMessages.push(message),
      };
      await options.withSession(replacementCtx);
      return { cancelled: false };
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'COMMIT: abc1234' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(newSessionParent, undefined);
  assert.equal(replacementMessages.length, 0);
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-build ${planPath}`,
    'Addy Build',
  );
  const committed =
    ctx.state.committedTasks?.[workflowTaskCommitKey(planPath, 1, 'Current')];
  assert.equal(committed?.commitSha, 'abc1234');
  assert.equal(ctx.state.autoFreshPrompt, undefined);
  const nextStatsKey = `${planPath}2Next`;
  assert.equal(ctx.state.stats.active.tasks[nextStatsKey].turns, 1);
  assert.equal(ctx.state.stats.active.tasks[`${planPath}1Current`], undefined);
});

test('agent_end auto loop preserves next task prompt when current context cannot send', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-no-sender-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  delete (pi as { sendUserMessage?: unknown }).sendUserMessage;
  addyWorkflowMonitor(pi as never);
  const editorTexts: string[] = [];
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-no-sender',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      autoLastPrompt: [
        '# Addy Auto Commit',
        '',
        'Invocation: `__addy-auto-task-commit__`',
      ].join('\n'),
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      setEditorText: (text: string) => editorTexts.push(text),
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'COMMIT: abc1234' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.match(editorTexts[0], /# Addy Build/);
  assert.match(notices.at(-1)?.[0] ?? '', /preserved for retry/);
  assert.equal(ctx.state.autoMode, true);
  assert.equal(ctx.state.autoPendingAction?.prompt, `/addy-build ${planPath}`);
  assert.equal(ctx.state.autoPendingAction?.taskTitle, 'Next');
  assert.equal(ctx.state.autoPendingAction?.reason, 'idle-retry');
});

test('agent_end auto loop continues next slice in current session after no-op task commit', async () => {
  const cwd = join(stateDir, 'auto-loop-noop-commit-next-slice-project');
  const firstPlan = join('docs', 'plans', 'feature-slice-01-one.md');
  const secondPlan = join('docs', 'plans', 'feature-slice-02-two.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, firstPlan),
    [
      '## Task 1: Done',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(cwd, secondPlan),
    [
      '## Task 1: Next slice task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const replacementMessages: string[] = [];
  const statsKey = `${firstPlan}\u001f1\u001f1\u001fDone`;
  const ctx: any = {
    cwd,
    id: 'auto-loop-noop-commit-next-slice',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      autoLastPrompt: [
        '# Addy Auto Commit',
        '',
        'Invocation: `__addy-auto-task-commit__`',
      ].join('\n'),
      activePlan: firstPlan,
      stats: {
        active: {
          tasks: {
            [statsKey]: {
              plan: firstPlan,
              sliceIndex: 1,
              taskIndex: 1,
              taskTitle: 'Done',
              turns: 3,
              verifyRuns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
    },
    sessionManager: { getSessionFile: () => 'old-session.jsonl' },
    newSession: async (options: {
      parentSession?: string;
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      await options.withSession({
        cwd,
        id: 'next-slice-replacement',
        ui: { setWidget() {}, notify() {} },
        isIdle: () => true,
        sendUserMessage: (message: string) => replacementMessages.push(message),
      });
      return { cancelled: false };
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No changes to commit' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(replacementMessages.length, 0);
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-build ${secondPlan}`,
    'Addy Build',
  );
  const committed =
    ctx.state.committedTasks?.[workflowTaskCommitKey(firstPlan, 1, 'Done')];
  assert.equal(committed?.commitSha, 'no-changes');
  assert.equal(ctx.state.autoFreshPrompt, undefined);
});

test('auto loop can disable between-task fresh context', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-no-fresh-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const previousEnv = process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS;
  process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS = 'false';
  try {
    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const ctx: any = {
      cwd,
      id: 'auto-loop-task-commit-no-fresh',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'complete',
          review: 'active',
          finish: 'pending',
        },
        warnings: [],
        current: 'review',
        autoMode: true,
        autoLastPrompt: [
          '# Addy Auto Commit',
          '',
          'Invocation: `__addy-auto-task-commit__`',
        ].join('\n'),
        activePlan: planPath,
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await events.get('agent_end')?.(
      {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'COMMIT: abc1234' }],
          },
        ],
      },
      ctx,
    );

    assert.equal(sentMessages.length, 1);
    assertSentWorkflowPrompt(
      sentMessages[0],
      `/addy-build ${planPath}`,
      'Addy Build',
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS;
    else process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS = previousEnv;
  }
});

test('agent_end auto loop continues review in current session when fresh is configured', async () => {
  const cwd = join(stateDir, 'auto-loop-review-fresh-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const previousEnv = process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW;
  process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW = 'true';
  try {
    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const replacementMessages: string[] = [];
    let replacementCtx: any;
    let currentPhaseAtReviewSend: unknown;
    const statsKey = `${planPath}\u001f\u001f1\u001fCurrent`;
    const ctx: any = {
      cwd,
      id: 'auto-loop-review-fresh',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'complete',
          review: 'pending',
          finish: 'pending',
        },
        warnings: [],
        current: 'verify',
        currentTask: 'Current',
        currentTaskIndex: 1,
        autoMode: true,
        autoLastPrompt: `/addy-verify ${planPath}`,
        activePlan: planPath,
        stats: {
          active: {
            tasks: {
              [statsKey]: {
                plan: planPath,
                taskIndex: 1,
                taskTitle: 'Current',
                turns: 1,
                reviewRuns: 0,
                issues: {
                  critical: 0,
                  important: 0,
                  suggestion: 0,
                  unknown: 0,
                  total: 0,
                },
              },
            },
          },
          history: [],
        },
      },
      newSession: async (options: {
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => {
        replacementCtx = {
          cwd,
          id: 'review-replacement',
          ui: { setWidget() {}, notify() {} },
          isIdle: () => true,
          sendUserMessage: (message: string) => {
            currentPhaseAtReviewSend = replacementCtx.state?.current;
            replacementMessages.push(message);
          },
        };
        await options.withSession(replacementCtx);
        return { cancelled: false };
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await events.get('agent_end')?.(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'Verified.' }] },
        ],
      },
      ctx,
    );

    assert.equal(sentMessages.length, 1);
    assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 1);
    assert.equal(ctx.state.autoFreshPrompt, undefined);
    assert.equal(ctx.state.current, 'review');
    assert.equal(ctx.state.phases.review, 'active');

    assert.equal(replacementMessages.length, 0);
    assertSentWorkflowPrompt(
      sentMessages[0],
      `/addy-review ${planPath}`,
      'Addy Review',
    );
    assert.equal(currentPhaseAtReviewSend, undefined);
    assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 2);
    assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 1);
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW;
    else process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW = previousEnv;
  }
});

test('addy-auto continues review in current session when fresh is configured', async () => {
  const previousEnv = process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW;
  process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW = 'true';
  try {
    const cwd = join(stateDir, 'auto-command-review-current-project');
    const planPath = join('docs', 'plans', 'auto-command-review.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Current',
        '- [x] Implemented',
        '- [x] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    );

    const { pi, commands, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    let newSessionCalls = 0;
    const replacementMessages: string[] = [];
    let compactCalls = 0;
    const ctx: any = {
      cwd,
      id: 'auto-command-review-current',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'complete',
          review: 'pending',
          finish: 'pending',
        },
        warnings: [],
        current: 'verify',
        autoMode: true,
        activePlan: planPath,
        currentTask: 'Current',
        currentTaskIndex: 1,
      },
      newSession: async (options: {
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => {
        newSessionCalls += 1;
        await options.withSession({
          ...ctx,
          id: 'auto-command-review-replacement',
          sendUserMessage: (message: string) =>
            replacementMessages.push(message),
        });
        return { cancelled: false };
      },
      compact: () => {
        compactCalls += 1;
        throw new Error('/addy-auto must not compact or replace the session');
      },
      isIdle: () => true,
      ui: { setWidget() {}, notify() {} },
    };
    setContextWorkflowState(ctx, ctx.state);

    await commands.get('addy-auto')?.handler('', ctx);

    assert.equal(newSessionCalls, 0);
    assert.equal(compactCalls, 0);
    assert.equal(replacementMessages.length, 0);
    assertSentWorkflowPrompt(
      sentMessages[0],
      `/addy-review ${planPath}`,
      'Addy Review',
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW;
    else process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW = previousEnv;
  }
});

test('addy-auto continues every workflow step in current session when fresh is configured', async () => {
  const cwd = join(stateDir, 'auto-loop-every-step-fresh-project');
  const planPath = join('docs', 'plans', 'auto-every-step.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const { pi, commands, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const replacementMessages: Array<{
      message: string;
      options?: { deliverAs?: string; streamingBehavior?: string };
    }> = [];
    let lastWidget: unknown;
    const ctx: any = {
      cwd,
      id: 'auto-loop-every-step-fresh',
      newSession: async (options: {
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => {
        await options.withSession({
          cwd,
          id: 'auto-loop-every-step-replacement',
          ui: { setWidget() {}, notify() {} },
          isIdle: () => true,
          sendUserMessage: (
            message: string,
            options?: { deliverAs?: string; streamingBehavior?: string },
          ) => replacementMessages.push({ message, options }),
        });
        return { cancelled: false };
      },
      ui: { setWidget: (_key: string, value: unknown) => (lastWidget = value) },
      isIdle: () => true,
    };

    await commands.get('addy-auto')?.handler(planPath, ctx);

    assert.equal(replacementMessages.length, 0);
    assert.equal(ctx.state.autoFreshPrompt, undefined);
    assert.equal(ctx.state.current, 'build');
    assert.equal(ctx.state.phases.build, 'active');
    const footer = (lastWidget as () => { render: () => string[] })()
      .render()
      .join('\n');
    assert.match(footer, /\[build\]/);
    assert.doesNotMatch(footer, /\[plan\]/);

    assertSentWorkflowPrompt(
      sentMessages[0],
      `/addy-build ${planPath}`,
      'Addy Build',
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('agent_end fresh-context same-phase retry self-unblocks in current session', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const cwd = join(stateDir, 'auto-loop-fresh-retry-project');
    const planPath = join('docs', 'plans', 'auto-fresh-retry.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Current',
        '- [ ] Implemented',
        '- [ ] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    );

    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const replacementMessages: string[] = [];
    let replacementCtx: any;
    const ctx: any = {
      cwd,
      id: 'auto-loop-fresh-retry',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'active',
          simplify: 'pending',
          verify: 'pending',
          review: 'pending',
          finish: 'pending',
        },
        warnings: [],
        current: 'build',
        autoMode: true,
        activePlan: planPath,
      },
      newSession: async (options: {
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => {
        replacementCtx = {
          cwd,
          id: 'auto-loop-fresh-retry-replacement',
          ui: {
            setWidget() {},
            notify() {},
          },
          isIdle: () => true,
          sendUserMessage: (message: string) =>
            replacementMessages.push(message),
          newSession: async (options: {
            withSession: (ctx: unknown) => Promise<void> | void;
          }) => {
            await options.withSession(replacementCtx);
            return { cancelled: false };
          },
        };
        await options.withSession(replacementCtx);
        return { cancelled: false };
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await events.get('agent_end')?.({}, ctx);

    assert.equal(sentMessages.length, 1);
    assert.equal(replacementMessages.length, 0);
    assert.equal(ctx.state.autoFreshPrompt, undefined);

    assertSentWorkflowPrompt(
      sentMessages[0],
      `/addy-build ${planPath}`,
      'Addy Build',
    );
    assert.equal(ctx.state.autoFreshPrompt, undefined);
    assert.equal(
      ctx.state.autoRetryKey?.startsWith(`/addy-build ${planPath}`),
      true,
    );
    assert.equal(ctx.state.autoRetryCount, 1);

    await events.get('agent_end')?.({}, ctx);

    assert.equal(sentMessages.length, 2);
    assertSentWorkflowPrompt(
      sentMessages[1],
      `/addy-build ${planPath}`,
      'Addy Build',
    );
    assert.match(
      workflowPromptText(sentMessages[1]) ?? '',
      /Addy Auto Same-Phase Recovery Pass/,
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('agent_end review fix loop continues fix verify and review prompts in current session', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const cwd = join(stateDir, 'auto-review-fix-fresh-project');
    const planPath = join('docs', 'plans', 'auto-review-fix-fresh.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Current',
        '- [x] Implemented',
        '- [x] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    );

    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const replacementMessages: string[] = [];
    const statsKey = `${planPath}\u001f\u001f1\u001fCurrent`;
    let replacementIndex = 0;
    const ctx: any = {
      cwd,
      id: 'auto-review-fix-fresh',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'complete',
          review: 'active',
          finish: 'pending',
        },
        warnings: [],
        current: 'review',
        currentTask: 'Current',
        currentTaskIndex: 1,
        autoMode: true,
        autoLastPrompt: `/addy-review ${planPath}`,
        activePlan: planPath,
        reviewStatsKey: statsKey,
        stats: {
          active: {
            tasks: {
              [statsKey]: {
                plan: planPath,
                taskIndex: 1,
                taskTitle: 'Current',
                turns: 1,
                verifyRuns: 1,
                reviewRuns: 1,
                issues: {
                  critical: 0,
                  important: 0,
                  suggestion: 0,
                  unknown: 0,
                  total: 0,
                },
              },
            },
          },
          history: [],
        },
      },
      newSession: async (options: {
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => {
        replacementIndex += 1;
        await options.withSession({
          cwd,
          id: `auto-review-fix-fresh-replacement-${replacementIndex}`,
          ui: { setWidget() {}, notify() {} },
          isIdle: () => true,
          sendUserMessage: (message: string) =>
            replacementMessages.push(message),
        });
        return { cancelled: false };
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await events.get('agent_end')?.(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Important: fix src/foo.ts:1 before review can pass.',
              },
            ],
          },
        ],
      },
      ctx,
    );
    assert.equal(replacementMessages.length, 0);
    assertSentWorkflowPrompt(
      sentMessages.splice(0)[0],
      `/addy-fix-all ${planPath}`,
      'Addy Fix All',
    );

    ctx.state = { ...ctx.state, autoLastPrompt: `/addy-fix-all ${planPath}` };
    await events.get('agent_end')?.(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }] },
        ],
      },
      ctx,
    );
    assert.equal(replacementMessages.length, 0);
    assertSentWorkflowPrompt(
      sentMessages.splice(0)[0],
      `/addy-verify ${planPath}`,
      'Addy Verify',
    );

    ctx.state = {
      ...ctx.state,
      autoLastPrompt: `/addy-verify ${planPath}`,
      autoReviewFixNeedsReview: true,
    };
    await events.get('agent_end')?.(
      {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'Verified.' }] },
        ],
      },
      ctx,
    );
    assert.equal(replacementMessages.length, 0);
    assertSentWorkflowPrompt(
      sentMessages.splice(0)[0],
      `/addy-review ${planPath}`,
      'Addy Review',
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('auto-continue fresh context emits visible clearing-context messages', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const cwd = join(stateDir, 'auto-fresh-visible-message-project');
    const planPath = join('docs', 'plans', 'auto-fresh-visible.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Current',
        '- [ ] Implemented',
        '- [ ] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    );

    const { pi, commands, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const notices: Array<[string, string | undefined]> = [];
    const messages: unknown[] = [];
    const replacementMessages: string[] = [];
    const ctx: any = {
      cwd,
      id: 'auto-fresh-visible-message',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'pending',
          simplify: 'pending',
          verify: 'pending',
          review: 'pending',
          finish: 'pending',
        },
        warnings: [],
        current: 'plan',
        autoMode: true,
        activePlan: planPath,
        autoFreshPrompt: `/addy-build ${planPath}`,
        autoFreshReason: 'before-step',
      },
      sendMessage: (message: unknown) => messages.push(message),
      newSession: async (options: {
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => {
        await options.withSession({
          cwd,
          id: 'auto-fresh-visible-message-replacement',
          ui: {
            setWidget() {},
            notify: (message: string, level?: string) =>
              notices.push([message, level]),
          },
          sendMessage: (message: unknown) => messages.push(message),
          sendUserMessage: (message: string) =>
            replacementMessages.push(message),
          isIdle: () => true,
        });
        return { cancelled: false };
      },
      ui: {
        setWidget() {},
        notify: (message: string, level?: string) =>
          notices.push([message, level]),
      },
      isIdle: () => true,
    };
    setContextWorkflowState(ctx, ctx.state);

    await commands
      .get('addy-auto-continue')
      ?.handler('--fresh before-step', ctx);

    assert.deepEqual(sentMessages, []);

    assert.ok(notices.some(([message]) => /clearing context/.test(message)));
    assert.ok(
      messages.some((message) =>
        /clearing context/.test(JSON.stringify(message)),
      ),
    );
    assertSentWorkflowPrompt(
      replacementMessages[0],
      `/addy-build ${planPath}`,
      'Addy Build',
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('auto loop re-reviews review-fix target before committing without review evidence', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'false';
  try {
    const cwd = join(stateDir, 'auto-review-fix-commit-previous-project');
    const planPath = join(
      'docs',
      'plans',
      'auto-review-fix-commit-previous.md',
    );
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Done',
        '- [x] Implemented',
        '- [x] Verified',
        '- [x] Reviewed',
        '## Task 2: Next',
        '- [ ] Implemented',
        '- [ ] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    );

    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const ctx: any = {
      cwd,
      id: 'auto-review-fix-commit-previous',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'active',
          review: 'complete',
          finish: 'pending',
        },
        warnings: [],
        current: 'verify',
        currentTask: 'Next',
        currentTaskIndex: 2,
        taskCount: 2,
        autoMode: true,
        autoLastPrompt: `/addy-verify ${planPath}`,
        autoReviewFixNeedsReview: true,
        autoReviewTask: 'Done',
        autoReviewTaskIndex: 1,
        activePlan: planPath,
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await events.get('agent_end')?.(
      {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Verified post-review fixes.' }],
          },
        ],
      },
      ctx,
    );

    assertSentWorkflowPrompt(
      sentMessages[0],
      `/addy-review ${planPath}`,
      'Addy Review',
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('resumed auto loop commits latest completed active task before new work', async () => {
  const cwd = join(stateDir, 'auto-resume-pending-commit-project');
  const planPath = join('docs', 'plans', 'auto-resume-pending-commit.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: First',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Second',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 3: Third',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const secondStatsKey = `${planPath}\u001f\u001f2\u001fSecond`;
  const ctx: any = {
    cwd,
    id: 'auto-resume-pending-commit',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'active',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      currentTask: 'Third',
      currentTaskIndex: 3,
      taskCount: 3,
      autoMode: true,
      autoLastPrompt: `/addy-verify ${planPath}`,
      activePlan: planPath,
      stats: {
        active: {
          tasks: {
            [secondStatsKey]: {
              plan: planPath,
              taskIndex: 2,
              taskTitle: 'Second',
              turns: 3,
              verifyRuns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await commands.get('addy-auto')?.handler('', ctx);

  assert.match(sentMessages[0], /^# Addy Auto Commit/);
  assert.match(sentMessages[0], /Completed task: Second/);
  assert.doesNotMatch(sentMessages[0], /Completed task: Third/);
});

test('auto mode starts finish in current session even when fresh before every step is enabled', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const cwd = join(stateDir, 'auto-finish-no-fresh-project');
    const planPath = join('docs', 'plans', 'auto-finish-no-fresh.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Done',
        '- [x] Implemented',
        '- [x] Verified',
        '- [x] Reviewed',
      ].join('\n'),
    );

    const { pi, commands, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const replacementMessages: string[] = [];
    const ctx: any = {
      cwd,
      id: 'auto-finish-no-fresh',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'complete',
          review: 'complete',
          finish: 'pending',
        },
        warnings: [],
        activePlan: planPath,
        committedTasks: committedTasksFor(planPath, [
          { taskIndex: 1, taskTitle: 'Done' },
        ]),
      },
      newSession: async (options: {
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => {
        await options.withSession({
          cwd,
          id: 'auto-finish-no-fresh-replacement',
          ui: { setWidget() {}, notify() {} },
          sendUserMessage: (message: string) =>
            replacementMessages.push(message),
          isIdle: () => true,
        });
        return { cancelled: false };
      },
      ui: { setWidget() {}, notify() {} },
      isIdle: () => true,
    };

    await commands.get('addy-auto')?.handler(planPath, ctx);

    assertSentWorkflowPrompt(
      sentMessages.at(-1),
      `/addy-finish ${planPath}`,
      'Addy Finish',
    );
    assert.equal(ctx.state.current, 'finish');
    assert.equal(ctx.state.phases.finish, 'active');
    assert.equal(replacementMessages.length, 0);
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('fresh context fallback dispatches pending review-fix prompt when newSession is unavailable', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const cwd = join(stateDir, 'auto-review-fix-no-new-session-project');
    const planPath = join('docs', 'plans', 'auto-review-fix-no-new-session.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Current',
        '- [x] Implemented',
        '- [x] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    );

    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    let compactCalls = 0;
    const ctx: any = {
      cwd,
      id: 'auto-review-fix-no-new-session',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'complete',
          review: 'active',
          finish: 'pending',
        },
        warnings: [],
        current: 'review',
        currentTask: 'Current',
        currentTaskIndex: 1,
        autoMode: true,
        autoLastPrompt: `/addy-review ${planPath}`,
        activePlan: planPath,
      },
      ui: { setWidget() {}, notify() {} },
      isIdle: () => true,
      compact: (_options: { onComplete?: () => void }) => {
        compactCalls += 1;
        throw new Error('fallback must not compact');
      },
    };

    await events.get('agent_end')?.(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Important: fix src/foo.ts:1 before review can pass.',
              },
            ],
          },
        ],
      },
      ctx,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(compactCalls, 0);
    assertSentWorkflowPrompt(
      sentMessages.at(-1),
      `/addy-fix-all ${planPath}`,
      'Addy Fix All',
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('manual Addy workflow steps do not replace the Pi session when beforeEveryStep is configured', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const { pi, commands, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const notices: Array<[string, string | undefined]> = [];
    let newSessionCalled = false;
    const ctx: any = {
      id: 'manual-step-fresh',
      sessionManager: { getSessionFile: () => 'old-session.jsonl' },
      newSession: () => {
        newSessionCalled = true;
        throw new Error('manual workflow commands must not replace session');
      },
      ui: {
        setWidget() {},
        notify: (message: string, level?: string) =>
          notices.push([message, level]),
      },
    };

    const result = await commands
      .get('addy-finish')
      ?.handler({ args: ['docs/plans/current.md'] }, ctx);

    assert.deepEqual(result, { action: 'continue' });
    assert.equal(newSessionCalled, false);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0], /# Addy Finish/);
    assert.ok(
      sentMessages[0].includes(
        'Invocation: `/addy-finish docs/plans/current.md`',
      ),
    );
    assert.match(notices.at(-1)?.[0] ?? '', /manual workflow commands/);

    sentMessages.length = 0;
    await commands
      .get('addy-define')
      ?.handler({ args: ['Implement invoices'] }, ctx);
    assert.equal(newSessionCalled, false);
    assert.match(sentMessages[0], /# Addy Define/);
    assert.ok(
      sentMessages[0].includes('Invocation: `/addy-define Implement invoices`'),
    );
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('auto fresh continuations use the replacement session API for all reasons', async () => {
  for (const reason of [
    'before-step',
    'before-review',
    'between-tasks',
  ] as const) {
    const { pi, commands, entries, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const replacementMessages: Array<{
      message: string;
      options?: { deliverAs?: string; streamingBehavior?: string };
    }> = [];
    const replacementEntries: Array<[string, unknown]> = [];
    let oldPiIsStale = false;
    pi.appendEntry = (type: string, data: unknown) => {
      if (oldPiIsStale) throw new Error('old extension API is stale');
      return entries.push([type, data]);
    };
    const ctx: any = {
      id: `auto-fresh-${reason}`,
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'pending',
          simplify: 'pending',
          verify: 'pending',
          review: 'pending',
          finish: 'pending',
        },
        warnings: [],
        autoMode: true,
        activePlan: 'docs/plans/current.md',
        autoFreshPrompt: '/addy-build docs/plans/current.md',
        autoFreshReason: reason,
        autoFreshDeliveryKey: `fresh-${reason}`,
      },
      sessionManager: { getSessionFile: () => `${reason}-old-session.jsonl` },
      newSession: async (options: {
        parentSession?: string;
        withSession: (ctx: unknown) => Promise<void> | void;
      }) => {
        assert.equal(options.parentSession, `${reason}-old-session.jsonl`);
        oldPiIsStale = true;
        await options.withSession({
          id: `auto-fresh-${reason}-replacement`,
          sessionManager: {
            appendCustomEntry: (type: string, data: unknown) =>
              replacementEntries.push([type, data]),
          },
          ui: { setWidget() {}, notify() {} },
          isIdle: () => true,
          sendUserMessage: (
            message: string,
            options?: { deliverAs?: string; streamingBehavior?: string },
          ) => replacementMessages.push({ message, options }),
        });
        return { cancelled: false };
      },
      ui: { setWidget() {}, notify() {} },
      isIdle: () => true,
    };

    await commands.get('addy-auto-continue')?.handler(`--fresh ${reason}`, ctx);

    assert.equal(sentMessages.length, 0);
    assert.equal(replacementEntries.at(-1)?.[0], WORKFLOW_STATE_ENTRY_TYPE);
    assert.deepEqual(replacementMessages[0].options, {
      deliverAs: 'followUp',
      streamingBehavior: 'followUp',
    });
    assertSentWorkflowPrompt(
      replacementMessages[0].message,
      '/addy-build docs/plans/current.md',
      'Addy Build',
    );
  }
});

test('extension-injected Addy workflow steps do not recursively start fresh sessions', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const { pi, events } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const ctx: any = {
      cwd: join(stateDir, 'manual-step-no-loop-project'),
      id: 'manual-step-no-loop',
      ui: { setWidget() {} },
    };

    const result = await events.get('input')?.(
      { input: '/addy-verify docs/plans/current.md', source: 'extension' },
      ctx,
    );

    assert.deepEqual(result, { action: 'continue' });
    assert.equal(ctx.state.current, 'verify');
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('internal auto continuation input does not exit auto mode', async () => {
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    id: 'auto-continue-preserve-auto-mode',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'active',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      autoMode: true,
      autoLastPrompt: '/addy-verify docs/plans/current.md',
      activePlan: 'docs/plans/current.md',
    },
    ui: { setWidget() {} },
  };

  const result = await events.get('input')?.(
    { input: '/addy-auto-continue --fresh before-review', source: 'extension' },
    ctx,
  );

  assert.deepEqual(result, { action: 'continue' });
  assert.equal(ctx.state.autoMode, true);
  assert.equal(ctx.state.autoLastPrompt, '/addy-verify docs/plans/current.md');
  assert.equal(ctx.state.current, 'verify');
});

test('extension-injected build input bypasses manual frontier guard', async () => {
  const cwd = join(stateDir, 'extension-build-frontier-bypass-project');
  const planPath = join('docs', 'plans', 'frontier.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Needs verification',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'extension-build-frontier-bypass',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify() {} },
  };

  await events.get('input')?.(
    { input: `/addy-build ${planPath}`, source: 'extension' },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.equal(ctx.state.current, 'build');
});

test('auto continuation cancellation does not use stale context after session replacement', async () => {
  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    id: 'auto-continue-cancelled',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      autoMode: true,
      activePlan: 'docs/plans/missing.md',
    },
    newSession: async () => ({ cancelled: true }),
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await commands
    .get('addy-auto-continue')
    ?.handler('--fresh before-review', ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    '/addy-build docs/plans/missing.md',
    'Addy Build',
  );
  assert.ok(
    notices.some(
      ([message, level]) =>
        level === 'info' && /clearing context/.test(message),
    ),
  );
  assert.ok(
    notices.some(
      ([message, level]) => level === 'warning' && /cancelled/.test(message),
    ),
  );
  assert.equal(ctx.state.autoFreshPrompt, undefined);
});

test('auto loop stops after finish when all plan tasks are complete', async () => {
  const cwd = join(stateDir, 'auto-loop-finish-complete-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  const notices: Array<[string, string | undefined]> = [];
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-finish-complete',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'complete',
        finish: 'active',
      },
      warnings: [],
      current: 'finish',
      autoMode: true,
      autoLastPrompt: `/addy-finish ${planPath}`,
      activePlan: planPath,
      committedTasks: committedTasksFor(planPath, [
        { taskIndex: 1, taskTitle: 'Current' },
      ]),
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Finished!' }] },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.equal(ctx.state.autoMode, false);
  assert.equal(ctx.state.autoLastPrompt, undefined);
  assert.equal(ctx.state.phases.finish, 'complete');
  assert.match(notices.at(-1)?.[0] ?? '', /Finished!/);
  assert.equal(notices.at(-1)?.[1], 'info');
});

test('auto loop does not stop after finish when the finish result is incomplete', async () => {
  const cwd = join(stateDir, 'auto-loop-finish-incomplete-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  const notices: Array<[string, string | undefined]> = [];
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-finish-incomplete',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'complete',
        finish: 'active',
      },
      warnings: [],
      current: 'finish',
      autoMode: true,
      autoLastPrompt: `/addy-finish ${planPath}`,
      activePlan: planPath,
      committedTasks: committedTasksFor(planPath, [
        { taskIndex: 1, taskTitle: 'Current' },
      ]),
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Please choose whether to commit.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(ctx.state.autoMode, true);
  assert.equal(ctx.state.autoLastPrompt, `/addy-finish ${planPath}`);
  assert.notDeepEqual(notices.at(-1), ['Finished!', 'info']);
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-finish ${planPath}`,
    'Addy Finish',
  );
});

test('auto loop does not commit after review when plan cannot prove task completion', async () => {
  const cwd = join(stateDir, 'auto-loop-missing-plan-no-commit-project');
  const planPath = join('docs', 'plans', 'missing.md');

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-loop-missing-plan-no-commit',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewTask: 'Current',
      autoReviewTaskIndex: 1,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-build ${planPath}`,
    'Addy Build',
  );
});

test('auto loop pauses after unclear commit output even when it contains a hash', async () => {
  const cwd = join(stateDir, 'auto-loop-task-commit-unclear-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-task-commit-unclear',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      autoLastPrompt: [
        '# Addy Auto Commit',
        '',
        'Invocation: `__addy-auto-task-commit__`',
      ].join('\n'),
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Commit failed. HEAD is abc1234.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /commit result was unclear/);
  assert.equal(notices.at(-1)?.[1], 'warning');
  assert.equal(ctx.state.activePlan, planPath);
  assert.equal(ctx.state.committedTasks, undefined);
});

test('auto loop accepts common successful commit output variants', async () => {
  const variants = [
    'Committed 4386b11c.',
    'Created commit 4386b11c.',
    'Commit hash: 4386b11c',
    '[main 4386b11c] fix: continue auto commit prompts',
  ];

  for (const [index, output] of variants.entries()) {
    const cwd = join(stateDir, `auto-loop-commit-output-variant-${index}`);
    const planPath = join('docs', 'plans', 'auto-loop.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Current',
        '- [x] Implemented',
        '- [x] Verified',
        '- [x] Reviewed',
      ].join('\n'),
    );

    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const notices: Array<[string, string | undefined]> = [];
    const ctx: any = {
      cwd,
      id: `auto-loop-commit-output-variant-${index}`,
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'complete',
          simplify: 'pending',
          verify: 'complete',
          review: 'active',
          finish: 'pending',
        },
        warnings: [],
        current: 'review',
        autoMode: true,
        autoLastPrompt: [
          '# Addy Auto Commit',
          '',
          'Invocation: `__addy-auto-task-commit__`',
        ].join('\n'),
        activePlan: planPath,
        stats: {
          active: {
            tasks: {
              [`${planPath}\u001f\u001f1\u001fCurrent`]: {
                plan: planPath,
                taskIndex: 1,
                taskTitle: 'Current',
                turns: 1,
                reviewRuns: 1,
                issues: {
                  critical: 0,
                  important: 0,
                  suggestion: 0,
                  unknown: 0,
                  total: 0,
                },
              },
            },
          },
          history: [],
        },
      },
      ui: {
        setWidget() {},
        notify: (message: string, level?: string) =>
          notices.push([message, level]),
      },
      isIdle: () => true,
    };

    await events.get('agent_end')?.(
      {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: output }],
          },
        ],
      },
      ctx,
    );

    assert.ok(
      !notices.some(([message]) => /commit result was unclear/.test(message)),
      output,
    );
    assert.ok(sentMessages.at(-1), output);
  }
});

test('auto loop stops review fix loop after three attempts by default', async () => {
  const cwd = join(stateDir, 'auto-loop-review-fix-max-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-review-fix-max',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewFixKey: `${planPath}\u001f1\u001fCurrent`,
      autoReviewFixCount: 3,
      autoReviewFindingFingerprint: 'previous',
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Important: fix src/new-location.ts:42 before review can pass.',
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /3 review fix loops/);
  assert.equal(notices.at(-1)?.[1], 'warning');
});

test('auto loop review fix loop limit is configurable', async () => {
  const cwd = join(stateDir, 'auto-loop-review-fix-configurable-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  writeFileSync(
    join(cwd, '.pi', 'addy-workflow.json'),
    JSON.stringify({ auto: { review: { maxFixLoops: 2 } } }),
  );
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-review-fix-configurable',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewFixKey: `${planPath}\u001f1\u001fCurrent`,
      autoReviewFixCount: 2,
      autoReviewFindingFingerprint: 'previous',
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Important: fix src/new-location.ts:42 before review can pass.',
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /2 review fix loops/);
  assert.equal(notices.at(-1)?.[1], 'warning');
});

test('auto loop stops when the same review finding repeats after a fix attempt', async () => {
  const cwd = join(stateDir, 'auto-loop-review-repeat-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-review-repeat',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewFixKey: `${planPath}\u001f1\u001fCurrent`,
      autoReviewFixCount: 1,
      autoReviewFindingFingerprint: reviewFingerprintForTest([
        'Important: fix src/repeated.ts:12 before review can pass.',
      ]),
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Important: fix src/repeated.ts:12 before review can pass.',
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /same review finding repeated/);
  assert.equal(notices.at(-1)?.[1], 'warning');
});

test('auto loop keys repeated review findings to tracked review target', async () => {
  const cwd = join(stateDir, 'auto-loop-review-repeat-tracked-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Done',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
      '## Task 2: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const finding = 'Important: fix src/repeated.ts:12 before review can pass.';
  const ctx: any = {
    cwd,
    id: 'auto-loop-review-repeat-tracked',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Next',
      currentTaskIndex: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewTask: 'Done',
      autoReviewTaskIndex: 1,
      autoReviewFixKey: `${planPath}\u001f1\u001fDone`,
      autoReviewFixCount: 1,
      autoReviewFindingFingerprint: reviewFingerprintForTest([finding]),
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: finding }],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /same review finding repeated/);
  assert.equal(ctx.state.autoPausedReason, 'repeated-review-finding');
});

test('auto loop does not treat different warning bullets as repeated findings', async () => {
  const cwd = join(stateDir, 'auto-loop-review-different-warning-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'auto-loop-review-different-warning',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewFixKey: `${planPath}\u001f1\u001fCurrent`,
      autoReviewFixCount: 1,
      autoReviewFindingFingerprint: reviewFingerprintForTest([
        '- retry counter is stale.',
      ]),
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Warnings:\n- This can auto-commit unrelated changes.',
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(notices.length, 0);
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-fix-all ${planPath}`,
    'Addy Fix All',
  );
});

test('auto retry state restored from session entries pauses duplicate dispatch', async () => {
  const cwd = join(stateDir, 'auto-loop-restored-retry-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const retryPrompt = `/addy-build ${planPath}`;
  const retryKey = [retryPrompt, planPath, 1, 'Current', 'none'].join('\u001f');
  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const restoredState = {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'active',
      simplify: 'pending',
      verify: 'pending',
      review: 'pending',
      finish: 'pending',
    },
    warnings: [],
    current: 'build',
    autoMode: true,
    activePlan: planPath,
    currentTask: 'Current',
    nextTask: 'none',
    currentTaskIndex: 1,
    taskCount: 1,
    autoLastPrompt: retryPrompt,
    autoRetryKey: retryKey,
    autoRetryCount: 1,
  };
  const ctx: any = {
    cwd,
    id: 'auto-loop-restored-retry',
    sessionManager: {
      getBranch: () => [[WORKFLOW_STATE_ENTRY_TYPE, restoredState]],
    },
    ui: {
      setWidget() {},
      notify() {},
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.({}, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-build ${planPath}`,
    'Addy Build',
  );
  assert.match(sentMessages[0], /Addy Auto Same-Phase Recovery Pass/);
});

test('malformed persisted auto retry state is ignored', () => {
  const ctx: any = {
    cwd: join(stateDir, 'malformed-auto-retry-state-project'),
    id: 'malformed-auto-retry-state',
    sessionManager: {
      getBranch: () => [
        [
          WORKFLOW_STATE_ENTRY_TYPE,
          {
            phases: {
              define: 'complete',
              plan: 'complete',
              build: 'active',
              simplify: 'pending',
              verify: 'pending',
              review: 'pending',
              finish: 'pending',
            },
            warnings: [],
            current: 'build',
            autoMode: true,
            activePlan: 'docs/plans/auto-loop.md',
            autoRetryCount: 'not-a-number',
          },
        ],
      ],
    },
  };

  assert.equal(getContextWorkflowState(ctx).autoMode, undefined);
});

test('malformed persisted auto pending action state is ignored', () => {
  const ctx: any = {
    cwd: join(stateDir, 'malformed-auto-pending-state-project'),
    id: 'malformed-auto-pending-state',
    sessionManager: {
      getBranch: () => [
        [
          WORKFLOW_STATE_ENTRY_TYPE,
          {
            phases: {
              define: 'complete',
              plan: 'complete',
              build: 'active',
              simplify: 'pending',
              verify: 'pending',
              review: 'pending',
              finish: 'pending',
            },
            warnings: [],
            current: 'build',
            autoMode: true,
            activePlan: 'docs/plans/auto-loop.md',
            autoPendingAction: {
              key: 'bad-pending',
              prompt: '/addy-build docs/plans/auto-loop.md',
              reason: 'not-a-real-reason',
              attempts: 0,
              createdAt: '2026-05-21T00:00:00.000Z',
            },
          },
        ],
      ],
    },
  };

  assert.equal(getContextWorkflowState(ctx).autoMode, undefined);
});

test('session start renders workflow widget before first workflow instruction', async () => {
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const widgets: Array<[string, unknown]> = [];
  await events.get('session_start')?.(
    {},
    {
      cwd: join(stateDir, 'startup-widget-project'),
      id: 'startup-widget-test',
      ui: {
        setWidget: (key: string, value: unknown) => widgets.push([key, value]),
      },
    },
  );

  assert.equal(widgets.at(-1)?.[0], 'pi-addy-workflow');
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), [
    'Addy Workflow: define → plan => { build → simplify → verify → review → finish }',
  ]);
});

test('session start restores persisted workflow widget state', async () => {
  const cwd = join(stateDir, 'startup-restore-project');
  const planPath = 'docs/plans/startup-restore.md';
  const firstCtx: any = {
    cwd,
    id: 'startup-restore-first',
    ui: { setWidget() {} },
  };
  handleWorkflowEvent(firstCtx, {
    source: 'user-input',
    text: `/addy-build ${planPath}`,
  });

  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const widgets: Array<[string, unknown]> = [];
  const nextCtx: any = {
    cwd,
    id: 'startup-restore-next',
    ui: {
      setWidget: (key: string, value: unknown) => widgets.push([key, value]),
    },
  };
  await events.get('session_start')?.({}, nextCtx);

  assert.equal(nextCtx.state.current, 'build');
  assert.equal(nextCtx.state.activePlan, planPath);
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish } | startup-restore.md',
  ]);
});

test('session project restore preserves persistent auto mode but clears stale prompt controls', async () => {
  const cwd = join(stateDir, 'startup-auto-sanitize-project');
  const planPath = 'docs/plans/startup-auto.md';
  const firstCtx: any = {
    cwd,
    id: 'startup-auto-sanitize-first',
    ui: { setWidget() {} },
  };
  handleWorkflowEvent(firstCtx, {
    source: 'user-input',
    text: `/addy-auto ${planPath}`,
  });

  const nextCtx: any = { cwd, id: 'startup-auto-sanitize-next' };
  const state = getContextWorkflowState(nextCtx);

  assert.equal(state.current, undefined);
  assert.equal(state.activePlan, planPath);
  assert.equal(state.autoMode, true);
  assert.equal(state.autoLastPrompt, undefined);
});

test('project restore preserves pending fresh auto continuation but clears stale controls', () => {
  const cwd = join(stateDir, 'startup-auto-fresh-project');
  const firstCtx: any = {
    cwd,
    id: 'startup-auto-fresh-first',
    ui: { setWidget() {} },
  };
  handleWorkflowEvent(firstCtx, {
    source: 'user-input',
    text: '/addy-auto docs/plans/fresh.md',
  });
  firstCtx.state.autoFreshPrompt = '/addy-build docs/plans/fresh.md';
  firstCtx.state.autoFreshReason = 'before-step';
  firstCtx.state.autoFreshExpandedPrompt = 'expanded build prompt';
  firstCtx.state.autoFreshDeliveryKey = 'fresh-key';
  firstCtx.state.autoLastPrompt = '/addy-review docs/plans/old.md';
  firstCtx.state.autoRetryKey = 'old-retry';
  firstCtx.state.autoRetryCount = 1;
  firstCtx.state.autoReviewFixKey = 'old-fix';
  firstCtx.state.autoReviewFixCount = 2;
  firstCtx.state.autoReviewFindingFingerprint = 'old-finding';
  firstCtx.state.autoReviewFixNeedsReview = true;
  firstCtx.state.autoReviewTask = 'Old task';
  firstCtx.state.autoReviewTaskIndex = 3;
  firstCtx.state.reviewStatsKey = 'old-stats';
  setContextWorkflowState(firstCtx, firstCtx.state);

  const state = getContextWorkflowState({
    cwd,
    id: 'startup-auto-fresh-next',
  } as any);

  assert.equal(state.autoMode, true);
  assert.equal(state.autoFreshPrompt, '/addy-build docs/plans/fresh.md');
  assert.equal(state.autoFreshReason, 'before-step');
  assert.equal(state.autoFreshExpandedPrompt, 'expanded build prompt');
  assert.equal(state.autoFreshDeliveryKey, 'fresh-key');
  assert.equal(state.autoLastPrompt, undefined);
  assert.equal(state.autoRetryKey, undefined);
  assert.equal(state.autoRetryCount, undefined);
  assert.equal(state.autoReviewFixKey, undefined);
  assert.equal(state.autoReviewFixCount, undefined);
  assert.equal(state.autoReviewFindingFingerprint, undefined);
  assert.equal(state.autoReviewFixNeedsReview, undefined);
  assert.equal(state.autoReviewTask, undefined);
  assert.equal(state.autoReviewTaskIndex, undefined);
  assert.equal(state.reviewStatsKey, undefined);
});

test('agent_end fresh handoff does not call newSession directly', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    let newSessionCalls = 0;
    const ctx: any = {
      id: 'agent-end-trampoline-only',
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'active',
          simplify: 'pending',
          verify: 'pending',
          review: 'pending',
          finish: 'pending',
        },
        warnings: [],
        current: 'build',
        autoMode: true,
        activePlan: 'docs/plans/current.md',
      },
      newSession: async () => {
        newSessionCalls += 1;
        throw new Error('agent_end must not call newSession');
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await events.get('agent_end')?.({}, ctx);

    assert.equal(newSessionCalls, 0);
    assertSentWorkflowPrompt(
      sentMessages[0],
      '/addy-build docs/plans/current.md',
      'Addy Build',
    );
    assert.equal(ctx.state.autoFreshPrompt, undefined);
    assert.equal(ctx.state.autoLastPrompt, '/addy-build docs/plans/current.md');
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('session start auto-resumes valid pending fresh continuation', async () => {
  const cwd = join(stateDir, 'startup-auto-resume-fresh-project');
  const firstCtx: any = {
    cwd,
    id: 'startup-auto-resume-first',
    ui: { setWidget() {} },
  };
  setContextWorkflowState(firstCtx, {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'pending',
      simplify: 'pending',
      verify: 'pending',
      review: 'pending',
      finish: 'pending',
    },
    warnings: [],
    autoMode: true,
    activePlan: 'docs/plans/fresh.md',
    autoFreshPrompt: '/addy-build docs/plans/fresh.md',
    autoFreshReason: 'before-step',
    autoFreshDeliveryKey: 'startup-key',
  });

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  await events.get('session_start')?.(
    {},
    { cwd, id: 'startup-auto-resume-next', ui: { setWidget() {} } },
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    '/addy-build docs/plans/fresh.md',
    'Addy Build',
  );
});

test('session start consumes pending fresh continuation without spawning another session', async () => {
  const cwd = join(stateDir, 'startup-no-recursive-fresh-project');
  setContextWorkflowState(
    { cwd, id: 'startup-no-recursive-fresh-first', ui: { setWidget() {} } },
    {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'pending',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      autoMode: true,
      activePlan: 'docs/plans/fresh.md',
      autoFreshPrompt: '/addy-build docs/plans/fresh.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'startup-no-recursive-key',
    },
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  let newSessionCalls = 0;
  const ctx: any = {
    cwd,
    id: 'startup-no-recursive-fresh-next',
    ui: { setWidget() {} },
    newSession: async () => {
      newSessionCalls += 1;
      return { cancelled: false };
    },
  };

  await events.get('session_start')?.({}, ctx);

  assert.equal(newSessionCalls, 0);
  assertSentWorkflowPrompt(
    sentMessages[0],
    '/addy-build docs/plans/fresh.md',
    'Addy Build',
  );
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
});

test('session start watchdog resumes stale reviewed task commit frontier', async () => {
  const cwd = join(stateDir, 'startup-watchdog-commit-frontier-project');
  const planPath = join('docs', 'plans', 'watchdog-commit.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Needs commit',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  setContextWorkflowState(
    { cwd, id: 'startup-watchdog-commit-source', ui: { setWidget() {} } },
    {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'complete',
        finish: 'pending',
      },
      warnings: [],
      autoMode: true,
      activePlan: planPath,
      stats: {
        active: {
          tasks: {
            [`${planPath}\u001f\u001f1\u001fNeeds commit`]: {
              plan: planPath,
              taskIndex: 1,
              taskTitle: 'Needs commit',
              turns: 2,
              verifyRuns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
    },
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  await events.get('session_start')?.(
    {},
    { cwd, id: 'startup-watchdog-commit-next', ui: { setWidget() {} } },
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    '__addy-auto-task-commit__',
    'Addy Auto Commit',
  );
});

test('session start watchdog supersedes stale pending auto action', async () => {
  const cwd = join(stateDir, 'startup-watchdog-stale-pending-project');
  const planPath = join('docs', 'plans', 'watchdog-stale.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Verify now',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );
  setContextWorkflowState(
    { cwd, id: 'startup-watchdog-stale-source', ui: { setWidget() {} } },
    {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      autoMode: true,
      activePlan: planPath,
      autoPendingAction: {
        key: 'stale-build-action',
        prompt: `/addy-build ${planPath}`,
        plan: planPath,
        taskIndex: 1,
        taskTitle: 'Verify now',
        reason: 'next-action',
        attempts: 0,
        createdAt: '2026-05-21T00:00:00.000Z',
      },
    },
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'startup-watchdog-stale-next',
    ui: { setWidget() {} },
  };
  await events.get('session_start')?.({}, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
  assert.equal(getContextWorkflowState(ctx).autoPendingAction, undefined);
});

test('plain addy-auto resumes after explicit stop pause', async () => {
  const cwd = join(stateDir, 'command-watchdog-stop-resume-project');
  const planPath = join('docs', 'plans', 'watchdog-stop-resume.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Start work',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'command-watchdog-stop-resume',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'pending',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      autoMode: true,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands.get('addy-auto')?.handler({ args: ['stop'] }, ctx);

  assert.equal(sentMessages.length, 0);
  assert.equal(getContextWorkflowState(ctx).autoMode, false);
  assert.equal(getContextWorkflowState(ctx).autoPausedReason, 'user-stopped');

  await commands.get('addy-auto')?.handler({}, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-build ${planPath}`,
    'Addy Build',
  );
  assert.equal(getContextWorkflowState(ctx).autoPausedReason, undefined);
});

test('session start ignores reasonless pending fresh state', async () => {
  const cwd = join(stateDir, 'startup-auto-reasonless-fresh-project');
  const firstCtx: any = {
    cwd,
    id: 'startup-auto-reasonless-first',
    ui: { setWidget() {} },
  };
  setContextWorkflowState(firstCtx, {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'pending',
      simplify: 'pending',
      verify: 'pending',
      review: 'pending',
      finish: 'pending',
    },
    warnings: [],
    autoMode: true,
    activePlan: 'docs/plans/fresh.md',
    autoFreshPrompt: '/addy-build docs/plans/fresh.md',
  });

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'startup-auto-reasonless-next',
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };
  await events.get('session_start')?.({}, ctx);

  assert.deepEqual(sentMessages, []);
  assert.equal(ctx.state.autoFreshPrompt, undefined);
});

test('duplicate auto fresh continuation no-ops after successful delivery', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const replacementMessages: string[] = [];
  let newSessionCalls = 0;
  const ctx: any = {
    id: 'duplicate-auto-continue',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'pending',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-build docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'duplicate-key',
    },
    newSession: async (options: {
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      newSessionCalls += 1;
      await options.withSession({
        id: 'duplicate-auto-continue-replacement',
        ui: { setWidget() {}, notify() {} },
        isIdle: () => true,
        sendUserMessage: (message: string) => replacementMessages.push(message),
      });
      return { cancelled: false };
    },
    ui: { setWidget() {}, notify() {} },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands.get('addy-auto-continue')?.handler('--fresh before-step', ctx);
  await commands.get('addy-auto-continue')?.handler('--fresh before-step', ctx);

  assert.equal(replacementMessages.length, 1);
  assert.equal(newSessionCalls, 1);
  assertSentWorkflowPrompt(
    replacementMessages[0],
    '/addy-build docs/plans/current.md',
    'Addy Build',
  );
});

test('consumed fresh continuation wins over stale branch pending state', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const stalePendingState: any = {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'pending',
      simplify: 'pending',
      verify: 'pending',
      review: 'pending',
      finish: 'pending',
    },
    warnings: [],
    autoMode: true,
    activePlan: 'docs/plans/current.md',
    autoFreshPrompt: '/addy-build docs/plans/current.md',
    autoFreshReason: 'before-step',
    autoFreshDeliveryKey: 'branch-stale-key',
  };
  const projectCtx: any = {
    cwd: join(stateDir, 'branch-stale-fresh-project'),
    id: 'branch-stale-fresh-project-state',
    ui: { setWidget() {} },
  };
  setContextWorkflowState(projectCtx, {
    ...stalePendingState,
    autoFreshPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
    autoFreshConsumedKey: 'branch-stale-key',
  });
  const replacementMessages: string[] = [];
  const ctx: any = {
    cwd: projectCtx.cwd,
    id: 'branch-stale-fresh-session',
    sessionManager: {
      getBranch: () => [[WORKFLOW_STATE_ENTRY_TYPE, stalePendingState]],
    },
    newSession: async (options: {
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      await options.withSession({
        cwd: projectCtx.cwd,
        id: 'branch-stale-fresh-replacement',
        ui: { setWidget() {}, notify() {} },
        isIdle: () => true,
        sendUserMessage: (message: string) => replacementMessages.push(message),
      });
      return { cancelled: false };
    },
    ui: { setWidget() {}, notify() {} },
  };

  await commands.get('addy-auto-continue')?.handler('--fresh before-step', ctx);

  assert.equal(replacementMessages.length, 0);
});

test('fresh continuation uses default delivery on session start', async () => {
  const cwd = join(stateDir, 'fresh-continuation-streaming-options-project');
  const sent: Array<{
    message: string;
    options?: { deliverAs?: string; streamingBehavior?: string };
  }> = [];
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'fresh-continuation-streaming-options',
    sendUserMessage: (
      message: string,
      options?: { deliverAs?: string; streamingBehavior?: string },
    ) => sent.push({ message, options }),
    ui: { setWidget() {}, notify() {} },
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      autoMode: true,
      autoFreshPrompt: '/addy-build docs/plans/current.md',
      autoFreshReason: 'before-step',
      stats: { active: { tasks: {} }, history: [] },
    },
  };

  await events.get('session_start')?.({}, ctx);

  assertSentWorkflowPrompt(
    sent[0].message,
    '/addy-build docs/plans/current.md',
    'Addy Build',
  );
  assert.deepEqual(sent[0].options, {
    deliverAs: 'followUp',
    streamingBehavior: 'followUp',
  });
});

test('fresh continuation is not auto-dispatched inside subagent children', async () => {
  const previous = process.env.PI_SUBAGENT_CHILD;
  process.env.PI_SUBAGENT_CHILD = '1';
  try {
    const cwd = join(stateDir, 'fresh-continuation-subagent-child-project');
    const sent: string[] = [];
    const { pi, events } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const ctx: any = {
      cwd,
      id: 'fresh-continuation-subagent-child',
      sendUserMessage: (message: string) => sent.push(message),
      ui: { setWidget() {}, notify() {} },
      state: {
        phases: {
          define: 'complete',
          plan: 'complete',
          build: 'active',
          simplify: 'pending',
          verify: 'pending',
          review: 'pending',
          finish: 'pending',
        },
        warnings: [],
        current: 'build',
        autoMode: true,
        autoFreshPrompt: '/addy-build docs/plans/current.md',
        autoFreshReason: 'before-step',
        stats: { active: { tasks: {} }, history: [] },
      },
    };

    await events.get('session_start')?.({}, ctx);

    assert.deepEqual(sent, []);
    assert.equal(
      ctx.state.autoFreshPrompt,
      '/addy-build docs/plans/current.md',
    );
    assert.equal(ctx.state.autoFreshReason, 'before-step');
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous;
  }
});

test('auto fresh send failure preserves pending prompt for retry', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd: join(stateDir, 'auto-continue-send-failure-project'),
    id: 'auto-continue-send-failure',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'pending',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-build docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'send-failure-key',
    },
    newSession: async (options: {
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      await options.withSession({
        cwd: join(stateDir, 'auto-continue-send-failure-project'),
        id: 'auto-continue-send-failure-replacement',
        ui: { setWidget() {}, notify() {} },
        isIdle: () => true,
        sendUserMessage: async () => {
          throw new Error('send failed');
        },
      });
      return { cancelled: false };
    },
    ui: { setWidget() {}, notify() {} },
  };
  setContextWorkflowState(ctx, ctx.state);

  await assert.rejects(
    () =>
      commands.get('addy-auto-continue')!.handler('--fresh before-step', ctx),
    /send failed/,
  );

  assert.equal(
    getContextWorkflowState(ctx).autoFreshPrompt,
    '/addy-build docs/plans/current.md',
  );
  assert.equal(getContextWorkflowState(ctx).autoFreshReason, 'before-step');
});

test('cancelled fresh continuation falls back to current session dispatch', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const sent: Array<{
    message: string;
    options?: { deliverAs?: string; streamingBehavior?: string };
  }> = [];
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd: join(stateDir, 'auto-continue-cancel-fallback-project'),
    id: 'auto-continue-cancel-fallback',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-verify docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'cancel-fallback-key',
    },
    newSession: async () => ({ cancelled: true }),
    sendUserMessage: (
      message: string,
      options?: { deliverAs?: string; streamingBehavior?: string },
    ) => sent.push({ message, options }),
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands.get('addy-auto-continue')?.handler('--fresh before-step', ctx);

  assert.match(notices.at(-1)?.[0] ?? '', /continuing in the current session/);
  assertSentWorkflowPrompt(
    sent[0].message,
    '/addy-verify docs/plans/current.md',
    'Addy Verify',
  );
  assert.deepEqual(sent[0].options, {
    deliverAs: 'followUp',
    streamingBehavior: 'followUp',
  });
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
  assert.equal(
    getContextWorkflowState(ctx).autoLastPrompt,
    '/addy-verify docs/plans/current.md',
  );
});

test('missing fresh-session API falls back with default delivery', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const sent: Array<{
    message: string;
    options?: { deliverAs?: string; streamingBehavior?: string };
  }> = [];
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd: join(stateDir, 'auto-continue-no-new-session-fallback-project'),
    id: 'auto-continue-no-new-session-fallback',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-review docs/plans/current.md',
      autoFreshReason: 'before-review',
      autoFreshDeliveryKey: 'no-new-session-fallback-key',
    },
    sendUserMessage: (
      message: string,
      options?: { deliverAs?: string; streamingBehavior?: string },
    ) => sent.push({ message, options }),
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands
    .get('addy-auto-continue')
    ?.handler('--fresh before-review', ctx);

  assert.match(notices.at(-1)?.[0] ?? '', /continuing in the current session/);
  assertSentWorkflowPrompt(
    sent[0].message,
    '/addy-review docs/plans/current.md',
    'Addy Review',
  );
  assert.deepEqual(sent[0].options, {
    deliverAs: 'followUp',
    streamingBehavior: 'followUp',
  });
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
});

test('fresh-session fallback ignores compact API and continues in current session', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const sent: Array<{
    message: string;
    options?: { deliverAs?: string; streamingBehavior?: string };
  }> = [];
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd: join(stateDir, 'auto-continue-compact-throws-project'),
    id: 'auto-continue-compact-throws',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-review docs/plans/current.md',
      autoFreshReason: 'before-review',
      autoFreshDeliveryKey: 'compact-throws-key',
    },
    compact: () => {
      throw new Error('compact must not be called');
    },
    sendUserMessage: (
      message: string,
      options?: { deliverAs?: string; streamingBehavior?: string },
    ) => sent.push({ message, options }),
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands
    .get('addy-auto-continue')
    ?.handler('--fresh before-review', ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(
    notices.some(([message]) =>
      /continuing in the current session/.test(message),
    ),
  );
  assertSentWorkflowPrompt(
    sent[0].message,
    '/addy-review docs/plans/current.md',
    'Addy Review',
  );
  assert.deepEqual(sent[0].options, {
    deliverAs: 'followUp',
    streamingBehavior: 'followUp',
  });
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
});

test('fresh-session fallback does not wait for compact completion', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const sent: Array<{
    message: string;
    options?: { deliverAs?: string; streamingBehavior?: string };
  }> = [];
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd: join(stateDir, 'auto-continue-compact-on-error-project'),
    id: 'auto-continue-compact-on-error',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-review docs/plans/current.md',
      autoFreshReason: 'before-review',
      autoFreshDeliveryKey: 'compact-on-error-key',
    },
    compact: (_options: { onError?: (error: Error) => void }) => {
      throw new Error('compact must not be called');
    },
    sendUserMessage: (
      message: string,
      options?: { deliverAs?: string; streamingBehavior?: string },
    ) => sent.push({ message, options }),
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands
    .get('addy-auto-continue')
    ?.handler('--fresh before-review', ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(
    notices.some(([message]) =>
      /continuing in the current session/.test(message),
    ),
  );
  assertSentWorkflowPrompt(
    sent[0].message,
    '/addy-review docs/plans/current.md',
    'Addy Review',
  );
  assert.deepEqual(sent[0].options, {
    deliverAs: 'followUp',
    streamingBehavior: 'followUp',
  });
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
});

test('busy missing fresh-session fallback waits for idle before default delivery', async () => {
  const { pi, commands } = createPiMock();
  const sent: Array<{
    message: string;
    options?: { deliverAs?: string; streamingBehavior?: string };
  }> = [];
  let idle = false;
  pi.sendUserMessage = (
    message: string,
    options?: { deliverAs?: string; streamingBehavior?: string },
  ) => {
    assert.equal(idle, true, 'default delivery must wait until Pi is idle');
    return sent.push({ message, options });
  };
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd: join(stateDir, 'auto-continue-no-new-session-busy-project'),
    id: 'auto-continue-no-new-session-busy',
    isIdle: () => idle,
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-review docs/plans/current.md',
      autoFreshReason: 'before-review',
      autoFreshDeliveryKey: 'no-new-session-busy-key',
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands
    .get('addy-auto-continue')
    ?.handler('--fresh before-review', ctx);

  assert.match(notices.at(-1)?.[0] ?? '', /continuing in the current session/);
  assert.equal(sent.length, 0);
  assert.equal(
    getContextWorkflowState(ctx).autoFreshPrompt,
    '/addy-review docs/plans/current.md',
  );

  idle = true;
  await new Promise((resolve) => setTimeout(resolve, 75));

  assertSentWorkflowPrompt(
    sent[0].message,
    '/addy-review docs/plans/current.md',
    'Addy Review',
  );
  assert.deepEqual(sent[0].options, {
    deliverAs: 'followUp',
    streamingBehavior: 'followUp',
  });
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
});

test('agent_end-created current-session fallback waits for idle before default delivery', async () => {
  const previousEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  const cwd = join(stateDir, 'agent-end-no-new-session-busy-project');
  const planPath = join('docs', 'plans', 'auto-loop.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events } = createPiMock();
  const sent: Array<{
    message: string;
    options?: { deliverAs?: string; streamingBehavior?: string };
  }> = [];
  let idle = false;
  pi.sendUserMessage = (
    message: string,
    options?: { deliverAs?: string; streamingBehavior?: string },
  ) => {
    assert.equal(idle, true, 'default delivery must wait until Pi is idle');
    return sent.push({ message, options });
  };
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'agent-end-no-new-session-busy',
    isIdle: () => idle,
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'active',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-verify ${planPath}`,
      activePlan: planPath,
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };
  setContextWorkflowState(ctx, ctx.state);

  try {
    await events.get('agent_end')?.(
      {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Verification passed.' }],
          },
        ],
      },
      ctx,
    );

    assert.match(
      notices.at(-1)?.[0] ?? '',
      /continuing in the current session/,
    );
    assert.equal(sent.length, 0);
    assert.equal(
      getContextWorkflowState(ctx).autoFreshPrompt,
      `/addy-review ${planPath}`,
    );

    idle = true;
    await new Promise((resolve) => setTimeout(resolve, 75));

    assertSentWorkflowPrompt(
      sent[0].message,
      `/addy-review ${planPath}`,
      'Addy Review',
    );
    assert.deepEqual(sent[0].options, {
      deliverAs: 'followUp',
      streamingBehavior: 'followUp',
    });
    assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
  } finally {
    if (previousEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousEnv;
  }
});

test('addy-auto retry consumes pending fresh prompt without replacing the session', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const sent: string[] = [];
  let newSessionCalls = 0;
  let compactCalls = 0;
  const ctx: any = {
    cwd: join(stateDir, 'auto-retry-pending-current-project'),
    id: 'auto-retry-pending-current',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-verify docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'manual-retry-key',
    },
    newSession: async (options: {
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      newSessionCalls += 1;
      return { cancelled: false };
    },
    compact: (_options: { onComplete?: () => void }) => {
      compactCalls += 1;
      throw new Error(
        '/addy-auto retry must not compact or replace the session',
      );
    },
    sendUserMessage: (message: string) => sent.push(message),
    ui: { setWidget() {}, notify() {} },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands.get('addy-auto')?.handler('', ctx);

  assert.equal(newSessionCalls, 0);
  assert.equal(compactCalls, 0);
  assertSentWorkflowPrompt(
    sent[0],
    '/addy-verify docs/plans/current.md',
    'Addy Verify',
  );
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
});

test('agent_end consumes pending fresh prompt before recomputing next action', async () => {
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const sent: Array<{
    message: string;
    options?: { deliverAs?: string; streamingBehavior?: string };
  }> = [];
  let newSessionCalls = 0;
  const ctx: any = {
    cwd: join(stateDir, 'agent-end-pending-current-project'),
    id: 'agent-end-pending-current',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-verify docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'agent-end-pending-key',
    },
    newSession: async () => {
      newSessionCalls += 1;
      return { cancelled: false };
    },
    sendUserMessage: (
      message: string,
      options?: { deliverAs?: string; streamingBehavior?: string },
    ) => sent.push({ message, options }),
    ui: { setWidget() {}, notify() {} },
  };
  setContextWorkflowState(ctx, ctx.state);

  await events.get('agent_end')?.({}, ctx);

  assert.equal(newSessionCalls, 0);
  assertSentWorkflowPrompt(
    sent[0].message,
    '/addy-verify docs/plans/current.md',
    'Addy Verify',
  );
  assert.deepEqual(sent[0].options, {
    deliverAs: 'followUp',
    streamingBehavior: 'followUp',
  });
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
});

test('provider transport failure preserves auto prompt for watchdog retry', async () => {
  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd: join(stateDir, 'provider-transport-failure-project'),
    id: 'provider-transport-failure',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'active',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoLastPrompt: '/addy-verify docs/plans/current.md',
      stats: { active: { tasks: {} }, history: [] },
    },
    ui: { setWidget() {}, notify() {} },
  };
  setContextWorkflowState(ctx, ctx.state);

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          diagnostics: [{ type: 'provider_transport_failure' }],
        },
      ],
    },
    ctx,
  );

  const state = getContextWorkflowState(ctx);
  assert.deepEqual(sentMessages, []);
  assert.equal(state.autoFreshPrompt, undefined);
  assert.equal(
    state.autoPendingAction?.prompt,
    '/addy-verify docs/plans/current.md',
  );
  assert.equal(state.autoPendingAction?.reason, 'idle-retry');
});

test('pending fresh prompt is preserved when no sender can auto-dispatch', async () => {
  const { pi, commands, events } = createPiMock();
  pi.sendUserMessage = undefined as never;
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const editorText: string[] = [];
  const ctx: any = {
    cwd: join(stateDir, 'pending-no-sender-project'),
    id: 'pending-no-sender',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-verify docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'no-sender-key',
    },
    ui: {
      setWidget() {},
      setEditorText: (text: string) => editorText.push(text),
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };
  setContextWorkflowState(ctx, ctx.state);

  await commands.get('addy-auto')?.handler('', ctx);

  assertSentWorkflowPrompt(
    editorText[0],
    '/addy-verify docs/plans/current.md',
    'Addy Verify',
  );
  assert.match(notices.at(-1)?.[0] ?? '', /Prefilled/);
  assert.equal(
    getContextWorkflowState(ctx).autoFreshPrompt,
    '/addy-verify docs/plans/current.md',
  );

  await events.get('input')?.({ input: editorText[0] }, ctx);

  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
  assert.equal(
    getContextWorkflowState(ctx).autoLastPrompt,
    '/addy-verify docs/plans/current.md',
  );
  assert.equal(getContextWorkflowState(ctx).autoMode, true);
});

test('raw manual command matching pending fresh prompt exits auto mode', async () => {
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd: join(stateDir, 'pending-raw-manual-project'),
    id: 'pending-raw-manual',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'verify',
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-verify docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'raw-manual-key',
    },
    ui: { setWidget() {}, notify() {} },
  };
  setContextWorkflowState(ctx, ctx.state);

  await events.get('input')?.(
    { input: '/addy-verify docs/plans/current.md' },
    ctx,
  );

  assert.equal(getContextWorkflowState(ctx).autoMode, false);
  assert.equal(getContextWorkflowState(ctx).autoFreshPrompt, undefined);
});

test('manual Addy turns record active task stats and addy-stats is read-only', async () => {
  const cwd = join(stateDir, 'manual-stats-project');
  const planPath = join('docs', 'plans', 'manual-stats.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Count this task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'manual-stats',
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };

  await commands.get('addy-stats')?.handler({}, ctx);
  assert.deepEqual(notices.at(-1), ['No Addy stats recorded yet', 'info']);

  for (const command of [
    '/addy-build',
    '/addy-verify',
    '/addy-code-simplify',
    '/addy-fix-all',
    '/addy-finish',
  ]) {
    await events.get('input')?.({ input: `${command} ${planPath}` }, ctx);
  }
  await commands.get('addy-stats')?.handler({}, ctx);

  const statsKey = `${planPath}\u001f\u001f1\u001fCount this task`;
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 5);
  assert.match(notices.at(-1)?.[0] ?? '', /Turns: 5/);
  assert.match(
    notices.at(-1)?.[0] ?? '',
    /Current task 1: Count this task — 5 turns/,
  );
  assert.equal(notices.at(-1)?.[1], 'info');
});

test('addy reviewer subagent records a review run', async () => {
  const cwd = join(stateDir, 'subagent-review-stats-project');
  const planPath = join('docs', 'plans', 'subagent-review-stats.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Review by subagent',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'subagent-review-stats',
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };

  await events.get('input')?.({ input: `/addy-build ${planPath}` }, ctx);
  await events.get('before_agent_start')?.({ agentName: 'addy-reviewer' }, ctx);
  await commands.get('addy-stats')?.handler({}, ctx);

  const statsKey = `${planPath}\u001f\u001f1\u001fReview by subagent`;
  assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 1);
  assert.match(notices.at(-1)?.[0] ?? '', /Review runs: 1/);
});

test('manual review with addy reviewer subagent records one review run', async () => {
  const cwd = join(stateDir, 'manual-review-subagent-stats-project');
  const planPath = join('docs', 'plans', 'manual-review-subagent-stats.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Review once',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'manual-review-subagent-stats',
    ui: { setWidget() {} },
  };

  await events.get('input')?.({ input: `/addy-review ${planPath}` }, ctx);
  await events.get('before_agent_start')?.({ agentName: 'addy-reviewer' }, ctx);

  const statsKey = `${planPath}\u001f\u001f1\u001fReview once`;
  assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 1);
});

test('manual review records a review run with zero issues when clean', async () => {
  const cwd = join(stateDir, 'manual-review-clean-stats-project');
  const planPath = join('docs', 'plans', 'manual-review-clean.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Review this task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: 'manual-review-clean-stats',
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };

  await events.get('input')?.({ input: `/addy-review ${planPath}` }, ctx);
  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );
  await commands.get('addy-stats')?.handler({}, ctx);

  const statsKey = `${planPath}\u001f\u001f1\u001fReview this task`;
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.total, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /Review runs: 1/);
  assert.match(notices.at(-1)?.[0] ?? '', /Issues: 0/);
});

test('manual review records severity buckets and unknown fallback', async () => {
  const cwd = join(stateDir, 'manual-review-issue-stats-project');
  const planPath = join('docs', 'plans', 'manual-review-issues.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Review this task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'manual-review-issue-stats',
    ui: { setWidget() {} },
  };

  await events.get('input')?.({ input: `/addy-review ${planPath}` }, ctx);
  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: [
                'Critical: fix src/critical.ts:10 before review can pass.',
                'Important issues:',
                '- Preserve the reviewed task when counting stats.',
                'Suggestions:',
                '- Prefer a shared helper.',
              ].join('\n'),
            },
          ],
        },
      ],
    },
    ctx,
  );
  await events.get('input')?.({ input: `/addy-fix-all ${planPath}` }, ctx);
  await events.get('input')?.({ input: `/addy-review ${planPath}` }, ctx);
  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Review found issues, but the output was not categorized.',
            },
          ],
        },
      ],
    },
    ctx,
  );

  const statsKey = `${planPath}\u001f\u001f1\u001fReview this task`;
  assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 2);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.critical, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.important, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.suggestion, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.unknown, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.total, 4);
});

test('manual review records issue stats in current session when beforeEveryStep is configured', async () => {
  const previousFreshEnv = process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = '1';
  try {
    const cwd = join(stateDir, 'manual-fresh-review-issue-stats-project');
    const planPath = join('docs', 'plans', 'manual-fresh-review.md');
    mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, planPath),
      [
        '## Task 1: Fresh review task',
        '- [x] Implemented',
        '- [x] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    );

    const { pi, events, commands, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    let newSessionCalled = false;
    const ctx: any = {
      cwd,
      id: 'manual-fresh-review-issue-stats',
      newSession: () => {
        newSessionCalled = true;
        throw new Error('manual review must not replace session');
      },
      ui: { setWidget() {}, notify() {} },
    };

    await commands.get('addy-review')?.handler({ args: [planPath] }, ctx);

    const statsKey = `${planPath}\u001f\u001f1\u001fFresh review task`;
    assert.equal(newSessionCalled, false);
    assert.equal(sentMessages.length, 1);
    assert.equal(ctx.state.reviewStatsKey, statsKey);
    assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 1);

    await events.get('agent_end')?.(
      {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Important issues:\n- Fix this.' }],
          },
        ],
      },
      ctx,
    );

    assert.equal(ctx.state.stats.active.tasks[statsKey].issues.important, 1);
    assert.equal(ctx.state.stats.active.tasks[statsKey].issues.total, 1);
  } finally {
    if (previousFreshEnv === undefined)
      delete process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
    else process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = previousFreshEnv;
  }
});

test('review stats count multiline finding details once', async () => {
  const cwd = join(stateDir, 'review-multiline-finding-stats-project');
  const planPath = join('docs', 'plans', 'review-multiline-finding.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Multiline finding task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'review-multiline-finding-stats',
    ui: { setWidget() {} },
  };

  await events.get('input')?.({ input: `/addy-review ${planPath}` }, ctx);
  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: [
                'Important issues:',
                '- Preserve the reviewed task when counting stats.',
                'Evidence: src/review.ts:12 currently drops it.',
                'Fix: carry the state into the replacement session.',
              ].join('\n'),
            },
          ],
        },
      ],
    },
    ctx,
  );

  const statsKey = `${planPath}\u001f\u001f1\u001fMultiline finding task`;
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.important, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.total, 1);
});

test('review subagent stats survive intervening phase transitions', async () => {
  const cwd = join(stateDir, 'review-agent-transition-stats-project');
  const planPath = join('docs', 'plans', 'review-agent-transition.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Transition review task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'review-agent-transition-stats',
    ui: { setWidget() {} },
  };

  await events.get('input')?.({ input: `/addy-review ${planPath}` }, ctx);
  await events.get('before_agent_start')?.({ agentName: 'addy-reviewer' }, ctx);
  await events.get('tool_result')?.(
    { command: 'npm test', success: true },
    ctx,
  );

  const statsKey = `${planPath}\u001f\u001f1\u001fTransition review task`;
  assert.equal(ctx.state.reviewStatsKey, statsKey);
  assert.equal(ctx.state.reviewStatsAgent, 'addy-reviewer');

  await events.get('agent_end')?.(
    {
      agentName: 'addy-test-engineer',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Critical: wrong agent output.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(ctx.state.reviewStatsAgent, 'addy-reviewer');
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.total, 0);
});

test('review subagent stats are consumed only by the matching agent end', async () => {
  const cwd = join(stateDir, 'review-agent-attribution-stats-project');
  const planPath = join('docs', 'plans', 'review-agent-attribution.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Attributed review task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'review-agent-attribution-stats',
    ui: { setWidget() {} },
  };

  await events.get('input')?.({ input: `/addy-review ${planPath}` }, ctx);
  await events.get('before_agent_start')?.({ agentName: 'addy-reviewer' }, ctx);

  const statsKey = `${planPath}\u001f\u001f1\u001fAttributed review task`;
  assert.equal(ctx.state.reviewStatsAgent, 'addy-reviewer');
  assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 1);

  await events.get('agent_end')?.(
    {
      agentName: 'addy-test-engineer',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Critical: unrelated output.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(ctx.state.reviewStatsAgent, 'addy-reviewer');
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.total, 0);

  await events.get('agent_end')?.(
    {
      agentName: 'addy-reviewer',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Suggestions:\n- Tighten this.' }],
        },
      ],
    },
    ctx,
  );

  assert.equal(ctx.state.reviewStatsAgent, undefined);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.suggestion, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.total, 1);
});

test('auto review stats use the same finding parser as the fix loop', async () => {
  const cwd = join(stateDir, 'auto-review-stats-parser-project');
  const planPath = join('docs', 'plans', 'auto-review-stats.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const statsKey = `${planPath}\u001f\u001f1\u001fCurrent`;
  const ctx: any = {
    cwd,
    id: 'auto-review-stats-parser',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Current',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      reviewStatsKey: statsKey,
      activePlan: planPath,
      stats: {
        active: {
          tasks: {
            [statsKey]: {
              plan: planPath,
              taskIndex: 1,
              taskTitle: 'Current',
              turns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Warnings:\n- This can auto-commit unrelated changes.',
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(
    sentMessages[0],
    `/addy-fix-all ${planPath}`,
    'Addy Fix All',
  );
  assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.important, 1);
  assert.equal(ctx.state.stats.active.tasks[statsKey].issues.total, 1);
});

test('auto-dispatched build records one turn without input double-counting', async () => {
  const cwd = join(stateDir, 'auto-stats-dispatch-project');
  const planPath = join('docs', 'plans', 'auto-stats.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Auto task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-stats-dispatch',
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await commands.get('addy-auto')?.handler(planPath, ctx);
  const statsKey = `${planPath}\u001f\u001f1\u001fAuto task`;
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 1);

  await events.get('input')?.({ input: sentMessages.at(-1) }, ctx);
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 1);
});

test('auto-dispatched fix, verify, review, finish, and commit prompts record task turns', async () => {
  const cwd = join(stateDir, 'auto-stats-lifecycle-project');
  const planPath = join('docs', 'plans', 'auto-stats-lifecycle.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Auto task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, commands, sentMessages, sentMessageOptions } =
    createPiMock();
  addyWorkflowMonitor(pi as never);
  const replacementMessages: string[] = [];
  let replacementCtx: any;
  const statsKey = `${planPath}\u001f\u001f1\u001fAuto task`;
  const ctx: any = {
    cwd,
    id: 'auto-stats-lifecycle',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'active',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      currentTask: 'Auto task',
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
      stats: {
        active: {
          tasks: {
            [statsKey]: {
              plan: planPath,
              taskIndex: 1,
              taskTitle: 'Auto task',
              turns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
    },
    sessionManager: { getSessionFile: () => 'stats-old-session.jsonl' },
    newSession: async (options: {
      withSession: (ctx: unknown) => Promise<void> | void;
    }) => {
      replacementCtx = {
        cwd,
        id: 'auto-stats-lifecycle-replacement',
        ui: { setWidget() {}, notify() {} },
        isIdle: () => true,
        sendUserMessage: (message: string) => replacementMessages.push(message),
      };
      await options.withSession(replacementCtx);
      return { cancelled: false };
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Important: fix src/foo.ts:1 before review can pass.',
            },
          ],
        },
      ],
    },
    ctx,
  );
  assertSentWorkflowPrompt(
    sentMessages.at(-1),
    `/addy-fix-all ${planPath}`,
    'Addy Fix All',
  );
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 2);

  await events.get('agent_end')?.(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }] },
      ],
    },
    ctx,
  );
  assertSentWorkflowPrompt(
    sentMessages.at(-1),
    `/addy-verify ${planPath}`,
    'Addy Verify',
  );
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 3);
  assert.equal(ctx.state.stats.active.tasks[statsKey].verifyRuns, 1);

  await events.get('agent_end')?.(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Verified.' }] },
      ],
    },
    ctx,
  );
  assertSentWorkflowPrompt(
    sentMessages.at(-1),
    `/addy-review ${planPath}`,
    'Addy Review',
  );
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 4);
  assert.equal(ctx.state.stats.active.tasks[statsKey].reviewRuns, 2);

  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Auto task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'No issues found.' }],
        },
      ],
    },
    ctx,
  );
  assert.match(sentMessages.at(-1) ?? '', /^# Addy Auto Commit/);
  assert.deepEqual(sentMessageOptions.at(-1), {
    streamingBehavior: 'followUp',
  });
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 5);

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'COMMIT: abc1234' }],
        },
      ],
    },
    ctx,
  );
  assert.equal(ctx.state.stats.history.at(-1)?.endedReason, 'task-commit');
  assert.equal(ctx.state.stats.history.at(-1)?.tasks[statsKey].turns, 5);

  assertSentWorkflowPrompt(
    sentMessages.at(-1),
    `/addy-finish ${planPath}`,
    'Addy Finish',
  );
  assert.equal(replacementMessages.length, 0);
  assert.equal(replacementCtx, undefined);
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 1);
});

test('auto stop preserves active stats and reports totals', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    id: 'auto-stop-stats',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      autoMode: true,
      autoFreshPrompt: '/addy-build docs/plans/current.md',
      stats: {
        active: {
          tasks: {
            task: {
              taskTitle: 'Task',
              turns: 3,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 1,
                suggestion: 0,
                unknown: 0,
                total: 1,
              },
            },
          },
        },
        history: [],
      },
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  };

  await commands.get('addy-auto')?.handler({ args: ['stop'] }, ctx);

  assert.equal(ctx.state.autoMode, false);
  assert.equal(ctx.state.autoFreshPrompt, undefined);
  assert.equal(ctx.state.stats.active.tasks.task.turns, 3);
  assert.equal(ctx.state.stats.history.length, 0);
  assert.match(notices.at(-1)?.[0] ?? '', /Addy auto stopped/);
  assert.match(notices.at(-1)?.[0] ?? '', /Turns: 3/);
});

test('auto finish archives active stats and reports totals', async () => {
  const cwd = join(stateDir, 'auto-finish-stats-project');
  const planPath = join('docs', 'plans', 'auto-finish-stats.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Current',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );

  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const statsKey = `${planPath}\u001f\u001f1\u001fCurrent`;
  const ctx: any = {
    cwd,
    id: 'auto-finish-stats',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'complete',
        finish: 'active',
      },
      warnings: [],
      current: 'finish',
      autoMode: true,
      autoLastPrompt: `/addy-finish ${planPath}`,
      activePlan: planPath,
      committedTasks: committedTasksFor(planPath, [
        { taskIndex: 1, taskTitle: 'Current' },
      ]),
      stats: {
        active: {
          tasks: {
            [statsKey]: {
              plan: planPath,
              taskIndex: 1,
              taskTitle: 'Current',
              turns: 2,
              verifyRuns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
    },
    ui: {
      setWidget() {},
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Finished!' }] },
      ],
    },
    ctx,
  );

  assert.equal(ctx.state.autoMode, false);
  assert.equal(ctx.state.stats.active.tasks[statsKey], undefined);
  assert.equal(ctx.state.stats.history.at(-1)?.endedReason, 'completed');
  assert.equal(ctx.state.stats.history.at(-1)?.tasks[statsKey].turns, 2);
  assert.match(notices.at(-1)?.[0] ?? '', /Finished!/);
  assert.match(notices.at(-1)?.[0] ?? '', /Turns: 2/);
});

test('workflow stats render aggregated history details for each task', () => {
  const state: any = {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'complete',
      simplify: 'pending',
      verify: 'complete',
      review: 'complete',
      finish: 'complete',
    },
    warnings: [],
    stats: {
      active: { tasks: {} },
      history: [
        {
          endedReason: 'task-commit',
          tasks: {
            first: {
              plan: 'docs/plans/slice-01.md',
              sliceIndex: 1,
              taskIndex: 1,
              taskTitle: 'First task',
              turns: 3,
              verifyRuns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 1,
                suggestion: 0,
                unknown: 0,
                total: 1,
              },
            },
          },
        },
        {
          endedReason: 'task-commit',
          tasks: {
            second: {
              plan: 'docs/plans/slice-02.md',
              sliceIndex: 2,
              taskIndex: 1,
              taskTitle: 'Second task',
              turns: 4,
              verifyRuns: 2,
              reviewRuns: 2,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 1,
                unknown: 0,
                total: 1,
              },
            },
          },
        },
        {
          endedReason: 'completed',
          tasks: {
            finish: {
              plan: 'docs/plans/slice-02.md',
              sliceIndex: 2,
              taskIndex: 1,
              taskTitle: 'Second task',
              turns: 1,
              verifyRuns: 0,
              reviewRuns: 0,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
      ],
    },
  };

  const stats = renderWorkflowStatsText(state);
  const markdown = renderWorkflowStatsMarkdown(state);

  assert.match(stats, /Turns: 8/);
  assert.match(stats, /Verify runs: 3/);
  assert.match(stats, /Review runs: 3/);
  assert.match(
    stats,
    /Completed slice 1, task 1: First task — 3 turns, verify 1, review 1, issues 1/,
  );
  assert.match(
    stats,
    /Completed slice 2, task 1: Second task — 5 turns, verify 2, review 2, issues 1/,
  );
  assert.match(markdown, /\| Metric \| Count \|/);
  assert.match(markdown, /\| Turns \| 8 \|/);
  assert.match(
    markdown,
    /\| Completed \| Slice 1 \| Task 1: First task \| 3 \| 1 \| 1 \| 1 \|/,
  );
  assert.match(
    markdown,
    /\| Completed \| Slice 2 \| Task 1: Second task \| 5 \| 2 \| 2 \| 1 \|/,
  );
});

test('addy-stats sends markdown table when custom messages are available', async () => {
  const commands = new Map<string, CommandConfig>();
  const messages: Array<{ message: unknown; options: unknown }> = [];
  const pi = {
    on() {},
    registerCommand: (name: string, config: CommandConfig) =>
      commands.set(name, config),
    registerMessageRenderer() {},
    appendEntry() {},
    sendMessage: (message: unknown, options: unknown) =>
      messages.push({ message, options }),
    sendUserMessage() {},
  };
  addyWorkflowMonitor(pi as never);

  const ctx: any = {
    id: 'custom-message-stats',
    state: {
      phases: {},
      warnings: [],
      stats: {
        active: {
          tasks: {
            task: {
              sliceIndex: 1,
              taskIndex: 2,
              taskTitle: 'Render stats',
              turns: 4,
              verifyRuns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 1,
                suggestion: 0,
                unknown: 0,
                total: 1,
              },
            },
          },
        },
        history: [],
      },
    },
    ui: { notify: () => assert.fail('expected markdown message, not notify') },
  };

  await commands.get('addy-stats')?.handler({}, ctx);

  const sent = messages.at(-1);
  assert.equal(sent?.options, undefined);
  const message = sent?.message as {
    customType?: string;
    details?: { markdown?: string };
  };
  assert.equal(message.customType, 'pi-addy-workflow-stats');
  assert.match(message.details?.markdown ?? '', /\| Metric \| Count \|/);
  assert.match(
    message.details?.markdown ?? '',
    /\| Current \| Slice 1 \| Task 2: Render stats \| 4 \| 1 \| 1 \| 1 \|/,
  );
});

test('auto stats use advanced numbered slice task grouping', async () => {
  const cwd = join(stateDir, 'auto-stats-slice-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  const indexPlan = join('docs', 'plans', 'feature-index.md');
  const firstPlan = join('docs', 'plans', 'feature-slice-01-one.md');
  const secondPlan = join('docs', 'plans', 'feature-slice-02-two.md');
  writeFileSync(
    join(cwd, indexPlan),
    [
      '# Feature index',
      '| Slice | Plan |',
      '| --- | --- |',
      '| 01 | `docs/plans/feature-slice-01-one.md` |',
      '| 02 | `docs/plans/feature-slice-02-two.md` |',
    ].join('\n'),
  );
  writeFileSync(
    join(cwd, firstPlan),
    [
      '## Task 1: Done',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(cwd, secondPlan),
    [
      '## Task 1: Next slice task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: 'auto-stats-slice',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        simplify: 'pending',
        verify: 'complete',
        review: 'complete',
        finish: 'pending',
      },
      warnings: [],
      current: 'review',
      autoMode: true,
      activePlan: indexPlan,
      committedTasks: committedTasksFor(firstPlan, [
        { taskIndex: 1, taskTitle: 'Done', sliceIndex: 1 },
      ]),
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get('agent_end')?.(
    {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'COMMIT: abc1234' }],
        },
      ],
    },
    ctx,
  );

  assertSentWorkflowPrompt(
    sentMessages.at(-1),
    `/addy-build ${secondPlan}`,
    'Addy Build',
  );
  const statsKey = `${secondPlan}\u001f2\u001f1\u001fNext slice task`;
  assert.equal(ctx.state.stats.active.tasks[statsKey].turns, 1);
});

test('legacy workflow state normalizes to empty stats', () => {
  const ctx: any = {
    sessionManager: {
      getBranch: () => [
        [
          WORKFLOW_STATE_ENTRY_TYPE,
          {
            current: 'build',
            phases: {
              define: 'complete',
              plan: 'complete',
              build: 'active',
              simplify: 'pending',
              verify: 'pending',
              review: 'pending',
              finish: 'pending',
            },
            warnings: [],
          },
        ],
      ],
    },
  };

  assert.deepEqual(getContextWorkflowState(ctx).stats, {
    active: { tasks: {} },
    history: [],
  });
});

test('reset command archives active stats history', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const widgets: Array<[string, unknown]> = [];
  const ctx: any = {
    id: 'reset-stats-history-test',
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      stats: {
        active: {
          tasks: {
            task: {
              taskTitle: 'Task',
              turns: 2,
              reviewRuns: 0,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
        history: [],
      },
    },
    ui: {
      setWidget: (key: string, value: unknown) => widgets.push([key, value]),
    },
  };

  await commands.get('addy-workflow-reset')?.handler({}, ctx);

  assert.deepEqual(ctx.state.stats.active.tasks, {});
  assert.equal(ctx.state.stats.history.length, 1);
  assert.equal(ctx.state.stats.history[0].endedReason, 'reset');
  assert.equal(ctx.state.stats.history[0].tasks.task.turns, 2);
  assert.deepEqual(widgets, [['pi-addy-workflow', undefined]]);
});

test('reset command clears widget, persists reset state, and continues', async () => {
  const { pi, commands, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const widgets: Array<[string, unknown]> = [];
  const result = await commands.get('addy-workflow-reset')?.handler(
    {},
    {
      id: 'reset-command-test',
      ui: {
        setWidget: (key: string, value: unknown) => widgets.push([key, value]),
      },
    },
  );

  assert.deepEqual(result, { action: 'continue' });
  assert.equal(entries.at(-1)?.[0], 'pi-addy-workflow-state');
  assert.deepEqual(widgets, [['pi-addy-workflow', undefined]]);
});

test('next command parses args, transitions, persists, prefills, and continues', async () => {
  const { pi, commands, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const effects: Array<[string, unknown]> = [];
  const ctx: any = {
    id: 'next-command-test',
    ui: {
      setWidget: (key: string, value: unknown) => effects.push([key, value]),
    },
    input: { prefill: (value: string) => effects.push(['prefill', value]) },
  };

  const result = await commands
    .get('addy-workflow-next')
    ?.handler('review diff.md', ctx);

  assert.deepEqual(result, { action: 'continue' });
  assert.equal(ctx.state.current, 'review');
  assert.equal(ctx.state.activePlan, 'diff.md');
  assert.equal(entries.at(-1)?.[0], 'pi-addy-workflow-state');
  assert.equal(effects.at(0)?.[0], 'pi-addy-workflow');
  assert.deepEqual((effects.at(0)?.[1] as any)().render(), [
    'Addy Workflow: ✓define → ✓plan => { build → simplify → verify → [review] → finish } | diff.md',
  ]);
  assert.deepEqual(effects.at(1), ['prefill', '/addy-review diff.md']);
});

test('next command warns and continues on invalid phase', async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const notices: Array<[string, string | undefined]> = [];
  const result = await commands.get('addy-workflow-next')?.handler('bogus', {
    ui: {
      notify: (message: string, level?: string) =>
        notices.push([message, level]),
    },
  });

  assert.deepEqual(result, { action: 'continue' });
  assert.match(notices[0][0], /Usage: \/addy-workflow-next/);
  assert.equal(notices[0][1], 'warning');
});

test('workflow state survives fresh contexts without session entries', () => {
  const firstCtx: any = { id: 'fresh-context-test', ui: { setWidget() {} } };
  const build = handleWorkflowEvent(firstCtx, {
    source: 'user-input',
    text: '/addy-build',
  });
  assert.equal(build.current, 'build');

  const nextCtx: any = {
    id: 'fresh-context-test',
    ui: {
      setWidget() {},
      notify(message: string) {
        throw new Error(message);
      },
    },
  };
  const verify = handleWorkflowEvent(nextCtx, {
    source: 'user-input',
    text: '/addy-verify',
  });

  assert.equal(verify.current, 'verify');
  assert.deepEqual(verify.warnings, []);
});

test('active plan written during plan phase survives fresh sessions for next build', () => {
  const cwd = join(stateDir, 'fresh-plan-project');
  const planPath = 'docs/plans/2026-05-11-better-workflow.md';
  const firstCtx: any = { cwd, id: 'plan-session', ui: { setWidget() {} } };
  const planned = handleWorkflowEvent(firstCtx, {
    source: 'file-write',
    artifact: planPath,
  });
  assert.equal(planned.activePlan, planPath);

  const prefills: string[] = [];
  const nextCtx: any = {
    cwd,
    id: 'build-session',
    input: { prefill: (value: string) => prefills.push(value) },
  };

  assert.equal(getContextWorkflowState(nextCtx).activePlan, planPath);
  // A fresh session with no explicit argument should use the persisted active plan immediately.
  assert.equal(
    openNextWorkflowPrompt(nextCtx, 'build'),
    `/addy-build ${planPath}`,
  );
  assert.deepEqual(prefills, [`/addy-build ${planPath}`]);
});

test('workflow state persists under the project .pi directory by default', () => {
  const previousStateDir = process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  const cwd = join(stateDir, 'project-local-state');
  const sessionId = 'project-local-state-session';
  const sessionKey = createHash('sha256')
    .update(sessionId)
    .digest('hex')
    .slice(0, 24);
  const projectKey = createHash('sha256')
    .update(`project:${cwd}`)
    .digest('hex')
    .slice(0, 24);
  const ctx: any = {
    cwd,
    id: sessionId,
    ui: { setWidget() {} },
  };

  try {
    const state = handleWorkflowEvent(ctx, {
      source: 'user-input',
      text: '/addy-build docs/plans/local.md',
    });

    assert.equal(state.activePlan, 'docs/plans/local.md');
    assert.ok(
      existsSync(
        join(cwd, '.pi', 'addy-workflow', 'state', `${sessionKey}.json`),
      ),
    );
    assert.ok(
      existsSync(
        join(cwd, '.pi', 'addy-workflow', 'state', `${projectKey}.json`),
      ),
    );
  } finally {
    if (previousStateDir === undefined)
      delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
    else process.env.PI_ADDY_WORKFLOW_STATE_DIR = previousStateDir;
  }
});

test('auto mode input preserves plan and task progress while toggling footer label', () => {
  const widgets: Array<[string, unknown]> = [];
  const ctx: any = {
    id: 'auto-mode-toggle',
    ui: {
      setWidget: (key: string, value: unknown) => widgets.push([key, value]),
    },
  };
  const build = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: '/addy-build docs/plans/auto-mode.md',
  });
  const withTask = {
    ...build,
    autoFreshPrompt: '/addy-build docs/plans/auto-mode.md',
    currentTask: 'Current task',
    nextTask: 'Next task',
    currentTaskIndex: 1,
    taskCount: 2,
  };
  ctx.state = withTask;

  const auto = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: '/addy-auto',
  });
  assert.equal(auto.autoMode, true);
  assert.equal(auto.autoFreshPrompt, undefined);
  assert.equal(auto.activePlan, 'docs/plans/auto-mode.md');
  assert.equal(auto.currentTask, 'Current task');
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), [
    '🔁 Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish } | auto-mode.md',
    'Current task: Current task | Next task: Next task | Task 1/2',
  ]);

  const stopped = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: '/addy-auto stop',
  });

  assert.equal(stopped.autoMode, false);
  assert.equal(stopped.activePlan, 'docs/plans/auto-mode.md');
  assert.equal(stopped.currentTask, 'Current task');
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish } | auto-mode.md',
    'Current task: Current task | Next task: Next task | Task 1/2',
  ]);

  const nextCtx: any = {
    id: 'auto-mode-toggle',
    sessionManager: { getBranch: () => [] },
  };
  assert.equal(getContextWorkflowState(nextCtx).autoMode, false);
  assert.equal(
    getContextWorkflowState(nextCtx).activePlan,
    'docs/plans/auto-mode.md',
  );
});

test('auto mode ignores invalid slash-like plan artifacts', () => {
  const ctx: any = {
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      activePlan: 'docs/plans/current.md',
    },
    ui: { setWidget() {} },
  };

  const state = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: '/addy-auto /add',
  });

  assert.equal(state.autoMode, true);
  assert.equal(state.activePlan, 'docs/plans/current.md');
});

test('workflow state sanitizes invalid persisted slash active plan', () => {
  const ctx: any = {
    state: {
      phases: {
        define: 'complete',
        plan: 'complete',
        build: 'active',
        simplify: 'pending',
        verify: 'pending',
        review: 'pending',
        finish: 'pending',
      },
      warnings: [],
      current: 'build',
      activePlan: '/add',
    },
  };

  assert.equal(getContextWorkflowState(ctx).activePlan, undefined);
});

test('workflow state stores current and next task from active plan', () => {
  const cwd = join(stateDir, 'task-state-project');
  const relativePlanPath = join('docs', 'plans', 'task-state.md');
  const referencedPlanPath = `@${relativePlanPath}`;
  const planPath = join(cwd, relativePlanPath);
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    planPath,
    [
      '## Task 1: Done',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Current',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 3: Next',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const ctx: any = { cwd, id: 'task-state-session', ui: { setWidget() {} } };
  const planned = handleWorkflowEvent(ctx, {
    source: 'file-write',
    artifact: referencedPlanPath,
  });
  ctx.state = {
    ...ctx.state,
    committedTasks: committedTasksFor(referencedPlanPath, [
      { taskIndex: 1, taskTitle: 'Done' },
    ]),
  };
  const build = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: '/addy-build',
  });

  assert.equal(planned.activePlan, referencedPlanPath);
  assert.equal(build.currentTask, 'Current');
  assert.equal(build.nextTask, 'Next');
  assert.equal(ctx.state.currentTask, 'Current');
  assert.equal(ctx.state.nextTask, 'Next');
});

test('bare verify keeps completed active slice on finish boundary', () => {
  const cwd = join(stateDir, 'stale-active-plan-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(
    join(
      plansDir,
      '2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
    ),
    [
      '## Task 1: Done',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(
      plansDir,
      '2026-05-08-invoice-csv-etl-slice-06-failures-reports-reruns.md',
    ),
    [
      '## Task 1: Reviewed already',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Verify Slice 06 Task 2',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const ctx: any = {
    cwd,
    id: 'stale-active-plan-session',
    ui: { setWidget() {} },
  };
  handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: '/addy-build @docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
  });
  ctx.state = {
    ...ctx.state,
    committedTasks: committedTasksFor(
      '@docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
      [{ taskIndex: 1, taskTitle: 'Done', sliceIndex: 5 }],
    ),
  };
  const verify = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: '/addy-verify',
  });

  assert.equal(verify.current, 'verify');
  assert.equal(
    verify.activePlan,
    '@docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
  );
  assert.equal(verify.currentTask, 'all tasks complete');
  assert.equal(verify.nextTask, 'none');
});

test('late task summaries do not overwrite newer workflow state', async () => {
  const cwd = join(stateDir, 'task-summary-race-project');
  const firstPlan = join(cwd, 'docs', 'plans', 'first.md');
  const secondPlan = join(cwd, 'docs', 'plans', 'second.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    firstPlan,
    [
      '## Task 1: First long task name that needs summary',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    secondPlan,
    [
      '## Task 1: Second long task name that must win',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  let releaseFirstSummary: (() => void) | undefined;
  const ctx: any = {
    cwd,
    id: 'task-summary-race-session',
    ui: { setWidget() {} },
    model: { provider: 'test', id: 'test-model' },
    modelRegistry: {
      getApiKeyAndHeaders: () =>
        new Promise((resolve) => {
          releaseFirstSummary = () => resolve({ ok: true, apiKey: 'test-key' });
        }),
    },
  };

  handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: `/addy-build ${firstPlan}`,
  });
  handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: `/addy-build ${secondPlan}`,
  });
  releaseFirstSummary?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(ctx.state.activePlan, secondPlan);
  assert.equal(ctx.state.currentTask, 'Second long task name that must win');
});

test('workflow state round-trips from persisted append entries', () => {
  const entries: Array<[string, unknown]> = [];
  const firstCtx: any = { ui: { setWidget() {} } };
  const build = handleWorkflowEvent(
    firstCtx,
    { source: 'user-input', text: '/addy-build' },
    (type, data) => entries.push([type, data]),
  );
  assert.equal(build.current, 'build');

  const nextCtx: any = {
    ui: {
      setWidget() {},
      notify(message: string) {
        throw new Error(message);
      },
    },
    sessionManager: { getBranch: () => entries },
  };
  const verify = handleWorkflowEvent(
    nextCtx,
    { source: 'user-input', text: '/addy-verify' },
    (type, data) => entries.push([type, data]),
  );

  assert.equal(getContextWorkflowState(nextCtx).current, 'verify');
  assert.deepEqual(verify.warnings, []);
});

test('workflow state backfills committed task ledger from legacy task-commit stats', () => {
  const planPath = 'docs/plans/slice-04.md';
  const committedKey = workflowTaskCommitKey(planPath, 1, 'Committed task');
  const buildOnlyKey = workflowTaskCommitKey(planPath, 2, 'Build-only task');
  const legacyState = {
    current: 'build',
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'active',
      simplify: 'pending',
      verify: 'pending',
      review: 'pending',
      finish: 'pending',
    },
    warnings: [],
    activePlan: planPath,
    stats: {
      active: { tasks: {} },
      history: [
        {
          endedReason: 'task-commit',
          tasks: {
            committed: {
              plan: planPath,
              sliceIndex: 4,
              taskIndex: 1,
              taskTitle: 'Committed task',
              turns: 3,
              verifyRuns: 1,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
            buildOnly: {
              plan: planPath,
              sliceIndex: 4,
              taskIndex: 2,
              taskTitle: 'Build-only task',
              turns: 1,
              verifyRuns: 0,
              reviewRuns: 0,
              issues: {
                critical: 0,
                important: 0,
                suggestion: 0,
                unknown: 0,
                total: 0,
              },
            },
          },
        },
      ],
    },
  };

  const state = getContextWorkflowState({
    id: 'legacy-task-commit-ledger-backfill',
    sessionManager: {
      getBranch: () => [[WORKFLOW_STATE_ENTRY_TYPE, legacyState]],
    },
  });

  assert.deepEqual(state.committedTasks?.[committedKey], {
    plan: planPath,
    sliceIndex: 4,
    taskIndex: 1,
    taskTitle: 'Committed task',
    commitSha: state.committedTasks?.[committedKey]?.commitSha,
    committedAt: 'legacy-task-commit',
  });
  assert.match(
    state.committedTasks?.[committedKey]?.commitSha ?? '',
    /^legacy:/,
  );
  assert.equal(state.committedTasks?.[buildOnlyKey], undefined);
});

test('workflow state skips malformed latest entries', () => {
  const validState = {
    current: 'build',
    phases: {
      define: 'pending',
      plan: 'pending',
      build: 'active',
      simplify: 'pending',
      verify: 'pending',
      review: 'pending',
      finish: 'pending',
    },
    warnings: [],
  };
  const ctx: any = {
    sessionManager: {
      getBranch: () => [
        [WORKFLOW_STATE_ENTRY_TYPE, validState],
        [WORKFLOW_STATE_ENTRY_TYPE, { bad: 'state' }],
        [
          WORKFLOW_STATE_ENTRY_TYPE,
          { current: 'verify', phases: {}, warnings: [] },
        ],
      ],
    },
  };

  assert.equal(getContextWorkflowState(ctx).current, 'build');
});

test('workflow state reads custom session entries', () => {
  const ctx: any = {
    sessionManager: {
      getBranch: () => [
        {
          type: 'custom',
          customType: WORKFLOW_STATE_ENTRY_TYPE,
          data: {
            current: 'build',
            phases: {
              define: 'pending',
              plan: 'pending',
              build: 'active',
              simplify: 'pending',
              verify: 'pending',
              review: 'pending',
              finish: 'pending',
            },
            warnings: [],
          },
        },
      ],
    },
  };

  assert.equal(getContextWorkflowState(ctx).current, 'build');
});

test('workflow state migrates legacy ship phase to finish', () => {
  const ctx: any = {
    sessionManager: {
      getBranch: () => [
        {
          type: 'custom',
          customType: WORKFLOW_STATE_ENTRY_TYPE,
          data: {
            current: 'ship',
            phases: {
              define: 'complete',
              plan: 'complete',
              build: 'complete',
              simplify: 'pending',
              verify: 'complete',
              review: 'complete',
              ship: 'active',
            },
            warnings: [],
          },
        },
      ],
    },
  };

  const state = getContextWorkflowState(ctx);

  assert.equal(state.current, 'finish');
  assert.equal(state.phases.finish, 'active');
});

test('write tool calls drive file-write transitions', async () => {
  const { pi, events, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const effects: Array<[string, unknown]> = [];
  const ctx: any = {
    cwd: join(stateDir, 'write-tool-project'),
    id: 'write-tool-test',
    ui: {
      setWidget: (key: string, value: unknown) => effects.push([key, value]),
    },
  };
  await events.get('tool_call')?.(
    { toolName: 'write', input: { path: 'tests/example.test.ts' } },
    ctx,
  );

  assert.equal(ctx.state.current, 'verify');
  assert.equal(entries.at(-1)?.[0], 'pi-addy-workflow-state');
  assert.equal(effects.at(-1)?.[0], 'pi-addy-workflow');
  assert.deepEqual((effects.at(-1)?.[1] as any)().render(), [
    'Addy Workflow: ✓define → ✓plan => { build → simplify → [verify] → review → finish }',
  ]);
});
