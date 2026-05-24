import {
  WORKFLOW_STATE_ENTRY_TYPE,
  type WorkflowState,
} from './workflow-state.ts';
import { writeWorkflowMemoryStates } from './workflow-state-memory-store.ts';
import { writeStoredWorkflowState } from './workflow-state-store-persistence.ts';
import {
  projectWorkflowStateKey,
  workflowStateKey,
  type WorkflowStateScopeContext,
} from './workflow-state-store-scope.ts';

export type WorkflowStateCommitContext = WorkflowStateScopeContext & {
  state?: WorkflowState;
};

export type AppendEntry = (type: string, data: unknown) => void;

export function commitWorkflowState(
  ctx: WorkflowStateCommitContext,
  state: WorkflowState,
  appendEntry?: AppendEntry,
): void {
  ctx.state = state;
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  writeWorkflowMemoryStates([key, projectKey], state);
  writeStoredWorkflowState(key, state, ctx);
  writeStoredWorkflowState(projectKey, state, ctx);
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
}
