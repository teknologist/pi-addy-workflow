#!/usr/bin/env -S node --experimental-strip-types
import { startAddyDashboard } from '../extensions/workflow-monitor/dashboard-server.ts';

function valueAfter(flag: string, args: string[]): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const portValue = valueAfter('--port', args) ?? valueAfter('-p', args);
const host =
  valueAfter('--host', args) ??
  valueAfter('-h', args) ??
  (args.includes('--public') ? '0.0.0.0' : undefined);
const stateDir = valueAfter('--state-dir', args);
const projectPath = valueAfter('--project-path', args);

if (args.includes('--help')) {
  console.log(`Usage: addy-dashboard [--port 3848] [--host 127.0.0.1] [--public] [--project-path PATH] [--state-dir PATH]

Shows the current Addy auto active plan from the current directory, or --project-path when supplied.
Use --public as shorthand for --host 0.0.0.0.
`);
  process.exit(0);
}

if (portValue !== undefined && !Number.isFinite(Number(portValue))) {
  console.error(`addy-dashboard: invalid --port "${portValue}"`);
  process.exit(2);
}

if (args.includes('--project-path') && !projectPath) {
  console.error('addy-dashboard: --project-path requires a path');
  process.exit(2);
}

startAddyDashboard({
  cwd: projectPath,
  host,
  port: portValue ? Number(portValue) : undefined,
  stateDir,
});
