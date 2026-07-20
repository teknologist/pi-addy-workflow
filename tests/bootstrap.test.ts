import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDY_BOOTSTRAP_MARKER,
  buildAddyBootstrap,
  injectAddyBootstrap,
} from '../extensions/bootstrap/core.ts';

test('injects Addy bootstrap once', () => {
  const once = injectAddyBootstrap({
    systemPrompt: 'base',
    tools: ['todo', 'workflow'],
  });
  assert.ok(once?.includes(ADDY_BOOTSTRAP_MARKER));
  assert.equal(
    injectAddyBootstrap({
      systemPrompt: once,
      tools: ['todo', 'workflow'],
    }),
    once,
  );
});

test('warns when companion tools are unavailable', () => {
  const block = buildAddyBootstrap([]);
  assert.match(block, /`todo` tool unavailable/);
  assert.match(block, /`workflow` tool unavailable/);
});
