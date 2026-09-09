/**
 * The heading a file falls under in the two grouped list shapes.
 *
 * One rule for both file lists, the commit screen's and the changed-files pane's, which
 * is the whole reason it is a module rather than a function inside one of them.
 */

import { describe, expect, it } from 'vitest';
import {
  GROUP_VIEW_EXTENSION,
  GROUP_VIEW_STATUS,
  groupHeadingOf,
  isGroupView
} from '@renderer/model/fileGroups.js';

describe('isGroupView', () =>
{
  it('separates the two groupings from the two path shapes', () =>
  {
    expect(isGroupView(GROUP_VIEW_EXTENSION)).toBe(true);
    expect(isGroupView(GROUP_VIEW_STATUS)).toBe(true);
    expect(isGroupView('tree')).toBe(false);
    expect(isGroupView('flat')).toBe(false);
  });
});

describe('groupHeadingOf', () =>
{
  it('groups by extension', () =>
  {
    expect(groupHeadingOf({ path: 'src/main.ts' }, GROUP_VIEW_EXTENSION)).toBe('.ts');
  });

  it('files a dotfile under its own name rather than an empty extension', () =>
  {
    expect(groupHeadingOf({ path: '.gitignore' }, GROUP_VIEW_EXTENSION)).toBe('.gitignore');
  });

  it('groups by status, in words rather than git letters', () =>
  {
    expect(groupHeadingOf({ path: 'a.ts', status: 'modified' }, GROUP_VIEW_STATUS)).toBe('Modified');
    expect(groupHeadingOf({ path: 'a.ts', status: 'untracked' }, GROUP_VIEW_STATUS)).toBe(
      'Untracked'
    );
  });

  it('files an entry with no status of its own under "Changed"', () =>
  {
    // A tree listing was never compared to anything, so it carries no status, and the
    // changed-files pane can be showing one.
    expect(groupHeadingOf({ path: 'a.ts' }, GROUP_VIEW_STATUS)).toBe('Changed');
    expect(groupHeadingOf({ path: 'a.ts', status: 'nonsense' }, GROUP_VIEW_STATUS)).toBe('Changed');
  });
});
