import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type WorkflowStateScopeContext = {
  cwd?: string;
  sessionId?: string;
  conversationId?: string;
  id?: string;
};

function hashScope(scope: string): string {
  return createHash('sha256').update(scope).digest('hex').slice(0, 24);
}

function projectScope(ctx?: Pick<WorkflowStateScopeContext, 'cwd'>): string {
  return (
    [ctx?.cwd, process.cwd()].find(
      (value) => typeof value === 'string' && value.length > 0,
    ) ?? 'default'
  );
}

export function workflowStateKey(ctx: WorkflowStateScopeContext): string {
  const explicitSessionScope = [ctx.sessionId, ctx.conversationId, ctx.id].find(
    (value) => typeof value === 'string' && value.length > 0,
  );
  const scope = explicitSessionScope ?? `${process.pid}:${projectScope(ctx)}`;
  return hashScope(scope);
}

export function projectWorkflowStateKey(
  ctx: WorkflowStateScopeContext,
): string {
  return hashScope(`project:${projectScope(ctx)}`);
}

export function workflowStateDir(ctx?: WorkflowStateScopeContext): string {
  const scope = projectScope(ctx);
  return (
    process.env.PI_ADDY_WORKFLOW_STATE_DIR ??
    (scope
      ? join(scope, '.pi', 'addy-workflow', 'state')
      : join(homedir(), '.pi', 'agent', 'state', 'pi-addy-workflow'))
  );
}

export function workflowStatePath(
  key: string,
  ctx?: WorkflowStateScopeContext,
): string {
  return join(workflowStateDir(ctx), `${key}.json`);
}
