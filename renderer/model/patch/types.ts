/** The shapes a parsed unified diff is made of: shared by every submodule below. */

export const LINE_KIND_CONTEXT = 'context' as const;
export const LINE_KIND_ADD = 'add' as const;
export const LINE_KIND_DELETE = 'delete' as const;

export type PatchLineKind = typeof LINE_KIND_CONTEXT | typeof LINE_KIND_ADD | typeof LINE_KIND_DELETE;

export interface PatchLine {
  kind: PatchLineKind;
  text: string;
  oldNumber: number | null;
  /** Line number on the new side, or null on a deleted line. */
  newNumber: number | null;
  /** git printed "\ No newline at end of file" under this line. */
  noNewline?: boolean;
}

export interface PatchHunk {
  /** The `@@` line verbatim, including the section heading git appends to it. */
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: PatchLine[];
}

export interface PatchFile {
  /** Path on the old side; `/dev/null` becomes an empty string. */
  oldPath: string;
  newPath: string;
  /**
   * git's own header lines above the first hunk: "new file mode", "similarity index",
   * "rename from"… They say things no hunk can (a mode change, a pure rename), so they
   * are kept rather than skipped.
   */
  header: string[];
  hunks: PatchHunk[];
  isBinary: boolean;
  /**
   * A gitlink: the file is a submodule, and its "contents" are one commit id.
   *
   * Worth knowing separately from the lines, because a patch of one is readable but
   * useless: two lines that differ by forty hex characters, which nobody diffs by eye.
   * What is wanted is which commit it moved between, and that is a sentence.
   */
  isSubmodule: boolean;
  /**
   * Which line of the whole patch this file's section starts on, counting from 0.
   *
   * For a viewer that shows a patch *file*, where what is wanted is the bytes git or
   * whoever sent it actually wrote, rather than a re-rendering of the parsed structure.
   * With this and the next file's start, that section is a slice.
   */
  startLine: number;
}

/** The one line a gitlink's diff has on each side, and the only content it ever holds. */
export const SUBPROJECT = 'Subproject commit ';

// Unified-diff format markers: the leading character of a line git printed.
export const MARKER_CONTEXT = ' ';
export const MARKER_ADD = '+';
export const MARKER_DELETE = '-';
