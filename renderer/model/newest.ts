/**
 * Guard reads that overtake each other: check before every assignment so superseded
 * replies don't overwrite newer ones (pane settles on selected row, not last-arrived).
 */
export interface Newest {
  /**
   * Start a request. The returned check answers true until a later request begins,
   * and false forever after: call it before every assignment, including in `finally`.
   */
  begin(): () => boolean;
}

export function newestOnly(): Newest
{
  let latest = 0;
  return {
    begin()
    {
      const mine = ++latest;
      return () => mine === latest;
    }
  };
}
