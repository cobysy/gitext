/**
 * git fsck argv. In shared because both main (listing) and renderer (dialog preview) need it.
 */

export interface FsckOptions {
  /**
   * --unreachable: show all unreachable objects, not just dangling ones (matters for recovery).
   */
  unreachable?: boolean;
  /** `--full`: check the packed objects too, not just the loose ones. Slower. */
  full?: boolean;
  /**
   * --no-reflogs: exclude reflog roots (let reset --hard commits be reported as lost).
   */
  noReflogs?: boolean;
  /**
   * `--lost-found`: write what it finds into `.git/lost-found/` as real files.
   *
   * Not a listing option: this is the recovery half, and it is the same command with one
   * more flag, which is why it is here rather than in a builder of its own.
   */
  lostFound?: boolean;
}

/**
 * Build git fsck argv. Always --no-progress (used for both listing and streamed --lost-found).
 */
const CMD_FSCK = 'fsck';

export function buildFsckArgs(options: FsckOptions = {}): string[]
{
  const { unreachable = false, full = false, noReflogs = false, lostFound = false } = options;
  const args = [CMD_FSCK, '--no-progress'];
  if (unreachable)
  {
    args.push('--unreachable');
  }
  if (full)
  {
    args.push('--full');
  }
  if (noReflogs)
  {
    args.push('--no-reflogs');
  }
  if (lostFound)
  {
    args.push('--lost-found');
  }
  return args;
}
