export type AfkMarker =
  | { type: 'CONTINUE'; issue: string; next: string }
  | { type: 'RUN-COMPLETE'; remaining: 0; evidence: string }
  | { type: 'LEGAL-STOP'; condition: number; needs: string };

export function parseAfkMarker(text: string): AfkMarker | null {
  const finalLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!finalLine?.startsWith('AFK-LOOP: ')) return null;

  let match = /^AFK-LOOP: CONTINUE issue=(\S+) next="([^"]+)"$/.exec(finalLine);
  if (match) return { type: 'CONTINUE', issue: match[1], next: match[2] };

  match = /^AFK-LOOP: RUN-COMPLETE remaining=0 evidence="([^"]+)"$/.exec(
    finalLine,
  );
  if (match) return { type: 'RUN-COMPLETE', remaining: 0, evidence: match[1] };

  match = /^AFK-LOOP: LEGAL-STOP condition=([1-8]) needs="([^"]+)"$/.exec(
    finalLine,
  );
  if (match)
    return { type: 'LEGAL-STOP', condition: Number(match[1]), needs: match[2] };

  return null;
}

export function afkStartCommand(args: string): string {
  return `/implement-from-issues ${args}`.trim();
}

export function afkResumeMessage(marker: AfkMarker | null): string {
  const summary =
    marker?.type === 'CONTINUE'
      ? `CONTINUE for issue ${marker.issue}: ${marker.next}`
      : marker?.type === 'RUN-COMPLETE'
        ? `RUN-COMPLETE: ${marker.evidence}`
        : marker?.type === 'LEGAL-STOP'
          ? `LEGAL-STOP condition ${marker.condition}: ${marker.needs}`
          : 'missing or malformed AFK-LOOP marker';
  return `Continue the active /implement-from-issues run.
The previous turn ended with ${summary}.
${marker ? '' : 'The marker was missing/malformed, which violated the AFK-LOOP contract.\n'}Do not summarize or wait if the next step is knowable.
Take the next concrete action now.
End this turn with exactly one AFK-LOOP marker line.`;
}

export function afkAgentEnd(
  text: string,
): { type: 'continue'; message: string } | { type: 'terminal' } {
  const marker = parseAfkMarker(text);
  if (marker?.type === 'CONTINUE' || marker === null) {
    return { type: 'continue', message: afkResumeMessage(marker) };
  }
  return { type: 'terminal' };
}
