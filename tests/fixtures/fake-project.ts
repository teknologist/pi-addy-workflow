import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type FakeTask = {
  id: string;
  title: string;
  implemented?: boolean;
  verified?: boolean;
  reviewed?: boolean;
  committed?: boolean;
};

export type FakeSlice = {
  path: string;
  title: string;
  tasks: FakeTask[];
};

export type FakeAddyProject = {
  cwd: string;
  indexPath: string;
  slices: FakeSlice[];
};

const DEFAULT_SLICES: FakeSlice[] = [
  {
    path: join('docs', 'plans', '001-setup.md'),
    title: 'Slice 001 - Setup',
    tasks: [
      { id: 'setup-cli', title: 'Add baseline CLI' },
      { id: 'setup-config', title: 'Add config file' },
    ],
  },
  {
    path: join('docs', 'plans', '002-feature.md'),
    title: 'Slice 002 - Feature',
    tasks: [
      { id: 'feature-command', title: 'Add feature command' },
      { id: 'feature-docs', title: 'Add feature docs' },
    ],
  },
];

export function createFakeAddyProject(
  slices: FakeSlice[] = DEFAULT_SLICES,
): FakeAddyProject {
  slices = slices.map((slice) => ({
    ...slice,
    tasks: slice.tasks.map((task) => ({ ...task })),
  }));
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-auto-fixture-'));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  mkdirSync(join(cwd, 'tests'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'addy-auto-fixture', private: true }, null, 2),
  );
  writeFileSync(join(cwd, 'src', 'index.ts'), 'export const ok = true;\n');
  writeFileSync(join(cwd, 'tests', 'index.test.ts'), 'export {};\n');

  const indexPath = join('docs', 'plans', 'index.md');
  writeFileSync(
    join(cwd, indexPath),
    [
      '# Fake Addy Auto Index',
      '',
      '| Slice | File |',
      '| --- | --- |',
      ...slices.map(
        (slice) => `| ${slice.title} | \`${slice.path.replace(/\\/g, '/')}\` |`,
      ),
      '',
    ].join('\n'),
  );
  for (const slice of slices) writeSlice(cwd, slice);

  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fake@example.test'], {
    cwd,
    stdio: 'ignore',
  });
  execFileSync('git', ['config', 'user.name', 'Fake Addy'], {
    cwd,
    stdio: 'ignore',
  });
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', 'commit', '-m', 'initial fixture'],
    {
      cwd,
      stdio: 'ignore',
    },
  );

  return { cwd, indexPath, slices };
}

export function setTaskStatuses(
  project: FakeAddyProject,
  sliceIndex: number,
  taskId: string,
  statuses: Partial<
    Pick<FakeTask, 'implemented' | 'verified' | 'reviewed' | 'committed'>
  >,
): void {
  const slice = project.slices[sliceIndex - 1];
  if (!slice) throw new Error(`Unknown slice ${sliceIndex}`);
  const task = slice.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Unknown task ${taskId}`);
  Object.assign(task, statuses);
  writeSlice(project.cwd, slice);
}

export function renameTask(
  project: FakeAddyProject,
  sliceIndex: number,
  taskId: string,
  title: string,
): void {
  const slice = project.slices[sliceIndex - 1];
  if (!slice) throw new Error(`Unknown slice ${sliceIndex}`);
  const task = slice.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Unknown task ${taskId}`);
  task.title = title;
  writeSlice(project.cwd, slice);
}

export function readPlan(project: FakeAddyProject, sliceIndex: number): string {
  const slice = project.slices[sliceIndex - 1];
  if (!slice) throw new Error(`Unknown slice ${sliceIndex}`);
  return readFileSync(join(project.cwd, slice.path), 'utf8');
}

function writeSlice(cwd: string, slice: FakeSlice): void {
  writeFileSync(
    join(cwd, slice.path),
    [
      `# ${slice.title}`,
      '',
      ...slice.tasks.flatMap((task, index) => [
        `## Task ${index + 1}: ${task.title}`,
        '',
        `<!-- addy-task-id: ${task.id} -->`,
        '',
        checkbox('Implemented', task.implemented),
        checkbox('Verified', task.verified),
        checkbox('Reviewed', task.reviewed),
        checkbox('Committed', task.committed),
        '',
      ]),
    ].join('\n'),
  );
}

function checkbox(label: string, checked: boolean | undefined): string {
  return `- [${checked ? 'x' : ' '}] ${label}`;
}
