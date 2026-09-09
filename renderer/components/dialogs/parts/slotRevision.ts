/**
 * Endpoint and name are one value. Together avoid swapping mismatches.
 * Own module for TypeScript.
 */

import { ENDPOINT_KIND_COMMIT, type DiffEndpoint } from '@shared/diff.js';


export interface SlotRevision {
  /** What the diff is actually taken against. */
  endpoint: DiffEndpoint;
  /**
   * Name if chosen by name (branch/tag/HEAD). Null for SHA-only:
   * card draws short SHA.
   */
  name: string | null;
}

/** Revision caller named, before resolution. */
export function namedRevision(rev: string): SlotRevision
{
  return { endpoint: { kind: ENDPOINT_KIND_COMMIT, sha: rev }, name: rev };
}
