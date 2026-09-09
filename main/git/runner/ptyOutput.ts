/**
 * What a terminal does with git's output, and what a pty adds to it.
 *
 * `collapseOverwrites` is the terminal's own rule and applies to every run, pty or
 * pipe: git's progress meters use `\r` either way. The other two are artifacts of
 * forcing a pty (see `PTY_FORCED_VERBS` in `runner.ts`) so git believes it's talking
 * to a terminal and prints the progress it would otherwise suppress, both confirmed
 * byte-for-byte against a real pty session.
 */

/**
 * The pty echoes the stdin-EOF keystroke that closes git's stdin as a literal `^D`
 * followed by two backspaces, once, at the very start of the session.
 */
const EOF_ECHO = '^D\b\b';

/** Strips the pty's leading EOF echo, if this is the very first chunk of a session. */
export function stripEofEcho(chunk: string, isFirstChunk: boolean): string
{
  if (isFirstChunk && chunk.startsWith(EOF_ECHO))
  {
    return chunk.slice(EOF_ECHO.length);
  }
  return chunk;
}

/** A pty terminates every line with `\r\n`; the rest of the app expects plain `\n`. */
export function normalizeCrlf(chunk: string): string
{
  return chunk.replace(/\r\n/g, '\n');
}

/**
 * What a terminal does with a progress meter: a bare `\r` returns to the start of the
 * line, so what follows overwrites what came before rather than continuing it. Only the
 * last write survives, which is why a finished `git gc` reads as one line per phase
 * ("Counting objects: 100% (6862/6862), done.") instead of every percentage it passed
 * through run together.
 *
 * Applied to a *complete* line, once the splitter has one: a chunk can end mid-phase,
 * and collapsing the halves separately would join the tick before the split to the one
 * after it, which is the run-together output this exists to prevent.
 */
export function collapseOverwrites(line: string): string
{
  return line.slice(line.lastIndexOf('\r') + 1);
}

/**
 * One complete line as a terminal would show it, and the only place that decision is
 * made: both the console window and the command log's record read what this returns.
 *
 * The trailing `\r` of a CRLF goes first, since that one ends the line rather than
 * rewriting it: a diff of a file with CRLF endings is made of them, and taking it as a
 * rewrite would leave every line blank.
 */
export function terminalLine(line: string): string
{
  if (line.endsWith('\r'))
  {
    return collapseOverwrites(line.slice(0, -1));
  }
  return collapseOverwrites(line);
}

/**
 * Both artifacts folded into one call, applied to every chunk read from a pty-spawned
 * child before it reaches the line-splitter or the capped record. `isFirstChunk` is the
 * caller's own running state: the echo can only appear once, at the start.
 */
export function sanitizePtyChunk(chunk: string, isFirstChunk: boolean): string
{
  return normalizeCrlf(stripEofEcho(chunk, isFirstChunk));
}
