import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const prompts = ["addy-spec", "addy-plan", "addy-build", "addy-test", "addy-review", "addy-code-simplify", "addy-ship"];
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
