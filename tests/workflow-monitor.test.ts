import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import addyWorkflowMonitor from "../extensions/workflow-monitor.ts";
import { getContextWorkflowState, handleWorkflowEvent } from "../extensions/workflow-monitor/workflow-handler.ts";
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

  assert.ok(events.has("input"));
  assert.ok(events.has("tool_result"));
  assert.ok(events.has("tool_call"));
  assert.equal(events.has("file_write"), false);
  assert.ok(events.has("before_agent_start"));
  assert.ok(commands.has("addy-workflow-reset"));
  assert.ok(commands.has("addy-workflow-next"));
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
  assert.equal(entries.at(-1)?.[0], "pi-addy-workflow-state");
  assert.equal(effects.at(0)?.[0], "pi-addy-workflow");
  assert.deepEqual((effects.at(0)?.[1] as any)().render(), ["Addy Workflow: define → plan → build → simplify → verify → [review] → ship"]);
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
  const validState = { current: "build", phases: { define: "pending", plan: "pending", build: "active", simplify: "pending", verify: "pending", review: "pending", ship: "pending" }, warnings: [] };
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
      getBranch: () => [{ type: "custom", customType: WORKFLOW_STATE_ENTRY_TYPE, data: { current: "build", phases: { define: "pending", plan: "pending", build: "active", simplify: "pending", verify: "pending", review: "pending", ship: "pending" }, warnings: [] } }],
    },
  };

  assert.equal(getContextWorkflowState(ctx).current, "build");
});

test("write tool calls drive file-write transitions", async () => {
  const { pi, events, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const effects: Array<[string, unknown]> = [];
  const ctx: any = { id: "write-tool-test", ui: { setWidget: (key: string, value: unknown) => effects.push([key, value]) } };
  await events.get("tool_call")?.({ toolName: "write", input: { path: "tests/example.test.ts" } }, ctx);

  assert.equal(ctx.state.current, "verify");
  assert.equal(entries.at(-1)?.[0], "pi-addy-workflow-state");
  assert.equal(effects.at(-1)?.[0], "pi-addy-workflow");
  assert.deepEqual((effects.at(-1)?.[1] as any)().render(), ["Addy Workflow: define → plan → build → simplify → [verify] → review → ship"]);
});
