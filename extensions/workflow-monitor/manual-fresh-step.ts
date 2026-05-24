import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isFreshContextStepCommand } from './command-router.ts';
import { planManualStepDispatch } from './command-dispatch.ts';
import { expandPackagedPromptTemplate } from './prompt-template.ts';

type ManualFreshStepDeps = {
  freshContextBeforeEveryStep(ctx: unknown): boolean;
  notify(ctx: unknown, message: string, level: string): void;
  sendUserMessage(pi: ExtensionAPI, ctx: unknown, message: string): void;
};

export function createManualFreshStepDispatcher(deps: ManualFreshStepDeps) {
  function shouldFreshContextBeforeStep(input: string, ctx: unknown): boolean {
    const command = input.trim().split(/\s+/, 1)[0];
    return Boolean(
      isFreshContextStepCommand(command) &&
      deps.freshContextBeforeEveryStep(ctx),
    );
  }

  function dispatchManualStepWithFreshContextConfig(
    pi: ExtensionAPI,
    input: string,
    ctx: unknown,
  ): boolean {
    const plan = planManualStepDispatch(input);
    deps.notify(ctx, plan.notice, 'info');
    deps.sendUserMessage(pi, ctx, expandPackagedPromptTemplate(plan.prompt));
    return true;
  }

  return {
    dispatchManualStepWithFreshContextConfig,
    shouldFreshContextBeforeStep,
  };
}
