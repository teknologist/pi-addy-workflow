import test from "node:test";
import assert from "node:assert/strict";
import { createInitialWorkflowState, resolveTargetPhase, transitionWorkflow, type WorkflowPhase } from "../extensions/workflow-monitor/workflow-transitions.ts";
import { nextPromptForPhase, renderWorkflowStrip, renderWorkflowWidget } from "../extensions/workflow-monitor/workflow-tracker.ts";
import { handleWorkflowEvent, openNextWorkflowPrompt, resetWorkflow } from "../extensions/workflow-monitor/workflow-handler.ts";

test("prompt triggers map to phases", () => {
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-define" }), "define");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-plan" }), "plan");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-build" }), "build");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-code-simplify" }), "simplify");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-verify" }), "verify");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-review" }), "review");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-ship" }), "ship");
});

test("forward transition completes current phase without enforcing define or plan", () => {
  const define = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-define" });
  const build = transitionWorkflow(define, { source: "user-input", text: "/addy-build" });

  assert.equal(build.phases.define, "complete");
  assert.equal(build.phases.plan, "pending");
  assert.equal(build.phases.build, "active");
  assert.deepEqual(build.warnings, []);
});

test("fresh build and simplify are allowed but verify and review enforce build to verify to review", () => {
  const build = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-build" });
  assert.equal(build.current, "build");
  assert.deepEqual(build.warnings, []);

  const simplify = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-code-simplify" });
  assert.equal(simplify.current, "simplify");
  assert.deepEqual(simplify.warnings, []);

  const verify = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-verify" });
  assert.equal(verify.current, "verify");
  assert.match(verify.warnings[0], /build/);

  const review = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-review" });
  assert.equal(review.current, "review");
  assert.match(review.warnings[0], /build/);
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

test("ship is optional and does not enforce earlier phases", () => {
  const ship = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-ship" });
  assert.equal(ship.current, "ship");
  assert.deepEqual(ship.warnings, []);
});

test("backward transition resets state", () => {
  const ship = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-ship" });
  const plan = transitionWorkflow(ship, { source: "user-input", text: "/addy-plan" });

  assert.equal(plan.current, "plan");
  assert.equal(plan.phases.define, "pending");
  assert.equal(plan.phases.ship, "pending");
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
    ["CHANGELOG.md", "ship"],
    ["RELEASE.md", "ship"],
    ["docs/releases/v1.md", "ship"],
    ["docs/deploy/prod.md", "ship"],
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
  assert.equal(nextPromptForPhase("ship", "release-notes.md"), "/addy-ship release-notes.md");
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
  assert.deepEqual(renderWorkflowWidget(state)().render(), [`Addy Workflow: define → [plan] → build → simplify → verify → review → ship | 2026-05-11-better-workflow.md`]);

  const build = transitionWorkflow({ ...state, activePlan: planPath }, { source: "user-input", text: "/addy-build" });
  assert.deepEqual(renderWorkflowWidget(build)().render(), [`Addy Workflow: define → ✓plan → [build] → simplify → verify → review → ship | 2026-05-11-better-workflow.md`]);
});

test("workflow widget colors footer artifact name light blue", () => {
  const state = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-plan docs/specs/2026-05-11-better-workflow.md" });
  const theme = { fg: (name: string, text: string) => name === "mdLinkUrl" ? `<light-blue>${text}</light-blue>` : text };

  assert.deepEqual(renderWorkflowWidget(state)(undefined, theme).render(), [`Addy Workflow: define → [plan] → build → simplify → verify → review → ship | <light-blue>2026-05-11-better-workflow.md</light-blue>`]);
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
  assert.deepEqual((widgets.at(0)?.[1] as any)().render(), ["Addy Workflow: define → plan → build → simplify → verify → [review] → ship | diff.md"]);
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
