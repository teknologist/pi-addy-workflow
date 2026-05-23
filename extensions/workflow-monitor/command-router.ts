import type { WorkflowPhase } from './workflow-transitions.ts';

export const WORKFLOW_COMMAND_BY_PHASE: Record<WorkflowPhase, string> = {
  define: '/addy-define',
  plan: '/addy-plan',
  build: '/addy-build',
  simplify: '/addy-code-simplify',
  verify: '/addy-verify',
  review: '/addy-review',
  finish: '/addy-finish',
};

export const PROMPT_TEMPLATE_BY_COMMAND: Record<string, string> = {
  '/addy-define': 'addy-define.md',
  '/addy-plan': 'addy-plan.md',
  '/addy-build': 'addy-build.md',
  '/addy-code-simplify': 'addy-code-simplify.md',
  '/addy-verify': 'addy-verify.md',
  '/addy-review': 'addy-review.md',
  '/addy-fix-all': 'addy-fix-all.md',
  '/addy-finish': 'addy-finish.md',
};

export const FRESH_CONTEXT_STEP_COMMANDS = Object.freeze([
  '/addy-define',
  '/addy-plan',
  '/addy-build',
  '/addy-code-simplify',
  '/addy-verify',
  '/addy-review',
  '/addy-fix-all',
  '/addy-finish',
]);

export function workflowTextFromInput(text: string): string {
  return text.match(/^Invocation:\s+`([^`]+)`\s*$/m)?.[1] ?? text;
}

export function commandFromPrompt(
  prompt: string | undefined,
): string | undefined {
  const text = prompt ? workflowTextFromInput(prompt) : undefined;
  return text?.trim().split(/\s+/, 1)[0];
}

export function commandNameFromText(
  text: string | undefined,
): string | undefined {
  if (!text) return undefined;
  const [command] = text.trim().split(/\s+/, 1);
  return command?.startsWith('/addy-') ? command : undefined;
}

export function phaseForWorkflowCommand(
  command: string | undefined,
): WorkflowPhase | undefined {
  if (command === '/addy-code-simplify') return 'simplify';
  for (const [phase, phaseCommand] of Object.entries(WORKFLOW_COMMAND_BY_PHASE))
    if (command === phaseCommand) return phase as WorkflowPhase;
  return undefined;
}

export function phaseFromWorkflowPrompt(
  prompt: string | undefined,
): WorkflowPhase | undefined {
  return phaseForWorkflowCommand(commandFromPrompt(prompt));
}

export function commandForWorkflowPhase(phase: WorkflowPhase): string {
  return WORKFLOW_COMMAND_BY_PHASE[phase];
}

export function isFreshContextStepCommand(
  command: string | undefined,
): boolean {
  return FRESH_CONTEXT_STEP_COMMANDS.includes(command ?? '');
}

export function isManualAddyWorkflowCommand(input: string): boolean {
  const command = commandNameFromText(input);
  return Boolean(
    command && command !== '/addy-auto' && command !== '/addy-auto-continue',
  );
}

export function isManualTurnCommand(command: string | undefined): boolean {
  return (
    command === '/addy-build' ||
    command === '/addy-verify' ||
    command === '/addy-review' ||
    command === '/addy-code-simplify' ||
    command === '/addy-fix-all' ||
    command === '/addy-finish'
  );
}
