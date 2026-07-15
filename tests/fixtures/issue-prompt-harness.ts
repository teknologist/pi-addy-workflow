import {
  afkAgentEnd,
  afkStartCommand,
  parseAfkMarker,
  type AfkMarker,
} from './implement-afk-issues.ts';

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type CommandRunner = (args: string[], input?: string) => CommandResult;

type PublicationPayload = Record<string, string | number>;

const SOURCE = 'implement-from-issues';
const UUID =
  /\baddy-run=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/i;

function completedEvidenceRunId(text: string): string | undefined {
  const marker = parseAfkMarker(text);
  if (marker?.type !== 'RUN-COMPLETE') return undefined;
  return UUID.exec(marker.evidence)?.[1];
}

export function createIssuePromptHarness(options: {
  cwd: string;
  run: CommandRunner;
}) {
  let runId: string | undefined;
  const warnings: string[] = [];

  function invoke(args: string[], input?: string): CommandResult | undefined {
    try {
      return options.run(args, input);
    } catch (error) {
      return {
        status: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function publicationArgs(command: string): string[] {
    return [
      command,
      '--cwd',
      options.cwd,
      '--source',
      SOURCE,
      ...(command === 'start' ? [] : ['--run', runId ?? '', '--stdin']),
    ];
  }

  function warn(command: string, result: CommandResult | undefined): void {
    warnings.push(`${command}: ${result?.stderr || 'failed'}`);
  }

  return {
    warnings,

    startAfk(args: string): string {
      return afkStartCommand(args);
    },

    setRunId(value: string): void {
      runId = value;
    },

    currentRunId(): string | undefined {
      return runId;
    },

    startPublication(): string | undefined {
      const result = invoke(publicationArgs('start'));
      if (result?.status !== 0) {
        warn('start', result);
        return undefined;
      }
      runId = result.stdout.trim();
      return runId;
    },

    beginPromptInvocation(previousOutput = ''): string | undefined {
      const recovered = completedEvidenceRunId(previousOutput);
      if (recovered !== undefined) {
        runId = recovered;
        return runId;
      }
      return this.startPublication();
    },

    updatePublication(payload: PublicationPayload): boolean {
      const result = invoke(publicationArgs('update'), JSON.stringify(payload));
      if (result?.status !== 0) {
        warn('update', result);
        return false;
      }
      return true;
    },

    finishPublication(payload: PublicationPayload): boolean {
      const input = JSON.stringify(payload);
      const args = publicationArgs('finish');
      const first = invoke(args, input);
      if (first?.status === 0) return true;
      const second = invoke(args, input);
      if (second?.status === 0) return true;
      warn('finish', second);
      return false;
    },

    handleAfkYield(
      text: string,
    ):
      | { type: 'continue'; message: string; marker: AfkMarker | null }
      | { type: 'terminal'; marker: AfkMarker | null } {
      const marker = parseAfkMarker(text);
      const result = afkAgentEnd(text);
      return result.type === 'continue'
        ? { ...result, marker }
        : { ...result, marker };
    },
  };
}
