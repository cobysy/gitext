/**
 * The lines open at one point in the walk, one per column, left to right. A line's lane
 * *is* its slot in this array; an empty slot is a column with nothing in it.
 *
 * **A line moves at most one column per row, ever.** That single rule is what makes
 * every lane change a diagonal: a line with four columns to cross takes four rows to
 * cross them, one column per row, which is a diagonal you can follow. Crossing all four
 * at once would be a five-degree line that reads as horizontal.
 *
 * Paying for it is the point of the empty slots. A line that ends leaves its column
 * behind, and the columns to its right come back one per row rather than all at once; a
 * line cutting left across its neighbours pushes each of them one column right as it
 * passes, and they drift back once it has gone. So the gutter carries a gap only while
 * something is moving through it.
 */

/** A line running from a commit already drawn down to one not reached yet. */
export interface OpenLine {
  /** Sha of the commit the line ends at. */
  readonly target: string;
  /** Palette index, fixed when the line is created and never changed. */
  readonly color: number;
  /** Row of the commit the line descends from. */
  readonly childRow: number;
}

export class OpenLines
{
  private slots: (OpenLine | null)[] = [];

  /**
   * Where every line is, rebuilt only after something moves. The row being drawn asks
   * for this twice, once for its top edge and once for its bottom, and the bottom of one
   * row is the top of the next, so without the cache it is built twice as often as
   * anything moves.
   */
  private cachedColumns: Map<OpenLine, number> | null = null;

  /** Columns in use, empty ones included. */
  get width(): number
  {
    return this.slots.length;
  }

  at(column: number): OpenLine | null
  {
    return this.slots[column] ?? null;
  }

  /** The leftmost line heading for `target`, or null. */
  find(target: string): OpenLine | null
  {
    return this.slots.find((line) => line?.target === target) ?? null;
  }

  /** Where every open line is now, which is where the row being drawn starts them. */
  columns(): ReadonlyMap<OpenLine, number>
  {
    if (this.cachedColumns)
    {
      return this.cachedColumns;
    }

    const columns = new Map<OpenLine, number>();
    for (let column = 0; column < this.slots.length; column++)
    {
      const line = this.slots[column];
      if (line)
      {
        columns.set(line, column);
      }
    }
    this.cachedColumns = columns;
    return columns;
  }

  /** Every colour currently in the gutter, as a veto mask for `pickColor`. */
  vetoMask(): number
  {
    let mask = 0;
    for (const line of this.slots)
    {
      if (line)
      {
        mask |= 1 << line.color;
      }
    }
    return mask;
  }

  /**
   * Empty the slots of the lines that end at `target`. The leftmost of them is where the
   * commit's node goes, and where whatever it starts takes over.
   */
  end(target: string): { nodeColumn: number; ended: OpenLine[] }
  {
    let nodeColumn = -1;
    const ended: OpenLine[] = [];
    for (let column = 0; column < this.slots.length; column++)
    {
      const line = this.slots[column];
      if (line?.target === target)
      {
        if (nodeColumn < 0)
        {
          nodeColumn = column;
        }
        ended.push(line);
        this.slots[column] = null;
        this.cachedColumns = null;
      }
    }
    return { nodeColumn, ended };
  }

  /** The leftmost empty column, or one past the end when every column is taken. */
  firstFreeColumn(): number
  {
    const free = this.slots.indexOf(null);
    if (free >= 0)
    {
      return free;
    }
    return this.slots.length;
  }

  /**
   * Open the lines this commit starts, as one block at the commit's own column. The
   * column the node is in is empty by now (its own line ended there, or it is a tip
   * taking an empty one), so the block replaces that rather than pushing everything
   * along: a commit with one parent moves nothing at all.
   */
  start(column: number, started: readonly OpenLine[]): void
  {
    if (started.length === 0)
    {
      return;
    }

    let replaces = 0;
    if (column < this.slots.length && this.slots[column] === null)
    {
      replaces = 1;
    }
    while (this.slots.length < column)
    {
      this.slots.push(null);
    }
    this.slots.splice(column, replaces, ...started);
    this.cachedColumns = null;
  }

  /**
   * Close the gutter up behind whatever ended: every line to the right of an empty
   * column moves down onto it.
   *
   * All at once, in the row where the room appeared, rather than a column per row. A
   * gutter that closes gradually has some line moving on almost every row, and lines
   * that are never quite vertical read as ribbons rather than as lanes. Closing at once
   * means a line is vertical except in the one row where something beside it ended.
   *
   * What that costs is a line arriving at a node several columns away: inside one row
   * that is a near-horizontal dash. `slant.ts` answers that by moving where such a line
   * is *drawn* over the rows above it, which needs no lane to move at all.
   */
  settle(): void
  {
    const packed = this.slots.filter((line): line is OpenLine => line !== null);
    if (packed.length !== this.slots.length)
    {
      this.slots = packed;
      this.cachedColumns = null;
    }
  }

  /** Drop empty columns off the right-hand end, so the gutter narrows with the history. */
  trim(): void
  {
    while (this.slots.length > 0 && this.slots[this.slots.length - 1] === null)
    {
      this.slots.pop();
    }
    // Trimming moves nothing, so the cached columns still stand.
  }
}
