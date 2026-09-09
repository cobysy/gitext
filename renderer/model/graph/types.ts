/**
 * What the layout is given, and what it hands the canvas.
 *
 * A **lane** is a column of the gutter. A **line** is one child-to-parent connection.
 * A line holds one column for its whole length: it can only change column where it
 * leaves its child or where it reaches its parent, and both of those happen inside a
 * single row and are drawn as one diagonal. Nothing here needs a neighbouring row to
 * know where a line is, which is what keeps the layout one forward pass and the canvas
 * a per-row draw.
 */

/** The only two fields of a commit the layout reads. */
export interface GraphInputCommit {
  sha: string;
  parents: string[];
}

/**
 * One line, as it crosses one row.
 *
 * `fromLane` is the column it is in at the row's top edge and `toLane` the column at the
 * bottom edge. `-1` on either side means it stops at this row's node instead of crossing
 * that edge, and that is the only place the two differ.
 */
export interface GraphLine {
  /** Column at the row's top edge, or -1 when the line starts at this row's node. */
  fromLane: number;
  /** Column at the row's bottom edge, or -1 when the line ends at this row's node. */
  toLane: number;
  /** Palette index, `--graph-{n}`: fixed when the line is created and never repainted. */
  color: number;
  /**
   * Row of the commit the line descends from, which is what ancestry dimming asks
   * about. A row index rather than a flag, so moving the highlight is a redraw and
   * never a relayout.
   */
  childRow: number;
}

/** One row of the gutter: a node, and the lines crossing or touching it. */
export interface GraphRow {
  /** Column this row's node sits in. */
  nodeLane: number;
  /** Palette index of the node: the colour of the line running through it. */
  color: number;
  /** Columns this row occupies, which is what the gutter is measured from. */
  laneCount: number;
  lines: GraphLine[];
}
