/** Which characters differ between two replaced lines: the intra-line highlight. */

/** The part of a replaced line that actually changed, as a character range per side. */
export interface InlineChange {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

const WORD = /[\p{L}\p{N}_]/u;

/** Walk a prefix length back to the start of the word it lands inside. */
function backToWordStart(text: string, prefix: number): number
{
  let at = prefix;
  while (at > 0 && WORD.test(text[at - 1] ?? '') && WORD.test(text[at] ?? ''))
  {
    at--;
  }
  return at;
}

/** Walk a suffix length forward to the end of the word it lands inside. */
function forwardToWordEnd(text: string, suffix: number): number
{
  let at = suffix;
  while (
    at < text.length &&
    WORD.test(text[text.length - at] ?? '') &&
    WORD.test(text[text.length - 1 - at] ?? '')
  )
  {
    at++;
  }
  return at;
}

/**
 * Which characters differ between a deleted line and the line that replaced it.
 *
 * The common prefix and suffix, trimmed back to a word boundary so a one-character
 * edit inside a word highlights the word rather than the character, which is what
 * makes a renamed identifier readable at a glance instead of a scatter of single
 * letters.
 *
 * Returns null when there is nothing useful to say: identical lines, or a pair that
 * agrees at neither end: a line that was rewritten rather than edited, where marking
 * all of it is the same as marking none of it.
 */
export function inlineChange(oldText: string, newText: string): InlineChange | null
{
  if (oldText === newText)
  {
    return null;
  }

  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix])
  {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < max - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  )
  {
    suffix++;
  }

  // Two lines that barely agree at either end were rewritten rather than edited, and
  // marking nearly all of both says nothing while making the row hard to read. The test
  // is on the *raw* prefix and suffix, before either grows to a word boundary.
  const shared = prefix + suffix;
  if (shared === 0)
  {
    return null;
  }
  if (shared * 2 < Math.min(oldText.length, newText.length))
  {
    return null;
  }

  prefix = backToWordStart(oldText, prefix);
  // Widening the suffix can push it past what the prefix left, on a short line where
  // both ends grew into the same word; the range then has to collapse rather than
  // invert.
  suffix = Math.min(
    forwardToWordEnd(oldText, suffix),
    oldText.length - prefix,
    newText.length - prefix
  );

  return {
    oldStart: prefix,
    oldEnd: oldText.length - suffix,
    newStart: prefix,
    newEnd: newText.length - suffix
  };
}
