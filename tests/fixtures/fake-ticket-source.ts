import type { TicketOperation } from '../../extensions/workflow-monitor/workflow-core.ts';
import type { TicketLifecycleSnapshot } from '../../extensions/workflow-monitor/ticket-phase-result.ts';

type TargetKind = 'issue' | 'parent' | 'pull-request';

type FakeTicketState = {
  ref: string;
  revision: string;
  body: string;
  comments: string[];
  nativeOwner?: string;
  claimId?: string;
  selector?: string;
  terminal?: 'resolved';
  lifecycle: TicketLifecycleSnapshot;
  repositoryScope: string[];
  commitEvidence: Record<string, string>;
};

type FakeStaleOwner = { owner: string; claimId: string };

export type FakeTicketOperation = {
  operation: Exclude<TicketOperation, 'select'>;
  expectedRevision: string;
  actionKey: string;
  owner?: string;
  claimId?: string;
  staleOwner?: FakeStaleOwner;
  removeSelector?: boolean;
  activity?: string;
  targetedReplacement?: { from: string; to: string };
  complete?: boolean;
  stopAfter?: 'native-owner';
};

export class LostEnvelopeError extends Error {}

export class FakeTicketSource {
  #state: FakeTicketState;
  #targetKind: TargetKind;
  #routingAmbiguous = false;
  #raceNext = false;
  #loseNext = false;
  #backendFailure?: string;
  #staleOwner?: FakeStaleOwner;

  constructor(options: {
    ref: string;
    body: string;
    selector?: string;
    targetKind?: TargetKind;
    repositoryScope: string[];
  }) {
    this.#targetKind = options.targetKind ?? 'issue';
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
    if (input.activity !== undefined) {
      const marker = `<!-- addy-activity:${input.actionKey} -->`;
      if (!this.#state.comments.some((comment) => comment.includes(marker))) {
        this.#state.comments.push(`${input.activity}\n${marker}`);
        changed = true;
      }
    }
    if (input.complete) {
      const lifecycle = this.#state.lifecycle;
      const commitsComplete = this.#state.repositoryScope.every(
        (repository) => this.#state.commitEvidence[repository],
      );
      if (
        !lifecycle.implemented ||
        !lifecycle.verified ||
        !lifecycle.reviewed ||
        /- \[ \]/.test(this.#state.body) ||
        !commitsComplete
      )
        throw new Error('closure requirements are incomplete');
      if (!this.#state.terminal) {
        this.#state.terminal = 'resolved';
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
