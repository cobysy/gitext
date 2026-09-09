/**
 * Split UI text into prose and git tokens in backticks. Markdown's grammar:
 * backticks mark code. Pure DOM-free so rule can be tested alone.
 */

const BACKTICK = '`';

/** Text with backticks removed for titles/labels/tooltips that render no markup. */
export function plainText(text: string): string
{
  return codeSegments(text).map((segment) => segment.value).join('');
}

export interface TextSegment
{
  value: string;
  /** Render in mono face. */
  code: boolean;
}

/**
 * Alternating plain/code segments. Odd indices are code. Unclosed backtick
 * stays prose with its mark (harmless for stray backticks in error output).
 */
export function codeSegments(text: string): TextSegment[]
{
  const parts = text.split(BACKTICK);
  const lastIsUnclosed = parts.length % 2 === 0;
  return parts.map((value, index) =>
  {
    const last = index === parts.length - 1;
    if (lastIsUnclosed && last)
    {
      return { value: BACKTICK + value, code: false };
    }
    else
    {
      return { value, code: index % 2 === 1 };
    }
  });
}
