import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitialWorkflowState, resolveTargetPhase, transitionWorkflow, type WorkflowPhase } from "../extensions/workflow-monitor/workflow-transitions.ts";
import { nextPromptForPhase, parseWorkflowState, planTasksFromMarkdown, refreshWorkflowTasksFromPlan, renderWorkflowStrip, renderWorkflowWidget, unfinishedLifecycleStepsFromMarkdown } from "../extensions/workflow-monitor/workflow-tracker.ts";
import { handleWorkflowEvent, openNextWorkflowPrompt, resetWorkflow } from "../extensions/workflow-monitor/workflow-handler.ts";

const taskFooterDir = "/tmp/pi-addy-workflow-task-footer-test";

test("prompt triggers map to phases", () => {
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-define" }), "define");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-plan" }), "plan");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-build" }), "build");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-code-simplify" }), "simplify");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-verify" }), "verify");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-review" }), "review");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-finish" }), "finish");
});

test("forward transition shows spec and plan checked once building", () => {
  const define = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-define" });
  const build = transitionWorkflow(define, { source: "user-input", text: "/addy-build" });

  assert.equal(build.phases.define, "complete");
  assert.equal(build.phases.plan, "complete");
  assert.equal(build.phases.build, "active");
  assert.deepEqual(build.warnings, []);
});

test("fresh build and simplify are allowed but verify and review enforce build to verify to review", () => {
  const build = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-build" });
  assert.equal(build.current, "build");
  assert.equal(build.phases.define, "complete");
  assert.equal(build.phases.plan, "complete");
  assert.deepEqual(build.warnings, []);

  const simplify = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-code-simplify" });
  assert.equal(simplify.current, "simplify");
  assert.equal(simplify.phases.define, "complete");
  assert.equal(simplify.phases.plan, "complete");
  assert.deepEqual(simplify.warnings, []);

  const verify = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-verify" });
  assert.equal(verify.current, "verify");
  assert.match(verify.warnings[0], /build/);

  const review = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-review" });
  assert.equal(review.current, "review");
  assert.match(review.warnings[0], /build/);
});

test("same-phase after-plan transition checks spec and plan for legacy state", () => {
  const legacyBuild = {
    ...createInitialWorkflowState(),
    current: "build" as const,
    phases: { ...createInitialWorkflowState().phases, build: "active" as const },
  };

  const build = transitionWorkflow(legacyBuild, { source: "user-input", text: "/addy-build" });

  assert.equal(build.current, "build");
  assert.equal(build.phases.define, "complete");
  assert.equal(build.phases.plan, "complete");
  assert.equal(build.phases.build, "active");
});

test("parsed legacy after-plan state checks spec and plan before rendering", () => {
  const legacyBuild = {
    ...createInitialWorkflowState(),
    current: "build" as const,
    phases: { ...createInitialWorkflowState().phases, build: "active" as const },
  };

  const state = parseWorkflowState(legacyBuild);

  assert.equal(state.phases.define, "complete");
  assert.equal(state.phases.plan, "complete");
  assert.deepEqual(renderWorkflowWidget(state)().render(), ["Addy Workflow: ✓define → ✓plan → [build] → simplify → verify → review → finish"]);
});

test("returning to optional simplify preserves completed build", () => {
  const build = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-build" });
  const verify = transitionWorkflow(build, { source: "user-input", text: "/addy-verify" });
  const simplify = transitionWorkflow(verify, { source: "user-input", text: "/addy-code-simplify" });
  const verifyAgain = transitionWorkflow(simplify, { source: "user-input", text: "/addy-verify" });

  assert.equal(simplify.current, "simplify");
  assert.equal(simplify.phases.build, "complete");
  assert.equal(simplify.phases.verify, "pending");
  assert.deepEqual(verifyAgain.warnings, []);
});

test("finish warns when required build verify review phases are skipped", () => {
  const finish = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-finish" });
  assert.equal(finish.current, "finish");
  assert.equal(finish.phases.define, "complete");
  assert.equal(finish.phases.plan, "complete");
  assert.match(finish.warnings[0], /build/);
});

test("finish warns about both verify and review when started after build", () => {
  const build = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-build" });
  const finish = transitionWorkflow(build, { source: "user-input", text: "/addy-finish" });

  assert.equal(finish.current, "finish");
  assert.match(finish.warnings[0], /verify and review/);
});

test("review warns when verify is skipped after build", () => {
  const build = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-build" });
  const review = transitionWorkflow(build, { source: "user-input", text: "/addy-review" });

  assert.equal(review.current, "review");
  assert.match(review.warnings[0], /verify/);
});

test("backward transition resets state", () => {
  const finish = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-finish" });
  const plan = transitionWorkflow(finish, { source: "user-input", text: "/addy-plan" });

  assert.equal(plan.current, "plan");
  assert.equal(plan.phases.define, "complete");
  assert.equal(plan.phases.finish, "pending");
});

test("file write triggers map to lifecycle phases", () => {
  const cases: Array<[string, WorkflowPhase | undefined]> = [
    ["SPEC.md", "define"],
    ["spec.md", "define"],
    ["docs/specs/feature.md", "define"],
    ["docs/prd/feature.md", "define"],
    ["docs/plans/feature.md", "plan"],
    ["src/index.ts", "build"],
    ["src/index.test.ts", "verify"],
    ["tests/index.ts", "verify"],
    ["CHANGELOG.md", "finish"],
    ["RELEASE.md", "finish"],
    ["docs/releases/v1.md", "finish"],
    ["docs/deploy/prod.md", "finish"],
  ];

  for (const [artifact, phase] of cases) {
    assert.equal(resolveTargetPhase({ source: "file-write", artifact }), phase, artifact);
  }
});

test("source and test file writes are ignored after build or verify", () => {
  assert.equal(resolveTargetPhase({ source: "file-write", artifact: "src/index.ts" }, "verify"), undefined);
  assert.equal(resolveTargetPhase({ source: "file-write", artifact: "tests/index.test.ts" }, "review"), undefined);
});

test("tool and subagent triggers map to verify and review", () => {
  assert.equal(resolveTargetPhase({ source: "tool-result", command: "npm test", success: true }), "verify");
  assert.equal(resolveTargetPhase({ source: "tool-result", command: "pnpm vitest", success: true }), "verify");
  assert.equal(resolveTargetPhase({ source: "subagent-call", agentName: "addy-reviewer" }), "review");
  assert.equal(resolveTargetPhase({ source: "subagent-call", agentName: "addy-spec-reviewer" }), "review");
});

test("renders phase strip and next prompt", () => {
  const state = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-plan" });
  assert.match(renderWorkflowStrip(state), /\[plan\]/);
  assert.equal(nextPromptForPhase("finish", "release-notes.md"), "/addy-finish release-notes.md");
});

test("tracks active spec and plan artifacts", () => {
  const specPath = "docs/specs/2026-05-11-better-workflow.md";
  const planPath = "docs/plans/2026-05-11-better-workflow.md";

  const define = transitionWorkflow(createInitialWorkflowState(), { source: "file-write", artifact: specPath });
  assert.equal(define.activeSpec, specPath);

  const plan = transitionWorkflow(define, { source: "user-input", text: `/addy-plan ${specPath}` });
  assert.equal(plan.activeSpec, specPath);

  const planned = transitionWorkflow(plan, { source: "file-write", artifact: planPath });
  assert.equal(planned.activePlan, planPath);

  const build = transitionWorkflow(planned, { source: "user-input", text: "/addy-build" });
  assert.equal(build.activeSpec, specPath);
  assert.equal(build.activePlan, planPath);

  const override = transitionWorkflow(build, { source: "user-input", text: "/addy-review docs/plans/override-plan.md" });
  assert.equal(override.activePlan, "docs/plans/override-plan.md");
});

test("only command-leading arguments update active artifacts", () => {
  const state = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "please run /addy-plan for the current spec" });

  assert.equal(state.current, "plan");
  assert.equal(state.activeSpec, undefined);
});

test("absolute spec and plan file writes update active artifacts", () => {
  const specPath = "/Users/eric/Dev/pi-addy-workflow/docs/specs/2026-05-11-better-workflow.md";
  const planPath = "/Users/eric/Dev/pi-addy-workflow/docs/plans/2026-05-11-better-workflow.md";

  const define = transitionWorkflow(createInitialWorkflowState(), { source: "file-write", artifact: specPath });
  assert.equal(define.activeSpec, specPath);

  const plan = transitionWorkflow(define, { source: "file-write", artifact: planPath });
  assert.equal(plan.activeSpec, specPath);
  assert.equal(plan.activePlan, planPath);
});

test("workflow widget renders spec or plan name footer", () => {
  const specPath = "docs/specs/2026-05-11-better-workflow.md";
  const planPath = "docs/plans/2026-05-11-better-workflow.md";
  const state = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: `/addy-plan ${specPath}` });
  assert.deepEqual(renderWorkflowWidget(state)().render(), [`Addy Workflow: define → [plan] → build → simplify → verify → review → finish | 2026-05-11-better-workflow.md`]);

  const build = transitionWorkflow({ ...state, activePlan: planPath }, { source: "user-input", text: "/addy-build" });
  assert.deepEqual(renderWorkflowWidget(build)().render(), [`Addy Workflow: ✓define → ✓plan → [build] → simplify → verify → review → finish | 2026-05-11-better-workflow.md`]);
});

test("workflow widget renders current and next task from active plan", () => {
  const planPath = join(taskFooterDir, "docs", "plans", "task-footer.md");
  mkdirSync(join(taskFooterDir, "docs", "plans"), { recursive: true });
  writeFileSync(planPath, [
    "## Task 1: Existing import path",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
    "",
    "## Task 2: Parse invoice rows",
    "- [x] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
    "",
    "## Task 3: Persist invoice payloads",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const state = refreshWorkflowTasksFromPlan(transitionWorkflow({ ...createInitialWorkflowState(), activePlan: planPath }, { source: "user-input", text: "/addy-build" }));

  assert.equal(state.currentTask, "Parse invoice rows");
  assert.equal(state.nextTask, "Persist invoice payloads");
  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    "Addy Workflow: ✓define → ✓plan → [build] → simplify → verify → review → finish | task-footer.md",
    "Current task: Parse invoice rows | Next task: Persist invoice payloads",
  ]);
});

test("workflow widget resolves Pi @-referenced active plan paths", () => {
  const cwd = join(taskFooterDir, "at-reference-project");
  const planPath = join(cwd, "docs", "plans", "task-footer.md");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(planPath, [
    "## Task 1: Parse invoice rows",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const state = refreshWorkflowTasksFromPlan({
    ...createInitialWorkflowState(),
    current: "build",
    phases: { ...createInitialWorkflowState().phases, define: "complete", plan: "complete", build: "active" },
    activePlan: "@docs/plans/task-footer.md",
  }, cwd);

  assert.equal(state.currentTask, "Parse invoice rows");
  assert.deepEqual(renderWorkflowWidget({ ...state, currentTask: undefined, nextTask: undefined }, cwd)().render(), [
    "Addy Workflow: ✓define → ✓plan → [build] → simplify → verify → review → finish | task-footer.md",
    "Current task: Parse invoice rows | Next task: none",
  ]);
});

test("workflow widget uses persisted task state when plan file is unavailable", () => {
  const state = {
    ...createInitialWorkflowState(),
    current: "build" as const,
    phases: { ...createInitialWorkflowState().phases, define: "complete" as const, plan: "complete" as const, build: "active" as const },
    activePlan: "docs/plans/missing.md",
    currentTask: "Parse invoice rows",
    nextTask: "Persist invoice payloads",
  };

  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    "Addy Workflow: ✓define → ✓plan → [build] → simplify → verify → review → finish | missing.md",
    "Current task: Parse invoice rows | Next task: Persist invoice payloads",
  ]);
});

test("workflow widget prefers summarized task labels", () => {
  const state = {
    ...createInitialWorkflowState(),
    current: "build" as const,
    phases: { ...createInitialWorkflowState().phases, define: "complete" as const, plan: "complete" as const, build: "active" as const },
    activePlan: "docs/plans/task-footer.md",
    currentTask: "Runtime wires per-invoice state transitions parsed converted submitted",
    nextTask: "Submit endpoint chooses draft live based on CSV isDraft",
    currentTaskSummary: "Wire state transitions",
    nextTaskSummary: "Route draft/live submits",
  };

  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    "Addy Workflow: ✓define → ✓plan → [build] → simplify → verify → review → finish | task-footer.md",
    "Current task: Wire state transitions | Next task: Route draft/live submits",
  ]);
});

test("refreshing workflow tasks clears stale summaries when task changes", () => {
  const planPath = join(taskFooterDir, "stale-summary.md");
  writeFileSync(planPath, [
    "## Task 1: New task name",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
  ].join("\n"));

  const state = refreshWorkflowTasksFromPlan({
    ...createInitialWorkflowState(),
    current: "build",
    activePlan: planPath,
    currentTask: "Old task name",
    currentTaskSummary: "Old summary",
  });

  assert.equal(state.currentTask, "New task name");
  assert.equal(state.currentTaskSummary, undefined);
});

test("plan task parser supports checklist tasks", () => {
  assert.deepEqual(planTasksFromMarkdown("- [x] First task\n- [ ] Second task"), [
    { title: "First task", complete: true },
    { title: "Second task", complete: false },
  ]);
});

test("plan task parser keeps status tasks current until implemented verified and reviewed", () => {
  assert.deepEqual(planTasksFromMarkdown([
    "## Task 1: Build finished but not verified",
    "- [x] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
    "",
    "## Task 2: Fully complete task",
    "- [x] Implemented",
    "- [x] Verified",
    "- [x] Reviewed",
  ].join("\n")), [
    { title: "Build finished but not verified", complete: false, missingStatuses: ["Verified", "Reviewed"] },
    { title: "Fully complete task", complete: true, missingStatuses: [] },
  ]);
});

test("unfinished lifecycle step helper reports missing finish prerequisites", () => {
  assert.deepEqual(unfinishedLifecycleStepsFromMarkdown([
    "## Task 0: Not started",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
    "",
    "## Task 1: Build finished but not verified",
    "- [x] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
    "",
    "## Task 2: Verified but not reviewed",
    "- [x] Implemented",
    "- [x] Verified",
    "- [ ] Reviewed",
  ].join("\n")), [
    { title: "Build finished but not verified", missingStatuses: ["Verified", "Reviewed"] },
    { title: "Verified but not reviewed", missingStatuses: ["Reviewed"] },
  ]);
});

test("plan task parser ignores nested checklist items when status task headings exist", () => {
  assert.deepEqual(planTasksFromMarkdown([
    "## Task 1: Parse invoice rows",
    "- [ ] Implemented",
    "- [ ] Verified",
    "- [ ] Reviewed",
    "- [ ] Acceptance criterion that is not a task",
  ].join("\n")), [
    { title: "Parse invoice rows", complete: false, missingStatuses: ["Implemented", "Verified", "Reviewed"] },
  ]);
});

test("workflow widget colors footer artifact name light blue", () => {
  const state = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-plan docs/specs/2026-05-11-better-workflow.md" });
  const theme = { fg: (name: string, text: string) => name === "mdLinkUrl" ? `<light-blue>${text}</light-blue>` : text };

  assert.deepEqual(renderWorkflowWidget(state)(undefined, theme).render(), [`Addy Workflow: define → [plan] → build → simplify → verify → review → finish | <light-blue>2026-05-11-better-workflow.md</light-blue>`]);
});

test("workflow widget colors task labels like workflow label", () => {
  const state = {
    ...createInitialWorkflowState(),
    current: "build" as const,
    phases: { ...createInitialWorkflowState().phases, define: "complete" as const, plan: "complete" as const, build: "active" as const },
    activePlan: "docs/plans/task-footer.md",
    currentTask: "Parse invoice rows",
    nextTask: "Persist invoice payloads",
  };
  const theme = { fg: (name: string, text: string) => name === "accent" ? `<accent>${text}</accent>` : text };

  assert.deepEqual(renderWorkflowWidget(state)(undefined, theme).render(), [
    "<accent>Addy Workflow: </accent>✓define → ✓plan → [build] → simplify → verify → review → finish | task-footer.md",
    "<accent>Current task: </accent>Parse invoice rows | <accent>Next task: </accent>Persist invoice payloads",
  ]);
});

test("workflow widget dims simplify but not finish", () => {
  const state = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-build" });
  const theme = { fg: (name: string, text: string) => name === "dim" ? `<dim>${text}</dim>` : text };

  assert.deepEqual(renderWorkflowWidget(state)(undefined, theme).render(), ["Addy Workflow: ✓define → ✓plan → [build] → <dim>simplify</dim> → verify → review → finish"]);
});

test("workflow widget truncates to render width", () => {
  const state = transitionWorkflow(createInitialWorkflowState(), {
    source: "user-input",
    text: "/addy-workflow-next review docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md",
  });

  const [line] = renderWorkflowWidget(state)().render(80);
  assert.equal(visibleWidth(line) <= 80, true);
});

test("workflow handler sets widget, reset clears widget, next opens prompt", () => {
  const widgets: Array<[string, unknown]> = [];
  const ctx: any = {
    id: "workflow-handler-test",
    ui: { setWidget: (key: string, value: unknown) => widgets.push([key, value]) },
    input: { prefill: (value: string) => widgets.push(["prefill", value]) },
  };

  handleWorkflowEvent(ctx, { source: "command", text: "/addy-workflow-next review", artifact: "diff.md" });
  assert.equal(ctx.state.current, "review");
  assert.equal(openNextWorkflowPrompt(ctx, "review", "diff.md"), "/addy-review diff.md");
  resetWorkflow(ctx);

  assert.equal(widgets.at(0)?.[0], "pi-addy-workflow");
  assert.deepEqual((widgets.at(0)?.[1] as any)().render(), ["Addy Workflow: ✓define → ✓plan → build → simplify → verify → [review] → finish | diff.md"]);
  assert.deepEqual(widgets.at(1), ["prefill", "/addy-review diff.md"]);
  assert.deepEqual(widgets.at(2), ["pi-addy-workflow", undefined]);
});

test("workflow next prompt falls back to active artifacts", () => {
  const specPath = "docs/specs/2026-05-11-better-workflow.md";
  const planPath = "docs/plans/2026-05-11-better-workflow.md";
  const widgets: Array<[string, unknown]> = [];
  const ctx: any = {
    state: { ...createInitialWorkflowState(), activeSpec: specPath, activePlan: planPath },
    input: { prefill: (value: string) => widgets.push(["prefill", value]) },
  };

  assert.equal(openNextWorkflowPrompt(ctx, "plan"), `/addy-plan ${specPath}`);
  assert.equal(openNextWorkflowPrompt(ctx, "build"), `/addy-build ${planPath}`);
});
