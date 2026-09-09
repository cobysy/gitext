/**
 * What to *read* about a lost object, and how to read git's answer: the argv and the
 * shape of the answer, DOM-free and unit-testable, leaving the component only the
 * drawing. One entry per object kind rather than a branchy loader.
 */

import {
  OBJECT_KIND_BLOB,
  OBJECT_KIND_COMMIT,
  OBJECT_KIND_TAG,
  OBJECT_KIND_TREE,
  STATE_DANGLING,
  STATE_MISSING,
  STATE_UNREACHABLE,
  type LostObject,
  type LostObjectKind
} from '@shared/types.js';
import { parseParents } from '@shared/parents.js';

// Re-exported so callers reach these through this module, alongside the argv builders and parsers below.
export { OBJECT_KIND_BLOB, OBJECT_KIND_COMMIT, OBJECT_KIND_TAG, OBJECT_KIND_TREE, STATE_MISSING };

const CMD_SHOW = 'show';
const CMD_LS_TREE = 'ls-tree';
const CMD_CAT_FILE = 'cat-file';
const FLAG_NO_PATCH = '--no-patch';
const FLAG_NUL_TERMINATED = '-z';
const FLAG_PRINT = '-p';
const FLAG_SIZE = '-s';

/** A path inside a tree object: a domain value, not a loose string. */
export type TreePath = string & { readonly __brand: 'TreePath' };

export function toTreePath(name: string): TreePath
{
  return name as TreePath;
}

/** One row of `git ls-tree`. */
export interface TreeEntry {
  /** `blob`, `tree`, or `commit` for a submodule gitlink. */
  kind: string;
  sha: string;
  name: TreePath;
  /** The raw six-digit mode, which is the only place the executable bit shows. */
  mode: string;
}

export interface CommitHeader {
  author: string;
  email: string;
  /** Unix seconds, or undefined when git had nothing to say. */
  date?: number;
  subject: string;
  /** The message after the subject, blank for a one-line commit. */
  body: string;
  parents: string[];
}

/**
 * `git show` restricted to the message. `--no-patch`: the patch itself is `DiffViewer`'s
 * to draw, from the range this header's parent supplies. No trailing `%x00`: there's exactly one record, so the string simply ends.
 */
export function buildHeaderArgs(sha: string): string[]
{
  return [CMD_SHOW, FLAG_NO_PATCH, `--format=%an%x00%ae%x00%ct%x00%s%x00%b%x00%P`, sha];
}

/** A tree's entries. `-z` because a path is the one field git lets contain a newline. */
export function buildTreeArgs(sha: string): string[]
{
  return [CMD_LS_TREE, FLAG_NUL_TERMINATED, sha];
}

export function buildBlobArgs(sha: string): string[]
{
  return [CMD_CAT_FILE, FLAG_PRINT, sha];
}

/** The object's size in bytes, which is all there is to say about a blob nobody can read. */
export function buildSizeArgs(sha: string): string[]
{
  return [CMD_CAT_FILE, FLAG_SIZE, sha];
}

const HEADER_FIELDS = 6;

/** Parse `buildHeaderArgs`' output. Returns null when git printed something else entirely. */
export function parseCommitHeader(output: string): CommitHeader | null
{
  const fields = output.split('\0');
  if (fields.length < HEADER_FIELDS)
  {
    return null;
  }

  const [author, email, date, subject, body, parents] = fields as [
    string,
    string,
    string,
    string,
    string,
    string
  ];

  return {
    author,
    email,
    date: Number(date) || undefined,
    subject,
    // git pads the body with the blank line that separated it from the subject.
    body: body.trim(),
    parents: parseParents(parents)
  };
}

/**
 * Parse `git ls-tree -z`: `<mode> SP <type> SP <sha> TAB <name>` per NUL-terminated
 * record. Split on the tab, not whitespace: everything after it is a path, which may contain spaces.
 */
/** True when a tree record's mode/kind/sha all parsed to something, not empty strings. */
function isCompleteTreeEntry(mode: string, kind: string, sha: string): boolean
{
  return !!mode && !!kind && !!sha;
}

export function parseTreeEntries(output: string): TreeEntry[]
{
  const entries: TreeEntry[] = [];

  for (const record of output.split('\0'))
  {
    if (!record)
    {
      continue;
    }
    const tab = record.indexOf('\t');
    if (tab === -1)
    {
      continue;
    }

    const [mode, kind, sha] = record.slice(0, tab).split(' ') as [string, string, string];
    if (!isCompleteTreeEntry(mode, kind, sha))
    {
      continue;
    }

    entries.push({ mode, kind, sha, name: toTreePath(record.slice(tab + 1)) });
  }

  // Trees first, then by name: a file list's order, not git's own (which sorts trees as though their names ended in a slash).
  return entries.sort(
    (a, b) =>
      Number(b.kind === OBJECT_KIND_TREE) - Number(a.kind === OBJECT_KIND_TREE) ||
      a.name.localeCompare(b.name)
  );
}

/**
 * Whether this blob is worth putting in a text pane. A NUL byte is git's own test for
 * binary; U+FFFD is the second half, since stdout is decoded as UTF-8 before it reaches
 * here and a non-UTF-8 file arrives as replacement characters. A single stray FFFD isn't enough, so this takes a share of the sample.
 */
const NUL = '\0';
const REPLACEMENT_CHARACTER = '�';

export function looksBinary(text: string): boolean
{
  if (text.includes(NUL))
  {
    return true;
  }

  const sample = text.slice(0, 8192);
  if (!sample)
  {
    return false;
  }

  let replacements = 0;
  for (const char of sample)
  {
    if (char === REPLACEMENT_CHARACTER)
    {
      replacements += 1;
    }
  }
  return replacements / sample.length > 0.1;
}

/**
 * What the pane says an object *is*, in words rather than git's vocabulary. `missing`
 * is different news from `dangling`/`unreachable`: a damaged repository, not a
 * recoverable one. Says nothing about the reflog: the `--no-reflogs` checkbox is on by default, so a claim about it would be false in the dialog's own opening state.
 */
export function explainState(object: LostObject): string
{
  const noun = KIND_NOUNS[object.kind];
  switch (object.state)
  {
    case STATE_MISSING:
      return `This ${noun} is referenced but is not in the object database: there is nothing here to recover it from.`;
    case STATE_DANGLING:
      return `Nothing at all points at this ${noun}. It stays in the object database until \`git gc\` removes it.`;
    case STATE_UNREACHABLE:
      return `No branch or tag reaches this ${noun}. It stays in the object database until \`git gc\` removes it.`;
  }
}

const KIND_NOUNS: Record<LostObjectKind, string> = {
  commit: 'commit',
  blob: 'file',
  tree: 'directory',
  tag: 'tag'
};

/** `commit`, `file`, `directory`, `tag`: what the object is, not what git calls it. */
export function kindNoun(kind: LostObjectKind): string
{
  return KIND_NOUNS[kind];
}
