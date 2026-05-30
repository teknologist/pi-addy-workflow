import { statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export function resolveWorkflowPlanPath(
  planPath: string,
  baseCwd?: string,
): string {
  const filesystemPath = planPath.startsWith('@')
    ? planPath.slice(1)
    : planPath;
  return isAbsolute(filesystemPath)
    ? filesystemPath
    : resolve(baseCwd ?? process.cwd(), filesystemPath);
}

export function resolveWorkflowPlanPathRelativeTo(
  planPath: string,
  relativeTo: string,
  baseCwd?: string,
): string {
  const filesystemPath = planPath.startsWith('@')
    ? planPath.slice(1)
    : planPath;
  if (isAbsolute(filesystemPath)) return filesystemPath;

  const relativeCandidate = resolve(dirname(relativeTo), filesystemPath);
  try {
    statSync(relativeCandidate);
    return relativeCandidate;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    return resolveWorkflowPlanPath(planPath, baseCwd);
  }
}
