import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  ensureDashboardShim,
  dashboardShimUsage,
  launchDashboardCommand,
} from './dashboard-installer/core.ts';

type UiContext = {
  cwd?: string;
  ui?: {
    notify?: (message: string, level?: string) => void;
    setStatus?: (key: string, message: string) => void;
  };
};

// Kept local so the dashboard installer stays independent of workflow-monitor.
type CommandEvent = string | { args?: string[]; input?: string };

function commandArgs(event: CommandEvent): string[] {
  if (typeof event === 'string') return event.split(/\s+/).filter(Boolean);
  return event.args ?? event.input?.split(/\s+/).filter(Boolean) ?? [];
}

function installDashboardShim(ctx: UiContext): void {
  ctx.ui?.setStatus?.('addy-dashboard', 'Dashboard: addy-dashboard');
  // Fire-and-forget: installing the shim must never delay Pi startup.
  void ensureDashboardShim(import.meta.url)
    .then((result) => {
      if (result.changed) ctx.ui?.notify?.(dashboardShimUsage(result), 'info');
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify?.(
        `pi-addy-workflow dashboard shim install failed: ${message}`,
        'warning',
      );
    });
}

export default function addyDashboardInstaller(pi: ExtensionAPI) {
  pi.registerCommand?.('addy-dashboard', {
    description:
      'Start the Addy dashboard and open http://127.0.0.1:3848. Use --public to bind 0.0.0.0.',
    handler: (event: CommandEvent, ctx: UiContext) => {
      const plan = launchDashboardCommand(import.meta.url, commandArgs(event), {
        cwd: ctx.cwd ?? process.cwd(),
      });
      ctx.ui?.notify?.(
        `Opening Addy dashboard at ${plan.url}${plan.public ? ' (public bind)' : ''}. If it was already running, the existing server is reused.`,
        'info',
      );
      return { action: 'continue' };
    },
  });

  pi.on('session_start', async (_event: unknown, ctx: UiContext) => {
    installDashboardShim(ctx);
  });
  pi.on('resources_discover', async (_event: unknown, ctx: UiContext) => {
    installDashboardShim(ctx);
    return {};
  });
}
