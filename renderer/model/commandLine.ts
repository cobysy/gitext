/**
 * An argv as the shell line that would run it, for showing and for pasting: the preview
 * strip and a dialog's progress line both draw commands, and both have to draw them the
 * same way. For display only: never used to build what runs.
 */

/**
 * POSIX-quote an argument.
 *
 * `~` is safe everywhere except as the first character, where a shell would expand it to
 * a home directory: so `HEAD~1` is shown as typed and `~/repo` is still quoted. It is
 * worth the extra clause because revision expressions are the arguments people read most
 * often here, and `'HEAD~1'` is noise around the one part of the command that carries the
 * meaning. `^` stays quoted: it is a pipe operator in cmd.exe.
 */
export function quoteArg(arg: string): string
{
  if (arg.length > 0 && /^[A-Za-z0-9_@%+=:,./-][A-Za-z0-9_@%+=:,./~-]*$/.test(arg))
  {
    return arg;
  }
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** `git` and its arguments, quoted. */
export function gitCommandLine(argv: readonly string[]): string
{
  return `git ${argv.map(quoteArg).join(' ')}`;
}
