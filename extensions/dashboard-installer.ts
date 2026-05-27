import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  ensureDashboardShim,
  dashboardShimUsage,
} from './dashboard-installer/core.ts';

type UiContext = {
  ui?: {
    notify?: (message: string, level?: string) => void;
    setStatus?: (key: string, message: string) => void;
  };
};

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
  pi.on('session_start', async (_event: unknown, ctx: UiContext) => {
    installDashboardShim(ctx);
  });
  pi.on('resources_discover', async (_event: unknown, ctx: UiContext) => {
    installDashboardShim(ctx);
    return {};
  });
}
