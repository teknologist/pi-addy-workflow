const EXPECTED_PROGRESS_BARS: Record<number, string> = {
  50: `[\x1b[38;5;32m██████\x1b[0m\x1b[48;5;32m\x1b[1;37m5\x1b[0m\x1b[48;5;32m\x1b[1;37m0\x1b[0m\x1b[48;5;236;1;37m%\x1b[0m\x1b[48;5;236m      \x1b[0m]`,
  67: `[\x1b[38;5;32m██████\x1b[0m\x1b[48;5;32m\x1b[1;37m6\x1b[0m\x1b[48;5;32m\x1b[1;37m7\x1b[0m\x1b[48;5;32m\x1b[1;37m%\x1b[0m\x1b[38;5;32m█\x1b[0m\x1b[48;5;236m     \x1b[0m]`,
};

export function expectedTotalTasksProgress(
  index: number,
  count: number,
): string {
  const percentage = Math.round((index / count) * 100);
  const progressBar = EXPECTED_PROGRESS_BARS[percentage];
  if (!progressBar)
    throw new Error(`Missing expected progress bar for ${percentage}%`);
  return `Total tasks ${progressBar} ${index}/${count}`;
}
