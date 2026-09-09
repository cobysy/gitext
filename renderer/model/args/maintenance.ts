/**
 * Argv for housekeeping commands: `gc` and `prune`.
 * All are shown before running and streamed during execution.
 */

// ── gc ────────────────────────────────────────────────────────────────────────

export interface GcOptions {
  /**
   * `--aggressive`: repack from scratch (slow; only worth it after history rewrites or large imports).
   */
  aggressive?: boolean;
  /**
   * `--prune=<date>`. git's default is `2.weeks.ago` to avoid race conditions.
   */
  prune?: string;
}

const CMD_GC = 'gc';
const CMD_PRUNE = 'prune';
const FLAG_AGGRESSIVE = '--aggressive';
const FLAG_VERBOSE = '--verbose';
const FLAG_PROGRESS = '--progress';

export function buildGcArgs(options: GcOptions = {}): string[]
{
  const { aggressive = false, prune } = options;
  const args = [CMD_GC];
  if (aggressive)
  {
    args.push(FLAG_AGGRESSIVE);
  }
  if (prune && prune.trim())
  {
    args.push(`--prune=${prune.trim()}`);
  }
  return args;
}

// ── fsck ──────────────────────────────────────────────────────────────────────
// `buildFsckArgs` is in `shared/fsck.ts` (argv is built in main for typed channels).

// ── prune ─────────────────────────────────────────────────────────────────────

/**
 * `git prune`: delete unreachable objects. Use `--verbose` to show what was deleted.
 */
export function buildPruneArgs(): string[]
{
  return [CMD_PRUNE, FLAG_VERBOSE, FLAG_PROGRESS];
}
