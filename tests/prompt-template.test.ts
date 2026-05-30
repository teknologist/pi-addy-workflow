import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPackagedPromptTemplate,
  parseTemplateArgs,
  stripFrontmatter,
  substituteTemplateArgs,
} from '../extensions/workflow-monitor/prompt-template.ts';

test('prompt template expands packaged commands and preserves invocation identity', () => {
  const expanded = expandPackagedPromptTemplate(
    '/addy-build "docs/plan one.md"',
    {
      promptsRoot: '/virtual/prompts',
      readFile: (path) => {
        assert.equal(path, '/virtual/prompts/addy-build.md');
        return [
          '---',
          'argument-hint: "[plan-path]"',
          '---',
          '# Addy Build',
          'Plan: `$ARGUMENTS`',
        ].join('\n');
      },
    },
  );

  assert.equal(
    expanded,
    [
      '# Addy Build',
      'Plan: `docs/plan one.md`',
      '',
      'Invocation: `/addy-build "docs/plan one.md"`',
    ].join('\n'),
  );
});

test('prompt template fails open for unknown commands and read failures', () => {
  assert.equal(
    expandPackagedPromptTemplate('/unknown value', {
      readFile: () => {
        throw new Error('should not read unknown command');
      },
    }),
    '/unknown value',
  );
  assert.equal(
    expandPackagedPromptTemplate('/addy-build docs/plan.md', {
      readFile: () => {
        throw new Error('missing template');
      },
    }),
    '/addy-build docs/plan.md',
  );
});

test('prompt template helpers preserve existing argument semantics', () => {
  assert.deepEqual(parseTemplateArgs('one "two words" \'three words\''), [
    'one',
    'two words',
    'three words',
  ]);
  assert.equal(stripFrontmatter('---\na: b\n---\nBody'), 'Body');
  assert.equal(
    substituteTemplateArgs('$1|$2|$3|$@|${@:2}|${@:2:2}', [
      'alpha',
      'beta',
      'gamma',
      'delta',
    ]),
    'alpha|beta|gamma|alpha beta gamma delta|beta gamma delta|beta gamma',
  );
});
