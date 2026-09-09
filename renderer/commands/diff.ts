/**
 * Diff display settings: on viewer toolbar (changed while reading diff).
 * Most re-run git (whitespace, context, whole-file); navigation pair steps within fetched patch.
 */

import { defineCommand, hasFile, hasRepo, type CommandContext } from './registry.js';
import { api, toMessage } from '@renderer/api.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { DIFF_VIEW_SIDE_BY_SIDE, IGNORE_WHITESPACE_NONE } from '@shared/types.js';

// Context steps are disabled when showing entire file.
const windowedContext = (c: CommandContext): boolean =>
  c.hasRepo && !useSettingsStore().settings.diffWholeFile;

/** git's own default. Also the floor and ceiling the two step commands work between. */
const MIN_CONTEXT = 0;
const MAX_CONTEXT = 100;

const VIEW_MODE_INLINE = 'inline';
const IGNORE_WHITESPACE_CHANGE = 'change';
const IGNORE_WHITESPACE_ALL = 'all';

export function registerDiffCommands(): void
{
  defineCommand({
    id: 'diff.inline',
    radioGroup: 'diff.mode',
    label: 'Inline Diff',
    group: 'Diff',
    when: hasRepo,
    checked: () => useSettingsStore().settings.diffViewMode === VIEW_MODE_INLINE,
    run: () => useSettingsStore().patch({ diffViewMode: VIEW_MODE_INLINE })
  });

  defineCommand({
    id: 'diff.sideBySide',
    radioGroup: 'diff.mode',
    label: 'Side-by-Side Diff',
    group: 'Diff',
    when: hasRepo,
    checked: () => useSettingsStore().settings.diffViewMode === DIFF_VIEW_SIDE_BY_SIDE,
    run: () => useSettingsStore().patch({ diffViewMode: DIFF_VIEW_SIDE_BY_SIDE })
  });

  // Three-way selector: `-b` and `-w` are mutually exclusive.
  defineCommand({
    id: 'diff.showWhitespace',
    radioGroup: 'diff.whitespace',
    label: 'Show All Whitespace Changes',
    group: 'Diff',
    when: hasRepo,
    checked: () => useSettingsStore().settings.diffIgnoreWhitespace === IGNORE_WHITESPACE_NONE,
    run: () => useSettingsStore().patch({ diffIgnoreWhitespace: IGNORE_WHITESPACE_NONE })
  });

  defineCommand({
    id: 'diff.ignoreWhitespaceChange',
    radioGroup: 'diff.whitespace',
    label: 'Ignore Whitespace Changes',
    group: 'Diff',
    when: hasRepo,
    checked: () => useSettingsStore().settings.diffIgnoreWhitespace === IGNORE_WHITESPACE_CHANGE,
    run: () => useSettingsStore().patch({ diffIgnoreWhitespace: IGNORE_WHITESPACE_CHANGE })
  });

  defineCommand({
    id: 'diff.ignoreAllWhitespace',
    radioGroup: 'diff.whitespace',
    label: 'Ignore All Whitespace',
    group: 'Diff',
    when: hasRepo,
    checked: () => useSettingsStore().settings.diffIgnoreWhitespace === IGNORE_WHITESPACE_ALL,
    run: () => useSettingsStore().patch({ diffIgnoreWhitespace: IGNORE_WHITESPACE_ALL })
  });

  defineCommand({
    id: 'diff.moreContext',
    label: 'More Context Lines',
    group: 'Diff',
    // Clamp in run, not when: `when` runs on every keystroke; disabled only for whole-file mode.
    when: windowedContext,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({
        diffContextLines: Math.min(MAX_CONTEXT, settings.settings.diffContextLines + 3)
      });
    }
  });

  defineCommand({
    id: 'diff.lessContext',
    label: 'Fewer Context Lines',
    group: 'Diff',
    when: windowedContext,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({
        diffContextLines: Math.max(MIN_CONTEXT, settings.settings.diffContextLines - 3)
      });
    }
  });

  // Mode, not context step: `--unified` with a very high count disables context stepping.
  defineCommand({
    id: 'diff.showEntireFile',
    label: 'Show Entire File',
    group: 'Diff',
    when: hasRepo,
    checked: () => useSettingsStore().settings.diffWholeFile,
    run: () =>
    {
      const settings = useSettingsStore();
      return settings.patch({ diffWholeFile: !settings.settings.diffWholeFile });
    }
  });

  // Function keys: can be pressed one-handed while reading; `Mod+` pairs are taken.
  defineCommand({
    id: 'diff.nextDifference',
    label: 'Next Difference',
    group: 'Diff',
    keys: ['F7'],
    when: hasFile,
    run: () => useDiffStore().stepDifference(1)
  });

  defineCommand({
    id: 'diff.previousDifference',
    label: 'Previous Difference',
    group: 'Diff',
    keys: ['Shift+F7'],
    when: hasFile,
    run: () => useDiffStore().stepDifference(-1)
  });

  /**
   * Hand the diff on screen to `diff.tool`. Operates on viewer's file (not right-clicked file).
   */
  defineCommand({
    id: 'diff.openInDifftool',
    label: 'Open in External Difftool',
    group: 'Diff',
    when: hasFile,
    run: async () =>
    {
      const diff = useDiffStore();
      const repoPath = useRepoStore().repo?.path;
      const path = diff.selectedFile?.path;
      const range = diff.range;
      if (!repoPath || !path || !range)
      {
        return;
      }
      try
      {
        await api['file:difftool'](repoPath, range, path);
      }
      catch (err)
      {
        useUiStore().toast(toMessage(err), 'error');
      }
    }
  });
}
