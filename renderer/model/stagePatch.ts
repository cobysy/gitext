/**
 * Building a patch that stages part of a file. `git add -- <path>` stages a file
 * whole; to stage one hunk, or a few lines inside one, there is no porcelain, so this
 * writes a patch containing exactly the wanted changes and feeds it to `git apply --cached`.
 *
 * The whole risk lives in this file: a patch built wrong doesn't fail loudly. `git
 * apply` either refuses it as "corrupt patch" (the good case) or applies it
 * *somewhere else* in the file if the numbers are plausible and wrong (the bad one). So
 * this is pure, and tested against both the arithmetic and real `git apply`.
 *
 * The two directions are not mirror images: staging matches the patch's OLD side
 * against the index, unstaging (reverse-applied) matches the NEW side, which flips what
 * happens to lines the user didn't pick. See `fateOf` below.
 */

import { DEV_NULL } from '@shared/diff.js';
import {
  LINE_KIND_ADD,
  LINE_KIND_CONTEXT,
  LINE_KIND_DELETE,
  MARKER_ADD,
  MARKER_CONTEXT,
  MARKER_DELETE,
  type PatchFile,
  type PatchHunk,
  type PatchLine
} from './patch.js';

// Stage directions
const STAGE_DIRECTION_STAGE = 'stage';

// Line fates
const FATE_KEEP = 'keep';
const FATE_CONTEXT = 'context';
const FATE_DROP = 'drop';

// Line kinds

// Unified-diff format markers
const OLD_PATH_PREFIX = 'a/';
const NEW_PATH_PREFIX = 'b/';
const OLD_PATH_LINE = '---';
const NEW_PATH_LINE = '+++';
const NEWLINE = '\n';

/** Which way the patch runs: into the index, or back out of it. */
export type StageDirection = 'stage' | 'unstage';

export interface BuildPatchOptions {
  /**
   * Indexes into `hunk.lines` the user picked, for line-level staging. Omit to take
   * every change in the hunk: the ordinary "stage this hunk" case.
   */
  selected?: ReadonlySet<number>;
  direction?: StageDirection;
}

/** The `\ No newline at end of file` marker, spelled as git spells it. */
const NO_NEWLINE = '\\ No newline at end of file';

/**
 * What becomes of one line in the patch being built. `keep` writes it with its own
 * marker, `context` writes it with a leading space, `drop` leaves it out entirely.
 */
type Fate = 'keep' | 'context' | 'drop';

/**
 * Decide a line's fate. A context line is always context; for the rest it turns on the
 * direction, since the two directions disagree about which side of the patch must match the index:
 *
 * - **Staging** (`apply --cached`) matches the OLD side: an unpicked addition isn't in
 *   the index and must not appear; an unpicked deletion *is* in the index and must stay as context.
 * - **Unstaging** (`apply --cached --reverse`) matches the NEW side: reversed, an
 *   unpicked addition must be carried as context, and an unpicked deletion dropped.
 *
 * Getting this backwards still applies cleanly to a file whose lines happen to line up,
 * which is why it's spelled out rather than inferred.
 */
function fateOf(kind: PatchLine['kind'], picked: boolean, direction: StageDirection): Fate
{
  if (kind === LINE_KIND_CONTEXT)
  {
    return FATE_CONTEXT;
  }
  if (picked)
  {
    return FATE_KEEP;
  }
  if (direction === STAGE_DIRECTION_STAGE)
  {
    if (kind === LINE_KIND_DELETE)
    {
      return FATE_CONTEXT;
    }
    else
    {
      return FATE_DROP;
    }
  }
  if (kind === LINE_KIND_ADD)
  {
    return FATE_CONTEXT;
  }
  else
  {
    return FATE_DROP;
  }
}

function markerFor(kind: PatchLine['kind'], fate: Fate): string
{
  if (fate === FATE_CONTEXT)
  {
    return MARKER_CONTEXT;
  }
  if (kind === LINE_KIND_ADD)
  {
    return MARKER_ADD;
  }
  else
  {
    return MARKER_DELETE;
  }
}

/**
 * The path pair for the `---`/`+++` lines. An absent path is `/dev/null`: a created
 * file has no old side, a deleted one no new side. Everything else is `a/`/`b/` prefixed as git writes it.
 */
function pathLines(file: PatchFile): string[]
{
  let old;
  if (file.oldPath)
  {
    old = `${OLD_PATH_PREFIX}${file.oldPath}`;
  }
  else
  {
    old = DEV_NULL;
  }
  let next;
  if (file.newPath)
  {
    next = `${NEW_PATH_PREFIX}${file.newPath}`;
  }
  else
  {
    next = DEV_NULL;
  }
  return [`${OLD_PATH_LINE} ${old}`, `${NEW_PATH_LINE} ${next}`];
}

/**
 * Where the rebuilt hunk sits, on each side. One side is *located* (staging matches
 * old, unstaging matches new); the other starts at the same line, except at a
 * zero-length side, where git's `@@` numbers mean "the content goes after this line",
 * not a line number: a new file is `@@ -0,0 +1,2 @@`, never `+0,2`. Emitting the
 * located side's number on both would produce an invalid header `git apply` calls corrupt.
 */
function anchor(
  hunk: PatchHunk,
  oldCount: number,
  newCount: number,
  direction: StageDirection
): { oldStart: number; newStart: number }
{
  const isStage = direction === STAGE_DIRECTION_STAGE;
  let base;
  if (isStage)
  {
    base = hunk.oldStart;
  }
  else
  {
    base = hunk.newStart;
  }
  let locatedCount: number;
  let otherCount: number;
  if (isStage)
  {
    locatedCount = oldCount;
    otherCount = newCount;
  }
  else
  {
    locatedCount = newCount;
    otherCount = oldCount;
  }
  let other;
  if (oldCount === 0 && newCount === 0)
  {
    other = base;
  }
  else if (locatedCount === 0)
  {
    other = base + 1;
  }
  else if (otherCount === 0)
  {
    other = Math.max(0, base - 1);
  }
  else
  {
    other = base;
  }
  if (isStage)
  {
    return { oldStart: base, newStart: other };
  }
  else
  {
    return { oldStart: other, newStart: base };
  }
}

/**
 * One line of the rebuilt hunk, before the no-newline markers are placed. `noNewline`
 * is carried, not written immediately: where the marker goes depends on the line's
 * position in the finished body, see `renderBody`.
 */
interface BodyLine {
  marker: string;
  text: string;
  /** The source line ended the side it is on without a newline. */
  noNewline: boolean;
  onOld: boolean;
  onNew: boolean;
}

/** The last line in `body` that `on` is true of, or -1 when there is none. */
function lastLineOn(body: readonly BodyLine[], on: (line: BodyLine) => boolean): number
{
  for (let i = body.length - 1; i >= 0; i -= 1)
  {
    if (on(body[i]!))
    {
      return i;
    }
  }
  return -1;
}

/**
 * Write the body out, placing the `\ No newline at end of file` markers: a fact about
 * where a line sits in *this* patch, so it may follow a deletion only at the end of the
 * old side, an addition only at the end of the new side, and context only when it ends both.
 *
 * A context line ending one side but not the other can't say so with one marker, so
 * it's split into a deletion and an addition of the same text, each ending its own way:
 * without the split, `git apply` reads the next line as running on from it. Splitting
 * changes neither count: the line was context on both sides and still is.
 */
function renderBody(body: readonly BodyLine[]): string[]
{
  const lastOld = lastLineOn(body, (line) => line.onOld);
  const lastNew = lastLineOn(body, (line) => line.onNew);
  const out: string[] = [];

  body.forEach((line, index) =>
  {
    const endsOld = index === lastOld && line.noNewline;
    const endsNew = index === lastNew && line.noNewline;
    const isContext = line.onOld && line.onNew;

    if (isContext && endsOld !== endsNew)
    {
      out.push(`${MARKER_DELETE}${line.text}`);
      if (endsOld)
      {
        out.push(NO_NEWLINE);
      }
      out.push(`${MARKER_ADD}${line.text}`);
      if (endsNew)
      {
        out.push(NO_NEWLINE);
      }
      return;
    }

    out.push(`${line.marker}${line.text}`);
    if (endsOld || endsNew)
    {
      out.push(NO_NEWLINE);
    }
  });

  return out;
}

/**
 * A patch containing one hunk's picked changes, ready for `git apply --cached`. Null
 * when nothing survives the selection: an empty patch isn't a no-op to apply, it's an
 * operation that shouldn't run, and `git apply` on one fails with a confusing error.
 */
export function buildHunkPatch(
  file: PatchFile,
  hunk: PatchHunk,
  options: BuildPatchOptions = {}
): string | null
{
  const direction = options.direction ?? STAGE_DIRECTION_STAGE;
  const { selected } = options;

  const body: BodyLine[] = [];
  let oldCount = 0;
  let newCount = 0;
  let changed = false;

  hunk.lines.forEach((line, index) =>
  {
    const picked = selected === undefined || selected.has(index);
    const fate = fateOf(line.kind, picked, direction);
    if (fate === FATE_DROP)
    {
      return;
    }

    if (fate === FATE_KEEP)
    {
      changed = true;
    }

    // A context line counts on both sides; a kept change counts only on its own.
    const onOld = fate === FATE_CONTEXT || line.kind === LINE_KIND_DELETE;
    const onNew = fate === FATE_CONTEXT || line.kind === LINE_KIND_ADD;
    if (onOld)
    {
      oldCount++;
    }
    if (onNew)
    {
      newCount++;
    }

    body.push({
      marker: markerFor(line.kind, fate),
      text: line.text,
      noNewline: line.noNewline === true,
      onOld,
      onNew
    });
  });

  if (!changed)
  {
    return null;
  }

  const { oldStart, newStart } = anchor(hunk, oldCount, newCount, direction);

  return (
    [
      ...file.header,
      ...pathLines(file),
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...renderBody(body)
    ].join(NEWLINE) + NEWLINE
  );
}

/**
 * True when a hunk has anything to stage at all. A hunk of pure context can't occur in
 * a diff, but a *selection* of pure context can, and the acting button should be off, not failing when pressed.
 */
export function hasPickableChange(hunk: PatchHunk, selected?: ReadonlySet<number>): boolean
{
  return hunk.lines.some(
    (line, index) =>
      line.kind !== LINE_KIND_CONTEXT && (selected === undefined || selected.has(index))
  );
}

/** Every index in a hunk that names a change rather than a context line. */
export function changedLineIndexes(hunk: PatchHunk): number[]
{
  const indexes: number[] = [];
  hunk.lines.forEach((line, index) =>
  {
    if (line.kind !== LINE_KIND_CONTEXT)
    {
      indexes.push(index);
    }
  });
  return indexes;
}
