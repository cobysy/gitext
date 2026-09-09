/**
 * Folding an OS locale into a tag `Intl` honours.
 *
 * The case that motivated this: English (US) with the region set to Denmark, which
 * macOS reports as `en_US@rg=dkzzzz`. Left alone that formats as US: V8 drops the `rg`
 * subtag: so the assertions below are as much about the region actually landing as
 * about the parsing.
 */

import { describe, expect, it } from 'vitest';
import { toDisplayLocale } from '@shared/locale.js';

const AT = Date.UTC(2026, 7, 4, 14, 22) / 1000;

/** What the details pane would print, so a tag is judged by what it does. */
const shown = (tag: string): string =>
  new Date(AT * 1000).toLocaleString(tag || undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

describe('the OS locale', () =>
{
  it('folds a region override into the tag', () =>
  {
    // Exactly what `app.getSystemLocale()` returns on macOS: hyphenated, with the
    // override still in the POSIX keyword syntax. The underscored form turns up in
    // `AppleLocale` and in environment variables.
    expect(toDisplayLocale('en-US@rg=dkzzzz')).toBe('en-DK');
    expect(toDisplayLocale('en_US@rg=dkzzzz')).toBe('en-DK');
  });

  it('takes the BCP-47 spelling of the same override', () =>
  {
    expect(toDisplayLocale('en-US-u-rg-dkzzzz')).toBe('en-DK');
  });

  it('keeps a script while replacing the region', () =>
  {
    expect(toDisplayLocale('zh_Hans_CN@rg=twzzzz')).toBe('zh-Hans-TW');
  });

  it('passes an ordinary locale through, in canonical form', () =>
  {
    expect(toDisplayLocale('da_DK')).toBe('da-DK');
    expect(toDisplayLocale('en-gb')).toBe('en-GB');
    expect(toDisplayLocale('fr_CA.UTF-8')).toBe('fr-CA');
  });

  it('returns nothing for what it cannot use, rather than a broken tag', () =>
  {
    // The caller passes `''` to `Intl` as `undefined` and gets the runtime default.
    expect(toDisplayLocale('')).toBe('');
    expect(toDisplayLocale('   ')).toBe('');
    expect(toDisplayLocale('C')).toBe('');
    expect(toDisplayLocale('not a locale')).toBe('');
  });

  it('changes the date, which is the whole point', () =>
  {
    // Day-first and a 24-hour clock, rather than the US month-first and "04:22 PM".
    const danish = shown(toDisplayLocale('en_US@rg=dkzzzz'));
    expect(danish).toMatch(/^04\D08\D2026/);
    expect(danish).not.toMatch(/[AP]M/);
    expect(shown('en-US')).toMatch(/^08\D04\D2026/);
  });
});
