/**
 * The one thing about the graph's shape that is a preference.
 *
 * A snapshot, passed in rather than read from the settings store, so `buildGraph` stays
 * a pure function of `(commits, config)`.
 */

export interface GraphConfig {
  /**
   * Let a merge's incoming line join a column already heading for the same commit,
   * instead of taking a column of its own and running beside it until they meet.
   *
   * Narrower, and it says something true: from that point down the two are one history.
   */
  mergeCommonParentLanes: boolean;
}

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  mergeCommonParentLanes: true
};
