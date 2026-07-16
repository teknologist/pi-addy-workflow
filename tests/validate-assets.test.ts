import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const prompts = [
  'addy-define',
  'addy-plan',
  'addy-build',
  'addy-code-simplify',
  'addy-verify',
  'addy-review',
  'addy-fix-all',
  'addy-auto',
  'addy-stats',
  'addy-finish',
  'addy-ship',
];
const planPathPrompts = [
  'addy-build',
  'addy-code-simplify',
  'addy-verify',
  'addy-review',
  'addy-fix-all',
  'addy-stats',
  'addy-finish',
  'addy-ship',
];
const agents = [
  'addy-planner',
  'addy-implementer',
  'addy-reviewer',
  'addy-spec-reviewer',
  'addy-release-manager',
  'addy-security-auditor',
  'addy-test-engineer',
];
const requiredSkills = [
  'using-addy-workflow',
  'spec-driven-development',
  'planning-and-task-breakdown',
  'incremental-implementation',
  'addy-auto-unblock',
  'debugging-and-error-recovery',
  'code-review-and-quality',
  'code-simplification',
  'shipping-and-launch',
];

function promptBody(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function expandArguments(content: string, args: string): string {
  return promptBody(content)
    .replace(/\$ARGUMENTS/g, args)
    .replace(/\$@/g, args);
}

test('Ticket command docs cover the complete matrix, claim restrictions, and opt-in tracker smoke', async () => {
  const [readme, autoPrompt, smoke] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('prompts/addy-auto.md', 'utf8'),
    readFile('docs/ticket-tracker-smoke.md', 'utf8'),
  ]);
  for (const command of [
    '/addy-build --ticket <ticket-ref>',
    '/addy-code-simplify --ticket <ticket-ref>',
    '/addy-verify --ticket <ticket-ref>',
    '/addy-review --ticket <ticket-ref>',
    '/addy-fix-all --ticket <ticket-ref>',
    '/addy-finish --ticket <ticket-ref>',
    '/addy-auto --tickets',
    '/addy-auto --tickets --label <label>',
    '/addy-auto --tickets --status <status>',
    '/addy-stats --ticket <ticket-ref>',
    '/addy-ticket status <ticket-ref>',
    '/addy-ticket release <ticket-ref>',
    '/addy-ticket reclaim <ticket-ref>',
    '/addy-ticket add-repository <ticket-ref> <repository>',
  ])
    assert.match(
      readme,
      new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  for (const command of [
    '/addy-auto --tickets --label <label>',
    '/addy-auto --tickets --status <status>',
  ])
    assert.match(
      autoPrompt,
      new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  assert.match(readme, /BUILD may create.*claim/i);
  assert.match(readme, /same live claim/i);
  assert.match(readme, /external.*read-only.*cannot.*Ticket claim/is);
  assert.match(smoke, /opt-in.*non-CI/i);
  assert.match(smoke, /credentials.*never/i);
  assert.match(smoke, /GitHub/i);
  assert.match(smoke, /Linear/i);
  assert.ok(
    smoke.includes(
      'GitHub FINISH order: final Activity → terminal transition (close the issue) → confirming refetch.',
    ),
  );
  assert.ok(
    smoke.includes(
      'Linear FINISH order: final Activity → terminal transition (move to the configured completed state) → confirming refetch.',
    ),
  );
  assert.match(smoke, /not executed/i);
  assert.match(smoke, /contract.*harness.*not.*live tracker mutation/is);
});

test('package manifest exposes Pi resources but not native agents', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(manifest.keywords.includes('pi-package'));
  assert.deepEqual(manifest.pi.extensions, [
    'extensions/bootstrap.ts',
    'extensions/agent-installer.ts',
    'extensions/dashboard-installer.ts',
    'extensions/workflow-monitor.ts',
  ]);
  assert.equal(manifest.pi.agents, undefined);
  assert.ok(manifest.files.includes('agents/'));
  assert.ok(manifest.files.includes('docs/'));
});

test('all Addy prompts exist and workflow commands are not prompt files', async () => {
  for (const prompt of prompts) {
    const content = await readFile(join('prompts', `${prompt}.md`), 'utf8');
    assert.match(content, new RegExp(`# Addy`, 'i'));
  }

  const promptFiles = await readdir('prompts');
  assert.equal(promptFiles.includes('addy-workflow-reset.md'), false);
  assert.equal(promptFiles.includes('addy-workflow-next.md'), false);
});

test('Addy path prompt arguments survive template expansion', async () => {
  const planPath = '@docs/plans/plan_name.md';
  for (const prompt of planPathPrompts) {
    const content = await readFile(join('prompts', `${prompt}.md`), 'utf8');
    assert.match(content, /argument-hint: "\[plan-path\]"/, prompt);
    assert.match(
      content,
      /Supplied plan path argument, if any: `\$ARGUMENTS`\./,
      prompt,
    );
    assert.match(
      expandArguments(content, planPath),
      new RegExp(planPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      prompt,
    );
  }

  const plan = await readFile(join('prompts', 'addy-plan.md'), 'utf8');
  assert.match(plan, /argument-hint: "\[spec-path\]"/);
  assert.match(
    expandArguments(plan, '@docs/specs/spec_name.md'),
    /@docs\/specs\/spec_name\.md/,
  );

  for (const prompt of ['addy-define', 'addy-auto']) {
    const content = await readFile(join('prompts', `${prompt}.md`), 'utf8');
    assert.match(
      content,
      /Supplied argument text, if any: `\$ARGUMENTS`\./,
      prompt,
    );
    assert.match(
      expandArguments(content, '@docs/plans/plan_name.md'),
      /@docs\/plans\/plan_name\.md/,
      prompt,
    );
  }
});

test('define prompt accepts either a spec path or build idea', async () => {
  const content = await readFile(join('prompts', 'addy-define.md'), 'utf8');

  assert.match(content, /`\/addy-define \[spec-path\]`/);
  assert.match(content, /`\/addy-define "what you want to build"`/);
  assert.match(content, /quoted build explanation/i);
  assert.match(content, /YYYY-MM-DD-HHMMSS-<meaningful-name>\.md/);
});

test('define guidance links relevant ADRs from specs', async () => {
  const definePrompt = await readFile(
    join('prompts', 'addy-define.md'),
    'utf8',
  );
  const specSkill = await readFile(
    join('skills', 'spec-driven-development', 'SKILL.md'),
    'utf8',
  );
  const specReviewer = await readFile(
    join('agents', 'addy-spec-reviewer.md'),
    'utf8',
  );

  for (const content of [definePrompt, specSkill]) {
    assert.match(content, /Related ADRs \/ Architecture constraints/i);
    assert.match(content, /docs\/adr\//i);
    assert.match(content, /decisions\//i);
    assert.match(content, /Before implementation, read/i);
    assert.match(content, /superseding ADR/i);
  }

  assert.match(specReviewer, /related ADRs \/ architecture constraints/i);
  assert.match(
    specReviewer,
    /ADR conflict.*open question|open question.*ADR conflict/i,
  );
});

test('define guidance uses grill-with-docs for risky specs', async () => {
  const definePrompt = await readFile(
    join('prompts', 'addy-define.md'),
    'utf8',
  );
  const specSkill = await readFile(
    join('skills', 'spec-driven-development', 'SKILL.md'),
    'utf8',
  );

  for (const content of [definePrompt, specSkill]) {
    assert.match(content, /grill-with-docs/);
    assert.match(
      content,
      /ambiguous, risky, domain-heavy, or architecture-sensitive specs/i,
    );
    assert.match(content, /CONTEXT\.md/);
    assert.match(content, /CONTEXT-MAP\.md/);
    assert.match(
      content,
      /Do not use `grill-with-docs` for trivial specs|Skip it for trivial specs/i,
    );
  }
});

test('finish prompt advances tasks and slices with inline commit instructions', async () => {
  const content = await readFile(join('prompts', 'addy-finish.md'), 'utf8');

  assert.match(content, /ask_user_question/);
  assert.match(content, /missing lifecycle steps/);
  assert.match(content, /skip missing steps/);
  assert.match(content, /required confirmation gate/);
  assert.match(content, /Never silently skip missing verify or review steps/);
  assert.match(
    content,
    /Never silently skip workflow phases between build and finish/,
  );
  assert.match(content, /current slice has unfinished tasks/);
  assert.match(
    content,
    /current slice is complete and a next unfinished slice exists/,
  );
  assert.match(content, /all slices are complete/);
  assert.match(content, /`commit first`/);
  assert.match(content, /`next task`/);
  assert.match(content, /`next slice`/);
  assert.match(content, /`commit`/);
  assert.match(content, /`ship`/);
  assert.match(content, /\/addy-build <current-slice-plan-path>/);
  assert.match(content, /\/addy-build <next-slice-plan-path>/);
  assert.match(content, /Inline finish commit rule/);
  assert.match(content, /inline commit procedure/);
  assert.match(content, /non-interactive and auto-mode finish paths/);
  assert.match(content, /active\/supplied plan and its index metadata/);
  assert.match(content, /Repository scope:/);
  assert.match(content, /Owner repo/);
  assert.match(content, /Companion repo/);
  assert.match(content, /fresh-session file-touch history/);
  assert.match(content, /finish choice as the user's commit confirmation/);
  assert.match(
    content,
    /do not call `ask_user_question` again for commit confirmation/,
  );
  assert.match(content, /\/addy-ship/);
  assert.match(content, /execute the selected action directly/);
  assert.match(content, /Never respond with only the slash command text/);
  assert.match(
    content,
    /Do not merely print `\/addy-build <current-slice-plan-path>`/,
  );
  assert.match(
    content,
    /Do not merely print `\/addy-build <next-slice-plan-path>`/,
  );
  assert.match(content, /Do not merely print `\/addy-ship`/);
  assert.match(content, /User has answered/);
  assert.match(content, /do not wait for another user message/);
  assert.doesNotMatch(content, /\/commit/);
  assert.doesNotMatch(content, /trigger `\/addy-build/);
  assert.doesNotMatch(content, /trigger the `\/addy-ship/);
});

test('finish prompt mirrors safe multi-repo commit behavior inline', async () => {
  const content = await readFile(join('prompts', 'addy-finish.md'), 'utf8');

  assert.match(content, /inspect staged, unstaged, and untracked changes/);
  assert.match(content, /Skip scoped repositories with no changes/);
  assert.match(content, /Stage only those relevant paths/);
  assert.match(content, /leave unrelated user work unstaged/);
  assert.match(content, /conventional commit message/);
  assert.match(content, /same message across all scoped repositories/);
  assert.match(content, /concise multi-repository commit preview/);
  assert.match(
    content,
    /commit directly after the preview without asking again/,
  );
  assert.match(content, /git commit -m/);
  assert.match(content, /Stop on the first commit failure/);
  assert.match(content, /failed repository/);
  assert.match(content, /repositories already committed/);
  assert.match(content, /COMMIT: <hash>/);
  assert.match(content, /No changes to commit/);
});

test('finish prompt keeps auto-mode commit paths non-interactive', async () => {
  const content = await readFile(join('prompts', 'addy-finish.md'), 'utf8');

  assert.match(
    content,
    /If Addy Auto Mode is active, do not call `ask_user_question`/,
  );
  assert.match(content, /without asking the user/);
  assert.match(
    content,
    /Do not call `ask_user_question` for auto-mode finish commits/,
  );
  assert.match(content, /non-interactive and auto-mode finish paths/);
});

test('finish prompt does not introduce recursive plan refinement', async () => {
  const content = await readFile(join('prompts', 'addy-finish.md'), 'utf8');

  assert.doesNotMatch(content, /\/refine-plan/);
  assert.doesNotMatch(content, /plan-refinement loop/i);
});

test('finish guidance does not advertise commit and push', async () => {
  const checkedFiles = [
    'README.md',
    'extensions/bootstrap/core.ts',
    'skills/using-addy-workflow/SKILL.md',
    'prompts/addy-finish.md',
  ];

  for (const file of checkedFiles) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /commit-and-push/i, file);
    assert.doesNotMatch(content, /commit and push/i, file);
    assert.doesNotMatch(content, /\/commit-push/, file);
  }
});

test('workflow guidance requires plan checkbox synchronization', async () => {
  const checkedFiles = [
    'README.md',
    'extensions/bootstrap/core.ts',
    'skills/using-addy-workflow/SKILL.md',
    'skills/planning-and-task-breakdown/SKILL.md',
    'skills/incremental-implementation/SKILL.md',
    'prompts/addy-plan.md',
    'prompts/addy-build.md',
    'prompts/addy-verify.md',
    'prompts/addy-review.md',
    'prompts/addy-finish.md',
  ];

  for (const file of checkedFiles) {
    const content = await readFile(file, 'utf8');
    assert.match(content, /Implemented/i, file);
    assert.match(content, /Verified/i, file);
    assert.match(content, /Reviewed/i, file);
  }
});

test('verify and review require checkbox synchronization after every run', async () => {
  const verify = await readFile(join('prompts', 'addy-verify.md'), 'utf8');
  assert.match(verify, /mandatory after every `\/addy-verify` run/);
  assert.match(
    verify,
    /Before reporting completion, re-open the active\/supplied plan/,
  );
  assert.match(
    verify,
    /update only the verify-owned `\[ \] Verified` checkbox/,
  );
  assert.match(
    verify,
    /Do not update implemented\/reviewed checkboxes from `\/addy-verify`/,
  );

  const review = await readFile(join('prompts', 'addy-review.md'), 'utf8');
  assert.match(review, /mandatory after every `\/addy-review` run/);
  assert.match(
    review,
    /Before reporting completion, re-open the active\/supplied plan/,
  );
  assert.match(
    review,
    /update only the review-owned `\[ \] Reviewed` checkbox/,
  );
  assert.match(
    review,
    /Do not update implemented\/verified checkboxes from `\/addy-review`/,
  );
});

test('plan and build define lifecycle task completion semantics', async () => {
  const planPrompt = await readFile(join('prompts', 'addy-plan.md'), 'utf8');
  const buildPrompt = await readFile(join('prompts', 'addy-build.md'), 'utf8');

  assert.match(planPrompt, /exact heading\/status layout/i);
  assert.match(planPrompt, /Task N: Short imperative task name/);
  assert.match(
    planPrompt,
    /complete only when all three lifecycle checkboxes are checked/i,
  );
  assert.match(planPrompt, /legacy layout is still readable/i);
  assert.match(
    buildPrompt,
    /may mark only the current task's `\[x\] Implemented` checkbox/i,
  );
  assert.match(
    buildPrompt,
    /Do not mark, unmark, or otherwise edit `\[ \] Verified` or `\[ \] Reviewed` during build/i,
  );
  assert.match(
    buildPrompt,
    /same task remains current until `Implemented`, `Verified`, and `Reviewed` are all checked/i,
  );
  assert.match(buildPrompt, /Legacy checklist-only plans remain supported/i);
});

test('build guidance consumes ADR required context before coding', async () => {
  const buildPrompt = await readFile(join('prompts', 'addy-build.md'), 'utf8');
  const incrementalSkill = await readFile(
    join('skills', 'incremental-implementation', 'SKILL.md'),
    'utf8',
  );
  const implementerAgent = await readFile(
    join('agents', 'addy-implementer.md'),
    'utf8',
  );

  for (const content of [buildPrompt, incrementalSkill, implementerAgent]) {
    assert.match(content, /required context/i);
    assert.match(content, /linked ADRs/i);
    assert.match(content, /must not.*guardrails/i);
    assert.match(content, /superseding ADR/i);
    assert.match(content, /human architecture decision/i);
  }

  assert.match(buildPrompt, /Do not perform broad ADR discovery during build/i);
  assert.match(buildPrompt, /stop and ask for plan\/spec clarification/i);
  assert.match(buildPrompt, /preserving ADR constraints/i);
});

test('plan guidance keeps auto-ready metadata durable and non-task audits', async () => {
  const planPrompt = await readFile(join('prompts', 'addy-plan.md'), 'utf8');
  const planningSkill = await readFile(
    join('skills', 'planning-and-task-breakdown', 'SKILL.md'),
    'utf8',
  );

  for (const content of [planPrompt, planningSkill]) {
    assert.match(content, /persist (its )?findings/i);
    assert.match(content, /linked durable artifact/i);
    assert.match(
      content,
      /dependent tasks (?:to )?reference|make dependent tasks reference/i,
    );
    assert.match(
      content,
      /non-task `## Completion audit`|non-task completion audit/i,
    );
    assert.match(content, /not .*lifecycle task/i);
    assert.doesNotMatch(content, /## Task N: Audit completed implementation/i);
  }
});

test('plan guidance carries relevant ADRs into implementation tasks', async () => {
  const planPrompt = await readFile(join('prompts', 'addy-plan.md'), 'utf8');
  const planningSkill = await readFile(
    join('skills', 'planning-and-task-breakdown', 'SKILL.md'),
    'utf8',
  );
  const plannerAgent = await readFile(
    join('agents', 'addy-planner.md'),
    'utf8',
  );

  for (const content of [planPrompt, planningSkill, plannerAgent]) {
    assert.match(content, /Architecture Decision Records \(ADRs\)/i);
    assert.match(
      content,
      /ADRs linked from the spec|ADRs explicitly (?:listed or )?linked from the spec/i,
    );
    assert.match(content, /docs\/adr\//i);
    assert.match(content, /decisions\//i);
    assert.match(content, /superseding ADR/i);
  }

  for (const content of [planPrompt, planningSkill]) {
    assert.match(content, /## Required context|plan-level required context/i);
    assert.match(content, /relevant ADR paths/i);
    assert.match(content, /Steering files/i);
    assert.match(content, /Must preserve ADR constraints/i);
    assert.match(content, /must not.*ADR constraints/i);
    assert.match(content, /task title.*ADR ID|ADR ID.*task title/i);
  }

  assert.match(
    plannerAgent,
    /required context listing the spec, relevant ADR paths/i,
  );
  assert.match(plannerAgent, /explicit `must not` guardrails/i);
});

test('plan guidance does not use grill-with-docs', async () => {
  const planPrompt = await readFile(join('prompts', 'addy-plan.md'), 'utf8');
  const planningSkill = await readFile(
    join('skills', 'planning-and-task-breakdown', 'SKILL.md'),
    'utf8',
  );
  const plannerAgent = await readFile(
    join('agents', 'addy-planner.md'),
    'utf8',
  );

  for (const content of [planPrompt, planningSkill, plannerAgent]) {
    assert.doesNotMatch(content, /grill-with-docs/);
  }
});

test('plan and build guidance define safe auto recovery for missing ADR context', async () => {
  const planPrompt = await readFile(join('prompts', 'addy-plan.md'), 'utf8');
  const buildPrompt = await readFile(join('prompts', 'addy-build.md'), 'utf8');
  const autoPrompt = await readFile(join('prompts', 'addy-auto.md'), 'utf8');
  const unblockSkill = await readFile(
    join('skills', 'addy-auto-unblock', 'SKILL.md'),
    'utf8',
  );

  for (const content of [planPrompt, buildPrompt, autoPrompt, unblockSkill]) {
    assert.match(content, /safe|safely/i);
    assert.match(content, /unambiguous/i);
    assert.match(content, /existing ADR|existing.*steering file/i);
    assert.match(content, /required context/i);
    assert.match(content, /stop|Pause/i);
    assert.match(content, /guessing/i);
  }

  assert.match(buildPrompt, /If Addy Auto Mode is active/i);
  assert.match(autoPrompt, /rerun the current build step/i);
  assert.match(
    unblockSkill,
    /Pause instead of redesigning during build or guessing/i,
  );
});

test('ambiguous spec and plan selection uses structured questions', async () => {
  const planPrompt = await readFile(join('prompts', 'addy-plan.md'), 'utf8');
  const buildPrompt = await readFile(join('prompts', 'addy-build.md'), 'utf8');
  const finishPrompt = await readFile(
    join('prompts', 'addy-finish.md'),
    'utf8',
  );

  assert.match(planPrompt, /ask_user_question.*bounded candidate.*spec paths/i);
  assert.match(buildPrompt, /ask_user_question.*bounded candidate plan paths/i);
  assert.match(buildPrompt, /always use the active plan from workflow state/i);
  assert.match(buildPrompt, /workflow footer names one/i);
  assert.match(
    buildPrompt,
    /Do not call `ask_user_question` before reading the active plan/i,
  );
  assert.match(
    buildPrompt,
    /Do not ask which plan to use just because other slice plans exist/i,
  );
  assert.match(buildPrompt, /Do not skip an unfinished active plan/i);
  assert.match(buildPrompt, /forward-reference link within the active plan/i);
  assert.match(buildPrompt, /separate index file in the same directory/i);
  assert.match(buildPrompt, /next numbered slice/i);
  assert.match(buildPrompt, /exactly one matching next slice exists/i);
  assert.match(buildPrompt, /workflow state's active plan is synchronized/i);
  assert.match(finishPrompt, /ask_user_question.*bounded options/i);
});

test('verify and review prompts avoid completed stale active plans', async () => {
  const verifyPrompt = await readFile(
    join('prompts', 'addy-verify.md'),
    'utf8',
  );
  const reviewPrompt = await readFile(
    join('prompts', 'addy-review.md'),
    'utf8',
  );

  assert.match(
    verifyPrompt,
    /bare `\/addy-verify` must not keep using a completed stale slice/i,
  );
  assert.match(
    reviewPrompt,
    /bare `\/addy-review` must not keep using a completed stale slice/i,
  );
});

test('review guidance enforces ADR constraints and guardrails', async () => {
  const reviewPrompt = await readFile(
    join('prompts', 'addy-review.md'),
    'utf8',
  );
  const reviewSkill = await readFile(
    join('skills', 'code-review-and-quality', 'SKILL.md'),
    'utf8',
  );
  const reviewerAgent = await readFile(
    join('agents', 'addy-reviewer.md'),
    'utf8',
  );

  for (const content of [reviewPrompt, reviewSkill, reviewerAgent]) {
    assert.match(content, /ADR constraints/i);
    assert.match(content, /must not.*guardrails/i);
    assert.match(content, /superseding ADR/i);
  }

  assert.match(reviewPrompt, /read those linked ADR\/spec\/steering files/i);
  assert.match(reviewPrompt, /violates listed ADR constraints/i);
  assert.match(reviewPrompt, /Important planning\/spec gap/i);
  assert.match(reviewPrompt, /actionable for `\/addy-fix-all`/i);
  assert.match(reviewPrompt, /adding missing spec\/plan required context/i);
  assert.match(reviewSkill, /Treat violations of linked ADRs/i);
  assert.match(reviewerAgent, /Flag changes that violate an ADR/i);
});

test('review may update plan checkboxes without editing source files', async () => {
  const content = await readFile(join('prompts', 'addy-review.md'), 'utf8');

  assert.match(content, /would skip `\/addy-verify`/);
  assert.match(
    content,
    /If Addy Auto Mode is active, do not call `ask_user_question`/,
  );
  assert.match(content, /Run `\/addy-verify <plan-path>` automatically/);
  assert.match(content, /ask_user_question/);
  assert.match(content, /required confirmation gate/);
  assert.match(content, /Never silently skip verify between build and review/);
  assert.match(content, /do not edit source files unless the user asks/i);
  assert.match(
    content,
    /Updating the active\/supplied plan status checkboxes is required/,
  );
});

test('fix-all prompt fixes surfaced items and reruns review', async () => {
  const content = await readFile(join('prompts', 'addy-fix-all.md'), 'utf8');

  assert.match(content, /fix pass, not a review pass/i);
  assert.match(content, /immediately preceding `\/addy-review` result/i);
  assert.match(content, /Crit comments, failing checks, or review notes/);
  assert.match(content, /Do not use older conversation context/);
  assert.match(content, /Do not invent issues/);
  assert.match(content, /Do not search for new review findings/);
  assert.match(content, /ask the user to run `\/addy-review` first/);
  assert.match(content, /rerun the Addy Verify workflow/i);
  assert.match(content, /\/addy-verify <plan-path>/);
  assert.match(
    content,
    /invalidate prior `\[x\] Verified` and `\[x\] Reviewed` evidence/,
  );
  assert.match(content, /Rerun the Addy Review workflow/i);
  assert.match(content, /\/addy-review <plan-path>/);
  assert.match(
    content,
    /ADR-related review findings are actionable fix targets/i,
  );
  assert.match(content, /Add missing spec\/plan required context/i);
  assert.match(content, /Link an existing ADR/i);
  assert.match(content, /Stop instead of guessing/i);
  assert.match(
    content,
    /Do not merely print `\/addy-verify` or `\/addy-review` and stop/,
  );
  assert.match(content, /Do not commit unless the user explicitly asks/);
});

test('auto prompt documents autonomous plan execution', async () => {
  const content = await readFile(join('prompts', 'addy-auto.md'), 'utf8');
  const readme = await readFile('README.md', 'utf8');
  const unblockDoc = await readFile(
    join('docs', 'addy-auto-unblock-flow.md'),
    'utf8',
  );

  assert.match(content, /`\/addy-auto \[plan-path\]`/);
  assert.match(content, /`\/addy-auto stop`/);
  assert.match(content, /active plan/i);
  assert.match(content, /plan-selection rules/i);
  assert.match(content, /build.*verify.*review.*pass/i);
  assert.match(content, /may commit/i);
  assert.match(content, /addy-auto-unblock/);
  assert.match(content, /debugging-and-error-recovery/);
  assert.match(
    content,
    /Do not use unblock recovery to skip, weaken, or silently reinterpret acceptance criteria/i,
  );
  assert.match(content, /ADR-related review findings as actionable/i);
  assert.match(content, /adding missing spec\/plan required context/i);
  assert.match(readme, /\/addy-auto/);
  assert.match(readme, /docs\/addy-auto-unblock-flow\.md/);
  assert.match(unblockDoc, /Autonomous recovery must not weaken the workflow/);
  assert.match(
    unblockDoc,
    /Missing artifacts are recoverable, not automatic blockers/,
  );
  assert.match(
    unblockDoc,
    /must not invoke or perform `\/addy-verify` or `\/addy-review` inside the fix-all turn/,
  );
});

test('auto unblock treats safe ADR review findings as recoverable', async () => {
  const unblockSkill = await readFile(
    join('skills', 'addy-auto-unblock', 'SKILL.md'),
    'utf8',
  );

  assert.match(unblockSkill, /ADR-related review finding/i);
  assert.match(unblockSkill, /implementation repair/i);
  assert.match(unblockSkill, /missing spec\/plan required context/i);
  assert.match(unblockSkill, /recoverable when the safe scoped fix/i);
  assert.match(unblockSkill, /Pause instead of auto-fixing/i);
  assert.match(unblockSkill, /creating or superseding an ADR/i);
});

test('auto prompt defines autonomous task loop boundaries', async () => {
  const content = await readFile(join('prompts', 'addy-auto.md'), 'utf8');

  assert.match(content, /repeat build.*verify.*review.*commit/i);
  assert.match(content, /re-read the active\/supplied plan after every phase/i);
  assert.match(
    content,
    /build owns `Implemented`, verify owns `Verified`, and review owns `Reviewed`/,
  );
  assert.match(content, /forward-reference link/i);
  assert.match(content, /same-directory index/i);
  assert.match(content, /ordered slice filename/i);
  assert.match(content, /failed tests/i);
  assert.match(content, /typecheck/i);
  assert.match(content, /review blockers/i);
  assert.match(content, /3 as the default maximum review fix loops/i);
  assert.match(content, /Task commit policy/i);
  assert.match(
    content,
    /Do not call `ask_user_question` for this auto-task commit/i,
  );
  assert.match(content, /formatter and lint\/format checks/i);
  assert.match(content, /untracked files and the plan checkbox update/i);
  assert.match(content, /expected git state/i);
  assert.match(content, /ambiguous-but-inferable next slices/i);
  assert.match(
    content,
    /unsafe, destructive, external, or genuinely undecidable/i,
  );
});

test('stats prompt is read-only and prompts require completion stats', async () => {
  const stats = await readFile(join('prompts', 'addy-stats.md'), 'utf8');
  const auto = await readFile(join('prompts', 'addy-auto.md'), 'utf8');
  const finish = await readFile(join('prompts', 'addy-finish.md'), 'utf8');
  const review = await readFile(join('prompts', 'addy-review.md'), 'utf8');

  assert.match(stats, /argument-hint: "\[plan-path\]"/);
  assert.match(stats, /Supplied plan path argument, if any: `\$ARGUMENTS`\./);
  assert.match(stats, /read-only/i);
  assert.match(stats, /Do not edit/i);
  assert.match(stats, /No Addy stats recorded yet/);
  assert.match(auto, /final aggregate stats/i);
  assert.match(auto, /completed or stopped loop/i);
  assert.match(finish, /cycle completion stats/i);
  assert.match(finish, /full Addy Auto session/i);
  assert.match(finish, /build → simplify → verify → review → finish/);
  assert.match(
    finish,
    /If Addy Auto Mode is active, do not call `ask_user_question`/,
  );
  assert.match(
    finish,
    /If there are no unstaged or untracked working-tree changes, do not commit/,
  );
  assert.match(finish, /fresh-session continuation/);
  assert.match(
    finish,
    /If there are unstaged or untracked working-tree changes, run the inline commit procedure above for the completed plan work without asking the user/,
  );
  assert.match(
    finish,
    /Do not call `ask_user_question` for auto-mode finish commits/,
  );
  assert.doesNotMatch(finish, /- `finish without commit`/);
  assert.match(finish, /Turns:/);
  assert.match(finish, /Review runs:/);
  assert.match(finish, /Issues:/);
  assert.match(review, /Critical:/);
  assert.match(review, /Important:/);
  assert.match(review, /Suggestion:/);
  assert.match(review, /machine-readable/i);
});

test('auto workflow end-to-end validation evidence is recorded', async () => {
  const assetTests = await readFile(
    join('tests', 'validate-assets.test.ts'),
    'utf8',
  );
  const monitorTests = await readFile(
    join('tests', 'workflow-monitor.test.ts'),
    'utf8',
  );
  const trackerTests = await readFile(
    join('tests', 'workflow-tracker.test.ts'),
    'utf8',
  );
  const widgetPresenterTests = await readFile(
    join('tests', 'workflow-widget-presenter.test.ts'),
    'utf8',
  );
  const plan = await readFile(
    join('docs', 'plans', '2026-05-12-addy-auto-command.md'),
    'utf8',
  );

  assert.match(assetTests, /auto prompt documents autonomous plan execution/);
  assert.match(
    assetTests,
    /finish prompt keeps auto-mode commit paths non-interactive/,
  );
  assert.match(
    widgetPresenterTests,
    /auto mode toggles without changing lifecycle phase/,
  );
  assert.match(
    monitorTests,
    /auto mode input preserves plan and task progress while toggling footer label/,
  );
  assert.match(
    monitorTests,
    /auto loop commits a completed reviewed task before moving to the next task/,
  );
  assert.match(plan, /Manual smoke notes/i);
  assert.match(plan, /Final report checklist/i);
});

test('required lifecycle skills exist', async () => {
  for (const skill of requiredSkills) {
    const content = await readFile(join('skills', skill, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp(`name: ${skill}`));
  }
});

test('packaged agents are addy-prefixed and have no package or model frontmatter', async () => {
  const files = (await readdir('agents')).filter((file) =>
    file.endsWith('.md'),
  );
  assert.deepEqual(files.sort(), agents.map((agent) => `${agent}.md`).sort());

  for (const file of files) {
    const content = await readFile(join('agents', file), 'utf8');
    const expectedName = file.replace(/\.md$/, '');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, `${file} has YAML frontmatter`);
    const names = frontmatter[1].match(/^name:\s*(.+)$/gm) ?? [];
    assert.deepEqual(names, [`name: ${expectedName}`]);
    assert.doesNotMatch(
      content,
      /^name: (planner|implementer|reviewer|spec-reviewer|release-manager|code-reviewer|security-auditor|test-engineer)$/m,
    );
    assert.doesNotMatch(content, /^package:/m);
    assert.doesNotMatch(content, /^model:/m);
  }
});

test('prompts and skills avoid stale local/package references and generic agent calls', async () => {
  const checkedDirs = ['prompts', 'skills'];
  const forbidden = [
    /~\/\.pi\/agent/,
    /\.claude/,
    /\/plugin/,
    /pi-superpowers/,
  ];

  for (const dir of checkedDirs) {
    const entries = await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const path = join(entry.parentPath, entry.name);
      const content = await readFile(path, 'utf8');
      for (const pattern of forbidden)
        assert.doesNotMatch(content, pattern, path);
      assert.doesNotMatch(
        content,
        /`(planner|implementer|reviewer|spec-reviewer|release-manager|code-reviewer|security-auditor|test-engineer)`/,
        path,
      );
    }
  }
});

test('package entrypoints import', async () => {
  await import('../extensions/bootstrap.ts');
  await import('../extensions/agent-installer.ts');
  await import('../extensions/workflow-monitor.ts');
});
