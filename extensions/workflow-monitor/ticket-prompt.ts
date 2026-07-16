import { normalizeTicketRepositoryRequest } from './repository-scope.ts';
import type { TicketOperation, TicketRunState } from './workflow-core.ts';

export type TicketPromptRequest = {
  operation: TicketOperation;
  sourceKind?: TicketRunState['source']['kind'];
  ticketRef?: string;
  runId?: string;
  claimId?: string;
  staleClaimId?: string;
  repository?: string;
  repositoryRoot?: string;
  selector?: TicketRunState['queueSelector'];
  actionKey: string;
  attempt: number;
};

const INSTRUCTIONS: Record<TicketOperation, string> = {
  select:
    'Read-only: inspect the configured queue, classify every candidate, and select only one eligible child issue. You must not mutate tickets, claims, labels, comments, parents, or pull requests. Return the Queue result schema.',
  status:
    'Read-only: fetch and report the authoritative current ticket state, including an unclaimed ticket. You must not mutate tickets, claims, labels, comments, parents, or pull requests.',
  claim:
    'Claim only an eligible unclaimed child issue. Establish the native owner, then the exact claim identity, then remove the queue selector only after both ownership steps succeed. On retry, reconcile only those exact values.',
  release:
    'Release only the exact claim identity supplied above. Remove its claim marker and native owner without changing unrelated ownership or ticket fields.',
  reclaim:
    'Reclaim only with authoritative stale ownership evidence. Replace the stale claim identity with the exact supplied claim identity; never take a live or ambiguous claim.',
  'add-repository':
    'Record a request for approval of the exact repository. This operation must not expand repository scope or perform work in that repository.',
  'repository-scope-approval':
    'Apply explicit approval for the exact repository requested, and only then expand repository scope. Preserve every already-approved repository.',
  build:
    'BUILD owns only acceptance criteria and Implemented. A successful result must set Implemented true.',
  simplify: 'SIMPLIFY changes no lifecycle status.',
  verify:
    'VERIFY owns only Verified. A successful result must set Verified true.',
  review:
    'REVIEW owns only Reviewed and returns a structured clean/findings disposition. Set Reviewed true only for clean.',
  'fix-all': 'FIX-ALL changes no lifecycle status.',
  finish:
    'FINISH changes no lifecycle status. Complete only when lifecycle is complete and commit evidence contains exactly one unique commit for every approved repository, with no extras.',
};

const READ_ONLY = new Set<TicketOperation>(['select', 'status']);

export function buildTicketPrompt(request: TicketPromptRequest): string {
  if (
    request.operation === 'reclaim' &&
    (!request.staleClaimId ||
      !request.claimId ||
      request.staleClaimId === request.claimId)
  )
    throw new Error(
      'RECLAIM requires distinct stale and replacement claim identities.',
    );
  const repository = request.repository
    ? normalizeTicketRepositoryRequest(
        request.repository,
        request.repositoryRoot,
      )
    : undefined;
  const identity = [
    `Operation: ${request.operation}`,
    `Source kind: ${request.sourceKind ?? 'resolve from the configured guide'}`,
    `Ticket ref: ${request.ticketRef ?? 'queue selection'}`,
    ...(request.runId ? [`Run id: ${request.runId}`] : []),
    ...(request.claimId ? [`Claim id: ${request.claimId}`] : []),
    ...(request.staleClaimId
      ? [`Stale claim id: ${request.staleClaimId}`]
      : []),
    ...(repository ? [`Requested repository: ${repository}`] : []),
    ...(request.selector
      ? [`Queue selector: ${request.selector.kind}:${request.selector.value}`]
      : []),
    `Auto Action Key: ${request.actionKey}`,
    `Attempt: ${request.attempt}`,
  ].join('\n');
  const authority =
    'Reread docs/agents/issue-tracker.md as the sole authority for tracker mechanics and docs/agents/triage-labels.md for label mapping. Use only the configured tracker skill or tool; do not invent backend commands. Fetch authoritative state and do not mutate a parent ticket or pull request.';
  const mutation = READ_ONLY.has(request.operation)
    ? ''
    : `\n\nBefore writing, refetch the authoritative ticket and perform a targeted merge against its current revision. Preserve unrelated edits; stop on a missing, changed, or ambiguous target. Add one idempotent Ticket Activity entry marked ${request.actionKey}:${request.attempt}. After writing, perform a post-write authoritative fetch. Reconcile only this exact operation, action, and attempt.`;
  const result =
    'End with exactly one hidden JSON result envelope using the versioned Queue or Ticket schema: <!-- ADDY-TICKET-RESULT {JSON} -->. Every Ticket result must include the authoritative claim snapshot or null from the final fetch. Include only orchestration evidence; never include bodies, comments, prompts, logs, tokens, secrets, or credentials.';

  return `${identity}\n\n${authority}\n\n${INSTRUCTIONS[request.operation]}${mutation}\n\nThere is no lifecycle skip or ship path in Ticket mode. Narrative prose is not completion evidence.\n\n${result}`;
}
