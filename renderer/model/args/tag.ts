/**
 * git tag argv. The -- before commit is essential (tag name and revision both just words to git).
 */

// Tag kinds
const TAG_KIND_LIGHTWEIGHT = 'lightweight';
const TAG_KIND_ANNOTATED = 'annotated';

// Git commands
const CMD_TAG = 'tag';
const CMD_PUSH = 'push';

// Git flags
const FLAG_ANNOTATE = '-a';
const FLAG_FORCE = '-f';
const FLAG_MESSAGE_FILE = '-F';
const FLAG_DELETE = '-d';
const FLAG_DELETE_REMOTE = '--delete';

/**
 * What kind of tag object to make.
 *
 * A lightweight tag is a ref and nothing else, no message, no tagger, no date, which
 * is why the message field is disabled under it rather than ignored.
 */
export type TagKind = 'lightweight' | 'annotated';

export interface TagKindInfo {
  kind: TagKind;
  label: string;
  detail: string;
  /** Whether this kind can carry a message. Only a lightweight tag cannot. */
  message: boolean;
}

export const TAG_KINDS: readonly TagKindInfo[] = [
  {
    kind: TAG_KIND_LIGHTWEIGHT,
    label: 'Lightweight',
    detail:
      'Just a name on the commit. No message, author or date.',
    message: false
  },
  {
    kind: TAG_KIND_ANNOTATED,
    label: 'Annotated',
    detail:
      '`-a`: a real object with a message, tagger and date.',
    message: true
  }
];

export interface CreateTagOptions {
  name: string;
  /** What it points at. A SHA, a branch, `HEAD`. */
  commit: string;
  kind?: TagKind;
  /**
   * Path to a file holding the message: never the message itself.
   *
   * `-F` rather than `-m` for the same reason the merge dialog uses it: a message with a
   * blank line and a body survives a file, and `-m` on a multi-line string depends on how
   * the argv is assembled.
   */
  messageFile?: string | null;
  /** Overwrite a tag of the same name: `-f`. */
  force?: boolean;
}

export function buildCreateTagArgs(options: CreateTagOptions): string[]
{
  const {
    name,
    commit,
    kind = TAG_KIND_LIGHTWEIGHT,
    messageFile = null,
    force = false
  } = options;

  const info = TAG_KINDS.find((entry) => entry.kind === kind);
  let operation: string[];
  if (kind === TAG_KIND_ANNOTATED)
  {
    operation = [FLAG_ANNOTATE];
  }
  else
  {
    operation = [];
  }

  const args = [CMD_TAG];
  if (force)
  {
    args.push(FLAG_FORCE);
  }
  args.push(...operation);
  if (info?.message && messageFile)
  {
    args.push(FLAG_MESSAGE_FILE, messageFile);
  }
  args.push(name.trim());
  // Without the separator, `git tag v1.0 main` is ambiguous the moment somebody has a
  // branch called `v1.0`.
  args.push('--');
  if (commit)
  {
    args.push(commit);
  }
  return args;
}

/** `git tag -d <name>…`: local only; the remote copy is a separate push. */
export function buildDeleteTagArgs(names: readonly string[]): string[]
{
  if (names.length)
  {
    return [CMD_TAG, FLAG_DELETE, ...names];
  }
  else
  {
    return [];
  }
}

/**
 * `git push <remote> --delete <ref>…`: deleting on the remote.
 *
 * The same shape for tags and branches, which is why it lives here rather than being
 * written out twice: git deletes a remote ref by pushing nothing to it, and `--delete` is
 * the readable spelling of the `:ref` refspec.
 */
export function buildDeleteRemoteRefArgs(
  remote: string,
  refs: readonly string[]
): string[]
{
  if (remote && refs.length)
  {
    return [CMD_PUSH, remote, FLAG_DELETE_REMOTE, ...refs];
  }
  else
  {
    return [];
  }
}
