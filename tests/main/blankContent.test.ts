/**
 * Taking file contents out of git output while leaving its shape in.
 *
 * The promise is that a log carried off a work machine holds no source code, which is
 * only worth making if every way a line of a file can appear is checked: as a patch line,
 * as a line that looks like a patch header, in blame, in grep, as a whole blob.
 */

import { describe, expect, it } from 'vitest';
import { blankOutput, blankPatch, blankStdin } from '@main/diagnostics/blankContent.js';

const PATCH = [
  'diff --git a/db/schema.sql b/db/schema.sql',
  'index 1111111..2222222 100644',
  '--- a/db/schema.sql',
  '+++ b/db/schema.sql',
  '@@ -1,4 +1,4 @@',
  ' CREATE TABLE secret_customers (',
  '--- the old comment',
  '+++ the new comment',
  '   id INTEGER',
  ' );',
  '\\ No newline at end of file'
].join('\n');

describe('a patch', () =>
{
  it('keeps the headers and hunk ranges, and counts each run of lines', () =>
  {
    expect(blankPatch(PATCH)).toBe([
      'diff --git a/db/schema.sql b/db/schema.sql',
      'index 1111111..2222222 100644',
      '--- a/db/schema.sql',
      '+++ b/db/schema.sql',
      '@@ -1,4 +1,4 @@',
      ' ×1',
      '-×1',
      '+×1',
      ' ×2',
      '\\ No newline at end of file'
    ].join('\n'));
  });

  /** A removed `-- comment` reads `--- comment`: a file header by look, code by position. */
  it('blanks a line of code that looks like a file header', () =>
  {
    const blanked = blankPatch(PATCH);
    expect(blanked).not.toContain('the old comment');
    expect(blanked).not.toContain('the new comment');
    expect(blanked).not.toContain('secret_customers');
  });

  it('keeps a line ending, which is shape rather than content', () =>
  {
    expect(blankPatch('@@ -1 +1 @@\n-old\r\n+new\r')).toBe('@@ -1 +1 @@\n-×1 CRLF\n+×1 CRLF');
  });

  it('blanks a combined diff by the same rule', () =>
  {
    expect(blankPatch('@@@ -1,2 -1,2 +1,2 @@@\n- left\n +right\n  both')).toBe(
      '@@@ -1,2 -1,2 +1,2 @@@\n-×1\n ×2'
    );
  });

  it('leaves a commit header in `log -p` alone, once the hunk before it has ended', () =>
  {
    const log = '@@ -1 +1 @@\n-a\n+b\ncommit 3333333\nAuthor: Someone\n\n    Fix the thing';
    expect(blankPatch(log)).toBe(
      '@@ -1 +1 @@\n-×1\n+×1\ncommit 3333333\nAuthor: Someone\n\n    Fix the thing'
    );
  });
});

describe('by command', () =>
{
  it('blanks `diff`, and a patch piped to `apply`', () =>
  {
    expect(blankOutput(['diff', '--cached'], PATCH)).toBe(blankPatch(PATCH));
    expect(blankStdin(['apply', '--cached'], PATCH)).toBe(blankPatch(PATCH));
  });

  it('keeps a commit message piped to `commit`, which is not a file', () =>
  {
    expect(blankStdin(['commit', '-F', '-'], 'Fix the thing')).toBe('Fix the thing');
  });

  it('reduces a blob read by `show <rev>:<path>` to its size', () =>
  {
    expect(blankOutput(['show', 'HEAD:src/app.ts'], 'line one\nline two')).toBe(
      '<file contents: 2 lines, 17 chars>'
    );
  });

  it('keeps blame headers and counts the lines of the file', () =>
  {
    const blame = '4444444 1 1 2\nauthor Someone\nfilename a.ts\n\tconst key = 1;\n4444444 2 2\n\tconst other = 2;';
    expect(blankOutput(['blame', '--porcelain', 'a.ts'], blame)).toBe(
      '4444444 1 1 2\nauthor Someone\nfilename a.ts\n\t×1\n4444444 2 2\n\t×1'
    );
  });

  it('keeps a grep hit\'s path and line, not its text', () =>
  {
    expect(blankOutput(['grep', '--line-number', '-z', 'key'], 'a.ts\x0012\x00const key = 1;')).toBe(
      'a.ts\x0012\x00<14 chars>'
    );
  });

  it('leaves output that holds no file contents as it was', () =>
  {
    const status = '1 .M N... 100644 100644 100644 abc abc src/app.ts';
    expect(blankOutput(['status', '--porcelain=v2'], status)).toBe(status);
    expect(blankOutput(['log', '--format=%H%x00%s'], '+ a subject that starts with a plus')).toBe(
      '+ a subject that starts with a plus'
    );
  });
});
