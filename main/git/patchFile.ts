/**
 * Read a .patch file (not git): parse it like diff viewer does so external tools' patches read correctly.
 * Separate module because it's neither index nor repo: a patch can be anywhere on disk.
 */

import { readFile, stat } from 'node:fs/promises';
import type { BlobContents } from '@shared/tree.js';
import { BINARY_SNIFF_BYTES, MAX_GIT_OUTPUT_BYTES } from './constants.js';

const ENCODING_UTF8 = 'utf8';

/** Returns BlobContents shape to reuse the same viewer and checks; submodule is always false. */
export async function readPatchFile(path: string): Promise<BlobContents>
{
  const { size } = await stat(path);

  const buffer = await readFile(path);
  const binary = buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  const truncated = size > MAX_GIT_OUTPUT_BYTES;

  let text: string;
  if (binary)
  {
    text = '';
  }
  else
  {
    text = buffer.subarray(0, MAX_GIT_OUTPUT_BYTES).toString(ENCODING_UTF8);
  }
  return {
    path,
    text,
    size,
    binary,
    truncated,
    submodule: false,
    missing: false
  };
}
