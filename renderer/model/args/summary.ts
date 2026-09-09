/**
 * Folded options summary from argv (can't hide decisions).
 * Read the argv flags: same array the preview draws, no duplication.
 */

/** Option-looking members, minus visible controls (exclude matches before `=`). */
export function flagsIn(argv: readonly string[], exclude: readonly string[] = []): string
{
  const excluded = new Set(exclude);
  return argv
    .filter((arg) => arg.startsWith('-') && !excluded.has(arg.split('=')[0] ?? arg))
    .join(' ');
}

/** The same, joined with the separator the disclosure line uses between unlike parts. */
export function summaryOf(parts: readonly string[]): string
{
  return parts.filter((part) => part.trim().length > 0).join(' · ');
}
