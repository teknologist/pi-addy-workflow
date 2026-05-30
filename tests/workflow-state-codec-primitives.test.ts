import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNonNegativeSafeInteger,
  isOptionalBoolean,
  isOptionalString,
  isPositiveSafeInteger,
  isStringArray,
} from '../extensions/workflow-monitor/workflow-state-codec-primitives.ts';

test('state codec primitive integer guards distinguish persisted indexes', () => {
  assert.equal(isPositiveSafeInteger(1), true);
  assert.equal(isPositiveSafeInteger(0), false);
  assert.equal(isPositiveSafeInteger(1.5), false);
  assert.equal(isNonNegativeSafeInteger(0), true);
  assert.equal(isNonNegativeSafeInteger(-1), false);
});

test('state codec primitive optional scalar guards preserve undefined semantics', () => {
  assert.equal(isOptionalString(undefined), true);
  assert.equal(isOptionalString('value'), true);
  assert.equal(isOptionalString(1), false);
  assert.equal(isOptionalBoolean(undefined), true);
  assert.equal(isOptionalBoolean(false), true);
  assert.equal(isOptionalBoolean('false'), false);
});

test('state codec primitive string array guard rejects mixed arrays', () => {
  assert.equal(isStringArray(['one', 'two']), true);
  assert.equal(isStringArray(['one', 2]), false);
  assert.equal(isStringArray('one'), false);
});
