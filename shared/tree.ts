/**
 * Repository contents at one endpoint, not changes. Same endpoint type as diff so one selection shows both.
 * Pure and testable: argv table is the only subtlety.
 */

import { ENDPOINT_KIND_COMMIT, type DiffEndpoint } from './diff.js';
import { OBJECT_KIND_BLOB, OBJECT_KIND_SUBMODULE } from './types/objects.js';

const CMD_LS_TREE = 'ls-tree';
const CMD_LS_FILES = 'ls-files';
const FLAG_RECURSIVE = '-r';
const FLAG_STAGE = '--stage';
const FLAG_NUL_TERMINATED = '-z';

/**
 * No status (this is "what exists", not "what changed").
 * Submodule separate from blob because submodules have no contents to show.
 */
export interface TreeEntry {
  /** Repo-relative and POSIX, exactly as git names it. */
  path: string;
  kind: typeof OBJECT_KIND_BLOB | typeof OBJECT_KIND_SUBMODULE;
  /** The six-digit file mode git stores: `100644`, `100755`, `120000`, `160000`. */
  mode: string;
}

/**
 * Only files (folders derived from paths to avoid duplication).
 * Commit uses ls-tree; index and working tree use ls-files (no tree object).
 *
 * | endpoint     | argv                    |
 * |--------------|-------------------------|
 * | commit       | `ls-tree -r -z <sha>`   |
 * | index        | `ls-files --stage -z`   |
 * | working tree | `ls-files --stage -z`   |
 */
export function buildTreeArgs(endpoint: DiffEndpoint): string[]
{
  if (endpoint.kind === ENDPOINT_KIND_COMMIT)
  {
    return [CMD_LS_TREE, FLAG_RECURSIVE, FLAG_NUL_TERMINATED, endpoint.sha];
  }
  return [CMD_LS_FILES, FLAG_STAGE, FLAG_NUL_TERMINATED];
}

/** One file's contents, as of whichever endpoint was asked about. */
export interface BlobContents {
  path: string;
  /** The decoded text, or empty when there is nothing to show. */
  text: string;
  /** Bytes on disk or in the object, before any truncation. */
  size: number;
  /** Held a NUL byte: an image, a font, a compiled thing. `text` is empty. */
  binary: boolean;
  /** Cut short at the size cap; what is here is the start of it. */
  truncated: boolean;
  /** A submodule's recorded commit, which has no contents of its own. */
  submodule: boolean;
  /** The endpoint has no such path. Not a failure: a revision that never had the file. */
  missing: boolean;
}
