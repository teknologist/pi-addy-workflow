import type { WorkflowState } from './workflow-core.ts';
import { coerceWorkflowState } from './workflow-state-coercer.ts';
import { normalizeWorkflowState } from './workflow-state-normalizer.ts';

export type WorkflowStateEntry =
  | { type?: string; customType?: string; data?: unknown }
  | [string, unknown];

export const WORKFLOW_STATE_ENTRY_TYPE = 'pi-addy-workflow-state';

export function serializeWorkflowState(state: WorkflowState): string {
  return JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state });
}

export function parsePersistedWorkflowState(
  value: unknown,
): WorkflowState | undefined {
  const directState = coerceWorkflowState(value);
  if (directState) return normalizeWorkflowState(directState);

  if (typeof value !== 'string') return undefined;

  try {
    const parsed = JSON.parse(value);
    const parsedState =
      parsed?.type === WORKFLOW_STATE_ENTRY_TYPE
        ? coerceWorkflowState(parsed.state)
        : coerceWorkflowState(parsed);
    if (parsedState) return normalizeWorkflowState(parsedState);
  } catch {
    return undefined;
  }

  return undefined;
}

export function workflowStateFromEntry(
  entry: WorkflowStateEntry,
): WorkflowState | undefined {
  if (Array.isArray(entry)) {
    const [type, data] = entry;
    return type === WORKFLOW_STATE_ENTRY_TYPE
      ? parsePersistedWorkflowState(data)
      : undefined;
  }

  if (typeof entry !== 'object' || entry === null) return undefined;

  if (entry.type === 'custom' && entry.customType === WORKFLOW_STATE_ENTRY_TYPE)
    return parsePersistedWorkflowState(entry.data);
  if (entry.type === WORKFLOW_STATE_ENTRY_TYPE)
    return parsePersistedWorkflowState(entry.data);

  return undefined;
}
