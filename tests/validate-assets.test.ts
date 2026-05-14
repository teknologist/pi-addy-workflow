import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const prompts = ["addy-define", "addy-plan", "addy-build", "addy-code-simplify", "addy-verify", "addy-review", "addy-fix-all", "addy-auto", "addy-stats", "addy-finish", "addy-ship"];
const planPathPrompts = ["addy-build", "addy-code-simplify", "addy-verify", "addy-review", "addy-fix-all", "addy-stats", "addy-finish", "addy-ship"];
const agents = [
  "addy-planner",
  "addy-implementer",
  "addy-reviewer",
  "addy-spec-reviewer",
  "addy-release-manager",
  "addy-security-auditor",
  "addy-test-engineer",
];
const requiredSkills = [
  "using-addy-workflow",
  "spec-driven-development",
  "planning-and-task-breakdown",
  "incremental-implementation",
  "addy-auto-unblock",
  "debugging-and-error-recovery",
  "code-review-and-quality",
  "code-simplification",
  "shipping-and-launch",
];

function promptBody(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function expandArguments(content: string, args: string): string {
  return promptBody(content).replace(/\$ARGUMENTS/g, args).replace(/\$@/g, args);
}

test("package manifest exposes Pi resources but not native agents", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.pi.extensions, ["extensions/bootstrap.ts", "extensions/agent-installer.ts", "extensions/workflow-monitor.ts"]);
  assert.equal(manifest.pi.agents, undefined);
  assert.ok(manifest.files.includes("agents/"));
  assert.ok(manifest.files.includes("docs/"));
});

test("all Addy prompts exist and workflow commands are not prompt files", async () => {
  for (const prompt of prompts) {
    const content = await readFile(join("prompts", `${prompt}.md`), "utf8");
    assert.match(content, new RegExp(`# Addy`, "i"));
  }

  const promptFiles = await readdir("prompts");
  assert.equal(promptFiles.includes("addy-workflow-reset.md"), false);
  assert.equal(promptFiles.includes("addy-workflow-next.md"), false);
});

test("Addy path prompt arguments survive template expansion", async () => {
  const planPath = "@docs/plans/plan_name.md";
  for (const prompt of planPathPrompts) {
    const content = await readFile(join("prompts", `${prompt}.md`), "utf8");
    assert.match(content, /argument-hint: "\[plan-path\]"/, prompt);
    assert.match(content, /Supplied plan path argument, if any: `\$ARGUMENTS`\./, prompt);
    assert.match(expandArguments(content, planPath), new RegExp(planPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), prompt);
  }

  const plan = await readFile(join("prompts", "addy-plan.md"), "utf8");
  assert.match(plan, /argument-hint: "\[spec-path\]"/);
  assert.match(expandArguments(plan, "@docs/specs/spec_name.md"), /@docs\/specs\/spec_name\.md/);

  for (const prompt of ["addy-define", "addy-auto"]) {
    const content = await readFile(join("prompts", `${prompt}.md`), "utf8");
    assert.match(content, /Supplied argument text, if any: `\$ARGUMENTS`\./, prompt);
    assert.match(expandArguments(content, "@docs/plans/plan_name.md"), /@docs\/plans\/plan_name\.md/, prompt);
  }
});

test("define prompt accepts either a spec path or build idea", async () => {
  const content = await readFile(join("prompts", "addy-define.md"), "utf8");

  assert.match(content, /`\/addy-define \[spec-path\]`/);
  assert.match(content, /`\/addy-define "what you want to build"`/);
  assert.match(content, /quoted build explanation/i);
  assert.match(content, /YYYY-MM-DD-HHMMSS-<meaningful-name>\.md/);
});

test("finish prompt advances tasks and slices with commit prompts", async () => {
  const content = await readFile(join("prompts", "addy-finish.md"), "utf8");

  assert.match(content, /ask_user_question/);
  assert.match(content, /missing lifecycle steps/);
  assert.match(content, /skip missing steps/);
  assert.match(content, /--skip-missing-steps-confirmed/);
  assert.match(content, /Never silently skip missing verify or review steps/);
  assert.match(content, /Never silently skip workflow phases between build and finish/);
  assert.match(content, /current slice has unfinished tasks/);
  assert.match(content, /current slice is complete and a next unfinished slice exists/);
  assert.match(content, /all slices are complete/);
  assert.match(content, /`commit first`/);
  assert.match(content, /`next task`/);
  assert.match(content, /`next slice`/);
  assert.match(content, /`commit`/);
  assert.match(content, /`ship`/);
  assert.match(content, /\/addy-build <current-slice-plan-path>/);
  assert.match(content, /\/addy-build <next-slice-plan-path>/);
  assert.match(content, /\/commit/);
  assert.match(content, /cross-repo-aware `\/commit`/);
  assert.match(content, /non-interactive mode/);
  assert.match(content, /derive the full repository scope/);
  assert.match(content, /Owner repo/);
  assert.match(content, /Companion repo/);
  assert.match(content, /Pass that full repository scope to `\/commit --non-interactive`/);
  assert.match(content, /fresh-session file-touch history/);
  assert.match(content, /finish choice is already the confirmation/);
  assert.match(content, /do not call `ask_user_question` again for commit confirmation/);
  assert.match(content, /do not replace `\/commit` with a hand-rolled single-repository git flow/);
  assert.match(content, /\/addy-ship/);
  assert.match(content, /execute the selected action directly/);
  assert.match(content, /Never respond with only the slash command text/);
  assert.match(content, /Do not merely print `\/commit`/);
  assert.match(content, /Do not merely print `\/addy-build <current-slice-plan-path>`/);
  assert.match(content, /Do not merely print `\/addy-build <next-slice-plan-path>`/);
  assert.match(content, /Do not merely print `\/addy-ship`/);
  assert.match(content, /User has answered/);
  assert.match(content, /do not wait for another user message/);
  assert.doesNotMatch(content, /trigger `\/addy-build/);
  assert.doesNotMatch(content, /trigger the `\/addy-ship/);
});

test("finish guidance does not advertise commit and push", async () => {
  const checkedFiles = [
    "README.md",
    "extensions/bootstrap/core.ts",
    "skills/using-addy-workflow/SKILL.md",
    "prompts/addy-finish.md",
  ];

  for (const file of checkedFiles) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /commit-and-push/i, file);
    assert.doesNotMatch(content, /commit and push/i, file);
    assert.doesNotMatch(content, /\/commit-push/, file);
  }
});

test("workflow guidance requires plan checkbox synchronization", async () => {
  const checkedFiles = [
    "README.md",
    "extensions/bootstrap/core.ts",
    "skills/using-addy-workflow/SKILL.md",
    "skills/planning-and-task-breakdown/SKILL.md",
    "skills/incremental-implementation/SKILL.md",
    "prompts/addy-plan.md",
    "prompts/addy-build.md",
    "prompts/addy-verify.md",
    "prompts/addy-review.md",
    "prompts/addy-finish.md",
  ];

  for (const file of checkedFiles) {
    const content = await readFile(file, "utf8");
    assert.match(content, /Implemented/i, file);
    assert.match(content, /Verified/i, file);
    assert.match(content, /Reviewed/i, file);
  }
});

test("verify and review require checkbox synchronization after every run", async () => {
  const verify = await readFile(join("prompts", "addy-verify.md"), "utf8");
  assert.match(verify, /mandatory after every `\/addy-verify` run/);
  assert.match(verify, /Before reporting completion, re-open the active\/supplied plan/);
  assert.match(verify, /update only the verify-owned `\[ \] Verified` checkbox/);
  assert.match(verify, /Do not update implemented\/reviewed checkboxes from `\/addy-verify`/);

  const review = await readFile(join("prompts", "addy-review.md"), "utf8");
  assert.match(review, /mandatory after every `\/addy-review` run/);
  assert.match(review, /Before reporting completion, re-open the active\/supplied plan/);
  assert.match(review, /update only the review-owned `\[ \] Reviewed` checkbox/);
  assert.match(review, /Do not update implemented\/verified checkboxes from `\/addy-review`/);
});

test("plan and build define lifecycle task completion semantics", async () => {
  const planPrompt = await readFile(join("prompts", "addy-plan.md"), "utf8");
  const buildPrompt = await readFile(join("prompts", "addy-build.md"), "utf8");

  assert.match(planPrompt, /exact heading\/status layout/i);
  assert.match(planPrompt, /Task N: Short imperative task name/);
  assert.match(planPrompt, /complete only when all three lifecycle checkboxes are checked/i);
  assert.match(planPrompt, /legacy layout is still readable/i);
  assert.match(buildPrompt, /may mark only the current task's `\[x\] Implemented` checkbox/i);
  assert.match(buildPrompt, /Do not mark, unmark, or otherwise edit `\[ \] Verified` or `\[ \] Reviewed` during build/i);
  assert.match(buildPrompt, /same task remains current until `Implemented`, `Verified`, and `Reviewed` are all checked/i);
  assert.match(buildPrompt, /Legacy checklist-only plans remain supported/i);
});

test("ambiguous spec and plan selection uses structured questions", async () => {
  const planPrompt = await readFile(join("prompts", "addy-plan.md"), "utf8");
  const buildPrompt = await readFile(join("prompts", "addy-build.md"), "utf8");
  const finishPrompt = await readFile(join("prompts", "addy-finish.md"), "utf8");

  assert.match(planPrompt, /ask_user_question.*bounded candidate.*spec paths/i);
  assert.match(buildPrompt, /ask_user_question.*bounded candidate plan paths/i);
  assert.match(buildPrompt, /always use the active plan from workflow state/i);
  assert.match(buildPrompt, /workflow footer names one/i);
  assert.match(buildPrompt, /Do not call `ask_user_question` before reading the active plan/i);
  assert.match(buildPrompt, /Do not ask which plan to use just because other slice plans exist/i);
  assert.match(buildPrompt, /Do not skip an unfinished active plan/i);
  assert.match(buildPrompt, /forward-reference link within the active plan/i);
  assert.match(buildPrompt, /separate index file in the same directory/i);
  assert.match(buildPrompt, /next numbered slice/i);
  assert.match(buildPrompt, /exactly one matching next slice exists/i);
  assert.match(buildPrompt, /workflow state's active plan is synchronized/i);
  assert.match(finishPrompt, /ask_user_question.*bounded options/i);
});

test("verify and review prompts avoid completed stale active plans", async () => {
  const verifyPrompt = await readFile(join("prompts", "addy-verify.md"), "utf8");
  const reviewPrompt = await readFile(join("prompts", "addy-review.md"), "utf8");

  assert.match(verifyPrompt, /bare `\/addy-verify` must not keep using a completed stale slice/i);
  assert.match(reviewPrompt, /bare `\/addy-review` must not keep using a completed stale slice/i);
});

test("review may update plan checkboxes without editing source files", async () => {
  const content = await readFile(join("prompts", "addy-review.md"), "utf8");

  assert.match(content, /would skip `\/addy-verify`/);
  assert.match(content, /ask_user_question/);
  assert.match(content, /--skip-verify-confirmed/);
  assert.match(content, /Never silently skip verify between build and review/);
  assert.match(content, /do not edit source files unless the user asks/i);
  assert.match(content, /Updating the active\/supplied plan status checkboxes is required/);
});

test("fix-all prompt fixes surfaced items and reruns review", async () => {
  const content = await readFile(join("prompts", "addy-fix-all.md"), "utf8");

  assert.match(content, /fix pass, not a review pass/i);
  assert.match(content, /immediately preceding `\/addy-review` result/i);
  assert.match(content, /Crit comments, failing checks, or review notes/);
  assert.match(content, /Do not use older conversation context/);
  assert.match(content, /Do not invent issues/);
  assert.match(content, /Do not search for new review findings/);
  assert.match(content, /ask the user to run `\/addy-review` first/);
  assert.match(content, /rerun the Addy Verify workflow/i);
  assert.match(content, /\/addy-verify <plan-path>/);
  assert.match(content, /invalidate prior `\[x\] Verified` and `\[x\] Reviewed` evidence/);
  assert.match(content, /Rerun the Addy Review workflow/i);
  assert.match(content, /\/addy-review <plan-path>/);
  assert.match(content, /Do not merely print `\/addy-verify` or `\/addy-review` and stop/);
  assert.match(content, /Do not commit unless the user explicitly asks/);
});

test("auto prompt documents autonomous plan execution", async () => {
  const content = await readFile(join("prompts", "addy-auto.md"), "utf8");
  const readme = await readFile("README.md", "utf8");
  const unblockDoc = await readFile(join("docs", "addy-auto-unblock-flow.md"), "utf8");

  assert.match(content, /`\/addy-auto \[plan-path\]`/);
  assert.match(content, /`\/addy-auto stop`/);
  assert.match(content, /active plan/i);
  assert.match(content, /plan-selection rules/i);
  assert.match(content, /build.*verify.*review.*pass/i);
  assert.match(content, /may commit/i);
  assert.match(content, /addy-auto-unblock/);
  assert.match(content, /debugging-and-error-recovery/);
  assert.match(content, /Do not use unblock recovery to skip, weaken, or silently reinterpret acceptance criteria/i);
  assert.match(readme, /\/addy-auto/);
  assert.match(readme, /docs\/addy-auto-unblock-flow\.md/);
  assert.match(unblockDoc, /Autonomous recovery must not weaken the workflow/);
  assert.match(unblockDoc, /Missing artifacts are recoverable, not automatic blockers/);
  assert.match(unblockDoc, /must not invoke or perform `\/addy-verify` or `\/addy-review` inside the fix-all turn/);
});

test("auto prompt defines autonomous task loop boundaries", async () => {
  const content = await readFile(join("prompts", "addy-auto.md"), "utf8");

  assert.match(content, /repeat build.*verify.*review.*commit/i);
  assert.match(content, /re-read the active\/supplied plan after every phase/i);
  assert.match(content, /build owns `Implemented`, verify owns `Verified`, and review owns `Reviewed`/);
  assert.match(content, /forward-reference link/i);
  assert.match(content, /same-directory index/i);
  assert.match(content, /ordered slice filename/i);
  assert.match(content, /failed tests/i);
  assert.match(content, /typecheck/i);
  assert.match(content, /review blockers/i);
  assert.match(content, /5 review fix loops/i);
  assert.match(content, /Task commit policy/i);
  assert.match(content, /Do not call `ask_user_question` for this auto-task commit/i);
  assert.match(content, /expected git state/i);
  assert.match(content, /ambiguous-but-inferable next slices/i);
  assert.match(content, /unsafe, destructive, external, or genuinely undecidable/i);
});

test("stats prompt is read-only and prompts require completion stats", async () => {
  const stats = await readFile(join("prompts", "addy-stats.md"), "utf8");
  const auto = await readFile(join("prompts", "addy-auto.md"), "utf8");
  const finish = await readFile(join("prompts", "addy-finish.md"), "utf8");
  const review = await readFile(join("prompts", "addy-review.md"), "utf8");

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
  assert.match(finish, /If the user chooses `commit`[^\n]*cycle completion stats[^\n]*then say `Finished!`/);
  assert.match(finish, /Turns:/);
  assert.match(finish, /Review runs:/);
  assert.match(finish, /Issues:/);
  assert.match(review, /Critical:/);
  assert.match(review, /Important:/);
  assert.match(review, /Suggestion:/);
  assert.match(review, /machine-readable/i);
});

test("auto workflow end-to-end validation evidence is recorded", async () => {
  const assetTests = await readFile(join("tests", "validate-assets.test.ts"), "utf8");
  const monitorTests = await readFile(join("tests", "workflow-monitor.test.ts"), "utf8");
  const trackerTests = await readFile(join("tests", "workflow-tracker.test.ts"), "utf8");
  const plan = await readFile(join("docs", "plans", "2026-05-12-addy-auto-command.md"), "utf8");

  assert.match(assetTests, /auto prompt documents autonomous plan execution/);
  assert.match(trackerTests, /auto mode toggles without changing lifecycle phase/);
  assert.match(monitorTests, /auto mode input preserves plan and task progress while toggling footer label/);
  assert.match(monitorTests, /auto loop commits a completed reviewed task before moving to the next task/);
  assert.match(plan, /Manual smoke notes/i);
  assert.match(plan, /Final report checklist/i);
});

test("required lifecycle skills exist", async () => {
  for (const skill of requiredSkills) {
    const content = await readFile(join("skills", skill, "SKILL.md"), "utf8");
    assert.match(content, new RegExp(`name: ${skill}`));
  }
});

test("packaged agents are addy-prefixed and have no package or model frontmatter", async () => {
  const files = (await readdir("agents")).filter((file) => file.endsWith(".md"));
  assert.deepEqual(files.sort(), agents.map((agent) => `${agent}.md`).sort());

  for (const file of files) {
    const content = await readFile(join("agents", file), "utf8");
    const expectedName = file.replace(/\.md$/, "");
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, `${file} has YAML frontmatter`);
    const names = frontmatter[1].match(/^name:\s*(.+)$/gm) ?? [];
    assert.deepEqual(names, [`name: ${expectedName}`]);
    assert.doesNotMatch(content, /^name: (planner|implementer|reviewer|spec-reviewer|release-manager|code-reviewer|security-auditor|test-engineer)$/m);
    assert.doesNotMatch(content, /^package:/m);
    assert.doesNotMatch(content, /^model:/m);
  }
});

test("prompts and skills avoid stale local/package references and generic agent calls", async () => {
  const checkedDirs = ["prompts", "skills"];
  const forbidden = [/~\/\.pi\/agent/, /\.claude/, /\/plugin/, /pi-superpowers/];

  for (const dir of checkedDirs) {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const path = join(entry.parentPath, entry.name);
      const content = await readFile(path, "utf8");
      for (const pattern of forbidden) assert.doesNotMatch(content, pattern, path);
      assert.doesNotMatch(content, /`(planner|implementer|reviewer|spec-reviewer|release-manager|code-reviewer|security-auditor|test-engineer)`/, path);
    }
  }
});

test("package entrypoints import", async () => {
  await import("../extensions/bootstrap.ts");
  await import("../extensions/agent-installer.ts");
  await import("../extensions/workflow-monitor.ts");
});
