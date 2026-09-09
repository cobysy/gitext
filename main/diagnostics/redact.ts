/**
 * Scrubbing a diagnostics report of what is nobody else's business.
 *
 * Off by default: the log the app keeps is the log it shows, and the transparency panel's
 * promise is that what it shows is what ran. This is for the moment a report leaves the
 * machine, when `redactDiagnostics` is on.
 *
 * **What it removes is identity, not evidence.** Argv, timings, exit codes, error text
 * and repository-relative paths all survive, because those are what actually answer a
 * bug report. What goes is the home directory, the credentials in a remote URL, and the
 * body of a commit message: three things that say who you are and what you were working
 * on, and none of which have ever explained a crash.
 *
 * Pure and DOM-free, so every rule below is an ordinary unit test.
 */

/** What a redacted home directory reads as. `~` is what a person would have typed. */
const HOME_MARK = '~';

const REDACTED = '<redacted>';

/** How much of a commit message survives: enough to match it against the log, no more. */
const MESSAGE_HEAD = 24;

/**
 * `scheme://user:password@host/path`, the shape a token in a clone URL takes. The
 * password is the point, but the username is often the account name, so both go.
 */
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;

/** `-m`, `--message=…` and `-F`: the three ways an argv carries prose. */
const MESSAGE_FLAGS = new Set(['-m', '--message', '-F', '--file']);

export interface RedactOptions {
  /** The user's home directory, replaced with `~` wherever it appears. */
  home: string;
  /** The open repository's root, so a path inside it can stay repo-relative and readable. */
  repoRoot?: string | null;
}

/** Everything after the first `MESSAGE_HEAD` characters, replaced by how much there was. */
function shorten(text: string): string
{
  if (text.length <= MESSAGE_HEAD)
  {
    return text;
  }
  return `${text.slice(0, MESSAGE_HEAD)}… (${text.length} chars)`;
}

/**
 * Paths, in one pass: inside the repository they become repo-relative, and anywhere else
 * the home directory becomes `~`. A path outside both is already saying nothing personal
 * and is left exactly as it is: `/usr/local/bin/git` is evidence, not identity.
 *
 * The separator goes with the repository root rather than being trimmed afterwards. A
 * trim would have to be anchored to the start of the string to be safe, which leaves an
 * embedded path as `/a.txt`, and unanchored it eats the leading slash off every absolute
 * path in the report.
 */
export function redactPaths(text: string, options: RedactOptions): string
{
  let out = text;
  if (options.repoRoot)
  {
    out = out.split(`${options.repoRoot}/`).join('');
  }
  if (options.home)
  {
    out = out.split(options.home).join(HOME_MARK);
  }
  return out;
}

/** A remote URL with its credentials removed, leaving the scheme and the host. */
export function redactUrls(text: string): string
{
  return text.replace(URL_CREDENTIALS, `$1${REDACTED}@`);
}

/**
 * One argv, scrubbed. The verb and its flags are kept whole: `commit -m` explains a
 * report and the message after it never does.
 */
export function redactArgv(argv: readonly string[], options: RedactOptions): string[]
{
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++)
  {
    const arg = argv[i]!;

    // `--message=text`: flag and value in one token.
    const equals = arg.indexOf('=');
    if (equals > 0 && MESSAGE_FLAGS.has(arg.slice(0, equals)))
    {
      out.push(`${arg.slice(0, equals)}=${shorten(arg.slice(equals + 1))}`);
      continue;
    }

    if (MESSAGE_FLAGS.has(arg))
    {
      out.push(arg);
      const value = argv[i + 1];
      if (value !== undefined)
      {
        out.push(shorten(value));
        i++;
      }
      continue;
    }

    out.push(redactUrls(redactPaths(arg, options)));
  }
  return out;
}

/** A line of free text: what a git command printed, an error message, a note. */
export function redactLine(text: string, options: RedactOptions): string
{
  return redactUrls(redactPaths(text, options));
}
