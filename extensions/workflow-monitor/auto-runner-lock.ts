import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  projectWorkflowStateKey,
  workflowStateDir,
  type WorkflowStateScopeContext,
} from './workflow-state-store-scope.ts';

export type AutoRunnerLock = {
  version: 1;
  projectKey: string;
  instanceId: string;
  runnerId: string;
  fencingToken: string;
  pid: number;
  cwd: string;
  activePlan?: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  lastActionKey?: string;
  pidStartedAt?: string;
  processCommand?: string;
};

type PidLiveness = boolean | 'unknown';

export type AutoRunnerLockDeps = {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  renameSync(from: string, to: string): void;
  rmSync(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): void;
  now(): Date;
  randomUUID(): string;
  pid(): number;
  cwd(ctx?: WorkflowStateScopeContext): string;
  processCommand(): string | undefined;
  pidStartedAt(pid: number): string | undefined;
  isPidAlive(pid: number): PidLiveness;
  isChildProcess(): boolean;
  sleep(ms: number): Promise<void>;
  setInterval(callback: () => void, ms: number): { unref?: () => void };
  clearInterval(timer: unknown): void;
};

export type AutoRunnerLockOptions = {
  activePlan?: string;
  lastActionKey?: string;
  ttlMs?: number;
  staleRecheckMs?: number;
  heartbeatMs?: number;
  deps?: Partial<AutoRunnerLockDeps>;
};

export type AutoRunnerLockOwnedResult = {
  status: 'owned' | 'reclaimed';
  lock: AutoRunnerLock;
};

export type AutoRunnerLockBlockedResult = {
  status: 'blocked';
  reason: string;
  owner?: AutoRunnerLock;
};

export type AutoRunnerLockResult =
  | AutoRunnerLockOwnedResult
  | AutoRunnerLockBlockedResult
  | { status: 'passive-child'; reason: string };

export type AutoRunnerStopIntentResult =
  | { status: 'recorded'; owner: AutoRunnerLock }
  | { status: 'owned'; owner: AutoRunnerLock }
  | { status: 'no-owner' }
  | { status: 'passive-child'; reason: string };

const OWNER_FILE = 'owner.json';
const STOP_INTENT_FILE = 'stop-intent.json';
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const DEFAULT_RECHECK_MS = 5 * 1000;
const DEFAULT_HEARTBEAT_MS = 30 * 1000;

const instanceId = randomUUID();
const fencingTokensByRunner = new Map<string, string>();
const heartbeatStopsByLockDir = new Map<string, () => void>();
let processCleanupRegistered = false;

function defaultDeps(): AutoRunnerLockDeps {
  return {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    renameSync,
    rmSync,
    now: () => new Date(),
    randomUUID,
    pid: () => process.pid,
    cwd: (ctx) => ctx?.cwd ?? process.cwd(),
    processCommand: () => process.argv.join(' '),
    pidStartedAt: () => undefined,
    isPidAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ESRCH') return false;
        if (code === 'EPERM') return true;
        return 'unknown';
      }
    },
    isChildProcess: () => process.env.PI_SUBAGENT_CHILD === '1',
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
  };
}

function depsFrom(options?: AutoRunnerLockOptions): AutoRunnerLockDeps {
  return { ...defaultDeps(), ...(options?.deps ?? {}) };
}

function iso(date: Date): string {
  return date.toISOString();
}

function expiresAt(now: Date, ttlMs: number): string {
  return iso(new Date(now.getTime() + ttlMs));
}

export function getAutoRunnerInstanceId(): string {
  return instanceId;
}

export function autoRunnerLockDir(ctx: WorkflowStateScopeContext): string {
  return join(
    workflowStateDir(ctx),
    'auto-runner-locks',
    projectWorkflowStateKey(ctx),
  );
}

function autoRunnerId(ctx: WorkflowStateScopeContext): string {
  return `${process.pid}:${projectWorkflowStateKey(ctx)}`;
}

function runnerTokenKey(
  lockDir: string,
  ctx: WorkflowStateScopeContext,
): string {
  return `${lockDir}\0${autoRunnerId(ctx)}`;
}

function ownerPath(lockDir: string): string {
  return join(lockDir, OWNER_FILE);
}

function stopIntentPath(lockDir: string): string {
  return join(lockDir, STOP_INTENT_FILE);
}

function ensureParentDir(lockDir: string, deps: AutoRunnerLockDeps): void {
  deps.mkdirSync(dirname(lockDir), { recursive: true });
}

function readOwner(
  lockDir: string,
  deps: AutoRunnerLockDeps,
): AutoRunnerLock | undefined {
  const raw = deps.readFileSync(ownerPath(lockDir), 'utf8');
  const parsed = JSON.parse(raw) as AutoRunnerLock;
  if (
    parsed.version !== 1 ||
    typeof parsed.projectKey !== 'string' ||
    typeof parsed.instanceId !== 'string' ||
    typeof parsed.runnerId !== 'string' ||
    typeof parsed.fencingToken !== 'string' ||
    typeof parsed.pid !== 'number' ||
    typeof parsed.cwd !== 'string' ||
    typeof parsed.acquiredAt !== 'string' ||
    typeof parsed.heartbeatAt !== 'string' ||
    typeof parsed.expiresAt !== 'string'
  )
    return undefined;
  return parsed;
}

function tryReadOwner(
  lockDir: string,
  deps: AutoRunnerLockDeps,
): AutoRunnerLock | undefined {
  try {
    return readOwner(lockDir, deps);
  } catch {
    return undefined;
  }
}

function writeOwnerAtomic(
  lockDir: string,
  owner: AutoRunnerLock,
  deps: AutoRunnerLockDeps,
): void {
  const tempPath = join(
    lockDir,
    `${OWNER_FILE}.${deps.pid()}.${deps.randomUUID()}.tmp`,
  );
  deps.writeFileSync(tempPath, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
  deps.renameSync(tempPath, ownerPath(lockDir));
}

function releaseOwnedLockDir(
  ctx: WorkflowStateScopeContext,
  lockDir: string,
  deps: AutoRunnerLockDeps,
): void {
  const owner = tryReadOwner(lockDir, deps);
  if (!owner || !ownedByThisRunner(owner, lockDir, ctx)) return;
  deps.rmSync(lockDir, { recursive: true, force: true });
}

function registerProcessCleanup(): void {
  if (processCleanupRegistered) return;
  processCleanupRegistered = true;
  process.once('exit', () => {
    const deps = defaultDeps();
    for (const [key, token] of fencingTokensByRunner.entries()) {
      const [lockDir] = key.split('\0');
      try {
        if (tryReadOwner(lockDir, deps)?.fencingToken === token)
          deps.rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup only; stale/dead-owner reclaim is authoritative.
      }
    }
  });
}

function writeJsonAtomic(
  filePath: string,
  value: unknown,
  deps: AutoRunnerLockDeps,
): void {
  const tempPath = `${filePath}.${deps.pid()}.${deps.randomUUID()}.tmp`;
  deps.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  deps.renameSync(tempPath, filePath);
}

function ownedByThisRunner(
  owner: AutoRunnerLock | undefined,
  lockDir: string,
  ctx: WorkflowStateScopeContext,
): boolean {
  return Boolean(
    owner &&
    owner.runnerId === autoRunnerId(ctx) &&
    owner.instanceId === instanceId &&
    owner.fencingToken ===
      fencingTokensByRunner.get(runnerTokenKey(lockDir, ctx)),
  );
}

function nextOwner(
  ctx: WorkflowStateScopeContext,
  lockDir: string,
  options: AutoRunnerLockOptions,
  deps: AutoRunnerLockDeps,
  previousOwner?: AutoRunnerLock,
): AutoRunnerLock {
  const now = deps.now();
  const token = previousOwner?.fencingToken ?? deps.randomUUID();
  fencingTokensByRunner.set(runnerTokenKey(lockDir, ctx), token);
  const pid = deps.pid();
  return {
    version: 1,
    projectKey: projectWorkflowStateKey(ctx),
    instanceId,
    runnerId: autoRunnerId(ctx),
    fencingToken: token,
    pid,
    cwd: deps.cwd(ctx),
    activePlan: options.activePlan ?? previousOwner?.activePlan,
    acquiredAt: previousOwner?.acquiredAt ?? iso(now),
    heartbeatAt: iso(now),
    expiresAt: expiresAt(now, options.ttlMs ?? DEFAULT_TTL_MS),
    lastActionKey: options.lastActionKey ?? previousOwner?.lastActionKey,
    pidStartedAt: deps.pidStartedAt(pid),
    processCommand: deps.processCommand(),
  };
}

function isExpired(owner: AutoRunnerLock, deps: AutoRunnerLockDeps): boolean {
  return Date.parse(owner.expiresAt) <= deps.now().getTime();
}

function ownerLooksDead(
  owner: AutoRunnerLock,
  deps: AutoRunnerLockDeps,
): boolean | 'uncertain' {
  const currentPidStartedAt = deps.pidStartedAt(owner.pid);
  if (
    owner.pidStartedAt &&
    currentPidStartedAt &&
    owner.pidStartedAt !== currentPidStartedAt
  )
    return true;

  const live = deps.isPidAlive(owner.pid);
  if (live === false) return true;
  if (live === true) return false;
  return 'uncertain';
}

function quarantineLockDir(
  lockDir: string,
  reason: string,
  deps: AutoRunnerLockDeps,
): boolean {
  const target = `${lockDir}.${reason}.${deps.pid()}.${deps.randomUUID()}`;
  try {
    deps.renameSync(lockDir, target);
    return true;
  } catch {
    return false;
  }
}

async function mayReclaimOwner(
  lockDir: string,
  owner: AutoRunnerLock | undefined,
  ownerFileExists: boolean,
  options: AutoRunnerLockOptions,
  deps: AutoRunnerLockDeps,
): Promise<boolean> {
  if (!owner) {
    if (!ownerFileExists) return false;
    return quarantineLockDir(lockDir, 'malformed', deps);
  }

  const dead = ownerLooksDead(owner, deps);
  if (dead === true) return quarantineLockDir(lockDir, 'dead', deps);
  if (dead === false) return false;
  if (!isExpired(owner, deps)) return false;

  await deps.sleep(options.staleRecheckMs ?? DEFAULT_RECHECK_MS);
  const rechecked = tryReadOwner(lockDir, deps);
  if (
    !rechecked ||
    rechecked.instanceId !== owner.instanceId ||
    rechecked.fencingToken !== owner.fencingToken ||
    !isExpired(rechecked, deps)
  )
    return false;

  return quarantineLockDir(lockDir, 'stale', deps);
}

export async function acquireAutoRunnerLock(
  ctx: WorkflowStateScopeContext,
  options: AutoRunnerLockOptions = {},
): Promise<AutoRunnerLockResult> {
  const deps = depsFrom(options);
  if (deps.isChildProcess())
    return { status: 'passive-child', reason: 'subagent child process' };

  const lockDir = autoRunnerLockDir(ctx);
  ensureParentDir(lockDir, deps);
  try {
    deps.mkdirSync(lockDir);
    const owner = nextOwner(ctx, lockDir, options, deps);
    writeOwnerAtomic(lockDir, owner, deps);
    const persisted = tryReadOwner(lockDir, deps);
    if (!ownedByThisRunner(persisted, lockDir, ctx))
      return {
        status: 'blocked',
        reason: 'lost acquisition race',
        owner: persisted,
      };
    registerProcessCleanup();
    return { status: 'owned', lock: owner };
  } catch {
    // Directory already exists or another process won the race. Inspect below.
  }

  const owner = tryReadOwner(lockDir, deps);
  if (owner && ownedByThisRunner(owner, lockDir, ctx)) {
    const renewed = nextOwner(ctx, lockDir, options, deps, owner);
    writeOwnerAtomic(lockDir, renewed, deps);
    registerProcessCleanup();
    return { status: 'owned', lock: renewed };
  }

  if (
    await mayReclaimOwner(
      lockDir,
      owner,
      deps.existsSync(ownerPath(lockDir)),
      options,
      deps,
    )
  ) {
    try {
      deps.mkdirSync(lockDir);
      const reclaimed = nextOwner(ctx, lockDir, options, deps);
      writeOwnerAtomic(lockDir, reclaimed, deps);
      const persisted = tryReadOwner(lockDir, deps);
      if (!ownedByThisRunner(persisted, lockDir, ctx))
        return { status: 'blocked', reason: 'lost reclaim race', owner };
      registerProcessCleanup();
      return { status: 'reclaimed', lock: reclaimed };
    } catch {
      return { status: 'blocked', reason: 'lost reclaim race', owner };
    }
  }

  return {
    status: 'blocked',
    reason: owner
      ? 'owned elsewhere'
      : deps.existsSync(ownerPath(lockDir))
        ? 'malformed lock'
        : 'acquisition in progress',
    owner,
  };
}

export function verifyAutoRunnerLock(
  ctx: WorkflowStateScopeContext,
  options: AutoRunnerLockOptions = {},
): AutoRunnerLockResult {
  const deps = depsFrom(options);
  if (deps.isChildProcess())
    return { status: 'passive-child', reason: 'subagent child process' };
  const lockDir = autoRunnerLockDir(ctx);
  const owner = tryReadOwner(lockDir, deps);
  if (owner && ownedByThisRunner(owner, lockDir, ctx))
    return { status: 'owned', lock: owner };
  return {
    status: 'blocked',
    reason: owner ? 'owned elsewhere' : 'missing or malformed lock',
    owner,
  };
}

export function renewAutoRunnerLock(
  ctx: WorkflowStateScopeContext,
  options: AutoRunnerLockOptions = {},
): AutoRunnerLockResult {
  const deps = depsFrom(options);
  const verified = verifyAutoRunnerLock(ctx, options);
  if (verified.status !== 'owned') return verified;
  const lockDir = autoRunnerLockDir(ctx);
  const renewed = nextOwner(ctx, lockDir, options, deps, verified.lock);
  writeOwnerAtomic(lockDir, renewed, deps);
  registerProcessCleanup();
  return { status: 'owned', lock: renewed };
}

export function releaseAutoRunnerLock(
  ctx: WorkflowStateScopeContext,
  options: AutoRunnerLockOptions = {},
): AutoRunnerLockResult {
  const deps = depsFrom(options);
  const lockDir = autoRunnerLockDir(ctx);
  const verified = verifyAutoRunnerLock(ctx, options);
  if (verified.status !== 'owned') return verified;
  heartbeatStopsByLockDir.get(lockDir)?.();
  heartbeatStopsByLockDir.delete(lockDir);
  releaseOwnedLockDir(ctx, lockDir, deps);
  fencingTokensByRunner.delete(runnerTokenKey(lockDir, ctx));
  return verified;
}

export function recordAutoRunnerStopIntent(
  ctx: WorkflowStateScopeContext,
  options: AutoRunnerLockOptions = {},
): AutoRunnerStopIntentResult {
  const deps = depsFrom(options);
  if (deps.isChildProcess())
    return { status: 'passive-child', reason: 'subagent child process' };
  const lockDir = autoRunnerLockDir(ctx);
  const owner = tryReadOwner(lockDir, deps);
  if (!owner) return { status: 'no-owner' };
  if (ownedByThisRunner(owner, lockDir, ctx)) return { status: 'owned', owner };
  const blockedOwner = owner;
  writeJsonAtomic(
    stopIntentPath(lockDir),
    {
      version: 1,
      projectKey: blockedOwner.projectKey,
      fencingToken: blockedOwner.fencingToken,
      requestedByInstanceId: instanceId,
      requestedAt: iso(deps.now()),
    },
    deps,
  );
  return { status: 'recorded', owner: blockedOwner };
}

export function consumeAutoRunnerStopIntent(
  ctx: WorkflowStateScopeContext,
  owner: AutoRunnerLock,
  options: AutoRunnerLockOptions = {},
): boolean {
  const deps = depsFrom(options);
  const lockDir = autoRunnerLockDir(ctx);
  try {
    const intent = JSON.parse(
      deps.readFileSync(stopIntentPath(lockDir), 'utf8'),
    ) as {
      fencingToken?: string;
    };
    if (intent.fencingToken !== owner.fencingToken) return false;
    deps.rmSync(stopIntentPath(lockDir), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function startAutoRunnerHeartbeat(
  ctx: WorkflowStateScopeContext,
  options: AutoRunnerLockOptions = {},
): () => void {
  const deps = depsFrom(options);
  const lockDir = autoRunnerLockDir(ctx);
  heartbeatStopsByLockDir.get(lockDir)?.();
  const timer = deps.setInterval(() => {
    try {
      renewAutoRunnerLock(ctx, options);
    } catch {
      heartbeatStopsByLockDir.get(lockDir)?.();
    }
  }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  timer.unref?.();
  const stop = () => {
    deps.clearInterval(timer);
    if (heartbeatStopsByLockDir.get(lockDir) === stop)
      heartbeatStopsByLockDir.delete(lockDir);
  };
  heartbeatStopsByLockDir.set(lockDir, stop);
  return stop;
}

export function autoRunnerLockOwnerSummary(owner?: AutoRunnerLock): string {
  if (!owner) return 'owner unavailable';
  const heartbeatAgeMs = Date.now() - Date.parse(owner.heartbeatAt);
  const heartbeatAge = Number.isFinite(heartbeatAgeMs)
    ? `${Math.max(0, Math.round(heartbeatAgeMs / 1000))}s ago`
    : 'unknown';
  return [
    `cwd: ${owner.cwd}`,
    owner.activePlan ? `plan: ${owner.activePlan}` : undefined,
    `heartbeat: ${heartbeatAge}`,
  ]
    .filter(Boolean)
    .join('; ');
}
