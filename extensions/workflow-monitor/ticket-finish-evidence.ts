import type {
  TicketCommitEvidence,
  TicketTerminalEvidence,
} from './workflow-core.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => required.includes(key))
  );
}

function line(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\r\n]/.test(value)
  );
}

function timestamp(value: unknown): value is string {
  return (
    line(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function isTicketCommitEvidence(
  value: unknown,
): value is TicketCommitEvidence {
  if (!record(value) || !line(value.repository) || !timestamp(value.recordedAt))
    return false;
  if (value.result === 'committed')
    return (
      exactKeys(value, ['repository', 'result', 'commitSha', 'recordedAt']) &&
      typeof value.commitSha === 'string' &&
      /^[0-9a-f]{7,40}$/i.test(value.commitSha)
    );
  return (
    value.result === 'no-changes' &&
    exactKeys(value, ['repository', 'result', 'recordedAt'])
  );
}

export function sameTicketCommitEvidence(
  left: TicketCommitEvidence,
  right: TicketCommitEvidence,
): boolean {
  return (
    left.repository === right.repository &&
    left.result === right.result &&
    left.recordedAt === right.recordedAt &&
    (left.result === 'no-changes' ||
      (right.result === 'committed' && left.commitSha === right.commitSha))
  );
}

export function sameTicketCommitEvidenceList(
  left: readonly TicketCommitEvidence[] | undefined,
  right: readonly TicketCommitEvidence[] | undefined,
): boolean {
  return (
    left?.length === right?.length &&
    (left === undefined ||
      left.every((entry, index) =>
        sameTicketCommitEvidence(entry, right![index]),
      ))
  );
}

export function isTicketTerminalEvidence(
  value: unknown,
): value is TicketTerminalEvidence {
  return (
    record(value) &&
    exactKeys(value, ['state', 'confirmedAt']) &&
    (value.state === 'closed' ||
      value.state === 'completed' ||
      value.state === 'resolved') &&
    timestamp(value.confirmedAt)
  );
}
