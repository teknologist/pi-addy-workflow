import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AddyWorkflowConfig = {
  auto: {
    freshContext: {
      betweenTasks: boolean;
      beforeReview: boolean;
    };
  };
};

type ConfigContext = {
  cwd?: string;
  ui?: { notify?: (message: string, level?: string) => void };
};

type ConfigEnv = Record<string, string | undefined>;

const DEFAULT_CONFIG: AddyWorkflowConfig = {
  auto: {
    freshContext: {
      betweenTasks: true,
      beforeReview: false,
    },
  },
};

function cloneDefaultConfig(): AddyWorkflowConfig {
  return {
    auto: {
      freshContext: {
        betweenTasks: DEFAULT_CONFIG.auto.freshContext.betweenTasks,
        beforeReview: DEFAULT_CONFIG.auto.freshContext.beforeReview,
      },
    },
  };
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function mergeConfig(base: AddyWorkflowConfig, raw: unknown): AddyWorkflowConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as { auto?: { freshContext?: { betweenTasks?: unknown; beforeReview?: unknown } } };
  const freshContext = candidate.auto?.freshContext;
  if (freshContext === undefined) return base;
  if (typeof freshContext !== "object" || freshContext === null) return undefined;

  const betweenTasks = freshContext.betweenTasks === undefined ? undefined : coerceBoolean(freshContext.betweenTasks);
  const beforeReview = freshContext.beforeReview === undefined ? undefined : coerceBoolean(freshContext.beforeReview);
  if (freshContext.betweenTasks !== undefined && betweenTasks === undefined) return undefined;
  if (freshContext.beforeReview !== undefined && beforeReview === undefined) return undefined;

  return {
    auto: {
      freshContext: {
        betweenTasks: betweenTasks ?? base.auto.freshContext.betweenTasks,
        beforeReview: beforeReview ?? base.auto.freshContext.beforeReview,
      },
    },
  };
}

function readConfigFile(path: string, base: AddyWorkflowConfig, notify?: (message: string, level?: string) => void): AddyWorkflowConfig {
  if (!existsSync(path)) return base;

  try {
    const merged = mergeConfig(base, JSON.parse(readFileSync(path, "utf8")));
    if (merged) return merged;
  } catch {
    // Fall through to warning/default handling.
  }

  notify?.(`Ignoring invalid Addy workflow config: ${path}`, "warning");
  return base;
}

function applyEnv(config: AddyWorkflowConfig, env: ConfigEnv): AddyWorkflowConfig {
  const betweenTasks = coerceBoolean(env.PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS);
  const beforeReview = coerceBoolean(env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW);

  return {
    auto: {
      freshContext: {
        betweenTasks: betweenTasks ?? config.auto.freshContext.betweenTasks,
        beforeReview: beforeReview ?? config.auto.freshContext.beforeReview,
      },
    },
  };
}

export function loadAddyWorkflowConfig(ctx: ConfigContext = {}, env: ConfigEnv = process.env): AddyWorkflowConfig {
  const notify = ctx.ui?.notify;
  let config = cloneDefaultConfig();
  config = readConfigFile(join(homedir(), ".pi", "agent", "addy-workflow.json"), config, notify);
  if (ctx.cwd) config = readConfigFile(join(ctx.cwd, ".pi", "addy-workflow.json"), config, notify);
  return applyEnv(config, env);
}
