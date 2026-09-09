/**
 * Turning "this changed" into "reload exactly that". `event:repoChanged` carries
 * facets (`shared/invalidation.ts`) rather than a path alone; this is the other half: a
 * table from facet to the work it invalidates, applied once each however many facets ask for it.
 *
 * **The division of labour is deliberate.** Main reports what *git* did: it can't know
 * the grid is scoped to the current branch, or the reflog is showing. So it says
 * `'head'`, and `needsLogReload` below decides whether this window's query actually depends on that.
 *
 * A window applies only the handlers it has: the repository window has five stores, a
 * dialog window has two and no grid. Each caller passes the handlers it can honour.
 */

import { ALL_FACETS, type RepoFacet } from '@shared/invalidation.js';

const FACET_COMMITS = 'commits';
const FACET_REFS = 'refs';
const FACET_HEAD = 'head';
// Not imported from `stores/settings.js`: that module's value exports pull in `api.ts`,
// which reads `window.git` at load time: this file stays loadable under Node.
const BRANCH_SCOPE_CURRENT = 'current';

/** One piece of reloading, and the facets that make it stale. */
export interface InvalidationHandler {
  facets: readonly RepoFacet[];
  run: () => void;
}

/**
 * Run every handler at least one of `facets` invalidates, each at most once. Order is
 * the order given, so a caller can put cheap visible reads ahead of expensive ones.
 */
export function applyInvalidation(
  facets: readonly RepoFacet[],
  handlers: readonly InvalidationHandler[]
): void
{
  if (facets.length === 0)
  {
    return;
  }
  const changed = new Set(facets);
  for (const handler of handlers)
  {
    if (handler.facets.some((facet) => changed.has(facet)))
    {
      handler.run();
    }
  }
}

/** What the grid's query is built from, as far as this decision is concerned. */
export interface LogScope {
  branchScope: 'current' | 'all' | 'filtered';
  reflog: boolean;
}

/**
 * Whether the revision grid has to re-run its query. Under the default `'all'` scope
 * the query is `--branches --tags --remotes`, so **a checkout changes no commits at
 * all**: `repo.refresh()` alone redraws the HEAD ring and artificial rows.
 *
 * `'refs'` always forces a reload: a row's ref badges are parsed from `CommitRow.refs`,
 * so a branch created or deleted anywhere changes the rows even when the walk doesn't.
 *
 * `'head'` is conditional, the reason this function exists:
 * - `'current'` scopes the walk to HEAD, so moving HEAD changes what's returned
 * - `--reflog` replaces the ref set with HEAD's own history
 * - otherwise the walk is over named refs, which a checkout doesn't touch
 */
export function needsLogReload(facets: readonly RepoFacet[], scope: LogScope): boolean
{
  const changed = new Set(facets);
  if (changed.has(FACET_COMMITS) || changed.has(FACET_REFS))
  {
    return true;
  }
  return changed.has(FACET_HEAD) && (scope.branchScope === BRANCH_SCOPE_CURRENT || scope.reflog);
}

/**
 * Whether `facets` is every facet there is: the shape only F5 and the `.git` watcher
 * send, since neither knows what actually changed. Naming it matters because
 * `ALL_FACETS` looks like a real operation's declared set (a commit, a merge) but could
 * just as easily be a checkout in another terminal; read literally it would move the grid's selection on every F5.
 */
export function isEveryFacet(facets: readonly RepoFacet[]): boolean
{
  if (facets.length !== ALL_FACETS.length)
  {
    return false;
  }
  const present = new Set(facets);
  return ALL_FACETS.every((facet) => present.has(facet));
}

/**
 * Whether `facets` marks an operation that moved HEAD, and so one the grid's selection
 * should follow: a commit, revert, cherry-pick, merge, rebase or reset, and a checkout.
 *
 * It once asked for `'commits'` as well, which excluded checkout on the grounds that it
 * lands on a commit already drawn. True, and beside the point: the row is there, the
 * selection is still on whatever you were looking at before, and the branch you switched
 * to may be a thousand rows away. Where HEAD *is* has nothing to do with whether the rows
 * had to be re-read.
 *
 * `ALL_FACETS` is still excluded, and that is the whole reason this is not just a set
 * lookup: F5 and the `.git` watcher send every facet because neither knows what changed,
 * so read literally they would drag the selection back to HEAD on every refresh and every
 * write in another terminal.
 */
export function headMoved(facets: readonly RepoFacet[]): boolean
{
  if (isEveryFacet(facets))
  {
    return false;
  }
  return new Set(facets).has(FACET_HEAD);
}
