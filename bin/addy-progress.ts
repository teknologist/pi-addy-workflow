#!/usr/bin/env -S node --experimental-strip-types
import { readSync } from 'node:fs';
import {
  finishExternalProgress,
  startExternalProgress,
  updateExternalProgress,
  type ExternalProgressSource,
  type ExternalProgressPatch,
} from '../extensions/workflow-monitor/external-progress.ts';

const USAGE = `Usage:
  addy-progress start --cwd PATH --source SOURCE
  addy-progress update --cwd PATH --source SOURCE --run UUID --stdin
  addy-progress finish --cwd PATH --source SOURCE --run UUID --stdin

SOURCE is df-implement-issues or implement-from-issues.
update and finish read one JSON object from stdin.
`;

function parseArgs(args: string[]): {
  command: string;
  cwd?: string;
  source?: string;
  runId?: string;
  stdin: boolean;
} {
  const command = args[0] ?? '';
  const result: {
    command: string;
    cwd?: string;
    source?: string;
    runId?: string;
    stdin: boolean;
  } = { command, stdin: false };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--stdin') {
      result.stdin = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--'))
      throw new Error(`${arg} requires a value`);
    if (arg === '--cwd') result.cwd = value;
    else if (arg === '--source') result.source = value;
    else if (arg === '--run') result.runId = value;
    else throw new Error(`unknown option: ${arg}`);
    index += 1;
  }
  return result;
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function readStdinObject(): Record<string, unknown> {
  const limit = 16 * 1024;
  const input = Buffer.alloc(limit + 1);
  let bytesRead = 0;
  while (bytesRead < input.length) {
    const count = readSync(0, input, bytesRead, input.length - bytesRead, null);
    if (count === 0) break;
    bytesRead += count;
  }
  if (bytesRead > limit) throw new Error('stdin payload is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.subarray(0, bytesRead).toString('utf8'));
  } catch {
    throw new Error('stdin must contain valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('stdin JSON must be an object');
  return parsed as Record<string, unknown>;
}

function main(args: string[]): void {
  if (args.includes('--help') || args[0] === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  const parsed = parseArgs(args);
  if (!['start', 'update', 'finish'].includes(parsed.command))
    throw new Error(`unknown command: ${parsed.command || '(missing)'}`);
  const cwd = required(parsed.cwd, '--cwd');
  const source = required(parsed.source, '--source') as ExternalProgressSource;

  if (parsed.command === 'start') {
    if (parsed.stdin || parsed.runId)
      throw new Error('start accepts only --cwd and --source');
    const snapshot = startExternalProgress({ cwd, source });
    process.stdout.write(`${snapshot.runId}\n`);
    return;
  }

  const runId = required(parsed.runId, '--run');
  if (!parsed.stdin) throw new Error('--stdin is required');
  const payload = readStdinObject();
  if (parsed.command === 'update') {
    updateExternalProgress({
      cwd,
      source,
      runId,
      patch: payload as ExternalProgressPatch,
    });
    return;
  }

  const { status, ...patch } = payload;
  if (status !== 'completed' && status !== 'failed')
    throw new Error('finish status must be completed or failed');
  finishExternalProgress({ cwd, source, runId, status, patch });
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`addy-progress: ${message}\n`);
  process.exitCode = 2;
}
