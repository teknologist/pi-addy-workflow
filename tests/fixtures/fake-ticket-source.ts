import type { TicketOperation } from '../../extensions/workflow-monitor/workflow-core.ts';
import type { TicketLifecycleSnapshot } from '../../extensions/workflow-monitor/ticket-phase-result.ts';

type TargetKind = 'issue' | 'parent' | 'pull-request';
type FakeTicketSourceKind = 'github' | 'linear' | 'local';

type FakeTicketState = {
  ref: string;
  revision: string;
  body: string;
  comments: string[];
  nativeOwner?: string;
  claimId?: string;
  selector?: string;
  terminal?: 'closed' | 'completed' | 'resolved';
  lifecycle: TicketLifecycleSnapshot;
  repositoryScope: string[];
  commitEvidence: Record<string, string>;
};

type FakeStaleOwner = { owner: string; claimId: string };
type FakeFinishActivity = {
  kind: 'failure' | 'final';
  content: string;
};

export type FakeTicketOperation = {
  operation: Exclude<TicketOperation, 'select'>;
  expectedRevision: string;
  actionKey: string;
  owner?: string;
  claimId?: string;
  staleOwner?: FakeStaleOwner;
  repository?: string;
  removeSelector?: boolean;
  activity?: string | FakeFinishActivity;
  targetedReplacement?: { from: string; to: string };
  lifecycle?: Partial<TicketLifecycleSnapshot>;
  commitEvidence?: Record<string, string>;
  complete?: boolean;
  stopAfter?: 'native-owner';
};

export class LostEnvelopeError extends Error {}

export class FakeTicketSource {
  #state: FakeTicketState;
  #targetKind: TargetKind;
  #kind?: FakeTicketSourceKind;
  #labels: string[] = [];
  #blockers: string[] = [];
  #routingAmbiguous = false;
  #raceNext = false;
  #loseNext = false;
  #backendFailure?: string;
  #staleOwner?: FakeStaleOwner;
  #originatingSelector?: string;

  constructor(options: {
    kind?: FakeTicketSourceKind;
    ref: string;
    body: string;
    selector?: string;
    targetKind?: TargetKind;
    repositoryScope: string[];
  }) {
    this.#kind = options.kind;
    this.#targetKind = options.targetKind ?? 'issue';
    this.#originatingSelector = options.selector;
    this.#state = {
      ref: options.ref,
      revision: '0',
      body: options.body,
      comments: [],
      ...(options.selector ? { selector: options.selector } : {}),
      lifecycle: { implemented: false, verified: false, reviewed: false },
      repositoryScope: [...options.repositoryScope],
      commitEvidence: {},
    };
  }

  fetch(): FakeTicketState {
    return structuredClone(this.#state);
  }

  humanEdit(edit: (body: string) => string): void {
    this.#state.body = edit(this.#state.body);
    this.#bumpRevision();
  }

  setSelector(selector: string | undefined): void {
    this.#state.selector = selector;
  }

  setLabels(labels: string[]): void {
    this.#labels = [...labels];
  }

  setBlockers(blockers: string[]): void {
    this.#blockers = [...blockers];
  }

  isEligible(): boolean {
    return (
      /## What to build\s*\n+\S/.test(this.#state.body) &&
      /## Acceptance criteria[\s\S]*- \[ \]/.test(this.#state.body) &&
      /## Blocked by\s*\n+\S/.test(this.#state.body) &&
      this.#blockers.length === 0 &&
      this.#state.claimId === undefined
    );
  }

  matchesQueue(selector: string): boolean {
    return (
      this.isEligible() &&
      (this.#state.selector === selector || this.#labels.includes(selector))
    );
  }

  setLifecycle(lifecycle: TicketLifecycleSnapshot): void {
    this.#state.lifecycle = { ...lifecycle };
    this.#bumpRevision();
  }

  setCommitEvidence(evidence: Record<string, string>): void {
    this.#state.commitEvidence = { ...evidence };
    this.#bumpRevision();
  }

  markOwnerStale(owner: FakeStaleOwner): void {
    if (
      this.#state.nativeOwner !== owner.owner ||
      this.#state.claimId !== owner.claimId
    )
      throw new Error('stale-owner evidence does not match');
    this.#staleOwner = { ...owner };
    this.#bumpRevision();
  }

  raceNextWrite(): void {
    this.#raceNext = true;
  }

  loseNextEnvelope(): void {
    this.#loseNext = true;
  }

  removeSelectorWithoutClaim(): void {
    this.#state.selector = undefined;
    this.#bumpRevision();
  }

  makeRoutingAmbiguous(): void {
    this.#routingAmbiguous = true;
  }

  failNextBackend(message: string): void {
    this.#backendFailure = message;
  }

  apply(input: FakeTicketOperation): FakeTicketState {
    if (this.#routingAmbiguous) throw new Error('ambiguous routing');
    if (this.#backendFailure) {
      const message = this.#backendFailure;
      this.#backendFailure = undefined;
      throw new Error(message);
    }
    if (this.#targetKind !== 'issue' && input.operation !== 'status')
      throw new Error('target is not a mutable child issue');
    if (this.#raceNext) {
      this.#raceNext = false;
      this.#bumpRevision();
    }
    if (input.expectedRevision !== this.#state.revision)
      throw new Error('revision conflict');

    if (
      input.operation === 'claim' &&
      this.#originatingSelector &&
      this.#state.selector === undefined &&
      this.#state.claimId === undefined
    )
      throw new Error(
        'selector removal without claim identity requires manual repair',
      );

    let changed = false;
    if (input.operation === 'release') {
      if (!input.claimId || this.#state.claimId !== input.claimId)
        throw new Error('release requires the exact claim identity');
      if (this.#state.nativeOwner) {
        this.#state.nativeOwner = undefined;
        changed = true;
      }
      if (input.stopAfter === 'native-owner') return this.#finish(changed);
      this.#state.claimId = undefined;
      this.#staleOwner = undefined;
      if (this.#originatingSelector && this.#state.selector === undefined)
        this.#state.selector = this.#originatingSelector;
      changed = true;
    } else if (input.operation === 'reclaim') {
      const stale = input.staleOwner;
      if (!stale || !input.owner || !input.claimId)
        throw new Error(
          'reclaim requires stale-owner and replacement identity',
        );
      if (
        !this.#staleOwner ||
        this.#staleOwner.owner !== stale.owner ||
        this.#staleOwner.claimId !== stale.claimId
      )
        throw new Error('reclaim refused a live owner');
      if (
        (this.#state.nativeOwner !== stale.owner &&
          this.#state.nativeOwner !== input.owner) ||
        this.#state.claimId !== stale.claimId
      )
        throw new Error('stale-owner evidence does not match');
      if (this.#state.nativeOwner !== input.owner) {
        this.#state.nativeOwner = input.owner;
        changed = true;
      }
      if (input.stopAfter === 'native-owner') return this.#finish(changed);
      this.#state.claimId = input.claimId;
      this.#staleOwner = undefined;
      changed = true;
    } else if (input.operation === 'add-repository') {
      if (!input.claimId || this.#state.claimId !== input.claimId)
        throw new Error(
          'repository approval requires the exact claim identity',
        );
      if (!input.repository?.trim())
        throw new Error('repository approval requires a repository');
      if (!this.#state.repositoryScope.includes(input.repository)) {
        this.#state.repositoryScope.push(input.repository);
        changed = true;
      }
    } else {
      if (input.owner !== undefined) {
        if (this.#state.nativeOwner && this.#state.nativeOwner !== input.owner)
          throw new Error('conflicting native owner');
        if (!this.#state.nativeOwner) {
          this.#state.nativeOwner = input.owner;
          changed = true;
        }
        if (input.stopAfter === 'native-owner') return this.#finish(changed);
      }
      if (input.claimId !== undefined) {
        if (this.#state.claimId && this.#state.claimId !== input.claimId)
          throw new Error('conflicting claim identity');
        if (!this.#state.claimId) {
          this.#state.claimId = input.claimId;
          changed = true;
        }
      }
    }
    if (input.removeSelector && this.#state.selector !== undefined) {
      this.#state.selector = undefined;
      changed = true;
    }
    if (
      this.#kind === 'local' &&
      input.operation === 'claim' &&
      this.#state.claimId &&
      /^Status: ready-for-agent$/m.test(this.#state.body)
    ) {
      this.#state.body = this.#state.body.replace(
        /^Status: ready-for-agent$/m,
        'Status: claimed',
      );
      changed = true;
    }
    if (input.targetedReplacement) {
      const { from, to } = input.targetedReplacement;
      const matches = this.#state.body.split(from).length - 1;
      if (matches !== 1)
        throw new Error('targeted replacement must match exactly once');
      const next = this.#state.body.replace(from, to);
      if (next !== this.#state.body) {
        this.#state.body = next;
        changed = true;
      }
    }
    if (input.lifecycle) {
      this.#state.lifecycle = {
        ...this.#state.lifecycle,
        ...input.lifecycle,
      };
      changed = true;
    }
    if (input.commitEvidence) {
      this.#state.commitEvidence = {
        ...this.#state.commitEvidence,
        ...input.commitEvidence,
      };
      changed = true;
    }
    if (input.activity !== undefined) {
      const marker = `<!-- addy-activity:${input.actionKey} -->`;
      const index = this.#state.comments.findIndex((comment) =>
        comment.includes(marker),
      );
      if (input.operation === 'finish' && typeof input.activity === 'string')
        throw new Error('finish Activity requires kind and content');
      const content =
        typeof input.activity === 'string'
          ? input.activity
          : `${input.activity.content}\n<!-- addy-activity-kind:${input.activity.kind} -->`;
      const comment = `${content}\n${marker}`;
      if (index === -1) {
        this.#state.comments.push(comment);
        if (this.#kind === 'local') this.#state.body += `\n\n${comment}`;
        changed = true;
      } else if (
        typeof input.activity !== 'string' &&
        input.activity.kind === 'final' &&
        this.#state.comments[index] !== comment
      ) {
        if (this.#kind === 'local')
          this.#state.body = this.#state.body.replace(
            this.#state.comments[index],
            comment,
          );
        this.#state.comments[index] = comment;
        changed = true;
      }
    }
    if (input.complete) {
      const lifecycle = this.#state.lifecycle;
      const commitsComplete = this.#state.repositoryScope.every(
        (repository) => this.#state.commitEvidence[repository],
      );
      const finalActivity = this.#state.comments.some(
        (comment) =>
          comment.includes(`<!-- addy-activity:${input.actionKey} -->`) &&
          comment.includes('<!-- addy-activity-kind:final -->'),
      );
      if (
        !lifecycle.implemented ||
        !lifecycle.verified ||
        !lifecycle.reviewed ||
        /- \[ \]/.test(this.#state.body) ||
        !commitsComplete ||
        !finalActivity
      )
        throw new Error('closure requirements are incomplete');
      if (!this.#state.terminal) {
        this.#state.terminal =
          this.#kind === 'github'
            ? 'closed'
            : this.#kind === 'linear'
              ? 'completed'
              : 'resolved';
        if (this.#kind === 'local')
          this.#state.body = this.#state.body.replace(
            /^Status: claimed$/m,
            'Status: resolved',
          );
        changed = true;
      }
    }
    return this.#finish(changed);
  }

  #finish(changed: boolean): FakeTicketState {
    if (changed) this.#bumpRevision();
    const result = this.fetch();
    if (this.#loseNext) {
      this.#loseNext = false;
      throw new LostEnvelopeError('result envelope was lost after mutation');
    }
    return result;
  }

  #bumpRevision(): void {
    this.#state.revision = String(Number(this.#state.revision) + 1);
  }
}

export function selectFakeTicket(
  tickets: FakeTicketSource[],
  selection:
    | { mode: 'direct'; ref: string }
    | { mode: 'queue'; selector: string },
): FakeTicketSource | undefined {
  if (selection.mode === 'direct')
    return tickets.find(
      (ticket) => ticket.fetch().ref === selection.ref && ticket.isEligible(),
    );
  return tickets
    .filter((ticket) => ticket.matchesQueue(selection.selector))
    .sort((left, right) => {
      const a = left.fetch().ref;
      const b = right.fetch().ref;
      const aNumber = /^\D*(\d+)/.exec(a)?.[1];
      const bNumber = /^\D*(\d+)/.exec(b)?.[1];
      if (aNumber && bNumber && Number(aNumber) !== Number(bNumber))
        return Number(aNumber) - Number(bNumber);
      if (aNumber) return -1;
      if (bNumber) return 1;
      return a.localeCompare(b);
    })[0];
}
