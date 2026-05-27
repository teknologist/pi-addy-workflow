import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import {
  dashboardBinSource,
  dashboardShimUsage,
  ensureDashboardShim,
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
