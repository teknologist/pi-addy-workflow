import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type AddyWorkflowConfig = {
  auto: {
    freshContext: {
      beforeEveryStep: boolean;
      betweenTasks: boolean;
      beforeReview: boolean;
    };
    review: {
      maxFixLoops: number;
    };
    notifications: {
      pushover: {
        enabled: boolean;
        appToken?: string;
        userKey?: string;
        priority: number;
      };
    };
  };
};

type ConfigContext = {
  cwd?: string;
  ui?: { notify?: (message: string, level?: string) => void };
};

type ConfigEnv = Record<string, string | undefined>;

export const DEFAULT_ADDY_WORKFLOW_CONFIG: AddyWorkflowConfig = {
  auto: {
    freshContext: {
      beforeEveryStep: true,
      betweenTasks: true,
      beforeReview: false,
    },
    review: {
      maxFixLoops: 3,
    },
    notifications: {
      pushover: {
        enabled: false,
        priority: 0,
      },
    },
  },
};

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function coercePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return undefined;
  const number = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function coerceInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) return undefined;
  const number = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(number) ? number : undefined;
}

function mergeConfig(
  base: AddyWorkflowConfig,
  raw: unknown,
): AddyWorkflowConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const candidate = raw as {
    auto?: {
      freshContext?: {
        beforeEveryStep?: unknown;
        betweenTasks?: unknown;
        beforeReview?: unknown;
      };
      review?: {
        maxFixLoops?: unknown;
      };
      notifications?: {
        pushover?: {
          enabled?: unknown;
          appToken?: unknown;
          userKey?: unknown;
          priority?: unknown;
        };
      };
    };
  };
  const freshContext = candidate.auto?.freshContext;
  const review = candidate.auto?.review;
  const pushover = candidate.auto?.notifications?.pushover;
  if (
    freshContext === undefined &&
    review === undefined &&
    pushover === undefined
  )
    return base;
  if (
    freshContext !== undefined &&
    (typeof freshContext !== 'object' || freshContext === null)
  )
    return undefined;
  if (review !== undefined && (typeof review !== 'object' || review === null))
    return undefined;
  if (
    pushover !== undefined &&
    (typeof pushover !== 'object' || pushover === null)
  )
    return undefined;

  const beforeEveryStep =
    freshContext?.beforeEveryStep === undefined
      ? undefined
      : coerceBoolean(freshContext.beforeEveryStep);
  const betweenTasks =
    freshContext?.betweenTasks === undefined
      ? undefined
      : coerceBoolean(freshContext.betweenTasks);
  const beforeReview =
    freshContext?.beforeReview === undefined
      ? undefined
      : coerceBoolean(freshContext.beforeReview);
  const maxFixLoops =
    review?.maxFixLoops === undefined
      ? undefined
      : coercePositiveInteger(review.maxFixLoops);
  const pushoverEnabled =
    pushover?.enabled === undefined
      ? undefined
      : coerceBoolean(pushover.enabled);
  const pushoverPriority =
    pushover?.priority === undefined
      ? undefined
      : coerceInteger(pushover.priority);
  if (
    freshContext?.beforeEveryStep !== undefined &&
    beforeEveryStep === undefined
  )
    return undefined;
  if (freshContext?.betweenTasks !== undefined && betweenTasks === undefined)
    return undefined;
  if (freshContext?.beforeReview !== undefined && beforeReview === undefined)
    return undefined;
  if (review?.maxFixLoops !== undefined && maxFixLoops === undefined)
    return undefined;
  if (pushover?.enabled !== undefined && pushoverEnabled === undefined)
    return undefined;
  if (pushover?.appToken !== undefined && typeof pushover.appToken !== 'string')
    return undefined;
  if (pushover?.userKey !== undefined && typeof pushover.userKey !== 'string')
    return undefined;
  if (pushover?.priority !== undefined && pushoverPriority === undefined)
    return undefined;

  return {
    auto: {
      freshContext: {
        beforeEveryStep:
          beforeEveryStep ?? base.auto.freshContext.beforeEveryStep,
        betweenTasks: betweenTasks ?? base.auto.freshContext.betweenTasks,
        beforeReview: beforeReview ?? base.auto.freshContext.beforeReview,
      },
      review: {
        maxFixLoops: maxFixLoops ?? base.auto.review.maxFixLoops,
      },
      notifications: {
        pushover: {
          enabled: pushoverEnabled ?? base.auto.notifications.pushover.enabled,
          appToken:
            pushover?.appToken ?? base.auto.notifications.pushover.appToken,
          userKey:
            pushover?.userKey ?? base.auto.notifications.pushover.userKey,
          priority:
            pushoverPriority ?? base.auto.notifications.pushover.priority,
        },
      },
    },
  };
}

function globalConfigPath(home = homedir()): string {
  return join(home, '.pi', 'agent', 'addy-workflow.json');
}

export function ensureGlobalAddyWorkflowConfig(
  ctx: ConfigContext = {},
  home = homedir(),
): void {
  const path = globalConfigPath(home);
  if (existsSync(path)) return;

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify(DEFAULT_ADDY_WORKFLOW_CONFIG, null, 2)}\n`,
      { flag: 'wx' },
    );
  } catch {
    ctx.ui?.notify?.(
      `Could not create default Addy workflow config: ${path}`,
      'warning',
    );
  }
}

function readConfigFile(
  path: string,
  base: AddyWorkflowConfig,
  notify?: (message: string, level?: string) => void,
): AddyWorkflowConfig {
  if (!existsSync(path)) return base;

  try {
    const merged = mergeConfig(base, JSON.parse(readFileSync(path, 'utf8')));
    if (merged) return merged;
  } catch {
    // Fall through to warning/default handling.
  }

  notify?.(`Ignoring invalid Addy workflow config: ${path}`, 'warning');
  return base;
}

function applyEnv(
  config: AddyWorkflowConfig,
  env: ConfigEnv,
): AddyWorkflowConfig {
  const beforeEveryStep = coerceBoolean(
    env.PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP ??
      env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_EVERY_STEP,
  );
  const betweenTasks = coerceBoolean(
    env.PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS,
  );
  const beforeReview = coerceBoolean(
    env.PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW,
  );
  const maxFixLoops = coercePositiveInteger(
    env.PI_ADDY_AUTO_REVIEW_MAX_FIX_LOOPS,
  );
  const pushoverEnabled = coerceBoolean(env.PI_ADDY_PUSHOVER_ENABLED);
  const pushoverPriority = coerceInteger(env.PI_ADDY_PUSHOVER_PRIORITY);

  return {
    auto: {
      freshContext: {
        beforeEveryStep:
          beforeEveryStep ?? config.auto.freshContext.beforeEveryStep,
        betweenTasks: betweenTasks ?? config.auto.freshContext.betweenTasks,
        beforeReview: beforeReview ?? config.auto.freshContext.beforeReview,
      },
      review: {
        maxFixLoops: maxFixLoops ?? config.auto.review.maxFixLoops,
      },
      notifications: {
        pushover: {
          enabled:
            pushoverEnabled ?? config.auto.notifications.pushover.enabled,
          appToken:
            env.PI_ADDY_PUSHOVER_APP_TOKEN ??
            config.auto.notifications.pushover.appToken,
          userKey:
            env.PI_ADDY_PUSHOVER_USER_KEY ??
            config.auto.notifications.pushover.userKey,
          priority:
            pushoverPriority ?? config.auto.notifications.pushover.priority,
        },
      },
    },
  };
}

export function loadAddyWorkflowConfig(
  ctx: ConfigContext = {},
  env: ConfigEnv = process.env,
): AddyWorkflowConfig {
  const notify = ctx.ui?.notify;
  let config = structuredClone(DEFAULT_ADDY_WORKFLOW_CONFIG);
  config = readConfigFile(globalConfigPath(), config, notify);
  if (ctx.cwd)
    config = readConfigFile(
      join(ctx.cwd, '.pi', 'addy-workflow.json'),
      config,
      notify,
    );
  return applyEnv(config, env);
}
