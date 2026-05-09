import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultAgentTargetRoot, packageAgentSourceRoot, relativeAgentSyncSummary, syncAgents } from "./agent-installer/core.ts";

type UiContext = {
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
};

async function syncBundledAgents(ctx: UiContext): Promise<void> {
  const targetRoot = defaultAgentTargetRoot();

  try {
    const result = await syncAgents({
      sourceRoot: packageAgentSourceRoot(import.meta.url),
      targetRoot,
    });

    if (result.written.length > 0 || result.removed.length > 0) {
      ctx.ui?.notify?.(relativeAgentSyncSummary(result, targetRoot), "info");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui?.notify?.(`pi-addy-workflow agent sync failed: ${message}`, "warning");
  }
}

export default function addyAgentInstaller(pi: ExtensionAPI) {
  pi.on("session_start", async (_event: unknown, ctx: UiContext) => syncBundledAgents(ctx));
  pi.on("resources_discover", async (_event: unknown, ctx: UiContext) => {
    await syncBundledAgents(ctx);
    return {};
  });
}
