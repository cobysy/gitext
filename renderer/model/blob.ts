import type { BlobContents } from '@shared/tree.js';

/** True when blob has text worth showing in the editor. */
export function isBlobShowable(blob: BlobContents | null): blob is BlobContents
{
  return !!blob && !blob.binary && !blob.submodule && !!blob.text;
}
