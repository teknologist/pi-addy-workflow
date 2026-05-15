import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDY_BOOTSTRAP_MARKER,
  buildAddyBootstrap,
  injectAddyBootstrap,
  shouldSkipBootstrap,
} from '../extensions/bootstrap/core.ts';

test('injects Addy bootstrap once', () => {
  const once = injectAddyBootstrap({
    systemPrompt: 'base',
    tools: ['todo', 'subagent'],
    env: {},
  });
  assert.ok(once?.includes(ADDY_BOOTSTRAP_MARKER));
  assert.equal(
    injectAddyBootstrap({
      systemPrompt: once,
      tools: ['todo', 'subagent'],
      env: {},
    }),
    once,
  );
});

test('skips nested subagent sessions', () => {
  assert.equal(shouldSkipBootstrap({ PI_SUBAGENT_DEPTH: '1' }), true);
  assert.equal(
    injectAddyBootstrap({
      systemPrompt: 'base',
      env: { PI_SUBAGENT_DEPTH: '2' },
    }),
    'base',
  );
});

test('warns when companion tools are unavailable', () => {
  const block = buildAddyBootstrap([]);
  assert.match(block, /`todo` tool unavailable/);
  assert.match(block, /`subagent` tool unavailable/);
});
