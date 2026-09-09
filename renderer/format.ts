/**
 * Display formatting for dates, author names, commit messages and sizes. Vue-free and
 * fully testable. Timestamps cross IPC as unix seconds; formatting
 * (relative/absolute/locale) stays here.
 */

import type { CommitRow, DateFormat } from '@shared/types.js';

/**
 * The locale for absolute dates, set at startup from `env:locale`.
 * If unset, Intl defaults to app language, which can mismatch the region.
 */
let dateLocale: string | undefined;

export function setDateLocale(tag: string): void
{
  dateLocale = tag || undefined;
  // The formatter below is built from it, so it cannot outlive the locale it was built for.
  absoluteFormatter = null;
}

/**
 * Relative dates always English (no i18n). Absolute dates follow locale.
 */
const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const ABSOLUTE_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
};

/**
 * Held, not rebuilt per call, and lazily so the locale has arrived by the time it is
 * first asked for.
 *
 * `toLocaleString(locale, options)` builds one of these on every call, and that
 * construction is the whole cost: 44us against 1.8us for a formatter already built. The
 * grid formats a date for every visible row on every render, so it is a cost paid forty
 * times a frame.
 */
let absoluteFormatter: Intl.DateTimeFormat | null = null;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60]
];

/** `04/08/2026, 16.22`, in the local zone and the user's regional conventions. */
export function formatAbsoluteDate(seconds: number): string
{
  absoluteFormatter ??= new Intl.DateTimeFormat(dateLocale, ABSOLUTE_DATE_OPTIONS);
  return absoluteFormatter.format(new Date(seconds * 1000));
}

/** `3 days ago`. Anything under a minute reads as "just now" rather than "0 seconds". */
export function formatRelativeDate(seconds: number, now: number = Date.now()): string
{
  const elapsed = (now - seconds * 1000) / 1000;
  for (const [unit, size] of UNITS)
  {
    if (Math.abs(elapsed) >= size)
    {
      // Truncate toward zero (not round). Clock skew in shared repos means commits
      // dated in the future should round to "in 1 hour", not "in 2 hours".
      return relativeFormatter.format(-Math.trunc(elapsed / size), unit);
    }
  }
  return 'just now';
}

/** Whichever form the `dateFormat` setting asks for. */
const DATE_FORMAT_ABSOLUTE = 'absolute';

export function formatCommitDate(seconds: number, format: DateFormat): string
{
  if (format === DATE_FORMAT_ABSOLUTE)
  {
    return formatAbsoluteDate(seconds);
  }
  else
  {
    return formatRelativeDate(seconds);
  }
}

/**
 * Which commit date the grid shows. A function to avoid branching at two call sites: the cell and the column measurer.
 */
export function gridCommitDate(row: CommitRow, showAuthorDate: boolean): number
{
  if (showAuthorDate)
  {
    return row.authorDate;
  }
  else
  {
    return row.committerDate;
  }
}

/**
 * Tooltip showing both dates in absolute format (relative format wouldn't distinguish them).
 * One line if same author/committer/time; two lines otherwise.
 */
export function describeCommitDates(row: CommitRow): string
{
  const sameHand = row.authorName === row.committerName && row.authorEmail === row.committerEmail;
  if (sameHand && row.authorDate === row.committerDate)
  {
    return `${formatAbsoluteDate(row.authorDate)} ${row.authorName} authored and committed`;
  }
  return (
    `${formatAbsoluteDate(row.authorDate)} ${row.authorName} authored\n` +
    `${formatAbsoluteDate(row.committerDate)} ${row.committerName} committed`
  );
}

/**
 * Format body as one line (row is one line tall): strip blanks, trim each line to avoid runs of spaces.
 */
export function inlineBody(body: string): string
{
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

/**
 * Author name as initials ("Jane Doe" → "JD") or verbatim, controlled by the
 * `authorInitials` setting. Safe for any Unicode name.
 *
 * Initials come from the *name*, which is what the setting and its label promise. The
 * email local part is the fallback for a name that yields nothing to abbreviate (an empty
 * name, or one made entirely of punctuation), not the ordinary answer.
 */
export function formatAuthorName(name: string, email: string, initials: boolean): string
{
  if (!initials)
  {
    return name;
  }
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    // The first character of a word, by code point: a surrogate pair is one letter.
    .map((word) => [...word][0] ?? '')
    .filter((letter) => /\p{L}|\p{N}/u.test(letter));
  if (letters.length > 0)
  {
    return letters.slice(0, 2).join('').toUpperCase();
  }
  return email.split('@')[0] ?? name;
}

// Defined in `shared/` because the patch reader abbreviates a submodule's commit ids
// too, and re-exported here because this is where the renderer looks for a formatter.
export { SHORT_SHA_LENGTH, shortSha } from '@renderer/model/sha.js';

/** `1.2 kB`, `4 bytes`: sizes as a person would say them. */
export function formatBytes(bytes: number): string
{
  if (bytes < 1024)
  {
    let noun: string;
    if (bytes === 1)
    {
      noun = 'byte';
    }
    else
    {
      noun = 'bytes';
    }
    return `${bytes} ${noun}`;
  }
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1)
  {
    value /= 1024;
    unit += 1;
  }
  let shown: number | string;
  if (value < 10)
  {
    shown = value.toFixed(1);
  }
  else
  {
    shown = Math.round(value);
  }
  return `${shown} ${units[unit]}`;
}
