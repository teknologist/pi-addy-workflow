import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { readExternalProgressProject } from '../extensions/workflow-monitor/external-progress.ts';

type EventHandler = (event: any, ctx: any) => unknown;
type CommandHandler = (args: string, ctx: any) => unknown;

type FakeRuntime = {
  command: (args: string) => Promise<void>;
  emit: (name: string, event: unknown) => Promise<void>;
  sentUserMessages: string[];
  sentMessages: Array<{ customType: string; content: string }>;
};

const ADDY_PROGRESS_BIN = join(process.cwd(), 'bin', 'addy-progress.ts');
const ISSUE_PROMPT = join(process.cwd(), 'prompts', 'implement-from-issues.md');
const AFK_EXTENSION = join(
  process.cwd(),
  'extensions',
  'implement-afk-issues',
  'index.ts',
);

function setup(): {
  cwd: string;
  homeDir: string;
  cleanup: () => void;
} {
  const cwd = mkdtempSync(join(tmpdir(), 'addy-issues-integration-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'addy-issues-home-'));
  writeFileSync(join(cwd, 'README.md'), 'fixture\n');
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {
    cwd,
    stdio: 'ignore',
  });
  execFileSync('git', ['config', 'user.name', 'Fixture'], {
    cwd,
    stdio: 'ignore',
  });
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'],
    { cwd, stdio: 'ignore' },
  );
  mkdirSync(join(homeDir, '.pi', 'agent', 'prompts'), { recursive: true });
  writeFileSync(
    join(homeDir, '.pi', 'agent', 'prompts', 'implement-from-issues.md'),
    readFileSync(ISSUE_PROMPT, 'utf8'),
  );
  return {
    cwd,
    homeDir,
    cleanup: () => {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

function runProgress(
  fixture: { cwd: string; homeDir: string },
  command: 'start' | 'update' | 'finish',
  runId?: string,
  payload?: Record<string, unknown>,
) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      ADDY_PROGRESS_BIN,
      command,
      '--cwd',
      fixture.cwd,
      '--source',
      'implement-from-issues',
      ...(runId === undefined ? [] : ['--run', runId, '--stdin']),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, HOME: fixture.homeDir },
      input: payload === undefined ? undefined : JSON.stringify(payload),
    },
  );
}

async function loadRealAfkRuntime(
  homeDir: string,
  cacheKey: string,
): Promise<FakeRuntime> {
  const previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  let extension: { default: (pi: any) => void };
  try {
    extension = (await import(
      `${pathToFileURL(AFK_EXTENSION).href}?test=${cacheKey}`
    )) as { default: (pi: any) => void };
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }

  const handlers = new Map<string, EventHandler>();
  const commands = new Map<string, CommandHandler>();
  const entries: Array<{ type: string; customType: string; data: unknown }> =
    [];
  const sentUserMessages: string[] = [];
  const sentMessages: Array<{ customType: string; content: string }> = [];
  const ctx = {
    sessionManager: { getEntries: () => entries },
    ui: {
      setStatus: () => undefined,
      notify: () => undefined,
    },
  };
  extension.default({
    on: (name: string, handler: EventHandler) => handlers.set(name, handler),
    registerCommand: (name: string, command: { handler: CommandHandler }) =>
      commands.set(name, command.handler),
    appendEntry: (customType: string, data: unknown) =>
      entries.push({ type: 'custom', customType, data }),
    sendUserMessage: (message: string) => sentUserMessages.push(message),
    sendMessage: (message: { customType: string; content: string }) =>
      sentMessages.push(message),
  });

  const sessionStart = handlers.get('session_start');
  assert.ok(sessionStart);
  await sessionStart({ reason: 'startup' }, ctx);
  const command = commands.get('implement-afk-issues');
  assert.ok(command);

  return {
    command: async (args) => {
      await command(args, ctx);
    },
    sentUserMessages,
    sentMessages,
    emit: async (name, event) => {
      const handler = handlers.get(name);
      assert.ok(handler, `registered ${name} handler`);
      await handler(event, ctx);
    },
  };
}

function assistantEvent(text: string) {
  return {
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

test('package-managed prompt and real AFK command reuse one progress UUID', async () => {
  const fixture = setup();
  try {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      pi: { extensions: string[]; prompts: string[] };
    };
    assert.ok(
      manifest.pi.extensions.includes(
        'extensions/implement-afk-issues/index.ts',
      ),
    );
    assert.deepEqual(manifest.pi.prompts, ['prompts']);

    const prompt = readFileSync(ISSUE_PROMPT, 'utf8');
    assert.match(
      prompt,
      /addy-progress start --cwd <absolute current working directory> --source implement-from-issues/,
    );

    const direct = runProgress(fixture, 'start');
    assert.equal(direct.status, 0, direct.stderr);
    const runId = direct.stdout.trim();

    const afk = await loadRealAfkRuntime(fixture.homeDir, 'continuity');
    await afk.command('label=fixture-issues');
    assert.deepEqual(afk.sentUserMessages, [
      '/implement-from-issues label=fixture-issues',
    ]);

    const initialAfkTurn = runProgress(fixture, 'start');
    assert.equal(initialAfkTurn.status, 0, initialAfkTurn.stderr);
    assert.equal(initialAfkTurn.stdout.trim(), runId);

    await afk.emit(
      'agent_end',
      assistantEvent(
        'Issue #5 queued.\nAFK-LOOP: CONTINUE issue=5 next="verify fixture"',
      ),
    );
    assert.match(
      afk.sentMessages.at(-1)?.content ?? '',
      /CONTINUE for issue 5: verify fixture/,
    );

    const wakeUp = runProgress(fixture, 'start');
    assert.equal(wakeUp.status, 0, wakeUp.stderr);
    assert.equal(wakeUp.stdout.trim(), runId);

    const project = readExternalProgressProject({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
    });
    assert.equal(project.snapshots.length, 1);
    assert.equal(project.snapshots[0]?.runId, runId);
  } finally {
    fixture.cleanup();
  }
});

test('real prompt contract and AFK path preserve markers and fail-open terminals', async () => {
  const fixture = setup();
  try {
    const prompt = readFileSync(ISSUE_PROMPT, 'utf8');
    assert.match(
      prompt,
      /AFK-LOOP: CONTINUE issue=<id-or-none> next="<next concrete action>"/,
    );
    assert.match(
      prompt,
      /AFK-LOOP: RUN-COMPLETE remaining=0 evidence="<tracker\/final-validation evidence>"/,
    );
    assert.match(
      prompt,
      /AFK-LOOP: LEGAL-STOP condition=<1-8> needs="<human input needed>"/,
    );
    assert.match(
      prompt,
      /Treat every `start` or `update` failure as a warning/,
    );
    assert.match(
      prompt,
      /For `finish`, retry exactly once; if it still fails, warn and continue/,
    );
    assert.match(
      prompt,
      /Never extract a token from `next`, `needs`, ordinary response text, tracker text, or any new marker field/,
    );

    const afk = await loadRealAfkRuntime(fixture.homeDir, 'fail-open');
    await afk.command('label=fixture-issues');

    const blockedHomeDir = join(fixture.homeDir, 'not-a-directory');
    writeFileSync(blockedHomeDir, 'fixture\n');
    const failingFixture = { ...fixture, homeDir: blockedHomeDir };
    const failedStart = runProgress(failingFixture, 'start');
    assert.notEqual(failedStart.status, 0);

    await afk.emit(
      'agent_end',
      assistantEvent(
        `Warning: ${failedStart.stderr.trim()}.\nAFK-LOOP: CONTINUE issue=5 next="continue implementation"`,
      ),
    );
    assert.match(
      afk.sentMessages.at(-1)?.content ?? '',
      /Take the next concrete action now/,
    );

    const runId = '11111111-1111-4111-8111-111111111111';
    const failedUpdate = runProgress(failingFixture, 'update', runId, {
      status: 'blocked',
      loopPhase: 'implementation',
      currentItem: 'issue #5',
    });
    assert.notEqual(failedUpdate.status, 0);

    await afk.emit(
      'agent_end',
      assistantEvent(
        `Warning: ${failedUpdate.stderr.trim()}.\nAFK-LOOP: CONTINUE issue=5 next="continue verification"`,
      ),
    );
    assert.match(
      afk.sentMessages.at(-1)?.content ?? '',
      /CONTINUE for issue 5: continue verification/,
    );

    const failedFinishPayload = {
      status: 'failed',
      loopPhase: 'implementation',
      currentItem: 'issue #5',
    };
    const firstFailedFinish = runProgress(
      failingFixture,
      'finish',
      runId,
      failedFinishPayload,
    );
    const secondFailedFinish = runProgress(
      failingFixture,
      'finish',
      runId,
      failedFinishPayload,
    );
    assert.notEqual(firstFailedFinish.status, 0);
    assert.equal(secondFailedFinish.status, firstFailedFinish.status);
    assert.equal(secondFailedFinish.stderr, firstFailedFinish.stderr);

    const messageCount = afk.sentMessages.length;
    await afk.emit(
      'agent_end',
      assistantEvent(
        `Warning: ${secondFailedFinish.stderr.trim()} after two finish attempts.\nAFK-LOOP: LEGAL-STOP condition=6 needs="tracker comments unavailable"`,
      ),
    );
    assert.equal(afk.sentMessages.length, messageCount + 1);
    assert.equal(
      afk.sentMessages.at(-1)?.content,
      'AFK issue run stopped legally (condition 6). Needs: tracker comments unavailable',
    );
  } finally {
    fixture.cleanup();
  }
});
