/**
 * Turning parsed patch files into the rows a diff viewer draws: hunks kept apart,
 * and for the side-by-side view the deletions paired with the additions that
 * replaced them.
 */

import { shortSha } from '../sha.js';
import {
  LINE_KIND_ADD,
  LINE_KIND_CONTEXT,
  LINE_KIND_DELETE,
  SUBPROJECT,
  type PatchFile,
  type PatchHunk,
  type PatchLine,
  type PatchLineKind
} from './types.js';


const CHANGE_SAME = 'same';
const CHANGE_ADD = 'add';
const CHANGE_DELETE = 'delete';
const CHANGE_MODIFY = 'modify';

const ROW_FILE = 'file';
const ROW_NOTE = 'note';
const ROW_GAP = 'gap';
const ROW_LINE = 'line';

const MODE_INLINE = 'inline';

const DIFF_GIT_PREFIX = 'diff --git';

/** One row of the side-by-side view: either side may be empty against the other. */
export interface PatchRow {
  left: PatchLine | null;
  right: PatchLine | null;
}

/**
 * Pair a hunk's lines into side-by-side rows. A run of deletions immediately followed
 * by additions is one edit, so the *n*th deleted line sits opposite the *n*th added
 * one; this is what makes the intra-line highlight possible without asking per row.
 */
export function toSideBySide(hunk: PatchHunk): PatchRow[]
{
  const rows: PatchRow[] = [];
  const lines = hunk.lines;

  for (let i = 0; i < lines.length; )
  {
    const line = lines[i]!;

    if (line.kind === LINE_KIND_CONTEXT)
    {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }

    const deletions: PatchLine[] = [];
    const additions: PatchLine[] = [];
    while (i < lines.length && lines[i]!.kind === LINE_KIND_DELETE)
    {
      deletions.push(lines[i++]!);
    }
    while (i < lines.length && lines[i]!.kind === LINE_KIND_ADD)
    {
      additions.push(lines[i++]!);
    }

    const height = Math.max(deletions.length, additions.length);
    for (let n = 0; n < height; n++)
    {
      rows.push({ left: deletions[n] ?? null, right: additions[n] ?? null });
    }
  }

  return rows;
}

// ── The aligned view model ───────────────────────────────────────────────────

/** What a row belongs to: unchanged, or one of the three kinds of difference. */
export type DiffChange = 'same' | 'add' | 'delete' | 'modify';

/**
 * One difference: a run of changed lines with unchanged lines either side. The unit a
 * comparison tool navigates by; git has no name for it, since a hunk is a *window*
 * sized by `--unified` and would stop early over two nearby edits. Derived from the lines, so blocks survive turning the context up to the whole file.
 */
export interface DiffBlock {
  kind: 'add' | 'delete' | 'modify';
  /** Inclusive row indices into the aligned rows. */
  start: number;
  end: number;
}

/**
 * A row of the aligned view. A union here rather than the flat shape the renderer
 * draws, because this half is pure and unit-tested; the flattening exists only because a Vue template narrows a union once per property access.
 */
export type AlignedRow =
  | { kind: 'file'; text: string }
  | { kind: 'note'; text: string }
  /** Lines git did not print, because they are the same and outside the context. */
  | { kind: 'gap'; skipped: number; oldStart: number; newStart: number }
  | {
    kind: 'line';
    left: PatchLine | null;
    right: PatchLine | null;
    change: DiffChange;
    /** Index into `blocks`, or -1 on an unchanged line. */
    block: number;
  };

export interface AlignedPatch {
  rows: AlignedRow[];
  blocks: DiffBlock[];
}

export const BINARY_NOTE = 'Binary file. There is no text diff to show.';

/**
 * What a submodule's diff says, as a sentence rather than two lines of hex. git prints
 * a gitlink's change as `-Subproject commit <old>`/`+Subproject commit <new>`, true and
 * unreadable, so this names the commits directly, abbreviated as the grid abbreviates them.
 */
export function submoduleNote(file: PatchFile): string
{
  const at = (kind: PatchLineKind): string | null =>
  {
    for (const hunk of file.hunks)
    {
      for (const line of hunk.lines)
      {
        if (line.kind === kind && line.text.startsWith(SUBPROJECT))
        {
          return shortSha(line.text.slice(SUBPROJECT.length).trim());
        }
      }
    }
    return null;
  };

  const before = at(LINE_KIND_DELETE);
  const after = at(LINE_KIND_ADD);

  if (before && after)
  {
    return `Submodule moved from ${before} to ${after}.`;
  }
  if (after)
  {
    return `Submodule added, at ${after}.`;
  }
  if (before)
  {
    return `Submodule removed; it was at ${before}.`;
  }
  // A mode change on a gitlink, or a diff git printed with no content at all.
  return 'Submodule unchanged.';
}

/**
 * Turn a parsed patch into the rows a two-pane comparison draws, and the differences
 * in it. The two modes differ in one place only: side by side pairs deletions with
 * their replacements, inline keeps git's own order (every deletion, then every
 * addition). Everything else is shared, so navigation and the overview strip are written once.
 */
export function alignPatch(files: PatchFile[], mode: 'inline' | 'sideBySide'): AlignedPatch
{
  const rows: AlignedRow[] = [];
  const blocks: DiffBlock[] = [];
  // Several files in one patch only happens when a rename was asked for by both its paths; the usual case is one, so naming it then would be noise.
  const many = files.length > 1;

  for (const file of files)
  {
    if (many)
    {
      rows.push({ kind: ROW_FILE, text: file.newPath || file.oldPath });
    }

    if (file.isBinary)
    {
      rows.push({ kind: ROW_NOTE, text: BINARY_NOTE });
      continue;
    }
    if (file.isSubmodule)
    {
      rows.push({ kind: ROW_NOTE, text: submoduleNote(file) });
      continue;
    }
    if (file.hunks.length === 0)
    {
      // A pure rename or mode change: git says so in the header and prints no hunk.
      const said = file.header.filter((line) => !line.startsWith(DIFF_GIT_PREFIX)).join('  ');
      rows.push({ kind: ROW_NOTE, text: said || 'No content change.' });
      continue;
    }

    // Where the previous hunk stopped, so the lines between two hunks can be counted rather than announced with an `@@` header nobody reads as a count.
    let oldNext = 1;
    let newNext = 1;

    for (const hunk of file.hunks)
    {
      const skipped = hunk.oldStart - oldNext;
      if (skipped > 0)
      {
        rows.push({ kind: ROW_GAP, skipped, oldStart: oldNext, newStart: newNext });
      }

      const lines = hunk.lines;
      for (let i = 0; i < lines.length; )
      {
        if (lines[i]!.kind === LINE_KIND_CONTEXT)
        {
          const line = lines[i]!;
          i++;
          rows.push({ kind: ROW_LINE, left: line, right: line, change: CHANGE_SAME, block: -1 });
          continue;
        }

        const deletions: PatchLine[] = [];
        const additions: PatchLine[] = [];
        while (i < lines.length && lines[i]!.kind === LINE_KIND_DELETE)
        {
          deletions.push(lines[i++]!);
        }
        while (i < lines.length && lines[i]!.kind === LINE_KIND_ADD)
        {
          additions.push(lines[i++]!);
        }

        let kind: 'add' | 'delete' | 'modify';
        if (deletions.length > 0 && additions.length > 0)
        {
          kind = CHANGE_MODIFY;
        }
        else if (additions.length > 0)
        {
          kind = CHANGE_ADD;
        }
        else
        {
          kind = CHANGE_DELETE;
        }
        const block = blocks.length;
        const start = rows.length;

        if (mode === MODE_INLINE)
        {
          for (const line of deletions)
          {
            rows.push({ kind: ROW_LINE, left: line, right: null, change: kind, block });
          }
          for (const line of additions)
          {
            rows.push({ kind: ROW_LINE, left: null, right: line, change: kind, block });
          }
        }
        else
        {
          const height = Math.max(deletions.length, additions.length);
          for (let n = 0; n < height; n++)
          {
            rows.push({
              kind: ROW_LINE,
              left: deletions[n] ?? null,
              right: additions[n] ?? null,
              change: kind,
              block
            });
          }
        }

        blocks.push({ kind, start, end: rows.length - 1 });
      }

      oldNext = hunk.oldStart + hunk.oldCount;
      newNext = hunk.newStart + hunk.newCount;
    }
  }

  return { rows, blocks };
}
