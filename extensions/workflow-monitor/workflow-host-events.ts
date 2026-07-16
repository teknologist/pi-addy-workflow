import type { AutoFreshReason } from './workflow-transitions.ts';

export type CommandEvent = string | { args?: string[]; input?: string };
export type InputEvent = { input?: string; text?: string; source?: string };
export type ToolEvent = {
  command?: string;
  text?: string;
  success?: boolean;
  artifact?: string;
};
export type ToolCallEvent = {
  toolName?: string;
  name?: string;
  input?: Record<string, unknown>;
};
export type SubagentEvent = { agent?: string; agentName?: string };

const WRITE_TOOL_NAMES = new Set([
  'write',
  'edit',
  'multi_edit',
  'obsidian_obsidian_append_content',
  'obsidian_obsidian_patch_content',
]);

export function tokenizeCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\' && quote !== "'") escaped = true;
    else if (quote) {
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
  if (escaped || quote)
    throw new SyntaxError(
      'Unterminated quote or dangling escape in command line.',
    );
  if (current) args.push(current);
  return args;
}

export function parseCommandArgs(event: CommandEvent): string[] {
  if (typeof event === 'string') return tokenizeCommandLine(event);
  return event.args ?? (event.input ? tokenizeCommandLine(event.input) : []);
}

export function quoteCommandArg(arg: string): string {
  return /[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg;
}

export function commandFromArgs(command: string, args: string[]): string {
  return `${command}${args.length ? ` ${args.map(quoteCommandArg).join(' ')}` : ''}`;
}

export function inputTextFromEvent(event: InputEvent): string {
  return event.input ?? event.text ?? '';
}

export function parseAutoFreshReason(
  event: CommandEvent,
): AutoFreshReason | undefined {
  const args = parseCommandArgs(event);
  const freshIndex = args.indexOf('--fresh');
  const value = freshIndex >= 0 ? args[freshIndex + 1] : args[0];
  return value === 'between-tasks' ||
    value === 'before-step' ||
    value === 'before-review'
    ? value
    : undefined;
}

export function isSubagentChildSession(): boolean {
  return process.env.PI_SUBAGENT_CHILD === '1';
}

export function extractWriteArtifact(event: ToolCallEvent): string | undefined {
  const toolName = event.toolName ?? event.name ?? '';
  const input = event.input ?? {};
  if (!WRITE_TOOL_NAMES.has(toolName)) return undefined;

  for (const key of ['path', 'file_path', 'filepath']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }

  return undefined;
}

export function subagentNameFromEvent(
  event: SubagentEvent,
): string | undefined {
  return event.agentName ?? event.agent;
}

export function isStaleExtensionContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      'This extension ctx is stale after session replacement',
    )
  );
}
