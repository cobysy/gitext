/**
 * `git format-patch`, `git apply` and `git am` argv.
 * Apply: `am` makes commits, `apply` takes changes only (drops authorship).
 */

const CMD_FORMAT_PATCH = 'format-patch';
const CMD_AM = 'am';
const CMD_APPLY = 'apply';
const FLAG_FIND_RENAMES = '--find-renames';
const FLAG_FIND_COPIES = '--find-copies';
const FLAG_BREAK_REWRITES = '--break-rewrites';
const FLAG_START_NUMBER = '--start-number';
const FLAG_ROOT = '--root';
const FLAG_OUTPUT_DIR = '-o';
const FLAG_3WAY = '--3way';
const FLAG_IGNORE_WHITESPACE = '--ignore-whitespace';
const FLAG_INDEX = '--index';

const MODE_APPLY = 'apply';
const MODE_AM = 'am';

/** The `{ from, to }` a `format-patch` is over. */
export interface FormatPatchOptions {
  /** The older end. Empty means "from the root", which git spells `--root <to>`. */
  from: string;
  /** The newer end: the last commit that goes in. */
  to: string;
  /** The directory the `.patch` files are written to: `-o`. */
  output: string;
  /** Number the files from here rather than from 1: `--start-number`. */
  startNumber?: number | null;
}

export function buildFormatPatchArgs(options: FormatPatchOptions): string[]
{
  const { from, to, output, startNumber = null } = options;
  const older = from.trim();
  const newer = to.trim();
  const dir = output.trim();
  if (!newer || !dir)
  {
    return [];
  }

  const args = [
    CMD_FORMAT_PATCH,
    // Unconditional: a patch that describes a rename as a rename applies where one
    // describing it as a delete and an add would conflict.
    FLAG_FIND_RENAMES,
    FLAG_FIND_COPIES,
    FLAG_BREAK_REWRITES
  ];
  if (startNumber !== null)
  {
    args.push(FLAG_START_NUMBER, String(startNumber));
  }
  // No older end means the branch from its very first commit; git needs `--root` to
  // include that commit rather than diffing it against a parent it does not have.
  if (older)
  {
    args.push(`${older}..${newer}`);
  }
  else
  {
    args.push(FLAG_ROOT, newer);
  }
  args.push(FLAG_OUTPUT_DIR, dir);
  return args;
}

/** How to bring a patch file in. */
export type ApplyMode = 'apply' | 'am';

export interface ApplyModeInfo {
  mode: ApplyMode;
  label: string;
  detail: string;
}

export const APPLY_MODES: readonly ApplyModeInfo[] = [
  {
    mode: MODE_APPLY,
    label: 'As changes in the working tree',
    detail:
      '`git apply`: the diff lands as uncommitted work.'
  },
  {
    mode: MODE_AM,
    label: 'As commits',
    detail:
      '`git am --3way`: one commit per patch, author and date kept.'
  }
];

export interface ApplyPatchOptions {
  mode?: ApplyMode;
  /** The patch file, or the directory of them `git am` takes. */
  file: string;
  /** Ignore whitespace differences when the context does not line up. */
  ignoreWhitespace?: boolean;
  /** `git apply` only: put the changes in the index as well as the working tree. */
  index?: boolean;
}

export function buildApplyPatchArgs(options: ApplyPatchOptions): string[]
{
  const {
    mode = MODE_APPLY,
    file,
    ignoreWhitespace = false,
    index = false
  } = options;

  const target = file.trim();
  if (!target)
  {
    return [];
  }

  if (mode === MODE_AM)
  {
    // With the blobs the patch names, git can merge a hunk whose context has moved
    // instead of refusing the whole patch.
    const args = [CMD_AM, FLAG_3WAY];
    if (ignoreWhitespace)
    {
      args.push(FLAG_IGNORE_WHITESPACE);
    }
    args.push(target);
    return args;
  }

  const args = [CMD_APPLY];
  if (index)
  {
    args.push(FLAG_INDEX);
  }
  if (ignoreWhitespace)
  {
    args.push(FLAG_IGNORE_WHITESPACE);
  }
  args.push(target);
  return args;
}

/**
 * Finishing or abandoning an `am` that stopped.
 *
 * `git am` runs a sequencer exactly as cherry-pick does, and a patch that conflicts leaves
 * it running: so the same three ways out, and the same reason they are commands rather
 * than something the dialog leaves you to find.
 */
export type ApplyStep = 'continue' | 'skip' | 'abort';

export function buildApplyStepArgs(step: ApplyStep): string[]
{
  return [CMD_AM, `--${step}`];
}
