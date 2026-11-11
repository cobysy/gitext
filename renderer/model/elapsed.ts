/**
 * How long something has been running, as a clock a person reads at a glance: whole
 * seconds, then minutes and seconds. Never fractions: the line is there to show the run
 * is still moving, and a tenth of a second changing is noise.
 */

const SECOND_MS = 1000;
const MINUTE_S = 60;

export function elapsedText(ms: number): string
{
  const seconds = Math.max(0, Math.floor(ms / SECOND_MS));
  if (seconds < MINUTE_S)
  {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / MINUTE_S);
  const rest = String(seconds % MINUTE_S).padStart(2, '0');
  return `${minutes}m ${rest}s`;
}
