import { describe, expect, it } from 'vitest';
import { flagsIn, summaryOf } from '@renderer/model/args/summary.js';

describe('flagsIn', () =>
{
  it('keeps only the option-looking arguments', () =>
  {
    expect(flagsIn(['push', '--force-with-lease', '-u', '--progress', 'origin', 'main'])).toBe(
      '--force-with-lease -u --progress'
    );
  });

  it('drops the excluded flags', () =>
  {
    expect(flagsIn(['push', '--force', '--progress', 'origin'], ['--progress'])).toBe('--force');
  });

  it('matches an excluded flag on the part before the =', () =>
  {
    expect(
      flagsIn(['push', '--recurse-submodules=check'], ['--recurse-submodules'])
    ).toBe('');
  });

  it('keeps a flag whose value differs but whose name is not excluded', () =>
  {
    expect(flagsIn(['fetch', '--depth=1'], ['--prune'])).toBe('--depth=1');
  });

  it('is empty when nothing but positional arguments are left', () =>
  {
    expect(flagsIn(['merge', 'feature'])).toBe('');
  });

  // A revision expression is not an option, however much it looks like one at a glance.
  it('does not treat a negative-looking revision as a flag', () =>
  {
    expect(flagsIn(['rebase', 'HEAD~3'])).toBe('');
  });
});

describe('summaryOf', () =>
{
  it('joins the parts that have something in them', () =>
  {
    expect(summaryOf(['to release', '', '--force'])).toBe('to release · --force');
  });

  it('treats whitespace as nothing', () =>
  {
    expect(summaryOf(['   ', '-u'])).toBe('-u');
  });

  it('is empty when every part is', () =>
  {
    expect(summaryOf(['', ''])).toBe('');
  });
});
