import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { projectWorkflowStateKey } from './workflow-state-store-scope.ts';

const SCHEMA_VERSION = 1;
const STALE_AFTER_MS = 30 * 60 * 1000;
const LOCK_STALE_AFTER_MS = 30_000;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_LOCK_BYTES = 1_024;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const TERMINAL_STATUSES = new Set<ExternalProgressTerminalStatus>([
  'completed',
  'failed',
]);
const ACTIVE_STATUSES = new Set<ExternalProgressActiveStatus>([
  'running',
  'blocked',
]);
const SOURCES = new Set<ExternalProgressSource>([
  'df-implement-issues',
  'implement-from-issues',
]);
const LOOP_PHASES = new Set<ExternalProgressLoopPhase>([
  'pre-loop',
  'queue',
  'implementation',
  'verification',
  'review-fix',
  'commit-merge',
  'post-loop',
]);
const PROGRESS_UNITS = new Set<ExternalProgressUnit>(['issues', 'waves']);
const SNAPSHOT_FIELDS = new Set([
  'schemaVersion',
  'projectKey',
  'runId',
  'parentRunId',
  'source',
  'status',
  'loopPhase',
  'progressUnit',
  'currentItem',
  'completed',
  'total',
  'startedAt',
  'updatedAt',
  'finishedAt',
]);
const PATCH_FIELDS = new Set([
  'status',
  'loopPhase',
  'progressUnit',
  'currentItem',
  'completed',
  'total',
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[0-9a-f]{24}$/;

type ExternalProgressSource = 'df-implement-issues' | 'implement-from-issues';
type ExternalProgressActiveStatus = 'running' | 'blocked';
type ExternalProgressTerminalStatus = 'completed' | 'failed';
type ExternalProgressStatus =
  | ExternalProgressActiveStatus
  | ExternalProgressTerminalStatus;
type ExternalProgressLoopPhase =
  | 'pre-loop'
  | 'queue'
  | 'implementation'
  | 'verification'
  | 'review-fix'
  | 'commit-merge'
  | 'post-loop';
type ExternalProgressUnit = 'issues' | 'waves';

export type IssueImplementationProgressSnapshot = {
  schemaVersion: 1;
  projectKey: string;
  runId: string;
  parentRunId?: string;
  source: ExternalProgressSource;
  status: ExternalProgressStatus;
  loopPhase: ExternalProgressLoopPhase;
  progressUnit?: ExternalProgressUnit;
  currentItem?: string;
  completed?: number;
  total?: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type ExternalProgressDiagnostic = {
  file: string;
  message: string;
};

export type ExternalProgressReadResult = {
  snapshots: IssueImplementationProgressSnapshot[];
  diagnostics: ExternalProgressDiagnostic[];
};

export type SelectedExternalProgress = {
  snapshot: IssueImplementationProgressSnapshot;
  stale: boolean;
};

export type ExternalProgressSelection = {
  active: SelectedExternalProgress[];
  terminal?: SelectedExternalProgress;
  diagnostics: ExternalProgressDiagnostic[];
};

type StorageOptions = {
  homeDir?: string;
};

type ProjectOptions = StorageOptions & {
  cwd: string;
};

export type StartExternalProgressInput = ProjectOptions & {
  source: ExternalProgressSource;
  parentRunId?: string;
  loopPhase?: ExternalProgressLoopPhase;
  progressUnit?: ExternalProgressUnit;
  currentItem?: string;
  completed?: number;
  total?: number;
  now?: Date;
};

export type UpdateExternalProgressInput = StorageOptions & {
  runId: string;
  cwd?: string;
  source?: ExternalProgressSource;
  patch: Partial<
    Pick<
      IssueImplementationProgressSnapshot,
      | 'status'
      | 'loopPhase'
      | 'progressUnit'
      | 'currentItem'
      | 'completed'
      | 'total'
    >
  >;
  now?: Date;
};

export type FinishExternalProgressInput = StorageOptions & {
  runId: string;
  cwd?: string;
  source?: ExternalProgressSource;
  status: ExternalProgressTerminalStatus;
  patch?: Partial<
    Pick<
      IssueImplementationProgressSnapshot,
      'loopPhase' | 'progressUnit' | 'currentItem' | 'completed' | 'total'
    >
  >;
  now?: Date;
};

/** Returns the canonical Git common directory shared by a checkout and its worktrees. */
export function canonicalGitCommonDir({
  cwd,
}: Pick<ProjectOptions, 'cwd'>): string {
  try {
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!commonDir || !isAbsolute(commonDir)) {
      throw new Error('Git did not return an absolute common directory');
    }
    return resolve(commonDir);
  } catch {
    throw new Error(`External progress requires a Git checkout: ${cwd}`);
  }
}

/** Derives the stable project key from the Git common directory, never a worktree path. */
export function externalProgressProjectKey({
  cwd,
}: Pick<ProjectOptions, 'cwd'>): string {
  return projectWorkflowStateKey({ cwd: canonicalGitCommonDir({ cwd }) });
}

export function externalProgressRoot({ homeDir }: StorageOptions = {}): string {
  return join(
    resolve(homeDir ?? homedir()),
    '.pi',
    'addy-workflow',
    'external-progress',
  );
}

export function externalProgressRunsDir({
  cwd,
  homeDir,
}: ProjectOptions): string {
  return runsDirForKey(externalProgressProjectKey({ cwd }), { homeDir });
}

/** Strictly decodes one schema-v1 snapshot and returns normalized display text. */
export function parseIssueImplementationProgressSnapshot(
  value: unknown,
): IssueImplementationProgressSnapshot {
  if (!isRecord(value)) throw new Error('Snapshot must be an object');
  for (const key of Object.keys(value)) {
    if (!SNAPSHOT_FIELDS.has(key))
      throw new Error(`Unknown snapshot field: ${key}`);
  }

  if (value.schemaVersion !== SCHEMA_VERSION)
    throw new Error('Unsupported schema version');
  const projectKey = requiredString(value, 'projectKey');
  if (!PROJECT_KEY_PATTERN.test(projectKey))
    throw new Error('Invalid project key');
  const runId = requiredString(value, 'runId');
  validateUuid(runId, 'runId');
  const parentRunId = optionalString(value, 'parentRunId');
  if (parentRunId !== undefined) {
    validateUuid(parentRunId, 'parentRunId');
    if (parentRunId === runId)
      throw new Error('parentRunId cannot equal runId');
  }
  const source = requiredEnum(value, 'source', SOURCES);
  const status = requiredEnum(
    value,
    'status',
    new Set<string>([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]),
  ) as ExternalProgressStatus;
  const loopPhase = requiredEnum(value, 'loopPhase', LOOP_PHASES);
  const progressUnit = optionalEnum(value, 'progressUnit', PROGRESS_UNITS);
  const currentItem = optionalDisplayText(value, 'currentItem');
  const completed = optionalCounter(value, 'completed');
  const total = optionalCounter(value, 'total');
  if (completed !== undefined && total !== undefined && completed > total) {
    throw new Error('completed cannot exceed total');
  }
  const startedAt = requiredIsoDate(value, 'startedAt');
  const updatedAt = requiredIsoDate(value, 'updatedAt');
  if (Date.parse(updatedAt) < Date.parse(startedAt)) {
    throw new Error('updatedAt cannot precede startedAt');
  }
  const finishedAt = optionalIsoDate(value, 'finishedAt');
  if (TERMINAL_STATUSES.has(status as ExternalProgressTerminalStatus)) {
    if (finishedAt === undefined)
      throw new Error('Terminal snapshots require finishedAt');
    if (Date.parse(finishedAt) < Date.parse(updatedAt)) {
      throw new Error('finishedAt cannot precede updatedAt');
    }
  } else if (finishedAt !== undefined) {
    throw new Error('Active snapshots cannot have finishedAt');
  }

  return omitUndefined({
    schemaVersion: SCHEMA_VERSION,
    projectKey,
    runId,
    parentRunId,
    source: source as ExternalProgressSource,
    status,
    loopPhase: loopPhase as ExternalProgressLoopPhase,
    progressUnit: progressUnit as ExternalProgressUnit | undefined,
    currentItem,
    completed,
    total,
    startedAt,
    updatedAt,
    finishedAt,
  });
}

/** Starts or reuses the one active progress run for a project/source pair. */
export function startExternalProgress(
  input: StartExternalProgressInput,
): IssueImplementationProgressSnapshot {
  const projectKey = externalProgressProjectKey(input);
  const runsDir = ensureRunsDir(projectKey, input);
  return withFileLock(join(runsDir, '.start.lock'), () => {
    const stored = readProjectByKey(projectKey, input);
    if (stored.diagnostics.length > 0) {
      throw new Error('Cannot establish external progress run ownership');
    }
    const existing = stored.snapshots
      .filter(
        (snapshot) =>
          snapshot.source === input.source &&
          ACTIVE_STATUSES.has(snapshot.status as ExternalProgressActiveStatus),
      )
      .sort(compareSnapshots)[0];
    if (existing) return existing;

    const timestamp = isoNow(input.now);
    const snapshot = parseIssueImplementationProgressSnapshot({
      schemaVersion: SCHEMA_VERSION,
      projectKey,
      runId: randomUUID(),
      ...(input.parentRunId === undefined
        ? {}
        : { parentRunId: input.parentRunId }),
      source: input.source,
      status: 'running',
      loopPhase: input.loopPhase ?? 'pre-loop',
      ...(input.progressUnit === undefined
        ? {}
        : { progressUnit: input.progressUnit }),
      ...(input.currentItem === undefined
        ? {}
        : { currentItem: input.currentItem }),
      ...(input.completed === undefined ? {} : { completed: input.completed }),
      ...(input.total === undefined ? {} : { total: input.total }),
      startedAt: timestamp,
      updatedAt: timestamp,
    });
    persistSnapshot(snapshot, input, false);
    return snapshot;
  });
}

/** Applies a validated merge patch to one active run. */
export function updateExternalProgress(
  input: UpdateExternalProgressInput,
): IssueImplementationProgressSnapshot {
  validatePatch(input.patch, false);
  const located = locateRun(input.runId, input);
  return withFileLock(runLockPath(located.file, input.runId), () => {
    const previous = locateRun(input.runId, input).snapshot;
    if (
      TERMINAL_STATUSES.has(previous.status as ExternalProgressTerminalStatus)
    ) {
      throw new Error('Terminal external progress runs are immutable');
    }
    if (
      input.patch.status !== undefined &&
      !ACTIVE_STATUSES.has(input.patch.status as ExternalProgressActiveStatus)
    ) {
      throw new Error('Use finishExternalProgress for terminal statuses');
    }
    const next = applyPatch(
      previous,
      input.patch,
      isoNowAfter(input.now, previous.updatedAt),
    );
    validateTransition(previous, next);
    persistSnapshot(next, input, true);
    return next;
  });
}

/** Marks one active run terminal, then best-effort retains the newest ten terminals. */
export function finishExternalProgress(
  input: FinishExternalProgressInput,
): IssueImplementationProgressSnapshot {
  validatePatch(input.patch ?? {}, true);
  if (!TERMINAL_STATUSES.has(input.status))
    throw new Error('Invalid terminal status');
  const located = locateRun(input.runId, input);
  const next = withFileLock(runLockPath(located.file, input.runId), () => {
    const previous = locateRun(input.runId, input).snapshot;
    if (
      TERMINAL_STATUSES.has(previous.status as ExternalProgressTerminalStatus)
    ) {
      throw new Error('Terminal external progress runs are immutable');
    }
    const timestamp = isoNowAfter(input.now, previous.updatedAt);
    const finished = parseIssueImplementationProgressSnapshot({
      ...applyPatch(previous, input.patch ?? {}, timestamp),
      status: input.status,
      updatedAt: timestamp,
      finishedAt: timestamp,
    });
    validateTransition(previous, finished);
    persistSnapshot(finished, input, true);
    return finished;
  });
  retainTerminalExternalProgress({
    projectKey: next.projectKey,
    homeDir: input.homeDir,
  });
  return next;
}

/** Atomically creates a prevalidated snapshot without replacing an existing run. */
export function writeExternalProgressSnapshot(
  snapshotValue: unknown,
  options: StorageOptions = {},
): IssueImplementationProgressSnapshot {
  const snapshot = parseIssueImplementationProgressSnapshot(snapshotValue);
  persistSnapshot(snapshot, options, false);
  return snapshot;
}

/** Reads valid snapshots for the current Git project; malformed files become diagnostics. */
export function readExternalProgressProject(
  options: ProjectOptions,
): ExternalProgressReadResult {
  return readProjectByKey(externalProgressProjectKey(options), options);
}

/** Selects all active runs and the newest terminal run without mutating storage. */
export function selectExternalProgress(
  options: ProjectOptions & { now?: Date },
): ExternalProgressSelection {
  const result = readExternalProgressProject(options);
  const active = result.snapshots
    .filter((snapshot) =>
      ACTIVE_STATUSES.has(snapshot.status as ExternalProgressActiveStatus),
    )
    .sort(compareSnapshots)
    .map((snapshot) => ({
      snapshot,
      stale: isExternalProgressStale(snapshot, options.now),
    }));
  const terminal = result.snapshots
    .filter((snapshot) =>
      TERMINAL_STATUSES.has(snapshot.status as ExternalProgressTerminalStatus),
    )
    .sort(compareTerminalSnapshots)
    .at(0);
  return {
    active,
    ...(terminal === undefined
      ? {}
      : { terminal: { snapshot: terminal, stale: false } }),
    diagnostics: result.diagnostics,
  };
}

export function isExternalProgressStale(
  snapshot: IssueImplementationProgressSnapshot,
  now: Date = new Date(),
): boolean {
  return (
    ACTIVE_STATUSES.has(snapshot.status as ExternalProgressActiveStatus) &&
    now.getTime() - Date.parse(snapshot.updatedAt) > STALE_AFTER_MS
  );
}

/** Best-effort retention; active files are untouched and read paths never call this. */
export function retainTerminalExternalProgress(
  options: StorageOptions & { cwd?: string; projectKey?: string },
): void {
  const projectKey =
    options.projectKey ??
    (options.cwd === undefined
      ? undefined
      : externalProgressProjectKey({ cwd: options.cwd }));
  if (!projectKey) throw new Error('Retention requires cwd or projectKey');
  const runsDir = runsDirForKey(projectKey, options);
  try {
    withFileLock(join(runsDir, '.retention.lock'), () => {
      const terminal = readProjectByKey(projectKey, options)
        .snapshots.filter((snapshot) =>
          TERMINAL_STATUSES.has(
            snapshot.status as ExternalProgressTerminalStatus,
          ),
        )
        .sort(compareTerminalSnapshots);
      for (const snapshot of terminal.slice(10)) {
        const file = join(runsDir, `${snapshot.runId}.json`);
        try {
          withFileLock(runLockPath(file, snapshot.runId), () => {
            const current = readSnapshotFile(file);
            if (
              current.projectKey === projectKey &&
              current.runId === snapshot.runId &&
              TERMINAL_STATUSES.has(
                current.status as ExternalProgressTerminalStatus,
              )
            ) {
              rmSync(file, { force: true });
            }
          });
        } catch {
          // A racing mutation or deletion is non-fatal; never delete without revalidation.
        }
      }
    });
  } catch {
    // Retention is best-effort and never blocks a successful terminal write.
  }
}

function readProjectByKey(
  projectKey: string,
  options: StorageOptions,
): ExternalProgressReadResult {
  let runsDir: string | undefined;
  let names: string[];
  try {
    runsDir = runsDirForKey(projectKey, options);
    names = readdirSync(runsDir).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (isMissingFileError(error)) return { snapshots: [], diagnostics: [] };
    return {
      snapshots: [],
      diagnostics: [
        {
          file: runsDir ?? externalProgressRoot(options),
          message: 'External progress storage is unreadable',
        },
      ],
    };
  }
  if (runsDir === undefined) return { snapshots: [], diagnostics: [] };
  const snapshots: IssueImplementationProgressSnapshot[] = [];
  const diagnostics: ExternalProgressDiagnostic[] = [];
  for (const name of names) {
    const file = join(runsDir, name);
    try {
      const parsed = readSnapshotFile(file);
      if (
        parsed.projectKey !== projectKey ||
        basename(file) !== `${parsed.runId}.json`
      ) {
        throw new Error('Snapshot does not belong to this project/path');
      }
      snapshots.push(parsed);
    } catch (error) {
      diagnostics.push({ file, message: conciseError(error) });
    }
  }
  return { snapshots, diagnostics };
}

function locateRun(
  runId: string,
  options: StorageOptions & { cwd?: string; source?: ExternalProgressSource },
): { snapshot: IssueImplementationProgressSnapshot; file: string } {
  validateUuid(runId, 'runId');
  let projectKeys: string[];
  try {
    projectKeys = options.cwd
      ? [externalProgressProjectKey({ cwd: options.cwd })]
      : readdirSync(
          safeStorageDirectory(
            options,
            ['.pi', 'addy-workflow', 'external-progress', 'projects'],
            false,
          ),
        ).filter((key) => PROJECT_KEY_PATTERN.test(key));
  } catch {
    throw new Error(`Unknown external progress run: ${runId}`);
  }
  const matches: {
    snapshot: IssueImplementationProgressSnapshot;
    file: string;
  }[] = [];
  for (const projectKey of projectKeys) {
    const file = join(runsDirForKey(projectKey, options), `${runId}.json`);
    try {
      const snapshot = readSnapshotFile(file);
      if (
        snapshot.projectKey !== projectKey ||
        snapshot.runId !== runId ||
        (options.source !== undefined && snapshot.source !== options.source)
      ) {
        throw new Error('Run ownership mismatch');
      }
      matches.push({ snapshot, file });
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw new Error(`Cannot read external progress run: ${runId}`);
    }
  }
  if (matches.length !== 1)
    throw new Error(`Unknown or ambiguous external progress run: ${runId}`);
  return matches[0]!;
}

function applyPatch(
  previous: IssueImplementationProgressSnapshot,
  patch: Record<string, unknown>,
  updatedAt: string,
): IssueImplementationProgressSnapshot {
  const candidate = {
    ...previous,
    ...patch,
    updatedAt,
  };
  const next = parseIssueImplementationProgressSnapshot(candidate);
  if (previous.total !== undefined && next.total !== previous.total) {
    throw new Error('total is immutable once set');
  }
  if (
    previous.completed !== undefined &&
    (next.completed ?? previous.completed) < previous.completed
  ) {
    throw new Error('completed cannot decrease');
  }
  return next;
}

function validateTransition(
  previous: IssueImplementationProgressSnapshot,
  next: IssueImplementationProgressSnapshot,
): void {
  if (
    previous.status !== next.status &&
    !(
      ACTIVE_STATUSES.has(previous.status as ExternalProgressActiveStatus) &&
      ACTIVE_STATUSES.has(next.status as ExternalProgressActiveStatus)
    ) &&
    !TERMINAL_STATUSES.has(next.status as ExternalProgressTerminalStatus)
  ) {
    throw new Error('Invalid status transition');
  }
  if (TERMINAL_STATUSES.has(next.status as ExternalProgressTerminalStatus))
    return;
  const allowed = allowedNextPhases(previous.loopPhase);
  if (!allowed.has(next.loopPhase)) {
    throw new Error(
      `Invalid loop phase transition: ${previous.loopPhase} -> ${next.loopPhase}`,
    );
  }
}

function allowedNextPhases(
  phase: ExternalProgressLoopPhase,
): Set<ExternalProgressLoopPhase> {
  switch (phase) {
    case 'pre-loop':
      return new Set(['pre-loop', 'queue']);
    case 'queue':
      return new Set(['queue', 'implementation']);
    case 'implementation':
      return new Set(['implementation', 'verification']);
    case 'verification':
      return new Set(['verification', 'review-fix', 'commit-merge']);
    case 'review-fix':
      return new Set([
        'review-fix',
        'implementation',
        'verification',
        'commit-merge',
      ]);
    case 'commit-merge':
      return new Set(['commit-merge', 'queue', 'post-loop']);
    case 'post-loop':
      return new Set(['post-loop']);
  }
}

function validatePatch(
  patch: Record<string, unknown>,
  terminal: boolean,
): void {
  if (!isRecord(patch)) throw new Error('Patch must be an object');
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCH_FIELDS.has(key) || value === undefined)
      throw new Error(`Unknown patch field: ${key}`);
    if (terminal && key === 'status')
      throw new Error('Finish status is provided separately');
  }
}

function ensureRunsDir(projectKey: string, options: StorageOptions): string {
  validateProjectKey(projectKey);
  return safeStorageDirectory(
    options,
    [
      '.pi',
      'addy-workflow',
      'external-progress',
      'projects',
      projectKey,
      'runs',
    ],
    true,
  );
}

function runsDirForKey(projectKey: string, options: StorageOptions): string {
  validateProjectKey(projectKey);
  return safeStorageDirectory(
    options,
    [
      '.pi',
      'addy-workflow',
      'external-progress',
      'projects',
      projectKey,
      'runs',
    ],
    false,
  );
}

function validateProjectKey(projectKey: string): void {
  if (!PROJECT_KEY_PATTERN.test(projectKey))
    throw new Error('Invalid project key');
}

function safeStorageDirectory(
  options: StorageOptions,
  segments: string[],
  create: boolean,
): string {
  let current = realpathSync(resolve(options.homeDir ?? homedir()));
  for (let index = 0; index < segments.length; index += 1) {
    const next = join(current, segments[index]!);
    try {
      const entry = lstatSync(next);
      if (entry.isSymbolicLink() || !entry.isDirectory())
        throw new Error(
          'External progress storage escapes its configured root',
        );
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      if (!create) return join(current, ...segments.slice(index));
      mkdirSync(next, { mode: 0o700 });
    }
    current = next;
  }
  return current;
}

type BoundedFile = {
  contents: string;
  dev: number | bigint;
  ino: number | bigint;
  mtimeMs: number;
};

function readBoundedRegularFile(file: string, maxBytes: number): BoundedFile {
  if (lstatSync(file).isSymbolicLink())
    throw new Error('Symlinks are not allowed');
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(
    file,
    constants.O_RDONLY | constants.O_NONBLOCK | noFollow,
  );
  try {
    const fileStat = fstatSync(descriptor, { bigint: true });
    if (!fileStat.isFile())
      throw new Error('Storage entry is not a regular file');
    if (fileStat.size > BigInt(maxBytes))
      throw new Error('Snapshot exceeds the size limit');
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > maxBytes)
      throw new Error('Snapshot exceeds the size limit');
    return {
      contents: buffer.subarray(0, bytesRead).toString('utf8'),
      dev: fileStat.dev,
      ino: fileStat.ino,
      mtimeMs: Number(fileStat.mtimeMs),
    };
  } finally {
    closeSync(descriptor);
  }
}

function readSnapshotFile(file: string): IssueImplementationProgressSnapshot {
  return parseIssueImplementationProgressSnapshot(
    JSON.parse(readBoundedRegularFile(file, MAX_SNAPSHOT_BYTES).contents),
  );
}

function persistSnapshot(
  snapshot: IssueImplementationProgressSnapshot,
  options: StorageOptions,
  overwrite: boolean,
): void {
  const runsDir = ensureRunsDir(snapshot.projectKey, options);
  const destination = join(runsDir, `${snapshot.runId}.json`);
  const temp = join(
    runsDir,
    `.${basename(destination)}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    writeFileSync(temp, `${JSON.stringify(snapshot)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    if (overwrite) renameSync(temp, destination);
    else linkSync(temp, destination);
  } finally {
    try {
      rmSync(temp, { force: true });
    } catch {
      // The rename already removed the temp path, or cleanup raced.
    }
  }
}

function runLockPath(file: string, runId: string): string {
  return join(dirname(file), `.run-${runId}.lock`);
}

function withFileLock<T>(lockPath: string, operation: () => T): T {
  const token = randomUUID();
  const deadline = Date.now() + 5_000;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    if (hasReclaimMarker(lockPath)) {
      if (Date.now() >= deadline)
        throw new Error('Could not acquire external progress lock');
      Atomics.wait(SLEEP_BUFFER, 0, 0, 10);
      continue;
    }
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }),
        'utf8',
      );
      if (hasReclaimMarker(lockPath) || !lockTokenMatches(lockPath, token)) {
        closeSync(descriptor);
        descriptor = undefined;
        releaseOwnedLock(lockPath, token);
        Atomics.wait(SLEEP_BUFFER, 0, 0, 10);
      }
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        descriptor = undefined;
        releaseOwnedLock(lockPath, token);
      }
      if (
        !isAlreadyExistsError(error) ||
        (!reclaimAbandonedLock(lockPath) && Date.now() >= deadline)
      ) {
        throw new Error('Could not acquire external progress lock');
      }
      Atomics.wait(SLEEP_BUFFER, 0, 0, 10);
    }
  }
  try {
    return operation();
  } finally {
    closeSync(descriptor);
    releaseOwnedLock(lockPath, token);
  }
}

function reclaimAbandonedLock(lockPath: string): boolean {
  if (hasReclaimMarker(lockPath)) return false;
  let observed: BoundedFile;
  let observedOwner: { pid?: unknown; token?: unknown } | undefined;
  try {
    observed = readBoundedRegularFile(lockPath, MAX_LOCK_BYTES);
    try {
      observedOwner = JSON.parse(observed.contents) as {
        pid?: unknown;
        token?: unknown;
      };
    } catch {
      if (Date.now() - observed.mtimeMs <= LOCK_STALE_AFTER_MS) return false;
    }
    const pid =
      typeof observedOwner?.pid === 'number' ? observedOwner.pid : undefined;
    if (pid !== undefined && isProcessAlive(pid)) return false;
  } catch (error) {
    if (isMissingFileError(error)) return true;
    try {
      const lockStat = lstatSync(lockPath, { bigint: true });
      if (
        lockStat.isSymbolicLink() ||
        !lockStat.isFile() ||
        Date.now() - Number(lockStat.mtimeMs) <= LOCK_STALE_AFTER_MS
      )
        return false;
      observed = {
        contents: '',
        dev: lockStat.dev,
        ino: lockStat.ino,
        mtimeMs: Number(lockStat.mtimeMs),
      };
    } catch {
      return false;
    }
  }

  const quarantine = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    renameSync(lockPath, quarantine);
    const moved = readBoundedRegularFile(quarantine, MAX_LOCK_BYTES);
    const observedToken =
      typeof observedOwner?.token === 'string'
        ? observedOwner.token
        : undefined;
    let movedToken: string | undefined;
    try {
      const movedOwner = JSON.parse(moved.contents) as { token?: unknown };
      movedToken =
        typeof movedOwner.token === 'string' ? movedOwner.token : undefined;
    } catch {
      // Generation comparison below still fences malformed lock files.
    }
    if (
      !sameGeneration(observed, moved) ||
      (observedToken !== undefined && movedToken !== observedToken)
    ) {
      renameSync(quarantine, lockPath);
      return false;
    }
    rmSync(quarantine, { force: true });
    return true;
  } catch (error) {
    rmSync(quarantine, { force: true });
    return isMissingFileError(error);
  }
}

function hasReclaimMarker(lockPath: string): boolean {
  const prefix = `${basename(lockPath)}.reclaim-`;
  try {
    for (const name of readdirSync(dirname(lockPath))) {
      if (!name.startsWith(prefix)) continue;
      const markerPath = join(dirname(lockPath), name);
      const pidText = name.slice(prefix.length).split('-', 1)[0];
      const pid = Number(pidText);
      if (Number.isSafeInteger(pid) && pid > 0 && isProcessAlive(pid))
        return true;
      rmSync(markerPath, { force: true });
    }
    return false;
  } catch {
    return false;
  }
}

function sameGeneration(left: BoundedFile, right: BoundedFile): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockTokenMatches(lockPath: string, token: string): boolean {
  try {
    const owner = JSON.parse(
      readBoundedRegularFile(lockPath, MAX_LOCK_BYTES).contents,
    ) as { token?: unknown };
    return owner.token === token;
  } catch {
    return false;
  }
}

function releaseOwnedLock(lockPath: string, token: string): void {
  try {
    if (lockTokenMatches(lockPath, token)) rmSync(lockPath, { force: true });
  } catch {
    // Another process reclaimed the lease or cleanup already completed.
  }
}

function isoNow(value: Date | undefined): string {
  const now = value ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Invalid current time');
  return now.toISOString();
}

function isoNowAfter(value: Date | undefined, previous: string): string {
  const now = isoNow(value);
  if (Date.parse(now) < Date.parse(previous))
    throw new Error('updatedAt cannot move backwards');
  return now;
}

function compareSnapshots(
  a: IssueImplementationProgressSnapshot,
  b: IssueImplementationProgressSnapshot,
): number {
  return a.runId.localeCompare(b.runId);
}

function compareTerminalSnapshots(
  a: IssueImplementationProgressSnapshot,
  b: IssueImplementationProgressSnapshot,
): number {
  const timeDifference = Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!);
  return timeDifference || b.runId.localeCompare(a.runId);
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0)
    throw new Error(`Invalid ${field}`);
  return result;
}

function optionalString(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  if (!(field in value)) return undefined;
  return requiredString(value, field);
}

function requiredEnum<T extends string>(
  value: Record<string, unknown>,
  field: string,
  choices: Set<T>,
): T {
  const result = requiredString(value, field);
  if (!choices.has(result as T)) throw new Error(`Invalid ${field}`);
  return result as T;
}

function optionalEnum<T extends string>(
  value: Record<string, unknown>,
  field: string,
  choices: Set<T>,
): T | undefined {
  if (!(field in value)) return undefined;
  return requiredEnum(value, field, choices);
}

function optionalCounter(
  value: Record<string, unknown>,
  field: string,
): number | undefined {
  if (!(field in value)) return undefined;
  const result = value[field];
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < 0
  ) {
    throw new Error(`Invalid ${field}`);
  }
  return result;
}

function optionalDisplayText(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  if (!(field in value)) return undefined;
  if (typeof value[field] !== 'string') throw new Error(`Invalid ${field}`);
  const normalized = value[field]
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (Array.from(normalized).length > 256)
    throw new Error(`${field} exceeds 256 Unicode code points`);
  return normalized || undefined;
}

function requiredIsoDate(
  value: Record<string, unknown>,
  field: string,
): string {
  const result = requiredString(value, field);
  if (
    Number.isNaN(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  ) {
    throw new Error(`Invalid ${field}`);
  }
  return result;
}

function optionalIsoDate(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  if (!(field in value)) return undefined;
  return requiredIsoDate(value, field);
}

function validateUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`Invalid ${field}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function conciseError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unreadable snapshot';
}

function isAlreadyExistsError(error: unknown): boolean {
  return isNodeError(error, 'EEXIST');
}

function isMissingFileError(error: unknown): boolean {
  return isNodeError(error, 'ENOENT');
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
