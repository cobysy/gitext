/**
 * The glyphs more than one surface draws. A page with a change on it is the diff, in
 * the changed-file pane's switch, the diff pane's, the blob pane's and the conflict
 * list's: four hand-written copies of the same six numbers, which is four chances for
 * one of them to drift a tenth of a pixel and nobody to notice.
 *
 * Only the shapes that repeat live here. A glyph one component draws stays in that
 * component, where the shape sits beside the thing it names.
 *
 * Every one is an outline stroked in `currentColor`, so it dims with a disabled button
 * and follows the theme without a second asset. That is why a glyph is a stroke width
 * and a list of paths rather than arbitrary markup: a shape needing a fill, a circle or
 * a rect is not one of these, and belongs to whichever component wants it.
 */

export type GlyphName = 'diffFile' | 'textFile' | 'folder' | 'stash';

export interface Glyph {
  strokeWidth: number;
  paths: string[];
}

export const GLYPHS: Record<GlyphName, Glyph> = {
  // A page with a line added and a line taken away: one file's diff.
  diffFile: {
    strokeWidth: 1.2,
    paths: ['M4 2.2h5.2L12.5 5.4v8.4H4z', 'M6.2 7.6h4M8.2 5.6v4M6.2 11.5h4']
  },
  // The same page with lines of text on it: the file itself, rather than what changed in it.
  textFile: {
    strokeWidth: 1.2,
    paths: ['M4 2.2h5.2L12.5 5.4v8.4H4z', 'M6.2 7.2h4.2M6.2 9.4h4.2M6.2 11.6h2.6']
  },
  // A folder: what the repository contains. Also the browse button's glyph, and a
  // worktree's, which is a folder somewhere else on disk.
  folder: {
    strokeWidth: 1.2,
    paths: ['M2.2 4.4h4l1.2 1.6h6.4v6.6a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1z']
  },
  // A stack: changes set aside in a pile you take the top off.
  stash: {
    strokeWidth: 1.2,
    paths: ['M2.6 5 8 2.2 13.4 5 8 7.8z', 'M2.6 8 8 10.8 13.4 8', 'M2.6 11 8 13.8 13.4 11']
  }
};

/** Every glyph is drawn in this box, so one size prop is all a caller ever passes. */
export const GLYPH_VIEW_BOX = '0 0 16 16';
