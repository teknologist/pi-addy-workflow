import type {
  WorkflowPlanStatsTarget,
  WorkflowTicketStatsTarget,
} from './workflow-stats.ts';
import { normalizeWorkflowStats } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

export function statsTargetFromTask(
  task: NonNullable<WorkflowState['stats']>['active']['tasks'][string],
): WorkflowPlanStatsTarget {
  return {
    plan: task.plan,
    taskId: task.taskId,
    sliceIndex: task.sliceIndex,
    taskIndex: task.taskIndex,
    taskTitle: task.taskTitle,
  };
}

export function latestActiveStatsTarget(
  state: WorkflowState,
): WorkflowPlanStatsTarget | undefined {
  const task = Object.values(state.stats?.active.tasks ?? {}).at(-1);
  if (!task) return undefined;
  return statsTargetFromTask(task);
}

export type TicketStatsTargetResolution =
  | { kind: 'resolved'; target: WorkflowTicketStatsTarget }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; sourceKinds: string[] };

export function resolveTicketStatsTarget(
  state: WorkflowState,
  ticketRef: string,
): TicketStatsTargetResolution {
  if (
    state.executionSource === 'ticket' &&
    state.ticketRun?.source.ref === ticketRef
  )
    return {
      kind: 'resolved',
      target: { kind: 'ticket', source: state.ticketRun.source },
    };

  const stats = normalizeWorkflowStats(state.stats);
  const sources = [stats.active, ...stats.history]
    .flatMap((session) => Object.values(session.tickets ?? {}))
    .map((ticket) => ticket.target.source)
    .filter((source) => source.ref === ticketRef);
  const sourceKinds = [...new Set(sources.map((source) => source.kind))].sort();
  if (sourceKinds.length === 0) return { kind: 'missing' };
  if (sourceKinds.length > 1) return { kind: 'ambiguous', sourceKinds };
  return {
    kind: 'resolved',
    target: { kind: 'ticket', source: sources[0] },
  };
}
