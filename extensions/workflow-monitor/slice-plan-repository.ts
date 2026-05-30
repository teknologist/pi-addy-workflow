import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolveWorkflowPlanPath } from './workflow-plan-path.ts';

export type SlicePlanRepository = {
  isFile(path: string): boolean;
  listFiles(directory: string): string[] | undefined;
  readMarkdown(planPath: string, baseCwd?: string): string | undefined;
};

function nodePathIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export const nodeSlicePlanRepository: SlicePlanRepository = {
  isFile: nodePathIsFile,
  listFiles(directory) {
    try {
      return readdirSync(directory);
    } catch {
      return undefined;
    }
  },
  readMarkdown(planPath, baseCwd) {
    try {
      const resolved = resolveWorkflowPlanPath(planPath, baseCwd);
      if (!nodePathIsFile(resolved)) return undefined;
      return readFileSync(resolved, 'utf8');
    } catch {
      return undefined;
    }
  },
};
