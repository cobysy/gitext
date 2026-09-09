/**
 * `git archive` argv.
 *
 * Worth a table and a test because the destination path and the pathspec both go in the
 * argv, and a quoting mistake is invisible until someone archives a directory with a
 * space in its name.
 * Here they are array elements and cannot run together at all.
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_FORMATS,
  buildArchiveArgs,
  suggestedArchiveName
} from '@renderer/model/args/archive.js';

describe('buildArchiveArgs', () =>
{
  it('names the format, the revision and the destination', () =>
  {
    expect(buildArchiveArgs({ revision: 'abc123', output: '/tmp/out.zip' })).toEqual([
      'archive',
      '--format=zip',
      'abc123',
      '--output',
      '/tmp/out.zip'
    ]);
  });

  it('every format in the table is a --format the builder emits', () =>
  {
    for (const entry of ARCHIVE_FORMATS)
    {
      expect(
        buildArchiveArgs({ revision: 'HEAD', output: `/tmp/a.${entry.extension}`, format: entry.format })
      ).toContain(`--format=${entry.format}`);
    }
  });

  it('the prefix gets the trailing slash git needs to make it a directory', () =>
  {
    expect(
      buildArchiveArgs({ revision: 'HEAD', output: '/tmp/a.zip', prefix: 'my-app' })
    ).toContain('--prefix=my-app/');
  });

  it('does not double the slash when one was typed', () =>
  {
    expect(
      buildArchiveArgs({ revision: 'HEAD', output: '/tmp/a.zip', prefix: 'my-app/' })
    ).toContain('--prefix=my-app/');
  });

  it('has no --prefix at all when the box is empty', () =>
  {
    const argv = buildArchiveArgs({ revision: 'HEAD', output: '/tmp/a.zip', prefix: '  ' });
    expect(argv.join(' ')).not.toContain('--prefix');
  });

  it('puts the paths behind a --', () =>
  {
    expect(
      buildArchiveArgs({ revision: 'HEAD', output: '/tmp/a.zip', paths: ['src', 'docs'] })
    ).toEqual([
      'archive',
      '--format=zip',
      'HEAD',
      '--output',
      '/tmp/a.zip',
      '--',
      'src',
      'docs'
    ]);
  });

  it('drops the blank lines a textarea leaves behind', () =>
  {
    const argv = buildArchiveArgs({
      revision: 'HEAD',
      output: '/tmp/a.zip',
      paths: ['', ' src ', '   ']
    });
    expect(argv.slice(argv.indexOf('--'))).toEqual(['--', 'src']);
  });

  it('is empty without a destination: the file is chosen before anything runs', () =>
  {
    expect(buildArchiveArgs({ revision: 'HEAD', output: '' })).toEqual([]);
    expect(buildArchiveArgs({ revision: '', output: '/tmp/a.zip' })).toEqual([]);
  });

  it('keeps a path with a space as one argument', () =>
  {
    const argv = buildArchiveArgs({
      revision: 'HEAD',
      output: '/tmp/my archives/a.zip',
      paths: ['src/some dir']
    });
    expect(argv).toContain('/tmp/my archives/a.zip');
    expect(argv).toContain('src/some dir');
  });
});

describe('suggestedArchiveName', () =>
{
  it('names the repository and the revision', () =>
  {
    expect(suggestedArchiveName('gitext', 'abc123def456789', 'zip')).toBe(
      'gitext_abc123def456.zip'
    );
  });

  it('takes the extension from the format', () =>
  {
    expect(suggestedArchiveName('gitext', 'abc123', 'tar.gz')).toBe('gitext_abc123.tar.gz');
  });

  it('adds a single named path, and never several', () =>
  {
    expect(suggestedArchiveName('gitext', 'abc123', 'zip', ['src/app.ts'])).toBe(
      'gitext_abc123_src_app_ts.zip'
    );
    expect(suggestedArchiveName('gitext', 'abc123', 'zip', ['src', 'docs'])).toBe(
      'gitext_abc123.zip'
    );
  });
});
