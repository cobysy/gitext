/**
 * Row movement and quick-search matching. Pure and tested as unit tests (no store/window).
 * Rows are indexed, not SHAs; callers translate to selection store.
 */

/** The row fields quick search reads. `CommitRow` satisfies it structurally. */
export interface SearchableRow {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
  readonly authorName: string;
  readonly refs: readonly { readonly name: string }[];
}

/** Down the grid (towards older commits) is +1; up is -1. */
export type SearchDirection = 1 | -1;

/**
 * Row `delta` steps away, clamped (wrap would spin on hold). With nothing selected, land on row 0 (not far end of history).
 */
export function stepRow(current: number | undefined, delta: number, count: number): number | undefined
{
  if (count === 0)
  {
    return undefined;
  }
  if (current === undefined)
  {
    return 0;
  }
  return Math.min(count - 1, Math.max(0, current + delta));
}

/**
 * Match refs, SHA (3+ chars to avoid false positives), author, message.
 */
export function matchesQuickSearch(row: SearchableRow, term: string): boolean
{
  const needle = term.trim().toLowerCase();
  if (needle === '')
  {
    return false;
  }

  for (const ref of row.refs)
  {
    if (ref.name.toLowerCase().includes(needle))
    {
      return true;
    }
  }

  if (needle.length > 2 && row.sha.toLowerCase().startsWith(needle))
  {
    return true;
  }

  if (row.authorName.toLowerCase().includes(needle))
  {
    return true;
  }
  return `${row.subject}\n${row.body}`.toLowerCase().includes(needle);
}

/**
 * Next row matching term, starting inclusive (refine search, not walk results).
 * Returns undefined when no match (shown as error, not silent).
 */
export function findQuickSearchMatch(
  rows: readonly SearchableRow[],
  term: string,
  from: number,
  direction: SearchDirection
): number | undefined
{
  const count = rows.length;
  if (count === 0 || term.trim() === '')
  {
    return undefined;
  }

  for (let i = 0; i < count; i++)
  {
    // Modulo twice: JavaScript's `%` keeps the sign, so a backwards search off the top
    // of the list would otherwise index with a negative number.
    const index = (((from + i * direction) % count) + count) % count;
    if (matchesQuickSearch(rows[index]!, term))
    {
      return index;
    }
  }

  return undefined;
}
