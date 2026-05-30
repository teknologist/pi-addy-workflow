import { commandFromPrompt } from './command-router.ts';

export function addAutoRecoveryGuidance(
  message: string,
  prompt: string,
): string {
  const fixAllGuidance =
    commandFromPrompt(prompt) === '/addy-fix-all'
      ? `

## Addy Auto Fix-All Handoff

This is an auto-dispatched fix pass. Fix only the surfaced review issues and run narrow validation for the changed scope. Do not invoke or perform \`/addy-verify\` or \`/addy-review\` inside this \`/addy-fix-all\` turn. When this turn ends, the Addy auto monitor will dispatch \`/addy-verify\` first, then \`/addy-review\`.`
      : '';

  return `${message}

## Addy Auto Mode Recovery

Addy Auto Mode is active. If this step blocks, repeats, or finds missing artifacts, use the Pi \`addy-auto-unblock\` skill before pausing. That skill must apply \`debugging-and-error-recovery\` to reproduce, classify, and safely fix scoped blockers.

Critical rule: do not skip, weaken, or silently reinterpret acceptance criteria, verification, or review. Only mark lifecycle checkboxes when there is real evidence from this run.${fixAllGuidance}`;
}
