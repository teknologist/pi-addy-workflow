import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH_CONTEXT_STEP_COMMANDS,
  PROMPT_TEMPLATE_BY_COMMAND,
  commandForWorkflowPhase,
  commandFromPrompt,
  commandNameFromText,
  isFreshContextStepCommand,
  isManualAddyWorkflowCommand,
  isManualTurnCommand,
  phaseFromWorkflowPrompt,
  phaseForWorkflowCommand,
  workflowTextFromInput,
} from '../extensions/workflow-monitor/command-router.ts';

test('command router parses invocation text and workflow phases', () => {
  assert.equal(
    workflowTextFromInput('Invocation: `/addy-review docs/plan.md`'),
    '/addy-review docs/plan.md',
  );
  assert.equal(
    commandFromPrompt(
      '# Addy Review\n\nInvocation: `/addy-review docs/plan.md`',
    ),
    '/addy-review',
  );
  assert.equal(commandNameFromText('/addy-auto stop'), '/addy-auto');
  assert.equal(
    commandNameFromText(
      '# Addy Build\n\nInvocation: `/addy-build docs/plan.md`',
    ),
    undefined,
  );
  assert.equal(commandNameFromText('npm test'), undefined);
  assert.equal(
    phaseFromWorkflowPrompt('/addy-code-simplify plan.md'),
    'simplify',
  );
  assert.equal(phaseForWorkflowCommand('/addy-finish'), 'finish');
  assert.equal(commandForWorkflowPhase('verify'), '/addy-verify');
});

test('command router exposes workflow command metadata', () => {
  assert.equal(PROMPT_TEMPLATE_BY_COMMAND['/addy-plan'], 'addy-plan.md');
  assert.equal(
    PROMPT_TEMPLATE_BY_COMMAND['/addy-code-simplify'],
    'addy-code-simplify.md',
  );
  assert.deepEqual(FRESH_CONTEXT_STEP_COMMANDS, [
    '/addy-define',
    '/addy-plan',
    '/addy-build',
    '/addy-code-simplify',
    '/addy-verify',
    '/addy-review',
    '/addy-fix-all',
    '/addy-finish',
  ]);
  assert.equal(isFreshContextStepCommand('/addy-review'), true);
  assert.equal(isFreshContextStepCommand('/addy-auto'), false);
});

test('command router classifies manual Addy workflow commands', () => {
  assert.equal(isManualAddyWorkflowCommand('/addy-build docs/plan.md'), true);
  assert.equal(isManualAddyWorkflowCommand('/addy-auto docs/plan.md'), false);
  assert.equal(
    isManualAddyWorkflowCommand('/addy-auto-continue --fresh before-step'),
    false,
  );
  assert.equal(isManualTurnCommand('/addy-fix-all'), true);
  assert.equal(isManualTurnCommand('/addy-define'), false);
});
