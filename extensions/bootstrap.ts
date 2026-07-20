import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { injectAddyBootstrap } from './bootstrap/core.ts';

type MutableContext = {
  systemPrompt?: string;
  tools?: string[] | Record<string, unknown>;
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
};

function normalizeTools(tools: MutableContext['tools']): string[] | undefined {
  if (Array.isArray(tools)) return tools;
  if (tools && typeof tools === 'object') return Object.keys(tools);
  return undefined;
}

export default function addyBootstrap(pi: ExtensionAPI) {
  pi.on('before_agent_start', async (_event: unknown, ctx: MutableContext) => {
    const nextPrompt = injectAddyBootstrap({
      systemPrompt: ctx.systemPrompt,
      tools: normalizeTools(ctx.tools),
    });

    if (nextPrompt !== undefined) ctx.systemPrompt = nextPrompt;
  });
}
