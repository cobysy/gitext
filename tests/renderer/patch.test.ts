/**
 * Reading a unified diff.
 *
 * The awkward cases are all here rather than on screen: a file with no trailing
 * newline, a rename with no content change, a binary file, a hunk whose header omits
 * its line count, and the pairing that decides which deleted line sits opposite which
 * added one, which is also what the intra-line highlight is computed from.
 */

import { describe, expect, it } from 'vitest';
import {
  alignPatch,
  BINARY_NOTE,
  countChangedLines,
  inlineChange,
  parsePatch,
  toSideBySide,
  type AlignedRow,
  type PatchHunk
} from '@renderer/model/patch.js';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 83db48f..bf269f4 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,4 @@
 const first = 1;
-const second = 2;
+const second = 22;
 const third = 3;
 const fourth = 4;
`;

describe('parsePatch', () =>
{
  it('reads paths, hunk ranges and line numbers', () =>
  {
    const [file] = parsePatch(PATCH);
    expect(file?.oldPath).toBe('src/a.ts');
    expect(file?.newPath).toBe('src/a.ts');
    expect(file?.hunks).toHaveLength(1);

    const hunk = file!.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(4);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(4);

    // Numbering runs down each side independently: a deleted line has no new number
    // and an added one has no old number, which is what the two gutters draw.
    expect(hunk.lines.map((line) => [line.kind, line.oldNumber, line.newNumber])).toEqual([
      ['context', 1, 1],
      ['delete', 2, null],
      ['add', null, 2],
      ['context', 3, 3],
      ['context', 4, 4]
    ]);
  });

  it('strips git\'s a/ and b/ prefixes but leaves /dev/null as nothing', () =>
  {
    const [file] = parsePatch(
      'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hi\n'
    );
    expect(file?.oldPath).toBe('');
    expect(file?.newPath).toBe('new.txt');
    expect(file?.header).toContain('new file mode 100644');
  });

  it('treats a missing count as one line', () =>
  {
    const [file] = parsePatch('@@ -3 +3 @@\n-a\n+b\n');
    expect(file?.hunks[0]?.oldCount).toBe(1);
    expect(file?.hunks[0]?.newCount).toBe(1);
  });

  it('reads a combined merge hunk header, taking the new side from the end', () =>
  {
    const [file] = parsePatch('@@@ -1,2 -1,3 +1,4 @@@\n  context\n');
    expect(file?.hunks[0]?.oldStart).toBe(1);
    expect(file?.hunks[0]?.newCount).toBe(4);
  });

  it('attaches "no newline at end of file" to the line above it', () =>
  {
    const [file] = parsePatch('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n');
    const lines = file!.hunks[0]!.lines;
    expect(lines[0]?.noNewline).toBe(true);
    expect(lines[1]?.noNewline).toBeUndefined();
  });

  it('records a binary file rather than pretending it has no changes', () =>
  {
    const [file] = parsePatch(
      'diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n'
    );
    expect(file?.isBinary).toBe(true);
    expect(file?.hunks).toHaveLength(0);
  });

  it('reads a gitlink as a submodule, from the mode or from the line itself', () =>
  {
    const [byMode] = parsePatch(
      'diff --git a/vendor/lib b/vendor/lib\nnew file mode 160000\nindex 0000000..1111111\n' +
        '--- /dev/null\n+++ b/vendor/lib\n@@ -0,0 +1 @@\n+Subproject commit 1111111222222233333334444444555555566666\n'
    );
    expect(byMode?.isSubmodule).toBe(true);

    // An older git prints no mode for a plain bump; the content is the only signal.
    const [byLine] = parsePatch(
      'diff --git a/vendor/lib b/vendor/lib\n--- a/vendor/lib\n+++ b/vendor/lib\n@@ -1 +1 @@\n' +
        '-Subproject commit aaaaaaa\n+Subproject commit bbbbbbb\n'
    );
    expect(byLine?.isSubmodule).toBe(true);
  });

  it('keeps the header of a rename that changed nothing', () =>
  {
    // No hunks at all is not an empty diff here: it is the whole of what happened.
    const [file] = parsePatch(
      'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n'
    );
    expect(file?.hunks).toHaveLength(0);
    expect(file?.header).toContain('rename from old.ts');
  });

  it('splits a patch spanning several files', () =>
  {
    const [first, second] = parsePatch(
      `${PATCH}diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n`
    );
    expect(first?.newPath).toBe('src/a.ts');
    expect(second?.newPath).toBe('b.ts');
    expect(second?.hunks[0]?.lines).toHaveLength(2);
  });

  it('is empty for empty input', () =>
  {
    expect(parsePatch('')).toEqual([]);
  });
});

describe('countChangedLines', () =>
{
  it('counts the two sides separately', () =>
  {
    expect(countChangedLines(parsePatch(PATCH)[0]!)).toEqual({ added: 1, deleted: 1 });
  });
});

describe('toSideBySide', () =>
{
  const hunkOf = (patch: string): PatchHunk => parsePatch(patch)[0]!.hunks[0]!;

  it('puts a context line on both sides', () =>
  {
    const rows = toSideBySide(hunkOf('@@ -1 +1 @@\n same\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.left).toBe(rows[0]?.right);
  });

  it('pairs the nth deletion with the nth addition', () =>
  {
    const rows = toSideBySide(hunkOf('@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+B\n'));
    expect(rows.map((row) => [row.left?.text, row.right?.text])).toEqual([
      ['a', 'A'],
      ['b', 'B']
    ]);
  });

  it('leaves the shorter side blank', () =>
  {
    const rows = toSideBySide(hunkOf('@@ -1,2 +1 @@\n-a\n-b\n+A\n'));
    expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ['a', 'A'],
      ['b', null]
    ]);
  });

  it('does not pair across a context line', () =>
  {
    // A deletion, a line that did not change, then an addition is two separate edits:
    // pairing them would draw the addition as a replacement of the deletion.
    const rows = toSideBySide(hunkOf('@@ -1,3 +1,3 @@\n-a\n keep\n+B\n'));
    expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ['a', null],
      ['keep', 'keep'],
      [null, 'B']
    ]);
  });
});

/**
 * The aligned view model: what the two-pane viewer draws and what "next difference"
 * counts.
 *
 * The cases worth pinning down are the ones the two modes disagree about: a replaced
 * line is one row in the side-by-side view and two in the inline one, and both have to
 * report it as *one* difference or the navigation counts edits twice.
 */
describe('alignPatch', () =>
{
  // Two hunks, so the lines git left out between them have to be accounted for.
  const TWO_HUNKS = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -10,3 +10,4 @@
 ten
 eleven
+eleven and a half
 twelve
`;

  const kinds = (rows: AlignedRow[]): string[] => rows.map((row) => row.kind);

  it('pairs a replacement into one row and calls it one difference', () =>
  {
    const { rows, blocks } = alignPatch(parsePatch(TWO_HUNKS), 'sideBySide');
    const replaced = rows[1]!;

    expect(replaced.kind).toBe('line');
    expect(replaced).toMatchObject({ change: 'modify', block: 0 });
    expect(blocks[0]).toEqual({ kind: 'modify', start: 1, end: 1 });
  });

  it('keeps git’s order inline, and still calls it one difference', () =>
  {
    const { rows, blocks } = alignPatch(parsePatch(TWO_HUNKS), 'inline');

    // The deletion and the addition are separate rows, one under the other…
    expect(rows[1]).toMatchObject({ change: 'modify', block: 0, right: null });
    expect(rows[2]).toMatchObject({ change: 'modify', block: 0, left: null });
    // …and one block covering both.
    expect(blocks[0]).toEqual({ kind: 'modify', start: 1, end: 2 });
    expect(blocks).toHaveLength(2);
  });

  it('counts the lines between two hunks rather than printing a header', () =>
  {
    const { rows } = alignPatch(parsePatch(TWO_HUNKS), 'sideBySide');
    expect(kinds(rows)).toEqual(['line', 'line', 'line', 'gap', 'line', 'line', 'line', 'line']);
    expect(rows[3]).toEqual({ kind: 'gap', skipped: 6, oldStart: 4, newStart: 4 });
  });

  it('opens with no gap when the first hunk starts at the first line', () =>
  {
    const { rows } = alignPatch(parsePatch(TWO_HUNKS), 'sideBySide');
    expect(rows[0]!.kind).toBe('line');
  });

  it('leaves a lone addition with nothing opposite it', () =>
  {
    const { rows, blocks } = alignPatch(parsePatch(TWO_HUNKS), 'sideBySide');
    expect(rows[6]).toMatchObject({ change: 'add', left: null });
    expect(blocks[1]).toMatchObject({ kind: 'add' });
  });

  it('calls a run of deletions with nothing replacing them a deletion', () =>
  {
    const patch = 'diff --git a/f b/f\n@@ -1,3 +1,1 @@\n keep\n-gone\n-also gone\n';
    const { blocks } = alignPatch(parsePatch(patch), 'sideBySide');
    expect(blocks).toEqual([{ kind: 'delete', start: 1, end: 2 }]);
  });

  it('splits two edits separated by an unchanged line into two differences', () =>
  {
    const patch = 'diff --git a/f b/f\n@@ -1,3 +1,3 @@\n-a\n+A\n keep\n-b\n+B\n';
    const { blocks } = alignPatch(parsePatch(patch), 'sideBySide');
    expect(blocks.map((block) => block.kind)).toEqual(['modify', 'modify']);
  });

  it('says so for a binary file, and reports no differences to navigate', () =>
  {
    const patch = 'diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n';
    const { rows, blocks } = alignPatch(parsePatch(patch), 'sideBySide');
    expect(rows).toEqual([{ kind: 'note', text: BINARY_NOTE }]);
    expect(blocks).toEqual([]);
  });

  it('says where a submodule moved, rather than drawing two lines of hex', () =>
  {
    const patch =
      'diff --git a/vendor/lib b/vendor/lib\nindex aaaaaaaabbbb..ccccccccdddd 160000\n' +
      '--- a/vendor/lib\n+++ b/vendor/lib\n@@ -1 +1 @@\n' +
      '-Subproject commit aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee\n' +
      '+Subproject commit ccccccccddddddddeeeeeeeeffffffff00000000\n';
    const { rows, blocks } = alignPatch(parsePatch(patch), 'sideBySide');

    expect(rows).toEqual([
      { kind: 'note', text: 'Submodule moved from aaaaaaaa to cccccccc.' }
    ]);
    // Nothing to step through: the one difference is what the note just said.
    expect(blocks).toEqual([]);
  });

  it('says a submodule was added when there is no older commit to name', () =>
  {
    const patch =
      'diff --git a/vendor/lib b/vendor/lib\nnew file mode 160000\n' +
      '--- /dev/null\n+++ b/vendor/lib\n@@ -0,0 +1 @@\n' +
      '+Subproject commit ccccccccddddddddeeeeeeeeffffffff00000000\n';
    const { rows } = alignPatch(parsePatch(patch), 'inline');
    expect(rows).toEqual([{ kind: 'note', text: 'Submodule added, at cccccccc.' }]);
  });

  it('keeps what git said about a rename that changed nothing', () =>
  {
    const patch =
      'diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n';
    const { rows } = alignPatch(parsePatch(patch), 'sideBySide');
    expect(rows[0]).toMatchObject({ kind: 'note' });
    expect((rows[0] as { text: string }).text).toContain('rename from old');
  });

  it('names each file only when the patch holds more than one', () =>
  {
    const one = alignPatch(parsePatch(PATCH), 'sideBySide');
    expect(kinds(one.rows)).not.toContain('file');

    const two = alignPatch(parsePatch(PATCH + PATCH.replace(/a\.ts/g, 'b.ts')), 'sideBySide');
    expect(two.rows.filter((row) => row.kind === 'file')).toHaveLength(2);
  });

  it('has nothing to align in an empty patch', () =>
  {
    expect(alignPatch(parsePatch(''), 'sideBySide')).toEqual({ rows: [], blocks: [] });
  });
});

describe('inlineChange', () =>
{
  it('marks the word that changed, not the character', () =>
  {
    const change = inlineChange('const foo_bar = 1;', 'const foo_baz = 1;');
    expect(change).not.toBeNull();
    expect('const foo_bar = 1;'.slice(change!.oldStart, change!.oldEnd)).toBe('foo_bar');
    expect('const foo_baz = 1;'.slice(change!.newStart, change!.newEnd)).toBe('foo_baz');
  });

  it('marks an insertion as an empty range on the old side', () =>
  {
    const change = inlineChange('a c', 'a b c');
    expect(change).not.toBeNull();
    expect('a c'.slice(change!.oldStart, change!.oldEnd)).toBe('');
    expect('a b c'.slice(change!.newStart, change!.newEnd)).toBe('b ');
  });

  it('says nothing about identical lines', () =>
  {
    expect(inlineChange('same', 'same')).toBeNull();
  });

  it('says nothing about a line that was rewritten rather than edited', () =>
  {
    // "alpha" and "beta" happen to share a trailing "a", which is not agreement: it is
    // a coincidence, and marking four of five characters reads as noise.
    expect(inlineChange('alpha', 'beta')).toBeNull();
    expect(inlineChange('return early;', 'throw new Error();')).toBeNull();
  });

  it('never produces an inverted range', () =>
  {
    // Both ends growing into the same word can otherwise push the suffix past what the
    // prefix left, which would slice backwards.
    for (const [a, b] of [
      ['ab', 'b'],
      ['a', 'ab'],
      ['aa', 'a'],
      ['x', ''],
      ['', 'x']
    ])
    {
      const change = inlineChange(a!, b!);
      if (!change)
      {
        continue;
      }
      expect(change.oldEnd).toBeGreaterThanOrEqual(change.oldStart);
      expect(change.newEnd).toBeGreaterThanOrEqual(change.newStart);
    }
  });
});
