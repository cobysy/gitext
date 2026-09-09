/**
 * The `git grep` argv table, and the parser that reads what it prints back.
 *
 * Both halves are here rather than split across `tests/shared` and `tests/main` because
 * they are one contract: `-z` is in the argv precisely so that the parser can find the
 * field boundaries, and a change to either that forgets the other produces hits with the
 * line number glued to the text, which is exactly the kind of failure that still *looks*
 * like a working search.
 */

import { describe, expect, it } from 'vitest';
import { GREP_MODES, buildGrepArgs, grepPathPrefix, type GrepOptions } from '@shared/grep.js';
import { parseGrep } from '@main/git/parse.js';

const base: GrepOptions = {
  pattern: 'needle',
  mode: 'fixed',
  ignoreCase: false,
  wholeWord: false,
  endpoint: { kind: 'workingTree' }
};

const argv = (overrides: Partial<GrepOptions> = {}): string[] =>
  buildGrepArgs({ ...base, ...overrides });

describe('buildGrepArgs', () =>
{
  it('searches the working tree with no revision argument at all', () =>
  {
    expect(argv()).toEqual(['grep', '--line-number', '-z', '-I', '-F', '-e', 'needle']);
  });

  it('asks the index for --cached and a commit by name', () =>
  {
    expect(argv({ endpoint: { kind: 'index' } })).toContain('--cached');
    expect(argv({ endpoint: { kind: 'commit', sha: 'abc123' } })).toContain('abc123');
    // Never both: an endpoint is one of the three, and a revision with --cached is a
    // command git rejects.
    expect(argv({ endpoint: { kind: 'commit', sha: 'abc123' } })).not.toContain('--cached');
  });

  it('passes the pattern after -e, so one beginning with a dash is not read as options', () =>
  {
    const args = argv({ pattern: '--force' });
    expect(args[args.indexOf('-e') + 1]).toBe('--force');
  });

  it('carries -i and -w only when they are asked for', () =>
  {
    expect(argv()).not.toContain('-i');
    expect(argv()).not.toContain('-w');
    expect(argv({ ignoreCase: true })).toContain('-i');
    expect(argv({ wholeWord: true })).toContain('-w');
  });

  it("names the grammar explicitly for every mode, including git's own default", () =>
  {
    for (const entry of GREP_MODES)
    {
      expect(argv({ mode: entry.mode })).toContain(entry.flag);
    }
  });

  it('puts pathspecs after --, and drops the blank lines the box collects', () =>
  {
    expect(argv({ paths: ['renderer', '  ', ' main/git '] }).slice(-3)).toEqual([
      '--',
      'renderer',
      'main/git'
    ]);
    expect(argv({ paths: ['', '   '] })).not.toContain('--');
  });
});

describe('grepPathPrefix', () =>
{
  it('is what git echoes in front of a path, and nothing for the two that echo none', () =>
  {
    expect(grepPathPrefix({ kind: 'commit', sha: 'abc123' })).toBe('abc123:');
    expect(grepPathPrefix({ kind: 'workingTree' })).toBe('');
    expect(grepPathPrefix({ kind: 'index' })).toBe('');
  });
});

describe('parseGrep', () =>
{
  const limit = 100;

  /** One hit as git prints it: two NUL-terminated fields, then the matched line. */
  const record = (path: string, line: number | string, text: string): string =>
    `${path}\u0000${line}\u0000${text}\n`;

  it('reads path, line and text out of one record', () =>
  {
    const { hits, truncated } = parseGrep(record('a.txt', 5, '  const needle = 1;'), { limit });
    expect(hits).toEqual([{ path: 'a.txt', line: 5, text: '  const needle = 1;' }]);
    expect(truncated).toBe(false);
  });

  it('never re-splits the matched line, whatever it happens to contain', () =>
  {
    const { hits } = parseGrep(record('a.txt', 1, 'key: value\ttail'), { limit });
    expect(hits[0]?.text).toBe('key: value\ttail');
  });

  it('survives a newline inside a path, which is why -z is asked for', () =>
  {
    const { hits } = parseGrep(record('od\nd.txt', 2, 'needle'), { limit });
    expect(hits).toEqual([{ path: 'od\nd.txt', line: 2, text: 'needle' }]);
  });

  it('reads several records in a row, in the order git gave them', () =>
  {
    const { hits } = parseGrep(
      record('a.txt', 1, 'one') + record('b/c.txt', 12, 'two') + record('a.txt', 3, 'three'),
      { limit }
    );
    expect(hits.map((hit) => `${hit.path}:${hit.line}`)).toEqual([
      'a.txt:1',
      'b/c.txt:12',
      'a.txt:3'
    ]);
  });

  it('strips the revision prefix git echoes when the search named one', () =>
  {
    const { hits } = parseGrep(record('HEAD:a.txt', 3, 'needle'), {
      pathPrefix: 'HEAD:',
      limit
    });
    expect(hits[0]?.path).toBe('a.txt');
  });

  it('leaves a path alone when it merely resembles the prefix', () =>
  {
    const { hits } = parseGrep(record('HEADers/a.txt', 3, 'needle'), {
      pathPrefix: 'HEAD:',
      limit
    });
    expect(hits[0]?.path).toBe('HEADers/a.txt');
  });

  it('reads a final record that arrived without its trailing newline', () =>
  {
    const { hits } = parseGrep('a.txt\u00001\u0000needle', { limit });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.text).toBe('needle');
  });

  it('skips a record whose line number is not one, rather than losing the rest', () =>
  {
    const { hits } = parseGrep(record('a.txt', 'x', 'junk') + record('b.txt', 2, 'needle'), {
      limit
    });
    expect(hits).toEqual([{ path: 'b.txt', line: 2, text: 'needle' }]);
  });

  it('stops at the limit and says so', () =>
  {
    const out = Array.from({ length: 5 }, (_, i) => record('a.txt', i + 1, 'needle')).join('');
    const { hits, truncated } = parseGrep(out, { limit: 3 });
    expect(hits).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it('is empty for empty output, which is what no matches looks like', () =>
  {
    expect(parseGrep('', { limit }).hits).toEqual([]);
  });
});
