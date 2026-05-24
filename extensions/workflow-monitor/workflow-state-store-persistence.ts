import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  parsePersistedWorkflowState,
  serializeWorkflowState,
  type WorkflowState,
} from './workflow-state.ts';
import {
  workflowStateDir,
  workflowStatePath,
  type WorkflowStateScopeContext,
} from './workflow-state-store-scope.ts';

export function readStoredWorkflowState(
  key: string,
  ctx?: WorkflowStateScopeContext,
): WorkflowState | undefined {
  const path = workflowStatePath(key, ctx);
  if (!existsSync(path)) return undefined;

  try {
    return parsePersistedWorkflowState(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeStoredWorkflowState(
  key: string,
  state: WorkflowState,
  ctx?: WorkflowStateScopeContext,
): void {
  const path = workflowStatePath(key, ctx);
  try {
    mkdirSync(workflowStateDir(ctx), { recursive: true });
    writeFileSync(path, serializeWorkflowState(state), 'utf8');
  } catch {
    // Persistence is best-effort; in-memory/session state still drives the current turn.
  }
}
