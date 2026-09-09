/**
 * The shaping behind the fsck dialog's preview.
 *
 * Every case here is one git actually produces: `ls-tree -z` records, a commit header with
 * an empty body, a blob that is a PNG. The point of the module is that none of it needs a
 * window to check.
 */

import { describe, expect, it } from 'vitest';
import {
  buildHeaderArgs,
  buildTreeArgs,
  explainState,
  looksBinary,
  parseCommitHeader,
  parseTreeEntries
} from '@renderer/model/lostObject.js';
import type { LostObject } from '@shared/types.js';

describe('the read argv', () =>
{
  it('asks for the message and never the patch: DiffViewer draws that from the range', () =>
  {
    expect(buildHeaderArgs('abc')).toContain('--no-patch');
    expect(buildHeaderArgs('abc')).not.toContain('--patch');
  });

  it('reads a tree NUL-delimited, because a path may contain a newline', () =>
  {
    expect(buildTreeArgs('abc')).toEqual(['ls-tree', '-z', 'abc']);
  });
});

describe('parseCommitHeader', () =>
{
  const record = [
    'Jane Doe',
    'jane@example.com',
    '1786374973',
    'feat: the subject',
    '\nthe body\nover two lines\n',
    'aaa111 bbb222'
  ].join('\0');

  it('reads every field and strips the blank line git pads the body with', () =>
  {
    expect(parseCommitHeader(record)).toEqual({
      author: 'Jane Doe',
      email: 'jane@example.com',
      date: 1786374973,
      subject: 'feat: the subject',
      body: 'the body\nover two lines',
      parents: ['aaa111', 'bbb222']
    });
  });

  it('reports a root commit as having no parents rather than one empty one', () =>
  {
    const root = ['Jane', 'j@e.com', '1', 'first', '', ''].join('\0');
    expect(parseCommitHeader(root)?.parents).toEqual([]);
  });

  it('keeps a subject containing a newline whole', () =>
  {
    // `%s` is one line, but a body is not, and the field boundary is NUL, so the parse
    // must not be tempted to split on the newline inside it.
    const multiline = ['Jane', 'j@e.com', '1', 'subject', '\nline one\nline two', ''].join('\0');
    expect(parseCommitHeader(multiline)?.body).toBe('line one\nline two');
  });

  it('returns null rather than a half-built header when git printed something else', () =>
  {
    expect(parseCommitHeader('fatal: bad object')).toBeNull();
  });
});

describe('parseTreeEntries', () =>
{
  const output =
    '040000 tree ccc333\tsrc\0' +
    '100644 blob aaa111\tREADME.md\0' +
    '100755 blob bbb222\tbuild script.sh\0' +
    '160000 commit ddd444\tvendor/lib\0';

  it('splits on the tab, so a name with spaces survives', () =>
  {
    expect(parseTreeEntries(output).map((e) => e.name)).toContain('build script.sh');
  });

  it('puts directories first, then sorts by name as a reader would order it', () =>
  {
    // `localeCompare`, so `README.md` files with `build`, rather than ASCII's ordering
    // which puts every capital ahead of every lowercase.
    expect(parseTreeEntries(output).map((e) => e.name)).toEqual([
      'src',
      'build script.sh',
      'README.md',
      'vendor/lib'
    ]);
  });

  it('carries the mode, which is where the executable bit lives', () =>
  {
    const script = parseTreeEntries(output).find((e) => e.name === 'build script.sh');
    expect(script?.mode).toBe('100755');
  });

  it('keeps a name containing a newline whole', () =>
  {
    const entries = parseTreeEntries('100644 blob aaa111\tone\ntwo\0');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('one\ntwo');
  });

  it('is empty for an empty tree', () =>
  {
    expect(parseTreeEntries('')).toEqual([]);
  });
});

describe('looksBinary', () =>
{
  it('is true for a NUL byte, which is git’s own test', () =>
  {
    expect(looksBinary('PNG\0\x1a\n')).toBe(true);
  });

  it('is false for ordinary text', () =>
  {
    expect(looksBinary('const x = 1;\nexport { x };\n')).toBe(false);
  });

  it('is false for one stray replacement character', () =>
  {
    // An encoding this app cannot name is not a reason to refuse to show the file.
    expect(looksBinary(`a latin-1 na${'�'}ve, and ${'x'.repeat(200)}`)).toBe(false);
  });

  it('is true when replacement characters dominate', () =>
  {
    expect(looksBinary('�'.repeat(50) + 'abc')).toBe(true);
  });

  it('is false for empty', () =>
  {
    expect(looksBinary('')).toBe(false);
  });
});

describe('explainState', () =>
{
  const object = (over: Partial<LostObject>): LostObject => ({
    state: 'unreachable',
    kind: 'commit',
    sha: 'a'.repeat(40),
    ...over
  });

  it('never mentions the reflog, which --no-reflogs makes a lie', () =>
  {
    for (const state of ['dangling', 'unreachable', 'missing'] as const)
    {
      expect(explainState(object({ state }))).not.toMatch(/reflog/i);
    }
  });

  it('names the object in words rather than in git’s vocabulary', () =>
  {
    expect(explainState(object({ kind: 'blob' }))).toContain('file');
    expect(explainState(object({ kind: 'tree' }))).toContain('directory');
  });

  it('says a missing object cannot be recovered, unlike the other two', () =>
  {
    expect(explainState(object({ state: 'missing' }))).toContain('nothing here to recover');
    expect(explainState(object({ state: 'dangling' }))).toContain('until `git gc` removes it');
  });
});
