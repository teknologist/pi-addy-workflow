import test from "node:test";
import assert from "node:assert/strict";
import addyWorkflowMonitor from "../extensions/workflow-monitor.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type CommandConfig = { description: string; handler: Handler };

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
  const result = await commands.get("addy-workflow-reset")?.handler({}, { ui: { setWidget: (key: string, value: unknown) => widgets.push([key, value]) } });

  assert.deepEqual(result, { action: "continue" });
  assert.equal(entries.at(-1)?.[0], "pi-addy-workflow-state");
  assert.deepEqual(widgets, [["pi-addy-workflow", undefined]]);
});

test("next command parses args, transitions, persists, prefills, and continues", async () => {
  const { pi, commands, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const effects: Array<[string, unknown]> = [];
  const ctx: any = {
    ui: { setWidget: (key: string, value: unknown) => effects.push([key, value]) },
    input: { prefill: (value: string) => effects.push(["prefill", value]) },
  };

  const result = await commands.get("addy-workflow-next")?.handler("review diff.md", ctx);

  assert.deepEqual(result, { action: "continue" });
  assert.equal(ctx.state.current, "review");
  assert.equal(entries.at(-1)?.[0], "pi-addy-workflow-state");
  assert.deepEqual(effects.at(0), ["pi-addy-workflow", "define → plan → build → verify → [review] → ship"]);
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

test("write tool calls drive file-write transitions", async () => {
  const { pi, events, entries } = createPiMock();
  addyWorkflowMonitor(pi as never);

  const effects: Array<[string, unknown]> = [];
  const ctx: any = { ui: { setWidget: (key: string, value: unknown) => effects.push([key, value]) } };
  await events.get("tool_call")?.({ toolName: "write", input: { path: "tests/example.test.ts" } }, ctx);

  assert.equal(ctx.state.current, "verify");
  assert.equal(entries.at(-1)?.[0], "pi-addy-workflow-state");
  assert.deepEqual(effects.at(-1), ["pi-addy-workflow", "define → plan → build → [verify] → review → ship"]);
});
