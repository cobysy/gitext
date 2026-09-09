/**
 * Date and size formatting for the grid and the details pane.
 *
 * Commit timestamps cross IPC as unix seconds, so the rounding decisions live here and
 * are worth pinning: "40 hours ago" reading as "2 days ago" is the kind of small lie
 * that makes a history look wrong.
 */

import { describe, expect, it } from 'vitest';
import type { CommitRow } from '@shared/types.js';
import {
  describeCommitDates,
  formatAbsoluteDate,
  setDateLocale,
  formatBytes,
  formatCommitDate,
  formatRelativeDate,
  gridCommitDate,
  inlineBody,
  shortSha
} from '@renderer/format.js';

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);
const secondsAgo = (seconds: number): number => NOW / 1000 - seconds;

function commit(over: Partial<CommitRow> = {}): CommitRow
{
  return {
    sha: '0123456789abcdef0123456789abcdef01234567',
    parents: [],
    authorName: 'Jane Doe',
    authorEmail: 'jane@example.com',
    authorDate: 1_700_000_000,
    committerName: 'Jane Doe',
    committerEmail: 'jane@example.com',
    committerDate: 1_700_000_000,
    subject: 'Fix the thing',
    body: '',
    refs: [],
    note: '',
    ...over
  };
}

describe('relative dates', () =>
{
  it('truncates rather than rounds', () =>
  {
    // 40 hours is yesterday, not two days ago.
    expect(formatRelativeDate(secondsAgo(40 * 3600), NOW)).toBe('yesterday');
  });

  it('reads anything under a minute as just now', () =>
  {
    expect(formatRelativeDate(secondsAgo(5), NOW)).toBe('just now');
    expect(formatRelativeDate(secondsAgo(59), NOW)).toBe('just now');
  });

  it('steps up through the units', () =>
  {
    expect(formatRelativeDate(secondsAgo(90), NOW)).toBe('1 minute ago');
    expect(formatRelativeDate(secondsAgo(3 * 3600), NOW)).toBe('3 hours ago');
    expect(formatRelativeDate(secondsAgo(10 * 86_400), NOW)).toBe('10 days ago');
    expect(formatRelativeDate(secondsAgo(400 * 86_400), NOW)).toBe('last year');
  });

  it('handles a commit dated in the future without exaggerating it', () =>
  {
    // Clock skew on a shared repository genuinely produces these.
    expect(formatRelativeDate(secondsAgo(-90 * 60), NOW)).toBe('in 1 hour');
  });
});

describe('absolute dates', () =>
{
  it('renders a fixed-width local timestamp', () =>
  {
    const formatted = formatAbsoluteDate(NOW / 1000);
    // Locale-dependent order, so assert the shape rather than the exact string.
    expect(formatted).toMatch(/\d{2}/);
    expect(formatted).toContain('2026');
  });

  /**
   * The formatter is held rather than rebuilt per call, so it has to be dropped when the
   * locale it was built for is replaced. Locale arrives from `env:locale` after the first
   * dates may already have been drawn.
   */
  it('follows the locale it is given, including a later one', () =>
  {
    const seconds = NOW / 1000;
    try
    {
      setDateLocale('de-DE');
      const german = formatAbsoluteDate(seconds);
      setDateLocale('en-US');
      const american = formatAbsoluteDate(seconds);

      expect(german).toContain('.');
      expect(american).toContain('/');
      expect(german).not.toBe(american);
    }
    finally
    {
      // Module state: leaving a locale set would follow every test after this one.
      setDateLocale('');
    }
  });
});

describe('choosing a format', () =>
{
  it('follows the setting', () =>
  {
    // Against the real clock, because this is the entry point the components call and
    // it deliberately takes no injectable "now".
    const seconds = Date.now() / 1000 - 3 * 3600;
    expect(formatCommitDate(seconds, 'absolute')).toBe(formatAbsoluteDate(seconds));
    expect(formatCommitDate(seconds, 'relative')).toBe('3 hours ago');
  });
});

describe('which date the grid column shows', () =>
{
  it('follows the setting', () =>
  {
    const row = commit({ authorDate: 100, committerDate: 200 });
    expect(gridCommitDate(row, true)).toBe(100);
    expect(gridCommitDate(row, false)).toBe(200);
  });

  it('says who did what when the two ends agree', () =>
  {
    expect(describeCommitDates(commit())).toContain('Jane Doe authored and committed');
  });

  it('names both when a rebase has moved them apart', () =>
  {
    const rebased = commit({ committerDate: 1_700_000_500 });
    const [authored, committed] = describeCommitDates(rebased).split('\n');
    expect(authored).toContain('Jane Doe authored');
    expect(committed).toContain('Jane Doe committed');
    expect(authored).not.toBe(committed);
  });

  it('names both when someone else committed it, even at the same instant', () =>
  {
    // A patch applied by a maintainer: same second, two people. One line would drop one
    // of the two names, which is the case the tooltip exists for.
    const applied = commit({ committerName: 'Sam Patch', committerEmail: 'sam@example.com' });
    expect(describeCommitDates(applied)).toContain('\n');
    expect(describeCommitDates(applied)).toContain('Sam Patch committed');
  });
});

describe('a commit body on one line', () =>
{
  it('drops the blank lines and joins the rest with a space', () =>
  {
    expect(inlineBody('First paragraph.\n\nSecond paragraph.')).toBe(
      'First paragraph. Second paragraph.'
    );
  });

  it('trims each line, so an indented body reads as a sentence', () =>
  {
    expect(inlineBody('  Wrapped line\n    and its continuation')).toBe(
      'Wrapped line and its continuation'
    );
  });

  it('is empty for a message that is only whitespace', () =>
  {
    expect(inlineBody('\n  \n')).toBe('');
  });
});

describe('short SHAs', () =>
{
  it('abbreviates to the width the grid column is built for', () =>
  {
    expect(shortSha('0123456789abcdef0123456789abcdef01234567')).toBe('01234567');
  });
});

describe('formatBytes', () =>
{
  it('says bytes below a kilobyte, and singular for one', () =>
  {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(1023)).toBe('1023 bytes');
  });

  it('keeps a decimal only while the number is small', () =>
  {
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(1024 * 40)).toBe('40 kB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
  });
});
