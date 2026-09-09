/**
 * A three-way merge at word level, for text git already gave up on at line level. Git's
 * merge is line-based: base `1 tsp salt`, ours `2 tsp salt`, theirs `1 tsp sea salt` is
 * a conflict git can't resolve but the edits don't actually collide. Never overrules
 * git: only offers an answer when the two sides' edits are provably disjoint; anything
 * else is left exactly as git left it. Tokens are whitespace/non-whitespace runs, the
 * same split `git diff --word-diff` makes, kept (not discarded) so the merge rejoins byte-for-byte, indentation included.
 */

/**
 * The point past which this stops trying. The alignment below is O(n×m) in tokens; a
 * block this big is a wholesale rewrite, not two edits that might not collide, so the answer would be "conflicted" after the work anyway.
 */
const MAX_TOKEN_PRODUCT = 1_000_000;

/** One side's edit to a stretch of the base, as a half-open base range and its replacement. */
interface TokenChange {
  start: number;
  end: number;
  replacement: string[];
}

export function tokenize(text: string): string[]
{
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * What `other` did to `base`, as a list of replaced ranges. A longest-common-subsequence
 * alignment walked forwards: `dp[i][j]` is the LCS length of the two *suffixes* starting at `i` and `j`, which is what makes the forward walk possible instead of the usual backwards backtrack.
 */
function diffTokens(base: readonly string[], other: readonly string[]): TokenChange[]
{
  const n = base.length;
  const m = other.length;

  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i += 1)
  {
    dp.push(new Uint32Array(m + 1));
  }
  for (let i = n - 1; i >= 0; i -= 1)
  {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1)
    {
      if (base[i] === other[j])
      {
        row[j] = next[j + 1]! + 1;
      }
      else if (next[j]! >= row[j + 1]!)
      {
        row[j] = next[j]!;
      }
      else
      {
        row[j] = row[j + 1]!;
      }
    }
  }

  const changes: TokenChange[] = [];
  let i = 0;
  let j = 0;
  /** The open change, while a run of non-matching tokens is being consumed. */
  let open: TokenChange | null = null;

  const close = (): void =>
  {
    if (open)
    {
      changes.push(open);
      open = null;
    }
  };
  const openAt = (start: number): TokenChange =>
  {
    if (!open)
    {
      open = { start, end: start, replacement: [] };
    }
    return open;
  };

  while (i < n || j < m)
  {
    const isMatch = i < n && j < m && base[i] === other[j];
    if (isMatch)
    {
      close();
      i += 1;
      j += 1;
      continue;
    }
    const isInsertion = j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!);
    if (isInsertion)
    {
      // `other` has a token `base` does not: an insertion.
      openAt(i).replacement.push(other[j]!);
      j += 1;
      continue;
    }
    // `base` has a token `other` does not: a deletion.
    const change = openAt(i);
    change.end = i + 1;
    i += 1;
  }
  close();

  return changes;
}

/** Whether two edits touch. Insertions are zero-width, and two at the same point still collide, since which comes first isn't a decision this can make. */
function overlaps(a: TokenChange, b: TokenChange): boolean
{
  if (a.start === a.end && b.start === b.end)
  {
    return a.start === b.start;
  }
  return a.start < b.end && b.start < a.end;
}

/**
 * Merge `ours` and `theirs` over their common ancestor, or null when they genuinely
 * collide. Null is the important half of the contract: two edits to the same words, a
 * block too large to align, or a base nobody could establish all stay a conflict a person decides, rather than a guess.
 */
export function threeWayWordMerge(base: string, ours: string, theirs: string): string | null
{
  const baseTokens = tokenize(base);
  const oursTokens = tokenize(ours);
  const theirsTokens = tokenize(theirs);

  const budget = Math.max(oursTokens.length, theirsTokens.length) * (baseTokens.length + 1);
  if (budget > MAX_TOKEN_PRODUCT)
  {
    return null;
  }

  const oursChanges = diffTokens(baseTokens, oursTokens);
  const theirsChanges = diffTokens(baseTokens, theirsTokens);

  for (const mine of oursChanges)
  {
    for (const other of theirsChanges)
    {
      if (overlaps(mine, other))
      {
        return null;
      }
    }
  }

  // Disjoint, so both sets can simply be applied. Sorted by where they land, with an insertion before a replacement at the same point so inserted text stays in front.
  const all = [...oursChanges, ...theirsChanges].sort((a, b) =>
  {
    if (a.start !== b.start)
    {
      return a.start - b.start;
    }
    return (a.end - a.start) - (b.end - b.start);
  });

  const out: string[] = [];
  let at = 0;
  for (const change of all)
  {
    out.push(...baseTokens.slice(at, change.start));
    out.push(...change.replacement);
    at = Math.max(at, change.end);
  }
  out.push(...baseTokens.slice(at));

  return out.join('');
}
