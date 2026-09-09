/**
 * Parsing unified diffs into `PatchFile`s. Pure module: imports nothing from `window`.
 */

import { DEV_NULL } from '@shared/diff.js';
import {
  LINE_KIND_ADD,
  LINE_KIND_CONTEXT,
  LINE_KIND_DELETE,
  MARKER_ADD,
  MARKER_CONTEXT,
  MARKER_DELETE,
  SUBPROJECT,
  type PatchFile,
  type PatchHunk
} from './types.js';

const HUNK_HEADER = /^@@+ (.+?) @@(.*)$/;

/** The mode git gives a gitlink, as it appears at the end of a header line. */
const GITLINK_MODE = ' 160000';

const DIFF_GIT_PREFIX = 'diff --git ';
const DIFF_CC_PREFIX = 'diff --cc ';
const HUNK_MARKER = '@@';
const OLD_PATH_LINE = '--- ';
const NEW_PATH_LINE = '+++ ';
const BINARY_FILES_PREFIX = 'Binary files ';
const GIT_BINARY_PATCH = 'GIT binary patch';
const NO_NEWLINE_MARKER = '\\';


/** Read a `-<start>,<count>` or `+<start>,<count>` range; a missing count means 1. */
function parseRange(spec: string): { start: number; count: number }
{
  const [start = '0', count] = spec.slice(1).split(',');
  let parsedCount: number;
  if (count === undefined)
  {
    parsedCount = 1;
  }
  else
  {
    parsedCount = Number(count) || 0;
  }
  return { start: Number(start) || 0, count: parsedCount };
}

/**
 * Parse a hunk header. Combined diffs use `@@@` and read ranges from the ends, not by position.
 */
function parseHunkHeader(line: string): PatchHunk | null
{
  const match = HUNK_HEADER.exec(line);
  if (!match)
  {
    return null;
  }

  const ranges = match[1]!.trim().split(' ');
  const old = parseRange(ranges[0] ?? '-0,0');
  const next = parseRange(ranges[ranges.length - 1] ?? '+0,0');

  return {
    header: line,
    oldStart: old.start,
    oldCount: old.count,
    newStart: next.start,
    newCount: next.count,
    lines: []
  };
}

function stripPathPrefix(path: string): string
{
  if (path === DEV_NULL)
  {
    return '';
  }
  // git writes `a/foo` and `b/foo` but `--no-index` writes paths as given.
  if (/^[ab]\//.test(path))
  {
    return path.slice(2);
  }
  else
  {
    return path;
  }
}

/**
 * Split a patch into files. Headers before the first `@@` contain renames, mode changes, and binary markers.
 */
export function parsePatch(text: string): PatchFile[]
{
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let hunk: PatchHunk | null = null;
  let oldNumber = 0;
  let newNumber = 0;

  const start = (startLine: number): PatchFile =>
  {
    const next: PatchFile = {
      oldPath: '',
      newPath: '',
      header: [],
      hunks: [],
      isBinary: false,
      isSubmodule: false,
      startLine
    };
    files.push(next);
    return next;
  };

  // Split on newlines leaves an empty final element if text ends with newline.
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '')
  {
    lines.pop();
  }

  for (const [at, line] of lines.entries())
  {
    if (line.startsWith(DIFF_GIT_PREFIX) || line.startsWith(DIFF_CC_PREFIX))
    {
      file = start(at);
      file.header.push(line);
      hunk = null;
      continue;
    }

    // Patches without `diff --git` (e.g. `git diff-tree` output) still parse; they start at line 0.
    file ??= start(0);

    if (line.startsWith(HUNK_MARKER))
    {
      const parsed = parseHunkHeader(line);
      if (parsed)
      {
        hunk = parsed;
        file.hunks.push(hunk);
        oldNumber = hunk.oldStart;
        newNumber = hunk.newStart;
      }
      continue;
    }

    if (hunk === null)
    {
      if (line.startsWith(OLD_PATH_LINE))
      {
        file.oldPath = stripPathPrefix(line.slice(4));
      }
      else if (line.startsWith(NEW_PATH_LINE))
      {
        file.newPath = stripPathPrefix(line.slice(4));
      }
      else if (line.startsWith(BINARY_FILES_PREFIX) || line.startsWith(GIT_BINARY_PATCH))
      {
        file.isBinary = true;
        file.header.push(line);
      }
      else if (line !== '')
      {
        // Gitlink mode `160000` appears at the end of various header lines.
        if (line.endsWith(GITLINK_MODE))
        {
          file.isSubmodule = true;
        }
        file.header.push(line);
      }
      continue;
    }

    const marker = line[0] ?? MARKER_CONTEXT;
    const rest = line.slice(1);

    if (marker === NO_NEWLINE_MARKER)
    {
      // "\ No newline at end of file" applies to the line above it.
      const last = hunk.lines[hunk.lines.length - 1];
      if (last)
      {
        last.noNewline = true;
      }
      continue;
    }

    // Older git omits `160000` for gitlink bumps; the `Subproject commit` line is the indicator.
    if (rest.startsWith(SUBPROJECT))
    {
      file.isSubmodule = true;
    }

    switch (marker)
    {
      case MARKER_ADD:
        hunk.lines.push({ kind: LINE_KIND_ADD, text: rest, oldNumber: null, newNumber: newNumber++ });
        break;
      case MARKER_DELETE:
        hunk.lines.push({ kind: LINE_KIND_DELETE, text: rest, oldNumber: oldNumber++, newNumber: null });
        break;
      case MARKER_CONTEXT:
        hunk.lines.push({
          kind: LINE_KIND_CONTEXT,
          text: rest,
          oldNumber: oldNumber++,
          newNumber: newNumber++
        });
        break;
      default:
        // Anything else ends the hunk: git has moved on to the next file's header.
        hunk = null;
        file.header.push(line);
        break;
    }
  }

  return files;
}

/** Total added and deleted lines, for the "+12 −3" a file list shows. */
export function countChangedLines(file: PatchFile): { added: number; deleted: number }
{
  let added = 0;
  let deleted = 0;
  for (const hunk of file.hunks)
  {
    for (const line of hunk.lines)
    {
      if (line.kind === LINE_KIND_ADD)
      {
        added++;
      }
      else if (line.kind === LINE_KIND_DELETE)
      {
        deleted++;
      }
    }
  }
  return { added, deleted };
}
