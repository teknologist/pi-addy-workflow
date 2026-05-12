import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import addyWorkflowMonitor from "../extensions/workflow-monitor.ts";
import { getContextWorkflowState, handleWorkflowEvent, openNextWorkflowPrompt } from "../extensions/workflow-monitor/workflow-handler.ts";
import { WORKFLOW_STATE_ENTRY_TYPE } from "../extensions/workflow-monitor/workflow-tracker.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type CommandConfig = { description: string; handler: Handler };

const stateDir = mkdtempSync(join(tmpdir(), "pi-addy-workflow-test-"));
process.env.PI_ADDY_WORKFLOW_STATE_DIR = stateDir;

test.after(() => {
  delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

function createPiMock() {
  const events = new Map<string, Handler>();
  const commands = new Map<string, CommandConfig>();
  const entries: Array<[string, unknown]> = [];
  const pi = {
    on: (name: string, handler: Handler) => events.set(name, handler),
    registerCommand: (name: string, config: CommandConfig) => commands.set(name, config),
    appendEntry: (type: string, data: unknown) => entries.push([type, data]),
  };
  return { pi, events, commands, entries };
}

test("registers workflow commands and handlers", () => {
  const { pi, events, commands } = createPiMock();

  addyWorkflowMonitor(pi as never);

  assert.ok(events.has("session_start"));
  assert.ok(events.has("input"));
  assert.ok(events.has("tool_result"));
  assert.ok(events.has("tool_call"));
  assert.equal(events.has("file_write"), false);
  assert.ok(events.has("before_agent_start"));
  assert.ok(commands.has("addy-workflow-reset"));
  assert.ok(commands.has("addy-workflow-next"));
});

test("session start renders workflow widget before first workflow instruction", async () => {
  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const widgets: Array<[string, unknown]> = [];
  await events.get("session_start")?.({}, { id: "startup-widget-test", ui: { setWidget: (key: string, value: unknown) => widgets.push([key, value]) } });

  assert.equal(widgets.at(-1)?.[0], "pi-addy-workflow");
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), ["Addy Workflow: define → plan => { build → simplify → verify → review → finish }"]);
});

test("session start restores persisted workflow widget state", async () => {
  const cwd = join(stateDir, "startup-restore-project");
  const planPath = "docs/plans/startup-restore.md";
  const firstCtx: any = { cwd, id: "startup-restore-first", ui: { setWidget() {} } };
  handleWorkflowEvent(firstCtx, { source: "user-input", text: `/addy-build ${planPath}` });

  const { pi, events } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const widgets: Array<[string, unknown]> = [];
  const nextCtx: any = { cwd, id: "startup-restore-next", ui: { setWidget: (key: string, value: unknown) => widgets.push([key, value]) } };
  await events.get("session_start")?.({}, nextCtx);

  assert.equal(nextCtx.state.current, "build");
  assert.equal(nextCtx.state.activePlan, planPath);
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), ["Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish } | startup-restore.md"]);
});

test("reset command clears widget, persists reset state, and continues", async () => {
  const { pi, commands, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const widgets: Array<[string, unknown]> = [];
  const result = await commands.get("addy-workflow-reset")?.handler({}, { id: "reset-command-test", ui: { setWidget: (key: string, value: unknown) => widgets.push([key, value]) } });

  assert.deepEqual(result, { action: "continue" });
  assert.equal(entries.at(-1)?.[0], "pi-addy-workflow-state");
  assert.deepEqual(widgets, [["pi-addy-workflow", undefined]]);
});

test("next command parses args, transitions, persists, prefills, and continues", async () => {
  const { pi, commands, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const effects: Array<[string, unknown]> = [];
  const ctx: any = {
    id: "next-command-test",
    ui: { setWidget: (key: string, value: unknown) => effects.push([key, value]) },
    input: { prefill: (value: string) => effects.push(["prefill", value]) },
  };

  const result = await commands.get("addy-workflow-next")?.handler("review diff.md", ctx);

  assert.deepEqual(result, { action: "continue" });
  assert.equal(ctx.state.current, "review");
  assert.equal(ctx.state.activePlan, "diff.md");
  assert.equal(entries.at(-1)?.[0], "pi-addy-workflow-state");
  assert.equal(effects.at(0)?.[0], "pi-addy-workflow");
  assert.deepEqual((effects.at(0)?.[1] as any)().render(), ["Addy Workflow: ✓define → ✓plan => { build → simplify → verify → [review] → finish } | diff.md"]);
  assert.deepEqual(effects.at(1), ["prefill", "/addy-review diff.md"]);
});

test("next command warns and continues on invalid phase", async () => {
  const { pi, commands } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const notices: Array<[string, string | undefined]> = [];
  const result = await commands.get("addy-workflow-next")?.handler(
    "bogus",
    { ui: { notify: (message: string, level?: string) => notices.push([message, level]) } },
  );

  assert.deepEqual(result, { action: "continue" });
  assert.match(notices[0][0], /Usage: \/addy-workflow-next/);
  assert.equal(notices[0][1], "warning");
});

test("workflow state survives fresh contexts without session entries", () => {
  const firstCtx: any = { id: "fresh-context-test", ui: { setWidget() {} } };
  const build = handleWorkflowEvent(firstCtx, { source: "user-input", text: "/addy-build" });
  assert.equal(build.current, "build");

  const nextCtx: any = { id: "fresh-context-test", ui: { setWidget() {}, notify(message: string) { throw new Error(message); } } };
  const verify = handleWorkflowEvent(nextCtx, { source: "user-input", text: "/addy-verify" });

  assert.equal(verify.current, "verify");
  assert.deepEqual(verify.warnings, []);
});

test("active plan written during plan phase survives fresh sessions for next build", () => {
  const cwd = join(stateDir, "fresh-plan-project");
  const planPath = "docs/plans/2026-05-11-better-workflow.md";
  const firstCtx: any = { cwd, id: "plan-session", ui: { setWidget() {} } };
  const planned = handleWorkflowEvent(firstCtx, { source: "file-write", artifact: planPath });
  assert.equal(planned.activePlan, planPath);

  const prefills: string[] = [];
  const nextCtx: any = { cwd, id: "build-session", input: { prefill: (value: string) => prefills.push(value) } };

  assert.equal(getContextWorkflowState(nextCtx).activePlan, planPath);
  // A fresh session with no explicit argument should use the persisted active plan immediately.
  assert.equal(openNextWorkflowPrompt(nextCtx, "build"), `/addy-build ${planPath}`);
  assert.deepEqual(prefills, [`/addy-build ${planPath}`]);
});

test("auto mode input preserves plan and task progress while toggling footer label", () => {
  const widgets: Array<[string, unknown]> = [];
  const ctx: any = { id: "auto-mode-toggle", ui: { setWidget: (key: string, value: unknown) => widgets.push([key, value]) } };
  const build = handleWorkflowEvent(ctx, { source: "user-input", text: "/addy-build docs/plans/auto-mode.md" });
  const withTask = {
    ...build,
    currentTask: "Current task",
    nextTask: "Next task",
    currentTaskIndex: 1,
    taskCount: 2,
  };
  ctx.state = withTask;

  const auto = handleWorkflowEvent(ctx, { source: "user-input", text: "/addy-auto" });
  assert.equal(auto.autoMode, true);
  assert.equal(auto.activePlan, "docs/plans/auto-mode.md");
  assert.equal(auto.currentTask, "Current task");
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), [
    "🔁 Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish } | auto-mode.md",
    "Current task: Current task | Next task: Next task | Task 1/2",
  ]);

  const stopped = handleWorkflowEvent(ctx, { source: "user-input", text: "/addy-auto stop" });

  assert.equal(stopped.autoMode, false);
  assert.equal(stopped.activePlan, "docs/plans/auto-mode.md");
  assert.equal(stopped.currentTask, "Current task");
  assert.deepEqual((widgets.at(-1)?.[1] as any)().render(), [
    "Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish } | auto-mode.md",
    "Current task: Current task | Next task: Next task | Task 1/2",
  ]);

  const nextCtx: any = { id: "auto-mode-toggle", sessionManager: { getBranch: () => [] } };
  assert.equal(getContextWorkflowState(nextCtx).autoMode, false);
  assert.equal(getContextWorkflowState(nextCtx).activePlan, "docs/plans/auto-mode.md");
});

test("workflow state stores current and next task from active plan", () => {
  const cwd = join(stateDir, "task-state-project");
  const relativePlanPath = join("docs", "plans", "task-state.md");
  const referencedPlanPath = `@${relativePlanPath}`;
  const planPath = join(cwd, relativePlanPath);
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(planPath, [
    "## Task 1: Done",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "",
    "## Task 2: Current",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
    "",
    "## Task 3: Next",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const ctx: any = { cwd, id: "task-state-session", ui: { setWidget() {} } };
  const planned = handleWorkflowEvent(ctx, { source: "file-write", artifact: referencedPlanPath });
  const build = handleWorkflowEvent(ctx, { source: "user-input", text: "/addy-build" });

  assert.equal(planned.activePlan, referencedPlanPath);
  assert.equal(build.currentTask, "Current");
  assert.equal(build.nextTask, "Next");
  assert.equal(ctx.state.currentTask, "Current");
  assert.equal(ctx.state.nextTask, "Next");
});

test("bare verify advances stale completed active plan to next unfinished slice", () => {
  const cwd = join(stateDir, "stale-active-plan-project");
  const plansDir = join(cwd, "docs", "plans");
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(plansDir, "2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md"), [
    "## Task 1: Done",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
  ].join("\n"));
  writeFileSync(join(plansDir, "2026-05-08-invoice-csv-etl-slice-06-failures-reports-reruns.md"), [
    "## Task 1: Reviewed already",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "",
    "## Task 2: Verify Slice 06 Task 2",
    "- [x] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const ctx: any = { cwd, id: "stale-active-plan-session", ui: { setWidget() {} } };
  handleWorkflowEvent(ctx, { source: "user-input", text: "/addy-build @docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md" });
  const verify = handleWorkflowEvent(ctx, { source: "user-input", text: "/addy-verify" });

  assert.equal(verify.current, "verify");
  assert.equal(verify.activePlan, "@docs/plans/2026-05-08-invoice-csv-etl-slice-06-failures-reports-reruns.md");
  assert.equal(verify.currentTask, "Verify Slice 06 Task 2");
  assert.equal(verify.nextTask, "none");
});

test("late task summaries do not overwrite newer workflow state", async () => {
  const cwd = join(stateDir, "task-summary-race-project");
  const firstPlan = join(cwd, "docs", "plans", "first.md");
  const secondPlan = join(cwd, "docs", "plans", "second.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(firstPlan, [
    "## Task 1: First long task name that needs summary",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));
  writeFileSync(secondPlan, [
    "## Task 1: Second long task name that must win",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  let releaseFirstSummary: (() => void) | undefined;
  const ctx: any = {
    cwd,
    id: "task-summary-race-session",
    ui: { setWidget() {} },
    model: { provider: "test", id: "test-model" },
    modelRegistry: {
      getApiKeyAndHeaders: () => new Promise((resolve) => {
        releaseFirstSummary = () => resolve({ ok: true, apiKey: "test-key" });
      }),
    },
  };

  handleWorkflowEvent(ctx, { source: "user-input", text: `/addy-build ${firstPlan}` });
  handleWorkflowEvent(ctx, { source: "user-input", text: `/addy-build ${secondPlan}` });
  releaseFirstSummary?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(ctx.state.activePlan, secondPlan);
  assert.equal(ctx.state.currentTask, "Second long task name that must win");
});

test("workflow state round-trips from persisted append entries", () => {
  const entries: Array<[string, unknown]> = [];
  const firstCtx: any = { ui: { setWidget() {} } };
  const build = handleWorkflowEvent(firstCtx, { source: "user-input", text: "/addy-build" }, (type, data) => entries.push([type, data]));
  assert.equal(build.current, "build");

  const nextCtx: any = {
    ui: { setWidget() {}, notify(message: string) { throw new Error(message); } },
    sessionManager: { getBranch: () => entries },
  };
  const verify = handleWorkflowEvent(nextCtx, { source: "user-input", text: "/addy-verify" }, (type, data) => entries.push([type, data]));

  assert.equal(getContextWorkflowState(nextCtx).current, "verify");
  assert.deepEqual(verify.warnings, []);
});

test("workflow state skips malformed latest entries", () => {
  const validState = { current: "build", phases: { define: "pending", plan: "pending", build: "active", simplify: "pending", verify: "pending", review: "pending", finish: "pending" }, warnings: [] };
  const ctx: any = {
    sessionManager: {
      getBranch: () => [
        [WORKFLOW_STATE_ENTRY_TYPE, validState],
        [WORKFLOW_STATE_ENTRY_TYPE, { bad: "state" }],
        [WORKFLOW_STATE_ENTRY_TYPE, { current: "verify", phases: {}, warnings: [] }],
      ],
    },
  };

  assert.equal(getContextWorkflowState(ctx).current, "build");
});

test("workflow state reads custom session entries", () => {
  const ctx: any = {
    sessionManager: {
      getBranch: () => [{ type: "custom", customType: WORKFLOW_STATE_ENTRY_TYPE, data: { current: "build", phases: { define: "pending", plan: "pending", build: "active", simplify: "pending", verify: "pending", review: "pending", finish: "pending" }, warnings: [] } }],
    },
  };

  assert.equal(getContextWorkflowState(ctx).current, "build");
});

test("workflow state migrates legacy ship phase to finish", () => {
  const ctx: any = {
    sessionManager: {
      getBranch: () => [{ type: "custom", customType: WORKFLOW_STATE_ENTRY_TYPE, data: { current: "ship", phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "complete", ship: "active" }, warnings: [] } }],
    },
  };

  const state = getContextWorkflowState(ctx);

  assert.equal(state.current, "finish");
  assert.equal(state.phases.finish, "active");
});

test("write tool calls drive file-write transitions", async () => {
  const { pi, events, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const effects: Array<[string, unknown]> = [];
  const ctx: any = { cwd: join(stateDir, "write-tool-project"), id: "write-tool-test", ui: { setWidget: (key: string, value: unknown) => effects.push([key, value]) } };
  await events.get("tool_call")?.({ toolName: "write", input: { path: "tests/example.test.ts" } }, ctx);

  assert.equal(ctx.state.current, "verify");
  assert.equal(entries.at(-1)?.[0], "pi-addy-workflow-state");
  assert.equal(effects.at(-1)?.[0], "pi-addy-workflow");
  assert.deepEqual((effects.at(-1)?.[1] as any)().render(), ["Addy Workflow: ✓define → ✓plan => { build → simplify → [verify] → review → finish }"]);
});
