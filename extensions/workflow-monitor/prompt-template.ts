import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_TEMPLATE_BY_COMMAND } from './command-router.ts';

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPTS_ROOT = join(MODULE_ROOT, '..', '..', 'prompts');

export type PromptTemplateDeps = {
  promptsRoot?: string;
  readFile?: (path: string) => string;
};

export function expandPackagedPromptTemplate(
  prompt: string,
  deps: PromptTemplateDeps = {},
): string {
  const trimmed = prompt.trim();
  const [command] = trimmed.split(/\s+/, 1);
  const templateName = PROMPT_TEMPLATE_BY_COMMAND[command];
  if (!templateName) return prompt;

  try {
    const argsString = trimmed.slice(command.length).trim();
    const readTemplate =
      deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
    const template = stripFrontmatter(
      readTemplate(
        join(deps.promptsRoot ?? DEFAULT_PROMPTS_ROOT, templateName),
      ),
    );
    const expanded = substituteTemplateArgs(
      template,
      parseTemplateArgs(argsString),
    ).trimEnd();
    return `${expanded}\n\nInvocation: \`${prompt}\``;
  } catch {
    return prompt;
  }
}

export function parseTemplateArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const char of argsString) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else current += char;
  }
  if (current) args.push(current);
  return args;
}

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

export function substituteTemplateArgs(
  content: string,
  args: string[],
): string {
  let result = content.replace(
    /\$(\d+)/g,
    (_match, rawIndex: string) => args[Number.parseInt(rawIndex, 10) - 1] ?? '',
  );
  result = result.replace(
    /\$\{@:(\d+)(?::(\d+))?\}/g,
    (_match, rawStart: string, rawLength: string | undefined) => {
      const start = Math.max(0, Number.parseInt(rawStart, 10) - 1);
      if (rawLength)
        return args
          .slice(start, start + Number.parseInt(rawLength, 10))
          .join(' ');
      return args.slice(start).join(' ');
    },
  );
  const allArgs = args.join(' ');
  return result.replace(/\$ARGUMENTS/g, allArgs).replace(/\$@/g, allArgs);
}
