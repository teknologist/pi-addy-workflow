import { createHash } from 'node:crypto';
import type { WorkflowIssueStats } from './workflow-transitions.ts';

export type ReviewIssueSeverity =
  | 'critical'
  | 'important'
  | 'suggestion'
  | 'unknown';

export type ReviewIssueFinding = {
  line: string;
  severity: ReviewIssueSeverity;
};

function emptyReviewIssueStats(): WorkflowIssueStats {
  return { critical: 0, important: 0, suggestion: 0, unknown: 0, total: 0 };
}

export function reviewTextHasActionableFindings(text: string): boolean {
  return reviewIssueFindings(text).length > 0;
}

export function reviewFindingsFingerprint(text: string): string {
  const normalized =
    reviewFindingLines(text).join('\n') || text.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function reviewFindingLines(text: string): string[] {
  return reviewIssueFindings(text).map((finding) => finding.line);
}

export function reviewIssueStatsFromText(text: string): WorkflowIssueStats {
  const stats = emptyReviewIssueStats();
  for (const finding of reviewIssueFindings(text)) {
    stats[finding.severity] += 1;
    stats.total += 1;
  }
  return stats;
}

export function reviewIssueFindings(text: string): ReviewIssueFinding[] {
  const findings: ReviewIssueFinding[] = [];
  let sectionSeverity: ReviewIssueSeverity | undefined;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().toLowerCase();
    if (!line) continue;

    const heading = reviewActionableSectionHeading(line);
    if (heading) {
      sectionSeverity = heading.severity;
      if (
        heading.inlineFinding &&
        !reviewLineIsEmptyFinding(heading.inlineFinding)
      )
        findings.push({ line, severity: heading.severity });
      continue;
    }

    if (reviewAnySectionHeading(line)) {
      sectionSeverity = undefined;
      continue;
    }

    if (sectionSeverity) {
      if (reviewLineStartsFinding(line) && !reviewLineIsEmptyFinding(line))
        findings.push({ line, severity: sectionSeverity });
      continue;
    }

    if (
      (reviewLineLooksLikeFileLineCitation(line) ||
        /\b(blocking issue|blocker|must fix|should fix)\b/.test(line)) &&
      !reviewLineIsEmptyFinding(line)
    ) {
      findings.push({ line, severity: 'unknown' });
    }
  }

  if (findings.length === 0 && reviewTextClearlyFoundIssues(text))
    findings.push({ line: text.trim().toLowerCase(), severity: 'unknown' });
  return findings;
}

// Allow-list of file extensions used by `reviewLineLooksLikeFileLineCitation`
// to accept bare-filename citations like `config.json:5` while rejecting bare
// host:port tokens like `api.example.com:443`. Covers common source code,
// config, data, web, doc, and build manifests. New entries should be lower
// case and may be added when a real review surfaces a missed citation.
const REVIEW_CITATION_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  // source code
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'scala',
  'swift',
  'cs',
  'fs',
  'vb',
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'hxx',
  'm',
  'mm',
  'php',
  'lua',
  'pl',
  'pm',
  'r',
  'jl',
  'dart',
  'elm',
  'ex',
  'exs',
  'erl',
  'hrl',
  'clj',
  'cljs',
  'edn',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  // config / data
  'json',
  'jsonc',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'properties',
  'plist',
  'xml',
  'xsd',
  'xsl',
  'xslt',
  'proto',
  'graphql',
  'gql',
  'prisma',
  // web / markup
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'styl',
  'vue',
  'svelte',
  'astro',
  // docs
  'md',
  'mdx',
  'rst',
  'adoc',
  'txt',
  'tex',
  // build / lock manifests
  'gradle',
  'sbt',
  'lock',
  'mod',
  'sum',
]);

const REVIEW_CITATION_EXTENSIONLESS_FILENAMES: ReadonlySet<string> = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env',
  '.eslintignore',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  '.python-version',
  '.ruby-version',
  '.yarnrc',
  'appfile',
  'berksfile',
  'brewfile',
  'capfile',
  'deliverfile',
  'dockerfile',
  'fastfile',
  'gemfile',
  'guardfile',
  'jenkinsfile',
  'justfile',
  'makefile',
  'matchfile',
  'podfile',
  'procfile',
  'rakefile',
  'taskfile',
  'vagrantfile',
]);

function reviewCitationIsAllowedExtensionlessFilename(prefix: string): boolean {
  const normalized = prefix.toLowerCase();
  return (
    REVIEW_CITATION_EXTENSIONLESS_FILENAMES.has(normalized) ||
    normalized.startsWith('.env.')
  );
}

function reviewLineLooksLikeFileLineCitation(line: string): boolean {
  // Heuristic to catch `src/foo.ts:42` style citations that the agent forgot
  // to put under a Critical/Important/Suggestion section. We must NOT match
  // host:port tokens such as `localhost:3031`, `127.0.0.1:443`,
  // `api.example.com:443`, or URLs like `http://localhost:3031` that
  // legitimately appear in /addy-verify proof blocks for clean reviews.
  // Those proof lines are stable across iterations and would otherwise
  // produce a deterministic fingerprint that trips the auto loop's "same
  // review finding repeated" pause.
  for (const match of line.matchAll(/(^|[^\w/.-])([\w./-]+):\d+\b/g)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    // Skip URL host tokens: when `://` immediately precedes the match, the
    // matched text is the host portion of a URL such as `localhost:3031` in
    // `http://localhost:3031`. We skip just this match and keep scanning,
    // so a line like `src/server.ts:42 see http://localhost:3031` is still
    // recognised as actionable via the earlier `src/server.ts:42` match.
    if (line.slice(0, start).endsWith('://')) continue;
    const prefix = match[2] ?? '';
    if (line.slice(0, start).endsWith(':') && prefix.startsWith('//')) continue;
    // Path-shaped prefix is a strong file:line signal.
    if (prefix.includes('/')) return true;
    if (reviewCitationIsAllowedExtensionlessFilename(prefix)) return true;
    // Bare filename: require the final dot-suffix to be in the allow-list of
    // known file extensions. This rejects hostnames like `example.com:443`,
    // `service.local:8080`, `db.example.org:5432` whose tail extension is a
    // TLD, not a source file extension.
    const extension = prefix.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (extension && prefix.includes('.')) {
      const dotCount = [...prefix].filter((char) => char === '.').length;
      if (dotCount > 1) continue;
    }
    if (extension && REVIEW_CITATION_FILE_EXTENSIONS.has(extension))
      return true;
  }
  return false;
}

function reviewTextClearlyFoundIssues(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (
    !lower ||
    /\bno (?:actionable )?(?:issues|findings)(?: found)?\b/.test(lower)
  )
    return false;
  return (
    /\b(?:found|surfaced|identified|reported|detected)\b[\s\S]{0,80}\b(?:issues?|findings?|problems?)\b/.test(
      lower,
    ) ||
    /\b(?:issues?|findings?|problems?)\b[\s\S]{0,40}\b(?:found|surfaced|identified|reported|detected)\b/.test(
      lower,
    )
  );
}

function reviewActionableSectionHeading(
  line: string,
): { severity: ReviewIssueSeverity; inlineFinding: string } | undefined {
  const match = line.match(
    /^(?:#+\s*)?(?:\*\*)?(critical(?: issues?)?|important(?: issues?)?|warnings?|suggestions?)(?:\*\*)?\s*:?\s*(.*)$/i,
  );
  if (!match) return undefined;
  const label = match[1]?.toLowerCase() ?? '';
  const severity: ReviewIssueSeverity = label.startsWith('critical')
    ? 'critical'
    : label.startsWith('suggestion')
      ? 'suggestion'
      : 'important';
  return { severity, inlineFinding: match[2]?.trim() ?? '' };
}

function reviewAnySectionHeading(line: string): boolean {
  return /^(?:#+\s*)?(?:\*\*)?[a-z][\w\s-]{0,40}(?:\*\*)?\s*:?\s*$/i.test(line);
}

function reviewLineIsEmptyFinding(line: string): boolean {
  return /^(?:[-*•]|\d+\.)?\s*(?:none|none found|n\/a|no issues(?: found)?|no findings|no actionable (?:issues|findings)|critical issues?: none|warnings?: none|suggestions?: none)\.?$/i.test(
    line,
  );
}

function reviewLineStartsFinding(line: string): boolean {
  return /^(?:[-*•]|\d+[.)])\s+\S/.test(line);
}
