/**
 * Loaded commit stream indexed for O(1) lookup by SHA or row. Plus artificial working-tree/index rows.
 */

import { computed, shallowRef, triggerRef, type ComputedRef } from 'vue';
import { artificialKind } from '@shared/artificial.js';
import type { CommitRow } from '@shared/types.js';

export interface StreamDeps {
  /** The working-tree/index rows, which sit above the commits and shift them down. */
  artificialRows: ComputedRef<CommitRow[]>;
}

export function createStreamState({ artificialRows }: StreamDeps)
{
  /**
   * Shallow: the array is appended to thousands of times during a load, and deep
   * reactivity over every commit would cost more than the parse and the layout put
   * together. Mutations are announced explicitly with `triggerRef`.
   */
  const commits = shallowRef<CommitRow[]>([]);

  const indexBySha = new Map<string, number>();

  /**
   * The parent edges read backwards, so the details pane can offer a commit's
   * children.
   *
   * Built while batches arrive rather than in `relayout`, because it is a single map
   * insert per parent and, unlike the lane layout, nothing about it has to be
   * revised when a later commit shows up. A child always appears above its parent in
   * log order, so this is complete for every commit already loaded.
   */
  const childrenBySha = new Map<string, string[]>();

  const count = computed(() => commits.value.length);

  function appendBatch(batch: CommitRow[]): void
  {
    const start = commits.value.length;
    for (let i = 0; i < batch.length; i++)
    {
      const commit = batch[i]!;
      indexBySha.set(commit.sha, start + i);
      for (const parent of commit.parents)
      {
        const children = childrenBySha.get(parent);
        if (children)
        {
          children.push(commit.sha);
        }
        else
        {
          childrenBySha.set(parent, [commit.sha]);
        }
      }
    }
    commits.value.push(...batch);
    triggerRef(commits);
  }

  /** Drop everything loaded, for a fresh load or a closed repository. */
  function clear(): void
  {
    commits.value = [];
    indexBySha.clear();
    childrenBySha.clear();
  }

  /**
   * Grid row for `sha`, or undefined when it is not on screen anywhere.
   *
   * `indexBySha` is built while batches arrive and so is indexed against `commits`;
   * the artificial rows sit above them and shift everything down. Kept as an offset
   * rather than rebuilding the map, because the map is written once per commit and
   * the offset changes far more often than the commits do.
   */
  function rowOf(sha: string): number | undefined
  {
    const artificial = artificialRows.value;
    for (let i = 0; i < artificial.length; i++)
    {
      if (artificial[i]!.sha === sha)
      {
        return i;
      }
    }
    const row = indexBySha.get(sha);
    if (row === undefined)
    {
      return undefined;
    }
    else
    {
      return row + artificial.length;
    }
  }

  function commitOf(sha: string): CommitRow | undefined
  {
    if (artificialKind(sha))
    {
      return artificialRows.value.find((r) => r.sha === sha);
    }
    const row = indexBySha.get(sha);
    if (row === undefined)
    {
      return undefined;
    }
    else
    {
      return commits.value[row];
    }
  }

  /**
   * Children of `sha` among the loaded rows, newest first.
   *
   * `childrenBySha` is built from the commit stream and so knows nothing about the
   * working-tree and index rows, which parent onto HEAD without being commits. They
   * are prepended here rather than folded into the map, because they come and go with
   * the working tree while the map is written once per commit, and because the grid
   * draws them above HEAD, so "go to child" from HEAD must reach them.
   */
  function childrenOf(sha: string): readonly string[]
  {
    const loaded = childrenBySha.get(sha) ?? [];
    const artificial = artificialRows.value.filter((r) => r.parents.includes(sha));
    if (artificial.length === 0)
    {
      return loaded;
    }
    else
    {
      return [...artificial.map((r) => r.sha), ...loaded];
    }
  }

  return { commits, count, appendBatch, clear, rowOf, commitOf, childrenOf };
}

export type StreamState = ReturnType<typeof createStreamState>;
