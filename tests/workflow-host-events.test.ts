import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWriteArtifact,
  inputTextFromEvent,
  isStaleExtensionContextError,
  isSubagentChildSession,
  parseAutoFreshReason,
  parseCommandArgs,
  subagentNameFromEvent,
} from '../extensions/workflow-monitor/workflow-host-events.ts';

test('workflow host events parse command args from strings and objects', () => {
  assert.deepEqual(parseCommandArgs('/addy-auto stop'), ['/addy-auto', 'stop']);
  assert.deepEqual(parseCommandArgs({ args: ['--fresh', 'before-review'] }), [
    '--fresh',
    'before-review',
  ]);
  assert.deepEqual(parseCommandArgs({ input: '--fresh before-step' }), [
    '--fresh',
    'before-step',
  ]);
  assert.deepEqual(parseCommandArgs({ input: '--ticket "ENG 42"' }), [
    '--ticket',
    'ENG 42',
  ]);
});

test('workflow host events parse auto fresh reasons', () => {
  assert.equal(
    parseAutoFreshReason({ input: '--fresh before-review' }),
    'before-review',
  );
  assert.equal(parseAutoFreshReason('between-tasks'), 'between-tasks');
  assert.equal(parseAutoFreshReason('--fresh unknown'), undefined);
});

test('workflow host events normalize input text', () => {
  assert.equal(
    inputTextFromEvent({ input: 'typed', text: 'fallback' }),
    'typed',
  );
  assert.equal(inputTextFromEvent({ text: 'fallback' }), 'fallback');
  assert.equal(inputTextFromEvent({}), '');
});

test('workflow host events extract write artifacts from known write tools', () => {
  assert.equal(
    extractWriteArtifact({ toolName: 'write', input: { path: 'src/a.ts' } }),
    'src/a.ts',
  );
  assert.equal(
    extractWriteArtifact({ name: 'edit', input: { file_path: 'src/b.ts' } }),
    'src/b.ts',
  );
  assert.equal(
    extractWriteArtifact({
      name: 'obsidian_obsidian_patch_content',
      input: { filepath: 'Note.md' },
    }),
    'Note.md',
  );
  assert.equal(
    extractWriteArtifact({ toolName: 'read', input: { path: 'src/a.ts' } }),
    undefined,
  );
});

test('workflow host events normalize subagent names', () => {
  assert.equal(
    subagentNameFromEvent({ agentName: 'reviewer', agent: 'fallback' }),
    'reviewer',
  );
  assert.equal(subagentNameFromEvent({ agent: 'fallback' }), 'fallback');
});

test('workflow host events detect host context and child-session conditions', () => {
  const previous = process.env.PI_SUBAGENT_CHILD;
  try {
    process.env.PI_SUBAGENT_CHILD = '1';
    assert.equal(isSubagentChildSession(), true);
    process.env.PI_SUBAGENT_CHILD = '0';
    assert.equal(isSubagentChildSession(), false);
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous;
  }

  assert.equal(
    isStaleExtensionContextError(
      new Error('This extension ctx is stale after session replacement'),
    ),
    true,
  );
  assert.equal(isStaleExtensionContextError(new Error('other')), false);
});
