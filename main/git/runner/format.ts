/**
 * Format argv as a shell command for display and pasting (command log, dialog preview).
 * For display only: never used to construct commands.
 */
const DEFAULT_GIT_BINARY = 'git';

export function formatCommand(argv: string[], gitPath = DEFAULT_GIT_BINARY): string
{
  let binary;
  if (gitPath === DEFAULT_GIT_BINARY)
  {
    binary = DEFAULT_GIT_BINARY;
  }
  else
  {
    binary = quoteArg(gitPath);
  }
  return [binary, ...argv.map(quoteArg)].join(' ');
}

function quoteArg(arg: string): string
{
  if (arg.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg))
  {
    return arg;
  }
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}
