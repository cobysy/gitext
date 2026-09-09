/**
 * The argv behind the file tree.
 *
 * Three endpoints and two of them share a command, which is exactly the shape of mistake
 * that reads as plausible in review and shows up as an empty pane: `ls-tree` against an
 * artificial SHA fails, `ls-files` against a commit silently ignores it and lists the
 * index instead. Both would look like "the tree is broken" rather than like the wrong
 * command, so the table is pinned here.
 */

import { describe, expect, it } from 'vitest';
import { isSubmoduleMode, isSymlinkMode } from '@shared/mode.js';
import { buildTreeArgs } from '@shared/tree.js';

describe('buildTreeArgs', () =>
{
  it('walks a commit recursively', () =>
  {
    expect(buildTreeArgs({ kind: 'commit', sha: 'abc123' })).toEqual([
      'ls-tree',
      '-r',
      '-z',
      'abc123'
    ]);
  });

  it('reads the index for the index endpoint', () =>
  {
    expect(buildTreeArgs({ kind: 'index' })).toEqual(['ls-files', '--stage', '-z']);
  });

  // The working tree has no tree object either; what it adds on top of the index: the
  // untracked files, and what it removes, the ones deleted on disk, are two more reads
  // in `listTreeFiles`, not flags here.
  it('reads the index for the working tree too', () =>
  {
    expect(buildTreeArgs({ kind: 'workingTree' })).toEqual(['ls-files', '--stage', '-z']);
  });

  it('never asks for folder entries, which the renderer derives from the paths', () =>
  {
    expect(buildTreeArgs({ kind: 'commit', sha: 'abc123' })).not.toContain('-t');
  });
});

describe('file modes', () =>
{
  it('recognizes a gitlink', () =>
  {
    expect(isSubmoduleMode('160000')).toBe(true);
    expect(isSubmoduleMode('100644')).toBe(false);
  });

  it('recognizes a symlink', () =>
  {
    expect(isSymlinkMode('120000')).toBe(true);
    expect(isSymlinkMode('100755')).toBe(false);
  });
});
