import { readFile } from 'node:fs/promises';

const PROVENANCE =
  /^<!-- provenance: source=.+; (?:commit=[0-9a-f]{40}; )?sha256=[0-9a-f]{64}(?:,[0-9a-f]{64})?; captured=\d{4}-\d{2}-\d{2} -->$/m;

export async function loadTrackerFixture(name: string): Promise<string> {
  return readFile(new URL(`${name}.md`, import.meta.url), 'utf8');
}

export function validateTrackerFixture(
  content: string,
  required: readonly string[],
  forbidden: readonly string[] = [],
): void {
  if (!PROVENANCE.test(content))
    throw new Error('Fixture provenance is missing or malformed.');
  for (const value of required)
    if (!content.includes(value))
      throw new Error(`Fixture is missing required contract: ${value}`);
  for (const value of forbidden)
    if (content.includes(value))
      throw new Error(`Fixture contains forbidden contract: ${value}`);
}
