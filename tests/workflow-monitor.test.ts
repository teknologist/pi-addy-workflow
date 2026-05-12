import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const sentMessages: string[] = [];
  const pi = {
    on: (name: string, handler: Handler) => events.set(name, handler),
    registerCommand: (name: string, config: CommandConfig) => commands.set(name, config),
    appendEntry: (type: string, data: unknown) => entries.push([type, data]),
    sendUserMessage: (message: string) => sentMessages.push(message),
  };
  return { pi, events, commands, entries, sentMessages };
}

function assertSentWorkflowPrompt(message: string | undefined, command: string, heading: string) {
  assert.ok(message, "expected a dispatched workflow prompt");
  assert.match(message, new RegExp(`# ${heading}`));
  assert.ok(message.includes(`Invocation: \`${command}\``), `expected invocation for ${command}`);
}

function reviewFingerprintForTest(lines: string[]): string {
  return createHash("sha256").update(lines.map((line) => line.trim().toLowerCase()).join("\n")).digest("hex").slice(0, 16);
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
  assert.ok(events.has("agent_end"));
  assert.ok(commands.has("addy-auto"));
  assert.ok(commands.has("addy-workflow-reset"));
  assert.ok(commands.has("addy-workflow-next"));
});

test("auto command dispatches the real next workflow command", async () => {
  const { pi, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const ctx: any = { cwd: join(stateDir, "auto-command-dispatch-project"), id: "auto-command-dispatch", ui: { setWidget() {} }, isIdle: () => true };
  const result = await commands.get("addy-auto")?.handler("docs/plans/auto.md", ctx);

  assert.deepEqual(result, { action: "continue" });
  assert.equal(ctx.state.autoMode, true);
  assert.equal(ctx.state.activePlan, "docs/plans/auto.md");
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], "/addy-build docs/plans/auto.md", "Addy Build");
});

test("auto loop dispatches verify after the current task is implemented", async () => {
  const cwd = join(stateDir, "auto-loop-dispatch-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-dispatch",
    state: {
      phases: { define: "complete", plan: "complete", build: "active", simplify: "pending", verify: "pending", review: "pending", finish: "pending" },
      warnings: [],
      current: "build",
      autoMode: true,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({}, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-verify ${planPath}`, "Addy Verify");
});

test("real workflow commands preserve auto mode so the loop can continue", async () => {
  const cwd = join(stateDir, "auto-loop-preserve-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, commands, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = { cwd, id: "auto-loop-preserve", ui: { setWidget() {} }, isIdle: () => true };

  await commands.get("addy-auto")?.handler(planPath, ctx);
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-build ${planPath}`, "Addy Build");

  await events.get("input")?.({ input: sentMessages.at(-1) }, ctx);
  assert.equal(ctx.state.autoMode, true);
  assert.equal(ctx.state.current, "build");

  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  await events.get("agent_end")?.({}, ctx);
  assert.equal(sentMessages.length, 2);
  assertSentWorkflowPrompt(sentMessages[1], `/addy-verify ${planPath}`, "Addy Verify");
});

test("auto loop retries one incomplete same-phase step before pausing", async () => {
  const cwd = join(stateDir, "auto-loop-pause-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: "auto-loop-pause",
    state: {
      phases: { define: "complete", plan: "complete", build: "active", simplify: "pending", verify: "pending", review: "pending", finish: "pending" },
      warnings: [],
      current: "build",
      autoMode: true,
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify: (message: string, level?: string) => notices.push([message, level]) },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({}, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-build ${planPath}`, "Addy Build");

  await events.get("input")?.({ input: sentMessages.at(-1) }, ctx);
  await events.get("agent_end")?.({}, ctx);

  assert.equal(sentMessages.length, 1);
  assert.match(notices.at(-1)?.[0] ?? "", /paused at \/addy-build/);
  assert.equal(notices.at(-1)?.[1], "warning");
});

test("auto loop same-phase retry works for verify and review too", async () => {
  const cases: Array<{ phase: "verify" | "review"; statuses: string[]; command: string }> = [
    { phase: "verify", statuses: ["- [x] Implemented", "- [ ] Verified", "- [ ] Reviewed"], command: "/addy-verify" },
    { phase: "review", statuses: ["- [x] Implemented", "- [x] Verified", "- [ ] Reviewed"], command: "/addy-review" },
  ];

  for (const testCase of cases) {
    const cwd = join(stateDir, `auto-loop-${testCase.phase}-retry-project`);
    const planPath = join("docs", "plans", "auto-loop.md");
    mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
    writeFileSync(join(cwd, planPath), ["## Task 1: Current", ...testCase.statuses].join("\n"));

    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const notices: Array<[string, string | undefined]> = [];
    const ctx: any = {
      cwd,
      id: `auto-loop-${testCase.phase}-retry`,
      state: {
        phases: {
          define: "complete",
          plan: "complete",
          build: "complete",
          simplify: "pending",
          verify: testCase.phase === "verify" ? "active" : "complete",
          review: testCase.phase === "review" ? "active" : "pending",
          finish: "pending",
        },
        warnings: [],
        current: testCase.phase,
        autoMode: true,
        activePlan: planPath,
      },
      ui: { setWidget() {}, notify: (message: string, level?: string) => notices.push([message, level]) },
      isIdle: () => true,
    };

    await events.get("agent_end")?.({}, ctx);
    assert.equal(sentMessages.length, 1);
    assertSentWorkflowPrompt(sentMessages[0], `${testCase.command} ${planPath}`, testCase.phase === "verify" ? "Addy Verify" : "Addy Review");

    await events.get("input")?.({ input: sentMessages.at(-1) }, ctx);
    await events.get("agent_end")?.({}, ctx);
    assert.equal(sentMessages.length, 1);
    assert.match(notices.at(-1)?.[0] ?? "", new RegExp(`paused at ${testCase.command}`));
    assert.equal(notices.at(-1)?.[1], "warning");
  }
});

test("auto loop runs fix-all when review surfaces actionable findings", async () => {
  const cwd = join(stateDir, "auto-loop-review-fix-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-review-fix",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Important: fix tests/unit/example.test.ts:12 before review can pass." }] }] }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-fix-all ${planPath}`, "Addy Fix All");
  assert.equal(ctx.state.autoReviewFixCount, 1);
});

test("auto loop verifies again after fix-all", async () => {
  const cwd = join(stateDir, "auto-loop-fix-verify-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-fix-verify",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      autoMode: true,
      autoLastPrompt: `/addy-fix-all ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Fixed surfaced review findings." }] }] }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-verify ${planPath}`, "Addy Verify");
  assert.equal(ctx.state.autoReviewFixNeedsReview, true);
});

test("auto loop reviews again after post-fix verify even when plan is already reviewed", async () => {
  const cwd = join(stateDir, "auto-loop-fix-verify-review-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "## Task 2: Next",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-fix-verify-review",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "active", review: "complete", finish: "pending" },
      warnings: [],
      current: "verify",
      currentTask: "Current",
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

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Verification passed after review fixes." }] }] }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-review ${planPath}`, "Addy Review");
  assert.equal(ctx.state.autoReviewFixNeedsReview, false);
});

test("auto loop commits a completed reviewed task before moving to the next task", async () => {
  const cwd = join(stateDir, "auto-loop-task-commit-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "## Task 2: Next",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-task-commit",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      currentTask: "Current",
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "No issues found. Marked Reviewed." }] }] }, ctx);

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^# Addy Auto Commit/);
  assert.match(sentMessages[0], /Completed task: Current/);
  assert.match(sentMessages[0], /Invocation: `__addy-auto-task-commit__`/);
  assert.match(sentMessages[0], /Do not call ask_user_question/);
});

test("auto loop fixes review findings even when plan was incorrectly marked reviewed", async () => {
  const cwd = join(stateDir, "auto-loop-reviewed-with-findings-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "## Task 2: Next",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-reviewed-with-findings",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      currentTask: "Current",
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Critical: fix src/foo.ts:10 before review can pass." }] }] }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-fix-all ${planPath}`, "Addy Fix All");
});

test("auto loop fixes mixed clean and warning review output", async () => {
  const cwd = join(stateDir, "auto-loop-reviewed-with-warning-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "## Task 2: Next",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const cases = [
    "No issues found in Critical issues.\nWarnings:\n- Retry counter is stale.",
    "Critical issues: none\nWarnings:\n- This can auto-commit unrelated changes.",
    "No actionable findings\nSuggestions:\n- Prefer a smaller guard.",
  ];

  for (const [index, reviewText] of cases.entries()) {
    const { pi, events, sentMessages } = createPiMock();
    addyWorkflowMonitor(pi as never);
    const ctx: any = {
      cwd,
      id: `auto-loop-reviewed-with-warning-${index}`,
      state: {
        phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
        warnings: [],
        current: "review",
        currentTask: "Current",
        currentTaskIndex: 1,
        taskCount: 2,
        autoMode: true,
        autoLastPrompt: `/addy-review ${planPath}`,
        activePlan: planPath,
      },
      ui: { setWidget() {} },
      isIdle: () => true,
    };

    await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: reviewText }] }] }, ctx);

    assert.equal(sentMessages.length, 1, reviewText);
    assertSentWorkflowPrompt(sentMessages[0], `/addy-fix-all ${planPath}`, "Addy Fix All");
  }
});

test("auto loop treats clean structured review output as clean", async () => {
  const cwd = join(stateDir, "auto-loop-clean-structured-review-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "## Task 2: Next",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-clean-structured-review",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      currentTask: "Current",
      currentTaskIndex: 1,
      taskCount: 2,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Critical issues: none\nWarnings: none\nSuggestions: none" }] }] }, ctx);

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^# Addy Auto Commit/);
});

test("auto loop continues after task commit succeeds", async () => {
  const cwd = join(stateDir, "auto-loop-task-commit-continue-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "## Task 2: Next",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-task-commit-continue",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      autoMode: true,
      autoLastPrompt: [
        "# Addy Auto Commit",
        "",
        "Invocation: `__addy-auto-task-commit__`",
      ].join("\n"),
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "COMMIT: abc1234" }] }] }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-build ${planPath}`, "Addy Build");
});

test("auto loop does not commit after review when plan cannot prove task completion", async () => {
  const cwd = join(stateDir, "auto-loop-missing-plan-no-commit-project");
  const planPath = join("docs", "plans", "missing.md");

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const ctx: any = {
    cwd,
    id: "auto-loop-missing-plan-no-commit",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      currentTask: "Current",
      currentTaskIndex: 1,
      taskCount: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      activePlan: planPath,
    },
    ui: { setWidget() {} },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "No issues found." }] }] }, ctx);

  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-build ${planPath}`, "Addy Build");
});

test("auto loop pauses after unclear commit output even when it contains a hash", async () => {
  const cwd = join(stateDir, "auto-loop-task-commit-unclear-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "## Task 2: Next",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: "auto-loop-task-commit-unclear",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      autoMode: true,
      autoLastPrompt: [
        "# Addy Auto Commit",
        "",
        "Invocation: `__addy-auto-task-commit__`",
      ].join("\n"),
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify: (message: string, level?: string) => notices.push([message, level]) },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Commit failed. HEAD is abc1234." }] }] }, ctx);

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? "", /commit result was unclear/);
  assert.equal(notices.at(-1)?.[1], "warning");
});

test("auto loop stops review fix loop after five attempts", async () => {
  const cwd = join(stateDir, "auto-loop-review-fix-max-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: "auto-loop-review-fix-max",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      currentTask: "Current",
      currentTaskIndex: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewFixKey: `${planPath}\u001f1\u001fCurrent`,
      autoReviewFixCount: 5,
      autoReviewFindingFingerprint: "previous",
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify: (message: string, level?: string) => notices.push([message, level]) },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Important: fix src/new-location.ts:42 before review can pass." }] }] }, ctx);

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? "", /5 review fix loops/);
  assert.equal(notices.at(-1)?.[1], "warning");
});

test("auto loop stops when the same review finding repeats after a fix attempt", async () => {
  const cwd = join(stateDir, "auto-loop-review-repeat-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: "auto-loop-review-repeat",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      currentTask: "Current",
      currentTaskIndex: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewFixKey: `${planPath}\u001f1\u001fCurrent`,
      autoReviewFixCount: 1,
      autoReviewFindingFingerprint: reviewFingerprintForTest(["Important: fix src/repeated.ts:12 before review can pass."]),
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify: (message: string, level?: string) => notices.push([message, level]) },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Important: fix src/repeated.ts:12 before review can pass." }] }] }, ctx);

  assert.equal(sentMessages.length, 0);
  assert.match(notices.at(-1)?.[0] ?? "", /same review finding repeated/);
  assert.equal(notices.at(-1)?.[1], "warning");
});

test("auto loop does not treat different warning bullets as repeated findings", async () => {
  const cwd = join(stateDir, "auto-loop-review-different-warning-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [x] Implemented",
    "- [x] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx: any = {
    cwd,
    id: "auto-loop-review-different-warning",
    state: {
      phases: { define: "complete", plan: "complete", build: "complete", simplify: "pending", verify: "complete", review: "active", finish: "pending" },
      warnings: [],
      current: "review",
      currentTask: "Current",
      currentTaskIndex: 1,
      autoMode: true,
      autoLastPrompt: `/addy-review ${planPath}`,
      autoReviewFixKey: `${planPath}\u001f1\u001fCurrent`,
      autoReviewFixCount: 1,
      autoReviewFindingFingerprint: reviewFingerprintForTest(["- retry counter is stale."]),
      activePlan: planPath,
    },
    ui: { setWidget() {}, notify: (message: string, level?: string) => notices.push([message, level]) },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Warnings:\n- This can auto-commit unrelated changes." }] }] }, ctx);

  assert.equal(notices.length, 0);
  assert.equal(sentMessages.length, 1);
  assertSentWorkflowPrompt(sentMessages[0], `/addy-fix-all ${planPath}`, "Addy Fix All");
});

test("auto retry state restored from session entries pauses duplicate dispatch", async () => {
  const cwd = join(stateDir, "auto-loop-restored-retry-project");
  const planPath = join("docs", "plans", "auto-loop.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, planPath), [
    "## Task 1: Current",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const retryPrompt = `/addy-build ${planPath}`;
  const retryKey = [retryPrompt, planPath, 1, "Current", "none"].join("\u001f");
  const { pi, events, sentMessages } = createPiMock();
  addyWorkflowMonitor(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const restoredState = {
    phases: { define: "complete", plan: "complete", build: "active", simplify: "pending", verify: "pending", review: "pending", finish: "pending" },
    warnings: [],
    current: "build",
    autoMode: true,
    activePlan: planPath,
    currentTask: "Current",
    nextTask: "none",
    currentTaskIndex: 1,
    taskCount: 1,
    autoLastPrompt: retryPrompt,
    autoRetryKey: retryKey,
    autoRetryCount: 1,
  };
  const ctx: any = {
    cwd,
    id: "auto-loop-restored-retry",
    sessionManager: { getBranch: () => [[WORKFLOW_STATE_ENTRY_TYPE, restoredState]] },
    ui: { setWidget() {}, notify: (message: string, level?: string) => notices.push([message, level]) },
    isIdle: () => true,
  };

  await events.get("agent_end")?.({}, ctx);

  assert.deepEqual(sentMessages, []);
  assert.match(notices.at(-1)?.[0] ?? "", /paused at \/addy-build/);
});

test("malformed persisted auto retry state is ignored", () => {
  const ctx: any = {
    id: "malformed-auto-retry-state",
    sessionManager: {
      getBranch: () => [[WORKFLOW_STATE_ENTRY_TYPE, {
        phases: { define: "complete", plan: "complete", build: "active", simplify: "pending", verify: "pending", review: "pending", finish: "pending" },
        warnings: [],
        current: "build",
        autoMode: true,
        activePlan: "docs/plans/auto-loop.md",
        autoRetryCount: "not-a-number",
      }]],
    },
  };

  assert.equal(getContextWorkflowState(ctx).autoMode, undefined);
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
