import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import addyDashboardInstaller from '../extensions/dashboard-installer.ts';
import {
  dashboardBinSource,
  dashboardShimUsage,
  ensureDashboardShim,
  ensureProgressShim,
  progressBinSource,
  launchDashboardCommand,
  planDashboardCommand,
} from '../extensions/dashboard-installer/core.ts';

const execFileAsync = promisify(execFile);

test('dashboard bin source resolves package bin path from extension URL', () => {
  const packageRoot = join(tmpdir(), 'addy dashboard package');
  const extensionUrl = pathToFileURL(
    join(packageRoot, 'extensions', 'dashboard-installer.ts'),
  ).href;

  assert.equal(
    dashboardBinSource(extensionUrl),
    join(packageRoot, 'bin', 'addy-dashboard.ts'),
  );
});

test('dashboard shim is written once, executable, and prepended to PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'addy-dashboard-shim-'));
  const binDir = join(root, 'bin');
  const packageRoot = join(root, 'package');
  const extensionUrl = pathToFileURL(
    join(packageRoot, 'extensions', 'dashboard-installer.ts'),
  ).href;
  const env = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;

  const first = await ensureDashboardShim(extensionUrl, { binDir, env });
  assert.equal(first.changed, true);
  assert.equal(first.pathUpdated, true);
  assert.equal(env.PATH?.startsWith(`${binDir}:`), true);
  const shim = await readFile(first.shimPath, 'utf8');
  assert.equal(shim.startsWith('#!/bin/sh\n'), true);
  assert.match(shim, /addy-dashboard\.ts/);
  assert.notEqual((await stat(first.shimPath)).mode & 0o111, 0);

  const second = await ensureDashboardShim(extensionUrl, { binDir, env });
  assert.equal(second.changed, false);
});

test('progress bin source resolves package bin path from extension URL', () => {
  const packageRoot = join(tmpdir(), 'addy progress package');
  const extensionUrl = pathToFileURL(
    join(packageRoot, 'extensions', 'dashboard-installer.ts'),
  ).href;

  assert.equal(
    progressBinSource(extensionUrl),
    join(packageRoot, 'bin', 'addy-progress.ts'),
  );
});

test('dashboard and progress shims install idempotently in one PATH directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'addy-runtime-shims-'));
  const binDir = join(root, 'bin');
  const packageRoot = join(root, 'package');
  const extensionUrl = pathToFileURL(
    join(packageRoot, 'extensions', 'dashboard-installer.ts'),
  ).href;
  const env = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;

  const [dashboard, progress] = await Promise.all([
    ensureDashboardShim(extensionUrl, { binDir, env }),
    ensureProgressShim(extensionUrl, { binDir, env }),
  ]);
  assert.equal(dashboard.changed, true);
  assert.equal(progress.changed, true);
  assert.equal(Number(dashboard.pathUpdated) + Number(progress.pathUpdated), 1);
  assert.equal(
    env.PATH?.split(':').filter((entry) => entry === binDir).length,
    1,
  );
  assert.match(
    await readFile(dashboard.shimPath, 'utf8'),
    /addy-dashboard\.ts/,
  );
  assert.match(await readFile(progress.shimPath, 'utf8'), /addy-progress\.ts/);
  assert.notEqual((await stat(progress.shimPath)).mode & 0o111, 0);

  assert.equal(
    (await ensureDashboardShim(extensionUrl, { binDir, env })).changed,
    false,
  );
  assert.equal(
    (await ensureProgressShim(extensionUrl, { binDir, env })).changed,
    false,
  );

  const concurrent = await Promise.all([
    ensureProgressShim(extensionUrl, { binDir, env }),
    ensureProgressShim(extensionUrl, { binDir, env }),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.changed),
    [false, false],
  );
});

test('dashboard shim executes directly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'addy-dashboard-shim-exec-'));
  const binDir = join(root, 'bin');
  const packageRoot = join(root, 'package');
  const sourcePath = join(packageRoot, 'bin', 'addy-dashboard.ts');
  const extensionUrl = pathToFileURL(
    join(packageRoot, 'extensions', 'dashboard-installer.ts'),
  ).href;

  await mkdir(join(packageRoot, 'bin'), { recursive: true });
  await writeFile(sourcePath, 'console.log(`dashboard shim ok`);\n', 'utf8');

  const result = await ensureDashboardShim(extensionUrl, { binDir });
  const { stdout } = await execFileAsync(result.shimPath, []);

  assert.equal(stdout.trim(), 'dashboard shim ok');
});

test('progress shim executes TypeScript directly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'addy-progress-shim-exec-'));
  const binDir = join(root, 'bin');
  const packageRoot = join(root, 'package-$HOME-literal');
  const sourcePath = join(packageRoot, 'bin', 'addy-progress.ts');
  const extensionUrl = pathToFileURL(
    join(packageRoot, 'extensions', 'dashboard-installer.ts'),
  ).href;

  await mkdir(join(packageRoot, 'bin'), { recursive: true });
  await writeFile(
    sourcePath,
    'const message: string = `progress shim ok`; console.log(message);\n',
    'utf8',
  );

  const result = await ensureProgressShim(extensionUrl, { binDir });
  const { stdout } = await execFileAsync(result.shimPath, []);
  assert.equal(stdout.trim(), 'progress shim ok');
});

test('progress installer refuses foreign files and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'addy-progress-foreign-'));
  const binDir = join(root, 'bin');
  const packageRoot = join(root, 'package');
  const extensionUrl = pathToFileURL(
    join(packageRoot, 'extensions', 'dashboard-installer.ts'),
  ).href;
  await mkdir(binDir);
  const shimPath = join(binDir, 'addy-progress');
  await writeFile(shimPath, 'user owned\n');
  await assert.rejects(
    ensureProgressShim(extensionUrl, { binDir }),
    /refusing to replace non-generated addy-progress/,
  );
  assert.equal(await readFile(shimPath, 'utf8'), 'user owned\n');

  await rm(shimPath);
  const target = join(root, 'target');
  await writeFile(target, 'target data\n');
  await symlink(target, shimPath);
  await assert.rejects(
    ensureProgressShim(extensionUrl, { binDir }),
    /not a regular file/,
  );
  assert.equal(await readFile(target, 'utf8'), 'target data\n');
});

test('lifecycle readiness awaits both runtime shims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'addy-lifecycle-shims-'));
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  process.env.HOME = root;
  process.env.PATH = '/usr/bin';
  try {
    const handlers = new Map<
      string,
      (event: unknown, ctx: unknown) => unknown
    >();
    addyDashboardInstaller({
      registerCommand: () => {},
      on: (
        name: string,
        handler: (event: unknown, ctx: unknown) => unknown,
      ) => {
        handlers.set(name, handler);
      },
    } as never);
    await handlers.get('resources_discover')?.({}, {});
    const binDir = join(root, '.pi', 'agent', 'bin');
    assert.notEqual(
      (await stat(join(binDir, 'addy-dashboard'))).mode & 0o111,
      0,
    );
    assert.notEqual(
      (await stat(join(binDir, 'addy-progress'))).mode & 0o111,
      0,
    );
    assert.equal(process.env.PATH?.startsWith(`${binDir}:`), true);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test('lifecycle waits for progress shim when dashboard installation fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'addy-partial-shims-'));
  const binDir = join(root, '.pi', 'agent', 'bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, 'addy-dashboard'), 'user dashboard\n');
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  process.env.HOME = root;
  process.env.PATH = '/usr/bin';
  try {
    const notifications: string[] = [];
    const handlers = new Map<
      string,
      (event: unknown, ctx: unknown) => unknown
    >();
    addyDashboardInstaller({
      registerCommand: () => {},
      on: (
        name: string,
        handler: (event: unknown, ctx: unknown) => unknown,
      ) => {
        handlers.set(name, handler);
      },
    } as never);
    await handlers.get('resources_discover')?.(
      {},
      {
        ui: { notify: (message: string) => notifications.push(message) },
      },
    );
    assert.notEqual(
      (await stat(join(binDir, 'addy-progress'))).mode & 0o111,
      0,
    );
    assert.equal(
      await readFile(join(binDir, 'addy-dashboard'), 'utf8'),
      'user dashboard\n',
    );
    assert.equal(
      notifications.some((message) => /non-generated/.test(message)),
      true,
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test('dashboard shim usage tells users how to open the dashboard', () => {
  assert.match(
    dashboardShimUsage({
      shimPath: '/tmp/bin/addy-dashboard',
      binDir: '/tmp/bin',
      changed: true,
      pathUpdated: true,
    }),
    /addy-dashboard --project-path "\$PWD"/,
  );
});

test('dashboard slash command defaults to current project and local URL', () => {
  assert.deepEqual(planDashboardCommand([], { cwd: '/repo' }), {
    serverArgs: ['--project-path', '/repo'],
    url: 'http://127.0.0.1:3848',
    public: false,
  });
});

test('dashboard slash command --public binds host 0.0.0.0', () => {
  assert.deepEqual(
    planDashboardCommand(['--public', '--port', '4000'], { cwd: '/repo' }),
    {
      serverArgs: [
        '--port',
        '4000',
        '--host',
        '0.0.0.0',
        '--project-path',
        '/repo',
      ],
      url: 'http://127.0.0.1:4000',
      public: true,
    },
  );
});

test('dashboard slash command launches server and browser opener', () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const fakeSpawn = ((command: string, args: string[]) => {
    calls.push({ command, args });
    return { on() {}, unref() {} };
  }) as never;
  const packageRoot = join(tmpdir(), 'addy dashboard package');
  const extensionUrl = pathToFileURL(
    join(packageRoot, 'extensions', 'dashboard-installer.ts'),
  ).href;

  launchDashboardCommand(extensionUrl, ['--public'], {
    cwd: '/repo',
    spawnProcess: fakeSpawn,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [
    '--experimental-strip-types',
    join(packageRoot, 'bin', 'addy-dashboard.ts'),
    '--host',
    '0.0.0.0',
    '--project-path',
    '/repo',
  ]);
  assert.match(calls[1].args.join(' '), /http:\/\/127\.0\.0\.1:3848/);
});

test('dashboard installer registers addy-dashboard slash command', () => {
  const commands = new Map<string, { description?: string }>();

  addyDashboardInstaller({
    registerCommand: (name: string, command: { description?: string }) => {
      commands.set(name, command);
    },
    on: () => {},
  } as never);

  assert.match(commands.get('addy-dashboard')?.description ?? '', /--public/);
});
