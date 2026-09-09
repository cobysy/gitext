/**
 * Normalize a typed branch name (fix: → fix__). Not validating (isValidBranchName checks git).
 */

/** The character invalid ones are replaced with. `''` deletes them instead. */
export type ReplacementToken = string;

/**
 * git's own definition of a character that may appear in a path: printable ASCII above
 * space and below `~`, minus `^` and `:`.
 *
 * Letters and digits outside ASCII are kept as well, so an accented or non-Latin branch
 * name survives, which git allows.
 */
const REF_CHAR_CARET = '^';
const REF_CHAR_COLON = ':';

function isValidNameChar(ch: string): boolean
{
  const code = ch.codePointAt(0) ?? 0;
  const asciiSafe = code > 0x20 && code < 0x7e && ch !== REF_CHAR_CARET && ch !== REF_CHAR_COLON;
  return asciiSafe || /\p{L}|\p{N}/u.test(ch);
}

/** Rule 1: no slash-separated component may start with `.` or end with `.lock`. */
function rule01(name: string, token: ReplacementToken): string
{
  return name
    .split('/')
    .map((part) =>
    {
      let next;
      if (part.startsWith('.'))
      {
        next = part.replace(/^\.+/, token);
      }
      else
      {
        next = part;
      }
      if (next.toLowerCase().endsWith('.lock'))
      {
        next = next.replace(/\.lock$/i, `${token}lock`);
      }
      return next;
    })
    .join('/');
}

/** Rule 3: no `..` anywhere. */
const rule03 = (name: string, token: ReplacementToken): string => name.replace(/\.{2,}/g, token);

/** Rule 4: no control characters, space, `~`, `^` or `:`. */
function rule04(name: string, token: ReplacementToken): string
{
  // Split by code point, not by UTF-16 unit: a name with an emoji in it must not have its
  // surrogate pair torn in half and each half replaced.
  return [...name]
    .map((ch) =>
    {
      if (isValidNameChar(ch))
      {
        return ch;
      }
      else
      {
        return token;
      }
    })
    .join('');
}

/** Rule 5: no `?`, `*` or `[`. */
const rule05 = (name: string, token: ReplacementToken): string => name.replace(/[?*[]/g, token);

/** Rule 6: no leading, trailing or repeated slashes. */
function rule06(name: string, allowTrailingSlash: boolean): string
{
  let next = name.replace(/\/{2,}/g, '/');
  if (next.startsWith('/'))
  {
    next = next.slice(1);
  }
  if (!allowTrailingSlash && next.endsWith('/'))
  {
    next = next.slice(0, -1);
  }
  return next;
}

/** Rule 7: cannot end with a dot. */
const rule07 = (name: string, token: ReplacementToken): string => name.replace(/\.+$/, token);

/** Rule 8: cannot contain `@{`. */
const rule08 = (name: string, token: ReplacementToken): string => name.replace(/@\{/g, token);

const REF_NAME_BARE_AT = '@';

/** Rule 9: cannot be the single character `@`. */
function rule09(name: string, token: ReplacementToken): string
{
  if (name === REF_NAME_BARE_AT)
  {
    return token;
  }
  else
  {
    return name;
  }
}

/** Rule 10: cannot contain a backslash. */
const rule10 = (name: string, token: ReplacementToken): string => name.replace(/\\+/g, token);

export interface NormaliseOptions {
  /** The character invalid ones become. `'_'` by default; `''` deletes them. */
  token?: ReplacementToken;
  /** Keep a trailing slash: for a *prefix* being typed rather than a whole name. */
  allowTrailingSlash?: boolean;
}

/**
 * Rule 2, "must contain at least one `/`", is deliberately not implemented: it is
 * waived by `--allow-onelevel`, which is what `check-ref-format --branch` uses, so `main`
 * is a legal branch name and normalising one into `heads/main` would be wrong.
 */
export function normaliseBranchName(name: string, options: NormaliseOptions = {}): string
{
  const { token = '_', allowTrailingSlash = false } = options;
  if (name.trim().length === 0)
  {
    return '';
  }

  let next = name;
  next = rule10(next, token);
  next = rule09(next, token);
  next = rule08(next, token);
  next = rule07(next, token);
  next = rule05(next, token);
  next = rule04(next, token);
  next = rule03(next, token);
  next = rule06(next, allowTrailingSlash);
  next = rule01(next, token);
  return next;
}
