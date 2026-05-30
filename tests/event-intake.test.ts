import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planSubagentStartEvent,
  planToolCallEvent,
  planToolResultEvent,
} from '../extensions/workflow-monitor/event-intake.ts';

test('event intake plans tool result workflow events', () => {
  assert.deepEqual(
    planToolResultEvent({
      text: 'ok',
      command: 'npm test',
      success: true,
      artifact: 'log.txt',
    }),
    {
      source: 'tool-result',
      text: 'ok',
      command: 'npm test',
      success: true,
      artifact: 'log.txt',
    },
  );
});

test('event intake plans file-write workflow events for write tools only', () => {
  assert.deepEqual(
    planToolCallEvent({ toolName: 'write', input: { path: 'src/a.ts' } }),
    { source: 'file-write', artifact: 'src/a.ts' },
  );
  assert.equal(
    planToolCallEvent({ toolName: 'read', input: { path: 'src/a.ts' } }),
    undefined,
  );
});

test('event intake plans subagent call workflow events', () => {
  assert.deepEqual(
    planSubagentStartEvent({ agentName: 'reviewer', agent: 'fallback' }),
    { source: 'subagent-call', agentName: 'reviewer' },
  );
});
