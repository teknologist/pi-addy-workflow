import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentEndedWithProviderTransportFailure,
  latestAssistantMessage,
  latestAssistantText,
  textFromMessage,
} from '../extensions/workflow-monitor/agent-end-event.ts';

test('agent end event extracts plain string message content', () => {
  assert.equal(textFromMessage({ content: 'done' }), 'done');
  assert.equal(textFromMessage(undefined), '');
  assert.equal(textFromMessage({ content: 42 }), '');
});

test('agent end event extracts text parts from structured content', () => {
  assert.equal(
    textFromMessage({
      content: [
        { type: 'thinking', text: 'hidden' },
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
        { type: 'text', text: 123 },
      ],
    }),
    'first\nsecond',
  );
});

test('agent end event prefers latest assistant message', () => {
  const event = {
    messages: [
      { role: 'assistant', content: 'old assistant' },
      { role: 'user', content: 'user text' },
      { role: 'assistant', content: 'latest assistant' },
    ],
  };

  assert.equal(latestAssistantText(event), 'latest assistant');
  assert.equal(latestAssistantMessage(event)?.content, 'latest assistant');
});

test('agent end event falls back to final message when no assistant exists', () => {
  assert.equal(
    latestAssistantText({ messages: [{ role: 'user', content: 'fallback' }] }),
    'fallback',
  );
  assert.equal(
    latestAssistantText({ message: { content: 'single' } }),
    'single',
  );
});

test('agent end event detects provider transport failures', () => {
  assert.equal(
    agentEndedWithProviderTransportFailure({
      message: {
        stopReason: 'error',
        diagnostics: [{ type: 'provider_transport_failure' }],
      },
    }),
    true,
  );
  assert.equal(
    agentEndedWithProviderTransportFailure({
      message: {
        stopReason: 'error',
        diagnostics: [{ type: 'other_error' }],
      },
    }),
    false,
  );
  assert.equal(
    agentEndedWithProviderTransportFailure({
      message: {
        stopReason: 'stop',
        diagnostics: [{ type: 'provider_transport_failure' }],
      },
    }),
    false,
  );
});
