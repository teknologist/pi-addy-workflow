import type {
  WorkflowRuntime,
  WorkflowTimerRegistry,
} from './workflow-runtime.ts';

export type RunWhenIdleOptions = {
  runtime: Pick<WorkflowRuntime, 'isBusy' | 'runOnce' | 'schedule'>;
  registry: WorkflowTimerRegistry;
  key: string;
  retryMs: number;
  maxAttempts: number;
  onStart?: () => void | Promise<void>;
  onReady: () => void | Promise<void>;
  onTimeout: () => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
};

export function runWhenIdle(options: RunWhenIdleOptions): boolean {
  return options.runtime.runOnce(options.registry, options.key, (release) => {
    const attempt = (attempts: number) => {
      if (options.runtime.isBusy()) {
        if (attempts >= options.maxAttempts) {
          void Promise.resolve(options.onTimeout()).finally(release);
          return;
        }
        options.runtime.schedule(() => attempt(attempts + 1), options.retryMs);
        return;
      }

      release();
      void Promise.resolve()
        .then(options.onReady)
        .catch((error) => options.onError?.(error));
    };

    void Promise.resolve()
      .then(options.onStart)
      .then(() => options.runtime.schedule(() => attempt(0), 0))
      .catch((error) =>
        Promise.resolve(options.onError?.(error)).finally(release),
      );
  });
}
