export const ADDY_BOOTSTRAP_MARKER = '<!-- pi-addy-workflow-bootstrap -->';

export type BootstrapToolAvailability = {
  todo?: boolean;
  subagent?: boolean;
};

export type BootstrapOptions = {
  systemPrompt?: string;
  tools?: BootstrapToolAvailability | string[];
  env?: Record<string, string | undefined>;
};

export function shouldSkipBootstrap(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const depth = Number(env.PI_SUBAGENT_DEPTH ?? '0');
  return Number.isFinite(depth) && depth > 0;
}

export function toolAvailable(
  tools: BootstrapToolAvailability | string[] | undefined,
  name: 'todo' | 'subagent',
): boolean {
  if (Array.isArray(tools)) return tools.includes(name);
  return tools?.[name] === true;
}

export function buildAddyBootstrap(
  tools?: BootstrapToolAvailability | string[],
): string {
  const warnings: string[] = [];

  if (!toolAvailable(tools, 'todo')) {
    warnings.push(
      '- Warning: `todo` tool unavailable; track Addy workflow tasks manually or install the todo companion package.',
    );
  }

  if (!toolAvailable(tools, 'subagent')) {
    warnings.push(
      '- Warning: `subagent` tool unavailable; run Addy review/ship fan-out manually or install pi-subagents.',
    );
  }

  return [
    ADDY_BOOTSTRAP_MARKER,
    '# Addy workflow for Pi',
    '',
    'Use `using-addy-workflow` as the governing workflow skill.',
    '',
    'Lifecycle:',
    '- Define before code when useful: `/addy-define` clarifies objective and acceptance criteria.',
    '- Plan before build: `/addy-plan` slices small verifiable tasks.',
    '- Build incrementally: `/addy-build` changes one vertical slice at a time.',
    '- Simplify optionally: `/addy-code-simplify` preserves behavior while reducing complexity.',
    '- Verify behavior: `/addy-verify` follows red-green-refactor or Prove-It bug flow.',
    '- Review before finish: `/addy-review` checks correctness, quality, security, performance.',
    '- Fix review findings: `/addy-fix-all` resolves surfaced issues and suggestions, then reruns review.',
    '- Finish the slice: `/addy-finish` can commit current work, continue the next task or slice, or ship when complete.',
    '- Keep plan checkboxes synced: implemented, verified, and reviewed must match real evidence.',
    '',
    'Pi mappings:',
    '- Task tracking → `todo`.',
    '- Delegated reviewers/implementers → `subagent`.',
    '- File reads/writes → Pi native file tools.',
    ...(warnings.length > 0 ? ['', 'Companion warnings:', ...warnings] : []),
  ]
    .join('\n')
    .trimEnd();
}

export function injectAddyBootstrap(
  options: BootstrapOptions = {},
): string | undefined {
  const systemPrompt = options.systemPrompt ?? '';
  if (shouldSkipBootstrap(options.env)) return systemPrompt;
  if (systemPrompt.includes(ADDY_BOOTSTRAP_MARKER)) return systemPrompt;

  const block = buildAddyBootstrap(options.tools);
  return systemPrompt ? `${systemPrompt}\n\n${block}` : block;
}
