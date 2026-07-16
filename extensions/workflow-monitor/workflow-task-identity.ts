export type WorkflowTaskIdentity = {
  plan?: string;
  taskId?: string;
  sliceIndex?: number;
  taskIndex?: number;
  taskTitle?: string;
};

export type PlanTaskIdentity = WorkflowTaskIdentity & { source: 'plan' };

export type TicketSliceIdentity = {
  source: 'ticket';
  sourceKind?: 'github' | 'linear' | 'local';
  ticketRef: string;
  runId: string;
  claimId?: string;
  staleClaimId?: string;
  selector?: {
    kind: 'default' | 'label' | 'status';
    value: string;
  };
  repository?: string;
};

export type WorkflowSourceIdentity = PlanTaskIdentity | TicketSliceIdentity;

const TASK_ID_KEY_MARKER = 'task-id';
const TASK_KEY_SEPARATOR = '\u001f';

export function hasLegacyTaskIdentity(identity: WorkflowTaskIdentity): boolean {
  return identity.taskIndex !== undefined || identity.taskTitle !== undefined;
}

export function legacyTaskIdentityMatches(
  identity: WorkflowTaskIdentity,
  candidate: WorkflowTaskIdentity,
): boolean {
  if (!hasLegacyTaskIdentity(identity)) return true;
  return (
    (identity.taskIndex === undefined ||
      identity.taskIndex === candidate.taskIndex) &&
    (identity.taskTitle === undefined ||
      identity.taskTitle === candidate.taskTitle)
  );
}

export function taskIdForIdentity(
  identity: WorkflowTaskIdentity,
  candidates: WorkflowTaskIdentity[],
): string | undefined {
  if (identity.taskId) return identity.taskId;
  return candidates.find(
    (candidate) =>
      candidate.taskId && legacyTaskIdentityMatches(identity, candidate),
  )?.taskId;
}

export function taskIdentityKeyParts(identity: WorkflowTaskIdentity): string[] {
  return identity.taskId
    ? [TASK_ID_KEY_MARKER, identity.taskId]
    : [`${identity.taskIndex ?? ''}`, identity.taskTitle ?? ''];
}

export function workflowSourceIdentityKey(
  identity: WorkflowSourceIdentity,
): string {
  if (identity.source === 'ticket')
    return [
      'ticket',
      identity.sourceKind,
      identity.ticketRef,
      identity.runId,
      identity.claimId ?? '',
    ].join(TASK_KEY_SEPARATOR);
  return ['plan', workflowTaskIdentityKey(identity)].join(TASK_KEY_SEPARATOR);
}

export function workflowTaskIdentityKey(
  identity: WorkflowTaskIdentity,
  options: { includeSlice?: boolean } = {},
): string {
  const legacyParts = options.includeSlice
    ? [
        identity.sliceIndex ?? '',
        identity.taskIndex ?? '',
        identity.taskTitle ?? '',
      ]
    : [identity.taskIndex ?? '', identity.taskTitle ?? ''];
  const parts = identity.taskId
    ? [identity.plan ?? '', TASK_ID_KEY_MARKER, identity.taskId]
    : [identity.plan ?? '', ...legacyParts];
  return parts.join(TASK_KEY_SEPARATOR);
}
