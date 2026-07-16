import type { TicketRunState } from './workflow-core.ts';

const MAX_TICKET_DISPLAY_LENGTH = 120;

export function boundedTicketDisplay(value: string): string {
  const safeText = value.replace(
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    '�',
  );
  return safeText.length > MAX_TICKET_DISPLAY_LENGTH
    ? `${safeText.slice(0, MAX_TICKET_DISPLAY_LENGTH)}…`
    : safeText;
}

export function ticketLifecycleFrontier(
  lifecycle: TicketRunState['lifecycle'],
): 'build' | 'verify' | 'review' | 'finish' {
  if (!lifecycle.implemented) return 'build';
  if (!lifecycle.verified) return 'verify';
  if (!lifecycle.reviewed) return 'review';
  return 'finish';
}
