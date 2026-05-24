export function agentTextReportsCommitComplete(text: string): boolean {
  if (
    /\b(commit failed|failed to commit|commit error|nothing committed)\b/i.test(
      text,
    )
  )
    return false;

  return (
    /\bCOMMIT:\s*[0-9a-f]{7,40}\b/i.test(text) ||
    /\b(?:committed|created commit|commit(?:ted)? hash(?: is)?):?\s*`?[0-9a-f]{7,40}`?\b/i.test(
      text,
    ) ||
    /\[[^\]\r\n]+\s+[0-9a-f]{7,40}\]\s+/i.test(text) ||
    /\b(no changes to commit|nothing to commit|working tree clean)\b/i.test(
      text,
    )
  );
}

export function commitShaFromAgentText(text: string): string {
  return (
    text.match(/\bCOMMIT:\s*([0-9a-f]{7,40})\b/i)?.[1] ??
    text.match(
      /\b(?:committed|created commit|commit(?:ted)? hash(?: is)?):?\s*`?([0-9a-f]{7,40})`?\b/i,
    )?.[1] ??
    text.match(/\[[^\]\r\n]+\s+([0-9a-f]{7,40})\]\s+/i)?.[1] ??
    'no-changes'
  );
}
