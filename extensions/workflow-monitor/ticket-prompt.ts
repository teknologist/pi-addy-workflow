import { normalizeTicketRepositoryRequest } from './repository-scope.ts';
import type {
  TicketCommitEvidence,
  TicketOperation,
  TicketRunState,
} from './workflow-core.ts';

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
  manual?: boolean;
  pendingClarification?: TicketRunState['pendingClarification'];
  repositoryScope?: string[];
  commitEvidence?: TicketCommitEvidence[];
  finishStage?: NonNullable<
    TicketRunState['lastValidatedResult']
  >['finishStage'];
  finishActivityKind?: NonNullable<
    TicketRunState['lastValidatedResult']
  >['finishActivityKind'];
  actionKey: string;
  attempt: number;
};

const INSTRUCTIONS: Record<TicketOperation, string> = {
  select:
    'Read-only: inspect the configured queue, classify every candidate, and select only one eligible child issue. You must not mutate tickets, claims, labels, comments, parents, or pull requests. Return the Queue result schema.',
  status:
    'Read-only: fetch and report the authoritative current ticket state, including an unclaimed ticket. You must not mutate tickets, claims, labels, comments, parents, or pull requests.',
  claim:
    'Claim only an eligible unclaimed child issue. Use these retry-safe stages in order: native ownership; normalized repository scope in the managed block with the exact claim identity; remove the originating selector only after native ownership and the matching managed block exist; final authoritative refetch. Reuse this action marker and resume only missing stages. Reconcile a fully completed post-state without duplicate writes or Activity. Stop for manual repair on native ownership without matching Addy identity, selector removal without recoverable claim identity, or any conflicting owner/block. Repository scope uses Repository scope, Owner repo, and Companion repo with the existing plan path vocabulary, defaults to the current repository, is normalized and unique, and must be validated and locked before claim completion or any code edit.',
  release:
    'Release only the exact claim identity supplied above. Remove its managed claim and exact native ownership without changing unrelated ownership or ticket fields. Restore the originating queue selector only when it is recorded in the managed block; a direct unlabeled Ticket must remain unlabeled and you must not invent a selector.',
  reclaim:
    'Reclaim only with authoritative stale ownership evidence. Perform a direct ownership transfer that replaces the stale native/managed claim identity with the exact supplied replacement claim identity. Never take a live or ambiguous claim, remove/restore a selector, or change queue state. Never requeue the Ticket between owners.',
  'add-repository':
    'Treat this command as explicit user approval for the exact normalized repository. Validate it, append it once to the locked managed repository scope, and post Activity before any edit or work in that repository. Preserve every already-approved repository; rejection leaves scope unchanged.',
  'repository-scope-approval':
    'Apply the persisted explicit approval for the exact repository requested after normalization. Validate it, append it once to locked scope, and post Activity before any edit there. Preserve every already-approved repository.',
  build:
    'BUILD owns only acceptance criteria and Implemented. Patch only the exact acceptance criteria it completed with targeted merges; a partial failure may preserve newly completed criteria but must leave Implemented false. Set Implemented true only when every required acceptance criterion is checked and BUILD-owned targeted checks pass. The managed repository scope must already be locked before any code edit; if another repository is required, stop for explicit add-repository approval before touching it.',
  simplify:
    'SIMPLIFY is manual-only and allowed only after BUILD and before VERIFY. SIMPLIFY changes no lifecycle status or acceptance criterion and posts only its idempotent Activity.',
  verify:
    'VERIFY owns only Verified. It must not change acceptance criteria, Implemented, or Reviewed. A successful result must set Verified true.',
  review:
    'REVIEW owns only Reviewed and returns a structured clean/findings disposition. It must not review or mutate when Implemented or Verified is missing. Comment every finding and keep Reviewed false for findings; set Reviewed true only for clean.',
  'fix-all':
    'FIX-ALL is allowed only after REVIEW findings. FIX-ALL changes no lifecycle status or acceptance criterion, records each targeted fix, and requires VERIFY then REVIEW again.',
  finish:
    'FINISH changes no lifecycle status. Refetch and confirm every acceptance criterion, Implemented, Verified, Reviewed, the exact claim, and locked scope before committing. Inspect each locked repository and record exactly one confirmed result: committed with a valid SHA and timestamp, or explicit no-changes with a timestamp. Reject missing, duplicate, unknown, malformed, failed, or unconfirmed evidence; post a bounded failure Activity for partial repository results without transitioning. Classify FINISH Activity as failure or final in both kind and content; on recovery, update or replace the failure Activity under this same idempotent action marker with confirmed final Activity, because failure Activity never authorizes closure. Then post the idempotent final Activity before the configured terminal transition and perform a terminal refetch. Resume only missing stages—repository evidence, final Activity, terminal transition, terminal refetch—using this same action marker. Reconcile an already-terminal ticket only when claim and evidence match; otherwise stop for manual repair. Preserve the claim and evidence on every failure.',
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
  const scope = request.repositoryScope?.length
    ? [
        `Locked repository scope:`,
        ...request.repositoryScope.map((item) => `- ${item}`),
      ]
    : [];
  const evidenceRepositories = new Set(
    request.commitEvidence?.map((entry) => entry.repository),
  );
  const missingRepositories =
    request.repositoryScope?.filter(
      (repository) => !evidenceRepositories.has(repository),
    ) ?? [];
  const repositoryEvidenceComplete =
    request.repositoryScope !== undefined &&
    request.commitEvidence !== undefined &&
    request.repositoryScope.length === request.commitEvidence.length &&
    evidenceRepositories.size === request.commitEvidence.length &&
    missingRepositories.length === 0;
  const partialRepositoryEvidence =
    request.operation === 'finish' &&
    request.finishStage === 'repository-evidence' &&
    !repositoryEvidenceComplete;
  const finishFrontier =
    request.operation === 'finish' && request.finishStage
      ? [
          `Completed FINISH frontier: ${request.finishStage}`,
          `Confirmed repository evidence: ${JSON.stringify(request.commitEvidence ?? [])}`,
          ...(partialRepositoryEvidence
            ? [
                'Missing locked repositories:',
                ...missingRepositories.map((repository) => `- ${repository}`),
              ]
            : []),
          `Final Activity: ${request.finishActivityKind === 'final' ? 'confirmed' : 'not confirmed'}`,
          partialRepositoryEvidence
            ? 'Resume at repository evidence; preserve confirmed partial evidence and do not advance to final Activity until exact complete coverage is validated.'
            : `Resume at ${
                request.finishStage === 'repository-evidence'
                  ? 'final Activity'
                  : request.finishStage === 'final-activity'
                    ? 'terminal transition'
                    : request.finishStage === 'terminal-transition'
                      ? 'terminal refetch'
                      : 'terminal confirmation reconciliation'
              }; do not repeat or replace confirmed earlier stages.`,
        ]
      : [];
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
    ...scope,
    ...finishFrontier,
  ].join('\n');
  const authority =
    'Reread docs/agents/issue-tracker.md as the sole authority for tracker mechanics and docs/agents/triage-labels.md for label mapping. Use only the configured tracker skill or tool; do not invent backend commands. Fetch authoritative state and do not mutate a parent ticket or pull request.';
  const mutation = READ_ONLY.has(request.operation)
    ? ''
    : `\n\nBefore writing, refetch the authoritative ticket and perform a targeted merge against its current revision. Preserve unrelated edits; stop on a missing, changed, or ambiguous target. Add one idempotent Ticket Activity entry marked ${request.actionKey}:${request.attempt}. After writing, perform a post-write authoritative fetch. Reconcile only this exact operation, action, and attempt.`;
  const pendingClarification = request.pendingClarification
    ? `\n\nPending clarification: ${request.pendingClarification.kind}\nQuestion: ${request.pendingClarification.prompt}\nAsk this same bounded question. On an answer, apply that fact and return the same clarification with its resolution in the result envelope.`
    : '';
  const ambiguity = request.manual
    ? '\n\nIf required tracker routing or completion semantics are genuinely ambiguous, ask exactly one bounded ask_user question. If canceled, preserve the claim, return clarification as {kind, prompt} with a blocked result, and perform no mutation. On an answer, persist and apply the resolved operation fact, then return {kind, prompt, resolution} with the completed result.'
    : '';
  const result =
    'End with exactly one hidden JSON result envelope using the versioned Queue or Ticket schema: <!-- ADDY-TICKET-RESULT {JSON} -->. Every Ticket result must include the authoritative claim snapshot or null from the final fetch. Include only bounded orchestration evidence; never include ticket bodies, comments, narrative, logs, tokens, secrets, or credentials.';

  return `${identity}${pendingClarification}\n\n${authority}\n\n${INSTRUCTIONS[request.operation]}${mutation}${ambiguity}\n\nThere is no lifecycle skip or ship path in Ticket mode. Narrative prose is not completion evidence.\n\n${result}`;
}
