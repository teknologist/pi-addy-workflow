import test from "node:test";
import assert from "node:assert/strict";
import { createInitialWorkflowState, resolveTargetPhase, transitionWorkflow, type WorkflowPhase } from "../extensions/workflow-monitor/workflow-transitions.ts";
import { nextPromptForPhase, renderWorkflowStrip } from "../extensions/workflow-monitor/workflow-tracker.ts";
import { handleWorkflowEvent, openNextWorkflowPrompt, resetWorkflow } from "../extensions/workflow-monitor/workflow-handler.ts";

test("prompt triggers map to phases and code-simplify is unchanged", () => {
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-spec" }), "define");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-plan" }), "plan");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-build" }), "build");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-test" }), "verify");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-review" }), "review");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-ship" }), "ship");
  assert.equal(resolveTargetPhase({ source: "user-input", text: "/addy-code-simplify" }), undefined);
});

test("forward transition completes current phase and warns for skipped phases", () => {
  const define = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-spec" });
  const build = transitionWorkflow(define, { source: "user-input", text: "/addy-build" });

  assert.equal(build.phases.define, "complete");
  assert.equal(build.phases.plan, "pending");
  assert.equal(build.phases.build, "active");
  assert.match(build.warnings[0], /plan/);
});

test("fresh later phase warns about first missing earlier phase", () => {
  const review = transitionWorkflow(createInitialWorkflowState(), { source: "user-input", text: "/addy-review" });
  assert.equal(review.current, "review");
  assert.match(review.warnings[0], /define/);
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
    ["tasks/plan.md", "plan"],
    ["tasks/todo.md", "plan"],
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

test("workflow handler sets widget, reset clears widget, next opens prompt", () => {
  const widgets: Array<[string, unknown]> = [];
  const ctx: any = {
    ui: { setWidget: (key: string, value: unknown) => widgets.push([key, value]) },
    input: { prefill: (value: string) => widgets.push(["prefill", value]) },
  };

  handleWorkflowEvent(ctx, { source: "command", text: "/addy-workflow-next review", artifact: "diff.md" });
  assert.equal(ctx.state.current, "review");
  assert.equal(openNextWorkflowPrompt(ctx, "review", "diff.md"), "/addy-review diff.md");
  resetWorkflow(ctx);

  assert.deepEqual(widgets.at(0), ["pi-addy-workflow", "define → plan → build → verify → [review] → ship"]);
  assert.deepEqual(widgets.at(1), ["prefill", "/addy-review diff.md"]);
  assert.deepEqual(widgets.at(2), ["pi-addy-workflow", undefined]);
});
