import { describe, expect, it } from 'vitest';
import { parsePatch } from '@renderer/model/patch.js';
import {
  buildHunkPatch,
  changedLineIndexes,
  hasPickableChange
} from '@renderer/model/stagePatch.js';

/** A two-hunk diff of one file, as `git diff` prints it. */
const TWO_HUNKS = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,4 +1,4 @@
-one
+ONE
 two
 three
 four
@@ -7,4 +7,4 @@
 seven
 eight
 nine
-ten
+TEN
`;

function fileOf(text: string)
{
  const file = parsePatch(text)[0];
  if (!file)
  {
    throw new Error('no file in patch');
  }
  return file;
}

describe('buildHunkPatch: a whole hunk', () =>
{
  it('takes one hunk and leaves the other behind', () =>
  {
    const file = fileOf(TWO_HUNKS);
    const patch = buildHunkPatch(file, file.hunks[0]!);
    expect(patch).toBe(
      `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,4 +1,4 @@
-one
+ONE
 two
 three
 four
`
    );
  });

  it('keeps the second hunk anchored at its own line, not at the first one', () =>
  {
    const file = fileOf(TWO_HUNKS);
    const patch = buildHunkPatch(file, file.hunks[1]!);
    expect(patch).toContain('@@ -7,4 +7,4 @@');
    expect(patch).toContain('-ten');
    expect(patch).not.toContain('one');
  });

  it('carries the file header through, so a mode or a rename is not lost', () =>
  {
    const file = fileOf(TWO_HUNKS);
    const patch = buildHunkPatch(file, file.hunks[0]!)!;
    expect(patch.startsWith('diff --git a/a.txt b/a.txt\nindex 1111111..2222222 100644\n')).toBe(
      true
    );
  });

  it('ends with a newline, because git apply rejects a patch that does not', () =>
  {
    const file = fileOf(TWO_HUNKS);
    expect(buildHunkPatch(file, file.hunks[0]!)!.endsWith('\n')).toBe(true);
  });
});

describe('buildHunkPatch: staging some of a hunk', () =>
{
  // One hunk that both adds and deletes, so the two unpicked cases are both reachable.
  const MIXED = `diff --git a/m.txt b/m.txt
--- a/m.txt
+++ b/m.txt
@@ -1,4 +1,4 @@
 keep
-drop-me
+add-me
 tail
`;

  it('drops an addition the user did not pick, and keeps an unpicked deletion as context', () =>
  {
    // The index has `drop-me` and does not have `add-me`. Staging only the deletion
    // must describe a file that still lacks `add-me`.
    const file = fileOf(MIXED);
    const hunk = file.hunks[0]!;
    const deletion = hunk.lines.findIndex((line) => line.kind === 'delete');
    const patch = buildHunkPatch(file, hunk, { selected: new Set([deletion]) })!;

    expect(patch).toContain('-drop-me');
    expect(patch).not.toContain('add-me');
    // 3 old lines (keep, drop-me, tail), 2 new (keep, tail).
    expect(patch).toContain('@@ -1,3 +1,2 @@');
  });

  it('keeps an unpicked deletion as a context line rather than dropping it', () =>
  {
    const file = fileOf(MIXED);
    const hunk = file.hunks[0]!;
    const addition = hunk.lines.findIndex((line) => line.kind === 'add');
    const patch = buildHunkPatch(file, hunk, { selected: new Set([addition]) })!;

    expect(patch).toContain(' drop-me');
    expect(patch).toContain('+add-me');
    // 3 old lines (keep, drop-me, tail), 4 new (keep, drop-me, add-me, tail).
    expect(patch).toContain('@@ -1,3 +1,4 @@');
  });

  it('answers null when the selection picks no change at all', () =>
  {
    const file = fileOf(MIXED);
    const hunk = file.hunks[0]!;
    const context = hunk.lines.findIndex((line) => line.kind === 'context');
    expect(buildHunkPatch(file, hunk, { selected: new Set([context]) })).toBeNull();
    expect(buildHunkPatch(file, hunk, { selected: new Set() })).toBeNull();
  });
});

describe('buildHunkPatch: unstaging', () =>
{
  // The pivot is HEAD against the index, and the patch is reverse-applied, so it is the
  // NEW side that has to match the index. The unpicked lines therefore swap fates.
  const MIXED = `diff --git a/m.txt b/m.txt
--- a/m.txt
+++ b/m.txt
@@ -1,4 +1,4 @@
 keep
-drop-me
+add-me
 tail
`;

  it('carries an unpicked addition as context, the opposite of staging', () =>
  {
    const file = fileOf(MIXED);
    const hunk = file.hunks[0]!;
    const deletion = hunk.lines.findIndex((line) => line.kind === 'delete');
    const patch = buildHunkPatch(file, hunk, {
      selected: new Set([deletion]),
      direction: 'unstage'
    })!;

    // The index holds `add-me`: it is staged. Reverse-applying must not claim otherwise.
    expect(patch).toContain(' add-me');
    expect(patch).toContain('-drop-me');
  });

  it('drops an unpicked deletion, the opposite of staging', () =>
  {
    const file = fileOf(MIXED);
    const hunk = file.hunks[0]!;
    const addition = hunk.lines.findIndex((line) => line.kind === 'add');
    const patch = buildHunkPatch(file, hunk, {
      selected: new Set([addition]),
      direction: 'unstage'
    })!;

    // `drop-me` is not in the index: the staged change removed it.
    expect(patch).not.toContain('drop-me');
    expect(patch).toContain('+add-me');
  });

  it('anchors on the new side, because the reverse patch is located by it', () =>
  {
    // The two sides sit at different lines because hunks above this one changed the
    // file's length. Which of the two the rebuilt hunk keeps is the whole question.
    const shifted = `--- a/s.txt
+++ b/s.txt
@@ -3,2 +9,2 @@
 a
-b
+B
`;
    const file = fileOf(shifted);
    const staged = buildHunkPatch(file, file.hunks[0]!, { direction: 'stage' })!;
    const unstaged = buildHunkPatch(file, file.hunks[0]!, { direction: 'unstage' })!;
    expect(staged).toContain('@@ -3,2 +3,2 @@');
    expect(unstaged).toContain('@@ -9,2 +9,2 @@');
  });
});

describe('buildHunkPatch: edge cases', () =>
{
  it('keeps the no-newline marker with the line it describes', () =>
  {
    const patch = `--- a/n.txt
+++ b/n.txt
@@ -1,1 +1,1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
    const file = fileOf(patch);
    const built = buildHunkPatch(file, file.hunks[0]!)!;
    expect(built).toContain('-old\n\\ No newline at end of file\n');
    expect(built).toContain('+new\n\\ No newline at end of file\n');
  });

  /**
   * The marker says "the line above ends its side here, without a newline", so a line it
   * follows must be the last one on that side. A selection can leave an unpicked change
   * as context in the middle of the body still carrying it, and `git apply` accepts the
   * result and runs the following line onto the end of it.
   */
  describe('the no-newline marker under a partial selection', () =>
  {
    const LAST_LINE_EDITED = `--- a/n.txt
+++ b/n.txt
@@ -1,3 +1,3 @@
 a
 b
-old last
\\ No newline at end of file
+new last
\\ No newline at end of file
`;

    /** Indexes of the deletion and the addition in the hunk above. */
    const DELETE_AT = 2;
    const ADD_AT = 3;

    it('splits a context line that ends the old side but not the new one', () =>
    {
      const file = fileOf(LAST_LINE_EDITED);
      const built = buildHunkPatch(file, file.hunks[0]!, {
        selected: new Set([ADD_AT]),
        direction: 'stage'
      })!;

      // The unpicked deletion would have been context; as context it cannot end one side
      // and not the other, so it becomes a deletion and an addition of the same text.
      expect(built).toContain(
        '-old last\n\\ No newline at end of file\n+old last\n+new last\n\\ No newline at end of file\n'
      );
      expect(built).toContain('@@ -1,3 +1,4 @@');
    });

    it('drops the marker from a deletion that no longer ends the old side', () =>
    {
      const file = fileOf(LAST_LINE_EDITED);
      const built = buildHunkPatch(file, file.hunks[0]!, {
        selected: new Set([DELETE_AT]),
        direction: 'unstage'
      })!;

      // The unpicked addition is carried as context and is now last on both sides, so it
      // takes the marker and the deletion above it does not.
      expect(built).toContain('-old last\n new last\n\\ No newline at end of file\n');
      expect(built).not.toContain('-old last\n\\ No newline');
      expect(built).toContain('@@ -1,4 +1,3 @@');
    });

    it('leaves a whole hunk alone', () =>
    {
      const file = fileOf(LAST_LINE_EDITED);
      const built = buildHunkPatch(file, file.hunks[0]!, { direction: 'stage' })!;
      expect(built).toContain('-old last\n\\ No newline at end of file\n');
      expect(built).toContain('+new last\n\\ No newline at end of file\n');
      expect(built).not.toContain('+old last');
    });
  });

  it('writes /dev/null for a file being created', () =>
  {
    const patch = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+first
+second
`;
    const file = fileOf(patch);
    const built = buildHunkPatch(file, file.hunks[0]!)!;
    expect(built).toContain('--- /dev/null');
    expect(built).toContain('+++ b/new.txt');
    expect(built).toContain('new file mode 100644');
    expect(built).toContain('@@ -0,0 +1,2 @@');
  });

  it('counts a deletion-only hunk with an empty new side', () =>
  {
    // Verified against git itself: emptying a two-line file is `@@ -1,2 +0,0 @@`, not
    // `+1,0`: a zero count makes the start the line the content goes *after*.
    const patch = `--- a/d.txt
+++ b/d.txt
@@ -1,2 +0,0 @@
-gone
-also gone
`;
    const file = fileOf(patch);
    expect(buildHunkPatch(file, file.hunks[0]!)!).toContain('@@ -1,2 +0,0 @@');
  });

  it('starts a pure insertion after the line it follows, as git does', () =>
  {
    // `@@ -2,0 +3 @@` is what git prints for two lines inserted after line 2.
    const patch = `--- a/i.txt
+++ b/i.txt
@@ -2,0 +3,2 @@
+one
+two
`;
    const file = fileOf(patch);
    expect(buildHunkPatch(file, file.hunks[0]!)!).toContain('@@ -2,0 +3,2 @@');
  });
});

describe('hasPickableChange / changedLineIndexes', () =>
{
  it('reports whether a selection names any change', () =>
  {
    const file = fileOf(TWO_HUNKS);
    const hunk = file.hunks[0]!;
    expect(hasPickableChange(hunk)).toBe(true);
    expect(hasPickableChange(hunk, new Set([1]))).toBe(true);
    // Index 2 is `two`, a context line.
    expect(hasPickableChange(hunk, new Set([2]))).toBe(false);
    expect(hasPickableChange(hunk, new Set())).toBe(false);
  });

  it('lists the changed lines and no others', () =>
  {
    const file = fileOf(TWO_HUNKS);
    const hunk = file.hunks[0]!;
    expect(changedLineIndexes(hunk)).toEqual([0, 1]);
    expect(hunk.lines[0]!.kind).toBe('delete');
    expect(hunk.lines[1]!.kind).toBe('add');
  });
});
