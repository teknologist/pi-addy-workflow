import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualFreshStepDispatcher } from '../extensions/workflow-monitor/manual-fresh-step.ts';

test('manual fresh step only applies to fresh-context workflow commands', () => {
  const dispatcher = createManualFreshStepDispatcher({
    freshContextBeforeEveryStep: () => true,
    notify: () => {},
    sendUserMessage: () => {},
  });

  assert.equal(
    dispatcher.shouldFreshContextBeforeStep('/addy-build docs/plan.md', {}),
    true,
  );
  assert.equal(
    dispatcher.shouldFreshContextBeforeStep('/addy-auto docs/plan.md', {}),
    false,
  );
});

test('manual fresh step respects config gate', () => {
  const dispatcher = createManualFreshStepDispatcher({
    freshContextBeforeEveryStep: () => false,
    notify: () => {},
    sendUserMessage: () => {},
  });

  assert.equal(
    dispatcher.shouldFreshContextBeforeStep('/addy-review docs/plan.md', {}),
    false,
  );
});

test('manual fresh step dispatches planned continuation prompt with notice', () => {
  const notices: Array<{ message: string; level: string }> = [];
  const sent: string[] = [];
  const dispatcher = createManualFreshStepDispatcher({
    freshContextBeforeEveryStep: () => true,
    notify: (_ctx, message, level) => notices.push({ message, level }),
    sendUserMessage: (_pi, _ctx, message) => sent.push(message),
  });

  assert.equal(
    dispatcher.dispatchManualStepWithFreshContextConfig(
      {} as never,
      '/addy-verify docs/plan.md',
      {},
    ),
    true,
  );
  assert.equal(notices[0].level, 'info');
  assert.match(notices[0].message, /fresh session/i);
  assert.match(sent[0], /docs\/plan\.md/);
});
