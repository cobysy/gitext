/**
 * Reading `filePaneView` back off disk.
 *
 * It holds one answer per list now and was a single value for both before, and settings
 * merge shallowly with no migration step: so a config written by an older build arrives
 * as a bare string and has to land somewhere sensible. Which list keeps that string, and
 * which takes the current default, is a decision worth pinning rather than an accident
 * of the branches.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  FILE_PANE_VIEW_BLAME,
  FILE_PANE_VIEW_DIFF,
  FILE_PANE_VIEW_FILE,
  toFilePaneViews
} from '@shared/types.js';

describe('reading a stored file-pane view', () =>
{
  it('keeps a pair already written as one answer per list', () =>
  {
    expect(
      toFilePaneViews({ changed: FILE_PANE_VIEW_FILE, tree: FILE_PANE_VIEW_DIFF })
    ).toEqual({ changed: FILE_PANE_VIEW_FILE, tree: FILE_PANE_VIEW_DIFF });
  });

  it('reads the old single value as the changed list\'s answer', () =>
  {
    // The tree's answer is a question that build never asked, so there is nothing of the
    // user's to carry over to it and it takes the default.
    expect(toFilePaneViews(FILE_PANE_VIEW_FILE)).toEqual({
      changed: FILE_PANE_VIEW_FILE,
      tree: DEFAULT_SETTINGS.filePaneView.tree
    });
  });

  it('falls back per list, so one unrecognised answer does not take the other with it', () =>
  {
    expect(toFilePaneViews({ changed: 'sideways', tree: FILE_PANE_VIEW_DIFF })).toEqual({
      changed: DEFAULT_SETTINGS.filePaneView.changed,
      tree: FILE_PANE_VIEW_DIFF
    });
  });

  it('falls back to the defaults for an absent or unusable value', () =>
  {
    // Absent is the ordinary case for a key a build has never written.
    expect(toFilePaneViews(undefined)).toEqual(DEFAULT_SETTINGS.filePaneView);
    expect(toFilePaneViews(null)).toEqual(DEFAULT_SETTINGS.filePaneView);
    expect(toFilePaneViews(7)).toEqual(DEFAULT_SETTINGS.filePaneView);
  });

  it('ships the diff beside the changed list and the blame beside the tree', () =>
  {
    expect(DEFAULT_SETTINGS.filePaneView.changed).toBe(FILE_PANE_VIEW_DIFF);
    expect(DEFAULT_SETTINGS.filePaneView.tree).toBe(FILE_PANE_VIEW_BLAME);
  });
});
