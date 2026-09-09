/**
 * Which list the file pane shows: changed files or revision tree. Operations differ by mode.
 */

import { computed } from 'vue';
import {
  describeRange,
  ENDPOINT_KIND_INDEX,
  ENDPOINT_KIND_WORKING_TREE,
  type LineCounts
} from '@shared/diff.js';
import type { FileStatusCode } from '@shared/types.js';
import type { FileRow } from '@renderer/filetree.js';
import { shortSha } from '@renderer/format.js';
import { MODE_REPLACE, type MultiSelectMode, type SelectMode } from '@renderer/pathSelection.js';
import { rowLines, rowStatus, rowTitle, type PaneEntry } from '@renderer/model/fileRowDescription.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';


export function usePaneSource()
{
  const diff = useDiffStore();
  const fileTree = useFileTreeStore();
  const settings = useSettingsStore();

  /** Which of the two lists is on screen. */
  const isTree = computed(() => settings.settings.filesPaneMode === FILES_PANE_MODE_TREE);

  /** Everything the list could show, before the filter box narrows it. */
  const source = computed<PaneEntry[]>(() =>
  {
    if (isTree.value)
    {
      return fileTree.entries;
    }
    else
    {
      return diff.files;
    }
  });

  /** The path the pane has open, in whichever list is showing. */
  const selectedPath = computed(() =>
  {
    if (isTree.value)
    {
      return fileTree.selectedPath;
    }
    else
    {
      return diff.selectedPath;
    }
  });

  const collapsed = computed(() =>
  {
    if (isTree.value)
    {
      return fileTree.collapsedFolders;
    }
    else
    {
      return diff.collapsedFolders;
    }
  });

  function selectPath(path: string | null, mode: SelectMode = MODE_REPLACE): void
  {
    if (isTree.value)
    {
      fileTree.select(path, mode);
    }
    else
    {
      diff.select(path, mode);
    }
  }

  /** Pick a folderful at once, which is what a folder row's menu acts on. */
  function selectPaths(paths: readonly string[], mode: MultiSelectMode = MODE_REPLACE): void
  {
    if (isTree.value)
    {
      fileTree.selectPaths(paths, mode);
    }
    else
    {
      diff.selectPaths(paths, mode);
    }
  }

  /** Everything the list has picked, in whichever mode it is in. */
  const selectedPaths = computed<readonly string[]>(() =>
  {
    if (isTree.value)
    {
      return fileTree.selectedPaths;
    }
    else
    {
      return diff.selectedPaths;
    }
  }
  );

  /**
   * The picked paths as a set, rebuilt once per change rather than per row.
   *
   * The list is virtualized over thousands of rows and this is read by every one of them;
   * `includes` per row is the difference between a list that draws and one that stutters
   * while you shift-drag through it. The commit screen's list does the same.
   */
  const pickedHere = computed<ReadonlySet<string>>(() => new Set(selectedPaths.value));

  function toggleFolder(key: string): void
  {
    if (isTree.value)
    {
      fileTree.toggleFolder(key);
    }
    else
    {
      diff.toggleFolder(key);
    }
  }

  /**
   * What the list is a list *of*.
   *
   * A comparison has two ends and reads as one, "abc1234 → the working directory", while a
   * tree has one, and saying which is the whole difference between the two modes.
   *
   * The SHAs come back backticked: the bar draws this through `CodeText`, so a hash is set
   * in the code font and the words around it are not. The tooltip on the same element takes
   * `plainText` of it, since an attribute renders no markup.
   */
  const asToken = (sha: string): string => `\`${shortSha(sha)}\``;

  const heading = computed(() =>
  {
    if (isTree.value)
    {
      const endpoint = fileTree.endpoint;
      if (!endpoint)
      {
        return 'Nothing selected';
      }
      if (endpoint.kind === ENDPOINT_KIND_INDEX)
      {
        return 'in the index';
      }
      if (endpoint.kind === ENDPOINT_KIND_WORKING_TREE)
      {
        return 'in the working directory';
      }
      return `at ${asToken(endpoint.sha)}`;
    }
    if (diff.range === null)
    {
      return 'Nothing selected';
    }
    else
    {
      return describeRange(diff.range, asToken);
    }
  });

  /**
   * What the selected revision did to each path it touched.
   *
   * The changed list, by path. It is loaded for the pivot whichever mode the pane is in, so
   * the tree can be asked the question a tree entry cannot answer on its own: the entry
   * says a file *exists* at this revision, not what happened to it getting here.
   *
   * `statusOf`/`markOf`/`rowStatus`/`rowMark`/`rowTitle` live in `fileRowDescription.ts`:
   * pure, and shared with anything else that draws a row from a `PaneEntry`. This is the
   * one thing only the pane's own data can answer, so the row helpers below take it as an
   * argument rather than reaching for the store themselves.
   */
  const changedStatus = computed(() =>
  {
    const byPath = new Map<string, FileStatusCode>();
    for (const file of diff.files)
    {
      byPath.set(file.path, file.status);
    }
    return byPath;
  });

  /**
   * How many lines each changed path gained and lost, by path: the other half of the
   * question a tree entry cannot answer about itself, filled in the same way as the status.
   */
  const changedLines = computed(() =>
  {
    const byPath = new Map<string, LineCounts>();
    for (const file of diff.files)
    {
      if (file.lines)
      {
        byPath.set(file.path, file.lines);
      }
    }
    return byPath;
  });

  const statusOfRow = (row: FileRow<PaneEntry>): FileStatusCode | null => rowStatus(row, changedStatus.value);
  const linesOfRow = (row: FileRow<PaneEntry>): LineCounts | null => rowLines(row, changedLines.value);
  const titleOfRow = (row: FileRow<PaneEntry>): string => rowTitle(row, changedStatus.value);

  return {
    isTree,
    source,
    selectedPath,
    collapsed,
    selectPath,
    selectPaths,
    selectedPaths,
    pickedHere,
    toggleFolder,
    heading,
    changedStatus,
    changedLines,
    statusOfRow,
    linesOfRow,
    titleOfRow
  };
}

export type PaneSource = ReturnType<typeof usePaneSource>;
