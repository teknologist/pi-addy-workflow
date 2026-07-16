import {
  isTicketCommitEvidence,
  isTicketTerminalEvidence,
  sameTicketCommitEvidence,
} from './ticket-finish-evidence.ts';
import type {
  TicketCommitEvidence,
  TicketOperation,
  TicketRunState,
  TicketTerminalEvidence,
} from './workflow-core.ts';

const OUTCOMES = ['succeeded', 'reconciled', 'blocked', 'failed'] as const;
const SOURCE_KINDS = ['github', 'linear', 'local'] as const;
const TICKET_OPERATIONS = [
  'claim',
  'build',
  'simplify',
  'verify',
  'review',
  'fix-all',
  'finish',
  'status',
  'release',
  'reclaim',
  'add-repository',
  'repository-scope-approval',
] as const;
const TERMINAL_REASONS = [
  'selected',
  'configuration-ambiguous',
  'all-ineligible',
  'all-claimed',
  'all-blocked',
  'mixed',
  'empty',
] as const;
const MUTATING_OPERATIONS = new Set<TicketOperation>([
  'claim',
  'build',
  'simplify',
  'verify',
  'review',
  'fix-all',
  'finish',
  'release',
  'reclaim',
  'add-repository',
  'repository-scope-approval',
]);
const CLAIM_BOUND_OPERATIONS = new Set<TicketOperation>([
  ...MUTATING_OPERATIONS,
]);
const SENSITIVE_CONTENT = /\b(?:bearer|token|secret|password|api[_-]?key)\b/i;

export type TicketLifecycleSnapshot = {
  implemented: boolean;
  verified: boolean;
  reviewed: boolean;
};

type TicketSource = TicketRunState['source'];
type TicketClaimSnapshot = NonNullable<TicketRunState['claim']>;
type TicketOutcome = (typeof OUTCOMES)[number];
type QueueTerminalReason = (typeof TERMINAL_REASONS)[number];
type QueueCategory = { count: number; refs: string[] };

export type TicketQueueResult = {
  schemaVersion: 1;
  kind: 'ticket-queue-result';
  operation: 'select';
  outcome: TicketOutcome;
  actionKey: string;
  attempt: number;
  selector: {
    kind: 'default' | 'label' | 'status';
    value: string;
  };
  categories: {
    eligible: QueueCategory;
    blocked: QueueCategory;
    claimed: QueueCategory;
    ineligible: QueueCategory;
    ambiguous: QueueCategory;
  };
  selected?: { source: TicketSource };
  terminalReason: QueueTerminalReason;
};

export type TicketReviewDisposition =
  | { status: 'clean' }
  | { status: 'findings'; count: number };

export type TicketClarificationResult = NonNullable<
  TicketRunState['pendingClarification']
>;

export type TicketPhaseResult = {
  schemaVersion: 1;
  kind: 'ticket-phase-result';
  operation: Exclude<TicketOperation, 'select'>;
  outcome: TicketOutcome;
  source: TicketSource;
  runId?: string;
  claimId?: string;
  staleClaimId?: string;
  claim: TicketClaimSnapshot | null;
  actionKey: string;
  attempt: number;
  postRevision: string;
  lifecycle: TicketLifecycleSnapshot;
  activity?: {
    marker: string;
    id?: string;
    kind?: 'failure' | 'final';
  };
  repositoryScope: string[];
  repository?: string;
  reviewDisposition?: TicketReviewDisposition;
  commitEvidence?: TicketCommitEvidence[];
  finishStage?:
    | 'repository-evidence'
    | 'final-activity'
    | 'terminal-transition'
    | 'terminal-refetch';
  terminal?: TicketTerminalEvidence;
  clarification?: TicketClarificationResult;
};

export type TicketResult = TicketQueueResult | TicketPhaseResult;

export type TicketResultExpectation = {
  operation: TicketOperation;
  actionKey: string;
  attempt: number;
  source?: TicketSource;
  sourceKind?: TicketSource['kind'];
  ticketRef?: string;
  runId?: string;
  claimId?: string;
  staleClaimId?: string;
  claim?: TicketClaimSnapshot | null;
  outcome?: TicketOutcome;
  previousLifecycle?: TicketLifecycleSnapshot;
  previousRepositoryScope?: string[];
  initialRepositoryScope?: string[];
  selector?: TicketQueueResult['selector'];
  repository?: string;
  manual?: boolean;
  pendingClarification?: TicketClarificationResult;
  previousCommitEvidence?: TicketCommitEvidence[];
  previousFinishStage?: TicketPhaseResult['finishStage'];
  previousFinishActivityKind?: NonNullable<
    TicketPhaseResult['activity']
  >['kind'];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function safeString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\r\n]/.test(value) &&
    !SENSITIVE_CONTENT.test(value)
  );
}

function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function safeAttempt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseSource(value: unknown): TicketSource {
  if (
    !record(value) ||
    !exactKeys(value, ['kind', 'ref']) ||
    !oneOf(value.kind, SOURCE_KINDS) ||
    !safeString(value.ref)
  )
    throw new Error('Ticket result source is malformed.');
  return value as TicketSource;
}

function sameClaim(
  left: TicketClaimSnapshot | null,
  right: TicketClaimSnapshot | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.id === right.id &&
      left.owner === right.owner &&
      left.claimedAt === right.claimedAt)
  );
}

function parseClaim(value: unknown): TicketClaimSnapshot | null {
  if (value === null) return null;
  if (
    !record(value) ||
    !exactKeys(value, ['id', 'owner', 'claimedAt']) ||
    !safeString(value.id) ||
    !safeString(value.owner) ||
    !safeString(value.claimedAt)
  )
    throw new Error('Ticket result claim snapshot is malformed.');
  return value as TicketClaimSnapshot;
}

function parseLifecycle(value: unknown): TicketLifecycleSnapshot {
  if (
    !record(value) ||
    !exactKeys(value, ['implemented', 'verified', 'reviewed']) ||
    typeof value.implemented !== 'boolean' ||
    typeof value.verified !== 'boolean' ||
    typeof value.reviewed !== 'boolean' ||
    (value.verified && !value.implemented) ||
    (value.reviewed && !value.verified)
  )
    throw new Error('Ticket result lifecycle is malformed.');
  return value as TicketLifecycleSnapshot;
}

function parseCategory(value: unknown): QueueCategory {
  if (
    !record(value) ||
    !exactKeys(value, ['count', 'refs']) ||
    !safeAttempt(value.count) ||
    !Array.isArray(value.refs) ||
    !value.refs.every(safeString) ||
    value.count !== value.refs.length ||
    new Set(value.refs).size !== value.refs.length
  )
    throw new Error('Ticket queue category is malformed.');
  return value as QueueCategory;
}

function derivedTerminalReason(
  categories: TicketQueueResult['categories'],
  selected: TicketQueueResult['selected'],
): QueueTerminalReason {
  if (selected) return 'selected';
  if (categories.eligible.count > 0)
    throw new Error('Ticket queue must select an eligible ticket.');
  if (categories.ambiguous.count > 0) return 'configuration-ambiguous';
  const nonempty = (['blocked', 'claimed', 'ineligible'] as const).filter(
    (key) => categories[key].count > 0,
  );
  if (nonempty.length === 0) return 'empty';
  if (nonempty.length > 1) return 'mixed';
  return `all-${nonempty[0]}` as QueueTerminalReason;
}

function parseQueueResult(value: Record<string, unknown>): TicketQueueResult {
  if (
    !exactKeys(
      value,
      [
        'schemaVersion',
        'kind',
        'operation',
        'outcome',
        'actionKey',
        'attempt',
        'selector',
        'categories',
        'terminalReason',
      ],
      ['selected'],
    ) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'ticket-queue-result' ||
    value.operation !== 'select' ||
    !oneOf(value.outcome, OUTCOMES) ||
    !safeString(value.actionKey) ||
    !safeAttempt(value.attempt) ||
    !record(value.selector) ||
    !exactKeys(value.selector, ['kind', 'value']) ||
    !oneOf(value.selector.kind, ['default', 'label', 'status'] as const) ||
    !safeString(value.selector.value) ||
    !record(value.categories) ||
    !exactKeys(value.categories, [
      'eligible',
      'blocked',
      'claimed',
      'ineligible',
      'ambiguous',
    ]) ||
    !oneOf(value.terminalReason, TERMINAL_REASONS)
  )
    throw new Error('Ticket Queue Result is malformed.');

  const categories = {
    eligible: parseCategory(value.categories.eligible),
    blocked: parseCategory(value.categories.blocked),
    claimed: parseCategory(value.categories.claimed),
    ineligible: parseCategory(value.categories.ineligible),
    ambiguous: parseCategory(value.categories.ambiguous),
  };
  const refs = Object.values(categories).flatMap((category) => category.refs);
  if (new Set(refs).size !== refs.length)
    throw new Error('Ticket queue refs must be unique across categories.');
  let selected: TicketQueueResult['selected'];
  if (value.selected !== undefined) {
    if (!record(value.selected) || !exactKeys(value.selected, ['source']))
      throw new Error('Ticket queue selection is malformed.');
    selected = { source: parseSource(value.selected.source) };
    if (!categories.eligible.refs.includes(selected.source.ref))
      throw new Error('Selected Ticket is not categorized as eligible.');
  }
  if (value.terminalReason !== derivedTerminalReason(categories, selected))
    throw new Error('Ticket queue terminal reason is inconsistent.');
  const successful =
    value.outcome === 'succeeded' || value.outcome === 'reconciled';
  if (selected && !successful)
    throw new Error('Selected Ticket requires a successful Queue outcome.');
  if (!selected && successful)
    throw new Error('Successful Ticket Queue result requires a selection.');
  return {
    ...(value as TicketQueueResult),
    categories,
    ...(selected ? { selected } : {}),
  };
}

function parseActivity(value: unknown): TicketPhaseResult['activity'] {
  if (
    !record(value) ||
    !exactKeys(value, ['marker'], ['id', 'kind']) ||
    !safeString(value.marker) ||
    (value.id !== undefined && !safeString(value.id)) ||
    (value.kind !== undefined &&
      !oneOf(value.kind, ['failure', 'final'] as const))
  )
    throw new Error('Ticket activity evidence is malformed.');
  return value as TicketPhaseResult['activity'];
}

function parseReviewDisposition(value: unknown): TicketReviewDisposition {
  if (!record(value) || !safeString(value.status))
    throw new Error('Ticket review disposition is malformed.');
  if (value.status === 'clean' && exactKeys(value, ['status']))
    return value as TicketReviewDisposition;
  if (
    value.status === 'findings' &&
    exactKeys(value, ['status', 'count']) &&
    safeAttempt(value.count) &&
    value.count > 0
  )
    return value as TicketReviewDisposition;
  throw new Error('Ticket review disposition is malformed.');
}

function parseClarification(value: unknown): TicketClarificationResult {
  if (
    !record(value) ||
    !exactKeys(value, ['kind', 'prompt'], ['resolution']) ||
    !oneOf(value.kind, ['tracker-routing', 'completion-transition'] as const) ||
    !safeString(value.prompt) ||
    (value.resolution !== undefined && !safeString(value.resolution))
  )
    throw new Error('Ticket clarification is malformed.');
  return value as TicketClarificationResult;
}

function parseCommitEvidence(
  value: unknown,
): TicketPhaseResult['commitEvidence'] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(isTicketCommitEvidence)
  )
    throw new Error('Ticket commit evidence is malformed.');
  return value;
}

function parseTerminal(value: unknown): TicketTerminalEvidence {
  if (!isTicketTerminalEvidence(value))
    throw new Error('Ticket terminal confirmation is malformed.');
  return value;
}

function validateLifecycleTransition(
  operation: TicketOperation,
  outcome: TicketOutcome,
  previous: TicketLifecycleSnapshot | undefined,
  next: TicketLifecycleSnapshot,
): void {
  const succeeded = outcome === 'succeeded' || outcome === 'reconciled';
  const owner = succeeded
    ? operation === 'build'
      ? 'implemented'
      : operation === 'verify'
        ? 'verified'
        : operation === 'review'
          ? 'reviewed'
          : undefined
    : undefined;
  if (
    (operation === 'build' && succeeded && !next.implemented) ||
    (operation === 'verify' && succeeded && !next.verified)
  )
    throw new Error(
      `${operation} did not satisfy its lifecycle postcondition.`,
    );
  if (!previous) return;
  for (const key of ['implemented', 'verified', 'reviewed'] as const)
    if (
      (previous[key] && !next[key]) ||
      (key !== owner && previous[key] !== next[key])
    )
      throw new Error(`${operation} cannot change Ticket lifecycle ${key}.`);
}

function parseTicketResult(value: Record<string, unknown>): TicketPhaseResult {
  if (
    !exactKeys(
      value,
      [
        'schemaVersion',
        'kind',
        'operation',
        'outcome',
        'source',
        'claim',
        'actionKey',
        'attempt',
        'postRevision',
        'lifecycle',
        'repositoryScope',
      ],
      [
        'runId',
        'claimId',
        'staleClaimId',
        'activity',
        'repository',
        'reviewDisposition',
        'commitEvidence',
        'finishStage',
        'terminal',
        'clarification',
      ],
    ) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'ticket-phase-result' ||
    !oneOf(value.operation, TICKET_OPERATIONS) ||
    !oneOf(value.outcome, OUTCOMES) ||
    !safeString(value.actionKey) ||
    !safeAttempt(value.attempt) ||
    !safeString(value.postRevision) ||
    !Array.isArray(value.repositoryScope) ||
    value.repositoryScope.length === 0 ||
    !value.repositoryScope.every(safeString) ||
    new Set(value.repositoryScope).size !== value.repositoryScope.length
  )
    throw new Error('Ticket Phase Result is malformed.');

  const operation = value.operation as TicketOperation;
  const source = parseSource(value.source);
  const claim = parseClaim(value.claim);
  const lifecycle = parseLifecycle(value.lifecycle);
  const repository = value.repository;
  if (
    (operation === 'add-repository' ||
      operation === 'repository-scope-approval') !== safeString(repository)
  )
    throw new Error('Ticket repository request identity is malformed.');
  const runId = value.runId === undefined ? undefined : value.runId;
  const claimId = value.claimId === undefined ? undefined : value.claimId;
  const staleClaimId =
    value.staleClaimId === undefined ? undefined : value.staleClaimId;
  if (
    (runId !== undefined && !safeString(runId)) ||
    (claimId !== undefined && !safeString(claimId)) ||
    (operation === 'reclaim') !== safeString(staleClaimId) ||
    (operation === 'reclaim' && claimId === staleClaimId) ||
    (operation !== 'status' &&
      CLAIM_BOUND_OPERATIONS.has(operation) &&
      (!safeString(runId) || !safeString(claimId)))
  )
    throw new Error('Ticket result claim identity is malformed.');

  const successful =
    value.outcome === 'succeeded' || value.outcome === 'reconciled';
  if (
    successful &&
    CLAIM_BOUND_OPERATIONS.has(operation) &&
    operation !== 'release' &&
    (!claim || claim.id !== claimId)
  )
    throw new Error(
      `Successful ${operation} requires the exact claim snapshot.`,
    );
  if (successful && operation === 'release' && claim !== null)
    throw new Error('Successful release requires an unclaimed snapshot.');

  const successfulMutation = MUTATING_OPERATIONS.has(operation) && successful;
  const activity =
    value.activity === undefined ? undefined : parseActivity(value.activity);
  if (successfulMutation && !activity)
    throw new Error('Successful Ticket mutation requires Activity evidence.');
  if (operation !== 'finish' && activity?.kind)
    throw new Error('Only FINISH may classify Activity evidence.');

  const reviewDisposition =
    value.reviewDisposition === undefined
      ? undefined
      : parseReviewDisposition(value.reviewDisposition);
  if (
    operation === 'review' &&
    (value.outcome === 'succeeded' || value.outcome === 'reconciled') &&
    !reviewDisposition
  )
    throw new Error('Successful REVIEW requires structured disposition.');
  if (operation !== 'review' && reviewDisposition)
    throw new Error('Only REVIEW may return review disposition.');
  if (
    operation === 'review' &&
    (value.outcome === 'succeeded' || value.outcome === 'reconciled') &&
    (reviewDisposition?.status === 'clean'
      ? !lifecycle.reviewed
      : lifecycle.reviewed)
  )
    throw new Error(
      'REVIEW disposition conflicts with Reviewed lifecycle state.',
    );

  const clarification =
    value.clarification === undefined
      ? undefined
      : parseClarification(value.clarification);
  const clarificationResolved = clarification?.resolution !== undefined;
  if (
    clarification &&
    (clarificationResolved ? !successful : value.outcome !== 'blocked')
  )
    throw new Error('Ticket clarification conflicts with result outcome.');

  const commitEvidence =
    value.commitEvidence === undefined
      ? undefined
      : parseCommitEvidence(value.commitEvidence);
  const finishStage = oneOf(value.finishStage, [
    'repository-evidence',
    'final-activity',
    'terminal-transition',
    'terminal-refetch',
  ] as const)
    ? value.finishStage
    : undefined;
  const terminal =
    value.terminal === undefined ? undefined : parseTerminal(value.terminal);
  if (
    operation !== 'finish' &&
    (commitEvidence || value.finishStage !== undefined || terminal)
  )
    throw new Error('Only FINISH may return closure evidence.');
  if (operation === 'finish' && !finishStage)
    throw new Error('FINISH requires a staged result.');
  if (operation === 'finish' && commitEvidence) {
    const repositories = commitEvidence.map((entry) => entry.repository);
    if (
      new Set(repositories).size !== repositories.length ||
      repositories.some(
        (repository) =>
          !(value.repositoryScope as string[]).includes(repository),
      )
    )
      throw new Error('FINISH commit evidence does not match locked scope.');
  }
  if (operation === 'finish') {
    const stage = [
      'repository-evidence',
      'final-activity',
      'terminal-transition',
      'terminal-refetch',
    ].indexOf(finishStage!);
    const evidenceComplete =
      commitEvidence?.length === value.repositoryScope.length;
    if (
      stage >= 1 &&
      (!lifecycle.implemented ||
        !lifecycle.verified ||
        !lifecycle.reviewed ||
        !evidenceComplete ||
        !activity ||
        activity.kind !== 'final')
    )
      throw new Error('FINISH stages must complete in order.');
    if (
      stage === 0 &&
      (terminal ||
        activity?.kind === 'final' ||
        (!evidenceComplete && activity?.kind !== 'failure'))
    )
      throw new Error('FINISH stages must complete in order.');
  }
  if (operation === 'finish' && successfulMutation) {
    if (!lifecycle.implemented || !lifecycle.verified || !lifecycle.reviewed)
      throw new Error('Successful FINISH requires completed lifecycle.');
    if (!commitEvidence)
      throw new Error('Successful FINISH requires commit evidence.');
    if (activity?.kind !== 'final')
      throw new Error('Successful FINISH requires final Activity evidence.');
    if (finishStage !== 'terminal-refetch' || !terminal)
      throw new Error('Successful FINISH requires terminal confirmation.');
    const expectedTerminal =
      source.kind === 'github'
        ? 'closed'
        : source.kind === 'local'
          ? 'resolved'
          : 'completed';
    if (terminal.state !== expectedTerminal)
      throw new Error('FINISH terminal state does not match its source.');
    const evidenceRepositories = commitEvidence.map(
      (evidence) => evidence.repository,
    );
    if (
      new Set(evidenceRepositories).size !== evidenceRepositories.length ||
      evidenceRepositories.length !== value.repositoryScope.length ||
      !value.repositoryScope.every((repository) =>
        evidenceRepositories.includes(repository),
      )
    )
      throw new Error(
        'Successful FINISH requires exactly one commit per repository.',
      );
  }

  return {
    ...(value as TicketPhaseResult),
    source,
    claim,
    lifecycle,
    ...(activity ? { activity } : {}),
    ...(safeString(repository) ? { repository } : {}),
    ...(reviewDisposition ? { reviewDisposition } : {}),
    ...(commitEvidence ? { commitEvidence } : {}),
    ...(finishStage ? { finishStage } : {}),
    ...(terminal ? { terminal } : {}),
    ...(clarification ? { clarification } : {}),
  };
}

function assertExpectation(
  result: TicketResult,
  expected: TicketResultExpectation,
): void {
  const repositoryOperation =
    expected.operation === 'add-repository' ||
    expected.operation === 'repository-scope-approval';
  if (
    (expected.operation === 'select') !== (expected.selector !== undefined) ||
    repositoryOperation !== safeString(expected.repository) ||
    (expected.operation === 'reclaim') !== safeString(expected.staleClaimId) ||
    (expected.operation === 'reclaim' &&
      (!safeString(expected.claimId) ||
        expected.claimId === expected.staleClaimId))
  )
    throw new Error('Ticket result expectation identity is malformed.');
  if (result.kind === 'ticket-phase-result' && result.clarification) {
    if (!expected.manual)
      throw new Error(
        'Ticket clarification is allowed only for manual actions.',
      );
    const pending = expected.pendingClarification;
    if (
      pending &&
      (result.clarification.kind !== pending.kind ||
        result.clarification.prompt !== pending.prompt)
    )
      throw new Error('Ticket clarification is stale or mismatched.');
  }
  if (
    result.kind === 'ticket-phase-result' &&
    expected.pendingClarification &&
    (!result.clarification ||
      (result.outcome !== 'blocked' &&
        result.clarification.resolution === undefined))
  )
    throw new Error('Pending Ticket clarification was not resolved.');
  if (
    result.operation !== expected.operation ||
    result.actionKey !== expected.actionKey ||
    result.attempt !== expected.attempt ||
    (expected.outcome !== undefined && result.outcome !== expected.outcome)
  )
    throw new Error('Ticket result is stale or mismatched.');
  if (result.kind === 'ticket-queue-result') {
    if (expected.operation !== 'select')
      throw new Error('Queue result does not match Ticket operation.');
    if (
      expected.selector &&
      (result.selector.kind !== expected.selector.kind ||
        result.selector.value !== expected.selector.value)
    )
      throw new Error('Ticket Queue selector is mismatched.');
    if (
      result.selected &&
      ((expected.source !== undefined &&
        (result.selected.source.kind !== expected.source.kind ||
          result.selected.source.ref !== expected.source.ref)) ||
        (expected.sourceKind !== undefined &&
          result.selected.source.kind !== expected.sourceKind))
    )
      throw new Error('Ticket result source is mismatched.');
    return;
  }
  if (
    (expected.source !== undefined &&
      (result.source.kind !== expected.source.kind ||
        result.source.ref !== expected.source.ref)) ||
    (expected.sourceKind !== undefined &&
      result.source.kind !== expected.sourceKind)
  )
    throw new Error('Ticket result source is mismatched.');
  if (
    expected.ticketRef !== undefined &&
    result.source.ref !== expected.ticketRef
  )
    throw new Error('Ticket result reference is mismatched.');
  if (expected.runId !== undefined && result.runId !== expected.runId)
    throw new Error('Ticket result run is mismatched.');
  if (
    (expected.claimId !== undefined && result.claimId !== expected.claimId) ||
    (expected.claim !== undefined && !sameClaim(result.claim, expected.claim))
  )
    throw new Error('Ticket result claim is mismatched.');
  if (
    expected.staleClaimId !== undefined &&
    result.staleClaimId !== expected.staleClaimId
  )
    throw new Error('Ticket result stale claim is mismatched.');
  if (
    expected.repository !== undefined &&
    result.repository !== expected.repository
  )
    throw new Error('Ticket result repository is mismatched.');
  if (
    result.activity &&
    result.activity.marker !== `${expected.actionKey}:${expected.attempt}`
  )
    throw new Error('Ticket activity marker is stale or mismatched.');
  if (result.operation === 'finish' && expected.previousFinishStage) {
    const stages: NonNullable<TicketPhaseResult['finishStage']>[] = [
      'repository-evidence',
      'final-activity',
      'terminal-transition',
      'terminal-refetch',
    ];
    if (
      !result.finishStage ||
      stages.indexOf(result.finishStage) <
        stages.indexOf(expected.previousFinishStage) ||
      expected.previousCommitEvidence?.some(
        (previous, index) =>
          !result.commitEvidence?.[index] ||
          !sameTicketCommitEvidence(result.commitEvidence[index], previous),
      ) ||
      (expected.previousFinishActivityKind === 'final' &&
        result.activity?.kind !== 'final')
    )
      throw new Error('FINISH retry frontier is stale or mismatched.');
  }
  validateLifecycleTransition(
    result.operation,
    result.outcome,
    expected.previousLifecycle,
    result.lifecycle,
  );
  const establishesScope =
    result.operation === 'claim' &&
    (result.outcome === 'succeeded' || result.outcome === 'reconciled') &&
    expected.initialRepositoryScope;
  if (establishesScope) {
    if (
      result.repositoryScope.length !== establishesScope.length ||
      !establishesScope.every(
        (repository, index) => result.repositoryScope[index] === repository,
      )
    )
      throw new Error('claim returned an invalid initial repository scope.');
  } else if (expected.previousRepositoryScope) {
    const previous = expected.previousRepositoryScope;
    const preservesScope = previous.every(
      (repository, index) => result.repositoryScope[index] === repository,
    );
    const expectedScope =
      (result.operation === 'add-repository' ||
        result.operation === 'repository-scope-approval') &&
      expected.repository &&
      !previous.includes(expected.repository)
        ? [...previous, expected.repository]
        : previous;
    if (
      !preservesScope ||
      result.repositoryScope.length !== expectedScope.length ||
      !expectedScope.every(
        (repository, index) => result.repositoryScope[index] === repository,
      )
    )
      throw new Error(`${result.operation} cannot change repository scope.`);
  }
}

export function extractTicketResultEnvelope(
  text: string,
  expected?: TicketResultExpectation,
): TicketResult {
  const matches = [...text.matchAll(/<!-- ADDY-TICKET-RESULT ([\s\S]*?) -->/g)];
  if (matches.length !== 1)
    throw new Error('Expected exactly one hidden Ticket result envelope.');
  let value: unknown;
  try {
    value = JSON.parse(matches[0][1]);
  } catch {
    throw new Error('Ticket result envelope contains malformed JSON.');
  }
  if (!record(value))
    throw new Error('Ticket result envelope must be an object.');
  const result =
    value.kind === 'ticket-queue-result'
      ? parseQueueResult(value)
      : parseTicketResult(value);
  if (expected) assertExpectation(result, expected);
  return result;
}

export function formatTicketResultEnvelope(result: TicketResult): string {
  return `<!-- ADDY-TICKET-RESULT ${JSON.stringify(result)} -->`;
}

export function queuePauseSummary(result: TicketQueueResult): string {
  if (result.selected) return `Selected Ticket ${result.selected.source.ref}.`;
  if (result.terminalReason === 'empty') return 'Ticket queue is empty.';
  if (result.terminalReason === 'configuration-ambiguous')
    return `Ticket queue paused for configuration ambiguity (${result.categories.ambiguous.count}).`;
  const { blocked, claimed, ineligible, ambiguous } = result.categories;
  return `Ticket queue paused: ${blocked.count} blocked, ${claimed.count} claimed, ${ineligible.count} ineligible, ${ambiguous.count} ambiguous.`;
}
