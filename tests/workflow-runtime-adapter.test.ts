import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendWorkflowEntry,
  appendWorkflowEntryFromContext,
  extensionApiFromContext,
  notifyWorkflow,
  notifyWorkflowWarning,
} from '../extensions/workflow-monitor/workflow-runtime-adapter.ts';

test('workflow runtime adapter appends through extension api', () => {
  const entries: Array<[string, unknown]> = [];
  const append = appendWorkflowEntry({
    appendEntry: (type: string, data: unknown) => entries.push([type, data]),
  } as never);

  append('workflow-state', { ok: true });

  assert.deepEqual(entries, [['workflow-state', { ok: true }]]);
});

test('workflow runtime adapter appends through host context', () => {
  const entries: Array<[string, unknown]> = [];
  const append = appendWorkflowEntryFromContext({
    sessionManager: {
      appendCustomEntry: (type: string, data: unknown) =>
        entries.push([type, data]),
    },
  });

  append('workflow-state', { ok: true });

  assert.deepEqual(entries, [['workflow-state', { ok: true }]]);
});

test('workflow runtime adapter creates extension api from host context', async () => {
  const entries: Array<[string, unknown]> = [];
  const sent: Array<[string, unknown]> = [];
  const api = extensionApiFromContext({
    sessionManager: {
      appendCustomEntry: (type: string, data: unknown) =>
        entries.push([type, data]),
    },
    sendUserMessage: (content: string, options: unknown) =>
      sent.push([content, options]),
  });

  api.appendEntry?.('workflow-state', { ok: true });
  await api.sendUserMessage?.('hello', { deliverAs: 'user' });

  assert.deepEqual(entries, [['workflow-state', { ok: true }]]);
  assert.deepEqual(sent, [['hello', { deliverAs: 'user' }]]);
});

test('workflow runtime adapter notifies through host ui', () => {
  const notifications: Array<[string, string | undefined]> = [];
  const ctx = {
    ui: {
      notify: (message: string, level?: string) =>
        notifications.push([message, level]),
    },
  };

  notifyWorkflow(ctx, 'hello', 'info');
  notifyWorkflowWarning(ctx, 'careful');

  assert.deepEqual(notifications, [
    ['hello', 'info'],
    ['careful', 'warning'],
  ]);
});
