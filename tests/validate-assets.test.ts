import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const prompts = ["addy-define", "addy-plan", "addy-build", "addy-code-simplify", "addy-verify", "addy-review", "addy-finish", "addy-ship"];
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
  "debugging-and-error-recovery",
  "code-review-and-quality",
  "code-simplification",
  "shipping-and-launch",
];

test("package manifest exposes Pi resources but not native agents", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.pi.extensions, ["extensions/bootstrap.ts", "extensions/agent-installer.ts", "extensions/workflow-monitor.ts"]);
  assert.equal(manifest.pi.agents, undefined);
  assert.ok(manifest.files.includes("agents/"));
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
  assert.match(finishPrompt, /ask_user_question.*bounded options/i);
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
