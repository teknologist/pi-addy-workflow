import { readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import {
  resolveWorkflowPlanPath,
  resolveWorkflowPlanPathRelativeTo,
} from './workflow-plan-path.ts';

function uniqueDefined(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function cleanScopeValue(value: string): string | undefined {
  const cleaned = value
    .replace(/[.;]\s*$/, '')
    .replace(/\s+only$/i, '')
    .trim();
  if (!cleaned) return undefined;
  if (/^(?:current repo(?:sitory)?|owner repo(?:sitory)?)$/i.test(cleaned))
    return cleaned;
  if (/\s/.test(cleaned)) return undefined;
  return cleaned;
}

export function normalizeTicketRepositoryRequest(
  value: string,
  repositoryRoot?: string,
): string {
  const cleaned = cleanScopeValue(value);
  if (!cleaned) throw new Error('Ticket repository request is empty.');
  if (isAbsolute(cleaned)) return resolve(cleaned);
  if (!repositoryRoot)
    throw new Error(
      'Relative Ticket repository request requires the owning repository root.',
    );
  return resolve(repositoryRoot, cleaned);
}

export function normalizeRepositoryScope(
  value: string,
  baseCwd?: string,
): string | undefined {
  const cleaned = cleanScopeValue(value);
  if (!cleaned) return undefined;
  if (/^(?:current repo(?:sitory)?|owner repo(?:sitory)?)$/i.test(cleaned))
    return baseCwd;
  if (isAbsolute(cleaned)) return cleaned;
  const relativeRepoPath =
    cleaned.startsWith('./') ||
    cleaned.startsWith('../') ||
    cleaned === '.' ||
    cleaned === '..';
  if (relativeRepoPath) return resolve(baseCwd ?? process.cwd(), cleaned);
  if (baseCwd && basename(baseCwd) === cleaned) return baseCwd;
  return cleaned;
}

function extractBacktickedValues(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)]
    .map((match) => cleanScopeValue(match[1] ?? ''))
    .filter((value): value is string => Boolean(value));
}

function extractRepositoryScopeLineValues(markdown: string): string[] {
  const line = markdown.match(/^Repository scope:\s*(.+)$/im)?.[1];
  if (!line) return [];
  const backticked = extractBacktickedValues(line);
  if (backticked.length > 0) return backticked;
  return line
    .split(/,|\band\b/i)
    .map((value) => cleanScopeValue(value) ?? '')
    .filter(Boolean);
}

function extractIndexPlanPath(markdown: string): string | undefined {
  return markdown.match(/^Index:\s*`([^`]+)`/im)?.[1]?.trim();
}

function labeledMarkdownValue(
  markdown: string,
  label: string,
): string | undefined {
  const prefix = `**${label}:**`;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase()))
      return trimmed.slice(prefix.length).trim();
  }
  return undefined;
}

function extractOwnerAndCompanionRepos(markdown: string): string[] {
  const repos: string[] = [];
  for (const label of ['Owner repo', 'Companion repo']) {
    const line = labeledMarkdownValue(markdown, label);
    if (!line) continue;
    const backticked = extractBacktickedValues(line);
    repos.push(
      ...(backticked.length > 0
        ? backticked
        : [cleanScopeValue(line.replace(/^sibling\s+/i, ''))].filter(
            (value): value is string => Boolean(value),
          )),
    );
  }
  return repos;
}

function normalizedRepositoryScopes(
  ownershipMarkdown: string,
  scopeMarkdown: string,
  baseCwd: string | undefined,
): string[] {
  return uniqueDefined([
    baseCwd,
    ...extractOwnerAndCompanionRepos(ownershipMarkdown).map((value) =>
      normalizeRepositoryScope(value, baseCwd),
    ),
    ...extractRepositoryScopeLineValues(scopeMarkdown).map((value) =>
      normalizeRepositoryScope(value, baseCwd),
    ),
  ]);
}

export function repositoryScopesFromMarkdown(
  markdown: string,
  baseCwd: string,
): string[] {
  return normalizedRepositoryScopes(markdown, markdown, baseCwd);
}

export function repositoryScopesForPlan(
  planPath: string | undefined,
  baseCwd?: string,
): string[] {
  if (!planPath) return baseCwd ? [baseCwd] : [];

  try {
    const resolvedPlanPath = resolveWorkflowPlanPath(planPath, baseCwd);
    const markdown = readFileSync(resolvedPlanPath, 'utf8');
    const indexPlanPath = extractIndexPlanPath(markdown);
    let indexMarkdown = '';
    if (indexPlanPath) {
      try {
        indexMarkdown = readFileSync(
          resolveWorkflowPlanPathRelativeTo(
            indexPlanPath,
            resolvedPlanPath,
            baseCwd,
          ),
          'utf8',
        );
      } catch {
        indexMarkdown = '';
      }
    }

    return normalizedRepositoryScopes(
      indexMarkdown || markdown,
      markdown,
      baseCwd,
    );
  } catch {
    return baseCwd ? [baseCwd] : [];
  }
}

export function repositoryScopeForPlan(
  planPath: string | undefined,
  baseCwd?: string,
): string | undefined {
  const scopes = repositoryScopesForPlan(planPath, baseCwd);
  return scopes.length > 0 ? scopes.join('; ') : undefined;
}
