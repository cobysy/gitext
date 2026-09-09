/**
 * Four ways to ignore a path: full path, *.ext, filename, directory.
 */

// Ignore styles
const IGNORE_STYLE_PATH = 'path';
const IGNORE_STYLE_NAME = 'name';
const IGNORE_STYLE_EXTENSION = 'extension';
const IGNORE_STYLE_FOLDER = 'folder';
export const IGNORE_STYLE_CUSTOM = 'custom';

const NEWLINE = '\n';
const COMMENT_MARKER = '#';

/** Which shape of rule to write. `custom` is whatever was typed instead. */
export type IgnoreStyle = 'path' | 'name' | 'extension' | 'folder' | 'custom';

export interface IgnoreStyleInfo {
  style: IgnoreStyle;
  label: string;
  detail: string;
}

export const IGNORE_STYLES: readonly IgnoreStyleInfo[] = [
  {
    style: IGNORE_STYLE_PATH,
    label: 'This file exactly',
    detail: 'Only at the repository root.'
  },
  {
    style: IGNORE_STYLE_NAME,
    label: 'A file of this name anywhere',
    detail: 'Unanchored: git matches the name in every directory.'
  },
  {
    style: IGNORE_STYLE_EXTENSION,
    label: 'Every file with this extension',
    detail: 'The broadest of the four.'
  },
  {
    style: IGNORE_STYLE_FOLDER,
    label: 'The whole folder it is in',
    detail: 'Everything under it, now and later.'
  },
  { style: IGNORE_STYLE_CUSTOM, label: 'Something else', detail: 'Write the rules yourself.' }
];

/** The file's own name, without the directories above it. */
function basename(path: string): string
{
  return path.split('/').pop() ?? path;
}

/** The directory holding it, or `''` when the file is at the repository root. */
function dirname(path: string): string
{
  const cut = path.lastIndexOf('/');
  if (cut === -1)
  {
    return '';
  }
  else
  {
    return path.slice(0, cut);
  }
}

/**
 * The extension including its dot, or `''` when there is none.
 *
 * A leading dot is a name, not an extension: `.gitignore` has no extension, and a rule
 * of `*.gitignore` would be a surprise rather than a shorthand.
 */
function extension(path: string): string
{
  const name = basename(path);
  const cut = name.lastIndexOf('.');
  if (cut > 0)
  {
    return name.slice(cut);
  }
  else
  {
    return '';
  }
}

/**
 * The rule this style produces for this path, or null when it cannot produce one.
 *
 * Null rather than a fallback: a file with no extension has no `*.ext` rule, and quietly
 * writing its full path under a radio labelled "every file with this extension" would be
 * a rule nobody chose. The dialog disables the option instead.
 */
export function ignorePatternFor(style: IgnoreStyle, path: string): string | null
{
  const trimmed = path.trim().replace(/^\/+/, '');
  if (!trimmed)
  {
    return null;
  }

  switch (style)
  {
    case IGNORE_STYLE_PATH:
      // Leading slash: `git` anchors a pattern containing a slash to the repository root
      // anyway, but writing it says so to the next person reading the file.
      return `/${trimmed}`;
    case IGNORE_STYLE_NAME:
      return basename(trimmed);
    case IGNORE_STYLE_EXTENSION: {
      const ext = extension(trimmed);
      if (ext)
      {
        return `*${ext}`;
      }
      else
      {
        return null;
      }
    }
    case IGNORE_STYLE_FOLDER: {
      const dir = dirname(trimmed);
      if (dir)
      {
        return `/${dir}/`;
      }
      else
      {
        return null;
      }
    }
    case IGNORE_STYLE_CUSTOM:
      return null;
  }
}

/** The rules for a whole selection, in order, with the ones this style cannot make dropped. */
export function ignorePatternsFor(style: IgnoreStyle, paths: readonly string[]): string[]
{
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths)
  {
    const pattern = ignorePatternFor(style, path);
    // Two files in one folder produce one folder rule, not the same line twice.
    if (pattern && !seen.has(pattern))
    {
      seen.add(pattern);
      result.push(pattern);
    }
  }
  return result;
}

/**
 * The lines of an ignore file, as git reads them: comments and blanks are not rules.
 *
 * Used to answer "is this already ignored here?", which is what stops the dialog
 * appending a duplicate line every time somebody presses the button twice.
 */
export function existingRules(contents: string): string[]
{
  return contents
    .split(NEWLINE)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(COMMENT_MARKER));
}

/** The rules from `patterns` that the file does not already carry. */
export function newRules(contents: string, patterns: readonly string[]): string[]
{
  const already = new Set(existingRules(contents));
  const result: string[] = [];
  // One pass, because two chained filters would evaluate the first over the whole array
  // before the second ever ran, and the duplicate check would then see nothing.
  for (const raw of patterns)
  {
    const pattern = raw.trim();
    if (!pattern || already.has(pattern))
    {
      continue;
    }
    already.add(pattern);
    result.push(pattern);
  }
  return result;
}
