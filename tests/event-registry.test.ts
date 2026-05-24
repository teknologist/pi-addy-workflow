import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWorkflowEvents } from '../extensions/workflow-monitor/event-registry.ts';

function createHarness() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const events: unknown[] = [];
  let sessionStarts = 0;
  let inputs = 0;
  let agentEnds = 0;
  registerWorkflowEvents(
    {
      on: (
        name: string,
        handler: (event: unknown, ctx: unknown) => unknown,
      ) => {
        handlers.set(name, handler);
      },
    } as never,
    {
      appendEntry: () => () => {},
      handleAgentEnd: async () => {
        agentEnds += 1;
      },
      handleInput: async () => {
        inputs += 1;
        return { action: 'continue' };
      },
      handleSessionStart: async () => {
        sessionStarts += 1;
      },
      handleWorkflowEvent: (_ctx, event) => events.push(event),
    },
  );

  return {
    events,
    handlers,
    get agentEnds() {
      return agentEnds;
    },
    get inputs() {
      return inputs;
    },
    get sessionStarts() {
      return sessionStarts;
    },
  };
}

test('event registry registers expected host event handlers', () => {
  const harness = createHarness();

  assert.deepEqual(
    [...harness.handlers.keys()],
    [
      'session_start',
      'input',
      'tool_result',
      'tool_call',
      'before_agent_start',
      'agent_end',
    ],
  );
});

test('event registry normalizes tool result and subagent events', () => {
  const harness = createHarness();

  harness.handlers.get('tool_result')?.(
    { text: 'ok', command: 'npm test', success: true, artifact: 'log.txt' },
    {},
  );
  harness.handlers.get('before_agent_start')?.(
    { agentName: 'addy-reviewer' },
    {},
  );

  assert.deepEqual(harness.events, [
    {
      source: 'tool-result',
      text: 'ok',
      command: 'npm test',
      success: true,
      artifact: 'log.txt',
    },
    { source: 'subagent-call', agentName: 'addy-reviewer' },
  ]);
});

test('event registry delegates session input and agent-end handlers', async () => {
  const harness = createHarness();

  await harness.handlers.get('session_start')?.({}, {});
  await harness.handlers.get('input')?.({ text: '/addy-build' }, {});
  await harness.handlers.get('agent_end')?.(
    { message: { content: 'done' } },
    {},
  );

  assert.equal(harness.sessionStarts, 1);
  assert.equal(harness.inputs, 1);
  assert.equal(harness.agentEnds, 1);
});
