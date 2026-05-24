import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFakeAddyProject,
  renameTask,
  setTaskStatuses,
  type FakeAddyProject,
} from './fixtures/fake-project.ts';
import {
  agentEndEvent,
  assertWorkflowPrompt,
  createAddyWorkflowHarness,
  stripAnsi,
  type AddyWorkflowHarness,
} from './fixtures/fake-workflow-runtime.ts';

const stateDir = mkdtempSync(join(tmpdir(), 'pi-addy-auto-fixture-state-'));
const previousStateDir = process.env.PI_ADDY_WORKFLOW_STATE_DIR;
const previousFreshEveryStep =
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
const previousFreshBetweenTasks =
  process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS;
const previousFreshBeforeReview =
  process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW;

process.env.PI_ADDY_WORKFLOW_STATE_DIR = stateDir;
process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = '0';
process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS = '0';
process.env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW = '0';

test.after(() => {
  restoreEnv('PI_ADDY_WORKFLOW_STATE_DIR', previousStateDir);
  restoreEnv('PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP', previousFreshEveryStep);
  restoreEnv(
    'PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS',
    previousFreshBetweenTasks,
  );
  restoreEnv(
    'PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW',
    previousFreshBeforeReview,
  );
  rmSync(stateDir, { recursive: true, force: true });
});

test('fake Addy Auto loop proves state execution and footer display across slices', async () => {
  const project = createFakeAddyProject();
  const harness = createAddyWorkflowHarness({
    cwd: project.cwd,
    id: 'fixture-happy-path',
  });

  await harness.commands
    .get('addy-auto')
    ?.handler(project.indexPath, harness.ctx);
  harness.recordProof('start auto', 'input');
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `/addy-build ${project.slices[0].path}`,
    'Addy Build',
  );
  assertStateFooterAndPromptAgree(harness, {
    activePlan: project.slices[0].path,
    activeSuitePlan: project.indexPath,
    currentTaskId: 'setup-cli',
    currentTask: 'Add baseline CLI',
    promptCommand: '/addy-build',
    footerIncludes: [
      'Current task: Add baseline CLI',
      'Next task: Add config file',
      'Slice 1/2',
      'Task 1/2',
      'Total tasks',
    ],
  });

  await completeTask(project, harness, 1, 'setup-cli', {
    nextCommand: '/addy-build',
    nextHeading: 'Addy Build',
    nextPlan: project.slices[0].path,
    nextTaskId: 'setup-config',
    nextTask: 'Add config file',
    commitSha: 'aaa1111',
  });

  await completeTask(project, harness, 1, 'setup-config', {
    nextCommand: '/addy-build',
    nextHeading: 'Addy Build',
    nextPlan: project.slices[1].path,
    nextTaskId: 'feature-command',
    nextTask: 'Add feature command',
    commitSha: 'bbb2222',
  });

  await completeTask(project, harness, 2, 'feature-command', {
    nextCommand: '/addy-build',
    nextHeading: 'Addy Build',
    nextPlan: project.slices[1].path,
    nextTaskId: 'feature-docs',
    nextTask: 'Add feature docs',
    commitSha: 'ccc3333',
  });

  await completeTask(project, harness, 2, 'feature-docs', {
    nextCommand: '/addy-finish',
    nextHeading: 'Addy Finish',
    nextPlan: project.slices[1].path,
    nextTask: 'all tasks complete',
    commitSha: 'ddd4444',
  });

  await harness.events.get('agent_end')?.(
    agentEndEvent('Finished!'),
    harness.ctx,
  );
  harness.recordProof('finish complete', 'agent-end', 'Finished!');

  assert.equal(harness.ctx.state.autoMode, false);
  assert.equal(harness.ctx.state.autoPendingAction, undefined);
  assert.equal(harness.ctx.state.autoFreshPrompt, undefined);
  assert.equal(Object.keys(harness.ctx.state.committedTasks ?? {}).length, 4);
  assert.deepEqual(harness.ctx.state.stats.active.tasks, {});
  assert.ok(
    harness.proof.some(
      (step) =>
        step.state.activePlan === project.slices[1].path &&
        step.state.currentTask === 'all tasks complete' &&
        step.footer.line?.includes('all tasks complete'),
    ),
    JSON.stringify(harness.proof, null, 2),
  );
  assertProofHasNoStateExecutionFooterDrift(harness);
});

test('fake Addy Auto review-fix loop proves fix verify review sequencing', async () => {
  const project = createFakeAddyProject();
  const harness = createAddyWorkflowHarness({
    cwd: project.cwd,
    id: 'fixture-review-fix',
  });

  await harness.commands
    .get('addy-auto')
    ?.handler(project.slices[0].path, harness.ctx);
  setTaskStatuses(project, 1, 'setup-cli', { implemented: true });
  await harness.events.get('agent_end')?.(
    agentEndEvent('Implemented.'),
    harness.ctx,
  );
  setTaskStatuses(project, 1, 'setup-cli', { verified: true });
  await harness.events.get('agent_end')?.(
    agentEndEvent('Verified.'),
    harness.ctx,
  );
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `/addy-review ${project.slices[0].path}`,
    'Addy Review',
  );

  await harness.events.get('agent_end')?.(
    agentEndEvent('Important: fix src/index.ts:1 before review can pass.'),
    harness.ctx,
  );
  harness.recordProof('review finding dispatches fix-all', 'agent-end');
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `/addy-fix-all ${project.slices[0].path}`,
    'Addy Fix All',
  );

  await harness.events.get('agent_end')?.(agentEndEvent('Fixed.'), harness.ctx);
  harness.recordProof('fix-all dispatches verify', 'agent-end');
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `/addy-verify ${project.slices[0].path}`,
    'Addy Verify',
  );

  await harness.events.get('agent_end')?.(
    agentEndEvent('Verified after fix.'),
    harness.ctx,
  );
  harness.recordProof('post-fix verify dispatches review', 'agent-end');
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `/addy-review ${project.slices[0].path}`,
    'Addy Review',
  );

  setTaskStatuses(project, 1, 'setup-cli', { reviewed: true });
  await harness.events.get('agent_end')?.(
    agentEndEvent('No issues found.'),
    harness.ctx,
  );
  harness.recordProof('clean review dispatches task commit', 'agent-end');
  assertWorkflowPrompt(
    harness.lastPrompt(),
    '__addy-auto-task-commit__',
    'Addy Auto Commit',
  );
  assert.equal(harness.ctx.state.autoReviewFixCount, 1);
  assertProofHasNoStateExecutionFooterDrift(harness);
});

test('fake Addy Auto rejects stale lifecycle evidence before commit or slice advancement', async () => {
  const project = createFakeAddyProject();
  setTaskStatuses(project, 1, 'setup-cli', {
    implemented: true,
    verified: true,
    reviewed: true,
  });
  const harness = createAddyWorkflowHarness({
    cwd: project.cwd,
    id: 'fixture-stale-evidence',
  });

  await harness.commands
    .get('addy-auto')
    ?.handler(project.slices[0].path, harness.ctx);
  harness.recordProof(
    'checked boxes without review evidence still review',
    'input',
  );
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `/addy-review ${project.slices[0].path}`,
    'Addy Review',
  );
  assert.equal(harness.ctx.state.currentTaskId, 'setup-cli');
  assert.equal(harness.ctx.state.committedTasks, undefined);

  assert.equal(harness.ctx.state.committedTasks, undefined);

  renameTask(project, 1, 'setup-cli', 'Add renamed baseline CLI');
  await harness.events.get('agent_end')?.(
    agentEndEvent('No issues found.'),
    harness.ctx,
  );
  harness.recordProof(
    'stable task id survives title rename for commit',
    'agent-end',
  );
  assertWorkflowPrompt(
    harness.lastPrompt(),
    '__addy-auto-task-commit__',
    'Addy Auto Commit',
  );

  await harness.events.get('agent_end')?.(
    agentEndEvent('COMMIT: eee5555'),
    harness.ctx,
  );
  harness.recordProof('commit evidence closes renamed task', 'agent-end');
  assert.equal(Object.keys(harness.ctx.state.committedTasks ?? {}).length, 1);
  assert.equal(harness.ctx.state.currentTaskId, 'setup-config');
  assertProofHasNoStateExecutionFooterDrift(harness);
});

test('fake Addy Auto delivery proof covers idle retry and fresh fallback', async () => {
  const busyProject = createFakeAddyProject();
  const busyHarness = createAddyWorkflowHarness({
    cwd: busyProject.cwd,
    id: 'fixture-busy-idle',
    idle: true,
  });

  await busyHarness.commands
    .get('addy-auto')
    ?.handler(busyProject.slices[0].path, busyHarness.ctx);
  setTaskStatuses(busyProject, 1, 'setup-cli', { implemented: true });
  busyHarness.setIdle(false);
  await busyHarness.events.get('agent_end')?.(
    agentEndEvent('Implemented while runtime is busy.'),
    busyHarness.ctx,
  );
  busyHarness.recordProof('busy runtime preserves pending verify', 'agent-end');
  assert.equal(
    busyHarness.ctx.state.autoPendingAction?.prompt,
    `/addy-verify ${busyProject.slices[0].path}`,
  );
  const promptCountBeforeIdle = busyHarness.sentMessages.length;

  busyHarness.setIdle(true);
  await busyHarness.flushIdle();
  assert.equal(busyHarness.sentMessages.length, promptCountBeforeIdle + 1);
  assertWorkflowPrompt(
    busyHarness.lastPrompt(),
    `/addy-verify ${busyProject.slices[0].path}`,
    'Addy Verify',
  );
  assert.equal(busyHarness.ctx.state.autoPendingAction, undefined);

  const previousFreshEveryStep =
    process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP;
  process.env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP = 'true';
  try {
    const freshProject = createFakeAddyProject();
    const freshHarness = createAddyWorkflowHarness({
      cwd: freshProject.cwd,
      id: 'fixture-fresh-cancelled',
      canStartFreshSession: true,
      freshSessionCancelled: true,
    });

    await freshHarness.commands
      .get('addy-auto')
      ?.handler(freshProject.slices[0].path, freshHarness.ctx);
    setTaskStatuses(freshProject, 1, 'setup-cli', { implemented: true });
    await freshHarness.events.get('agent_end')?.(
      agentEndEvent('Implemented with cancelled fresh session.'),
      freshHarness.ctx,
    );
    freshHarness.recordProof(
      'cancelled fresh session falls back current session',
      'agent-end',
    );
    assert.equal(freshHarness.freshSessions.length, 0);
    assertWorkflowPrompt(
      freshHarness.lastPrompt(),
      `/addy-verify ${freshProject.slices[0].path}`,
      'Addy Verify',
    );
    assert.equal(freshHarness.ctx.state.autoFreshPrompt, undefined);
  } finally {
    restoreEnv(
      'PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP',
      previousFreshEveryStep,
    );
  }
});

async function completeTask(
  project: FakeAddyProject,
  harness: AddyWorkflowHarness,
  sliceIndex: number,
  taskId: string,
  expected: {
    nextCommand: string;
    nextHeading: string;
    nextPlan: string;
    nextTaskId?: string;
    nextTask: string;
    commitSha: string;
  },
) {
  const slice = project.slices[sliceIndex - 1];
  if (!slice) throw new Error(`Missing slice ${sliceIndex}`);
  const task = slice.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Missing task ${taskId}`);

  setTaskStatuses(project, sliceIndex, taskId, { implemented: true });
  await harness.events.get('tool_call')?.(
    {
      toolName: 'write',
      input: { path: join(project.cwd, 'src', `${taskId}.ts`) },
    },
    harness.ctx,
  );
  harness.recordProof(`${taskId} source write`, 'file-write');
  await harness.events.get('agent_end')?.(
    agentEndEvent(`Implemented ${task.title}.`),
    harness.ctx,
  );
  harness.recordProof(
    `${taskId} build complete`,
    'agent-end',
    `Implemented ${task.title}.`,
  );
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `/addy-verify ${slice.path}`,
    'Addy Verify',
  );

  setTaskStatuses(project, sliceIndex, taskId, { verified: true });
  await harness.events.get('tool_result')?.(
    { command: 'npm test', success: true, text: 'tests passed' },
    harness.ctx,
  );
  harness.recordProof(`${taskId} verify tool result`, 'tool-result');
  await harness.events.get('agent_end')?.(
    agentEndEvent(`Verified ${task.title}.`),
    harness.ctx,
  );
  harness.recordProof(
    `${taskId} verify complete`,
    'agent-end',
    `Verified ${task.title}.`,
  );
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `/addy-review ${slice.path}`,
    'Addy Review',
  );

  setTaskStatuses(project, sliceIndex, taskId, { reviewed: true });
  await harness.events.get('agent_end')?.(
    agentEndEvent('No issues found.'),
    harness.ctx,
  );
  harness.recordProof(
    `${taskId} review clean`,
    'agent-end',
    'No issues found.',
  );
  assertWorkflowPrompt(
    harness.lastPrompt(),
    '__addy-auto-task-commit__',
    'Addy Auto Commit',
  );

  await harness.events.get('agent_end')?.(
    agentEndEvent(`COMMIT: ${expected.commitSha}`),
    harness.ctx,
  );
  harness.recordProof(
    `${taskId} commit complete`,
    'agent-end',
    `COMMIT: ${expected.commitSha}`,
  );
  assertWorkflowPrompt(
    harness.lastPrompt(),
    `${expected.nextCommand} ${expected.nextPlan}`,
    expected.nextHeading,
  );
  assert.equal(harness.ctx.state.activePlan, expected.nextPlan);
  if (expected.nextTaskId)
    assert.equal(harness.ctx.state.currentTaskId, expected.nextTaskId);
  assert.equal(harness.ctx.state.currentTask, expected.nextTask);
}

function assertStateFooterAndPromptAgree(
  harness: AddyWorkflowHarness,
  expected: {
    activePlan: string;
    activeSuitePlan?: string;
    currentTaskId: string;
    currentTask: string;
    promptCommand: string;
    footerIncludes: string[];
  },
) {
  const state = harness.ctx.state;
  assert.equal(state.activePlan, expected.activePlan);
  assert.equal(state.activeSuitePlan, expected.activeSuitePlan);
  assert.equal(state.currentTaskId, expected.currentTaskId);
  assert.equal(state.currentTask, expected.currentTask);
  assert.equal(
    harness.proof.at(-1)?.execution.promptCommand,
    expected.promptCommand,
  );
  const footer = stripAnsi(harness.latestFooterLine());
  assert.ok(footer, JSON.stringify(harness.proof, null, 2));
  for (const fragment of expected.footerIncludes) {
    assert.ok(
      footer.includes(fragment),
      `expected footer to include ${fragment}; got ${footer}`,
    );
  }
}

function assertProofHasNoStateExecutionFooterDrift(
  harness: AddyWorkflowHarness,
): void {
  assert.ok(harness.proof.length > 0);
  for (const step of harness.proof) {
    if (!step.state.currentTask || step.state.currentTask === 'none') continue;
    const footer = stripAnsi(step.footer.line);
    assert.ok(
      footer?.includes(step.state.currentTask) ||
        step.state.currentTask === 'all tasks complete',
      `proof drift at ${step.label}: ${JSON.stringify(step, null, 2)}`,
    );
    if (step.state.currentSliceIndex) {
      assert.equal(
        step.footer.containsSliceProgress,
        true,
        `missing slice footer proof at ${step.label}: ${JSON.stringify(step, null, 2)}`,
      );
    }
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
