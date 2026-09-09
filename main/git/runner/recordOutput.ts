/**
 * The output a command-log record keeps: the lines `execute`'s splitter has already
 * shaped, held up to a bound.
 *
 * Bounded because the ring holds hundreds of records and each is broadcast to every
 * open window, so what one carries cannot be however much git felt like printing.
 *
 * It does no parsing of its own. Turning git's chunks into the lines a terminal would
 * show is `execute`'s one splitter and `terminalLine`, so the command log and the
 * console window cannot come to different answers about what git said.
 */

import { MAX_RECORD_OUTPUT } from '@shared/types.js';

const LF = '\n';

export class CappedOutput
{
  /** The lines that have ended, each with its newline, up to the cap. */
  private text = '';
  /** The line git is still part way through writing. */
  private partial = '';
  /** How much the ended lines came to in total, cap or no cap. */
  private length = 0;

  /** A line that has ended, as the terminal would have shown it. */
  addLine(line: string): void
  {
    const ended = line + LF;
    this.length += ended.length;
    this.text += ended.slice(0, this.room);
  }

  /**
   * The line being written, each time it changes: a progress meter spends a whole phase
   * rewriting one line, and a record that waited for the newline would show nothing for
   * as long as that phase lasted.
   */
  setPartial(line: string): void
  {
    this.partial = line;
  }

  /** The text so far, including that unfinished line. */
  get kept(): string
  {
    return this.text + this.partial.slice(0, this.room);
  }

  /** How much there was in total, or undefined when nothing was cut. */
  get cutFrom(): number | undefined
  {
    const total = this.length + this.partial.length;
    if (total > this.kept.length)
    {
      return total;
    }
    return undefined;
  }

  /** How many more characters the cap has room for. */
  private get room(): number
  {
    return Math.max(0, MAX_RECORD_OUTPUT - this.text.length);
  }
}
