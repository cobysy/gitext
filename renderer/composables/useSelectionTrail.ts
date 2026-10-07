/**
 * What a window has selected, in the words the diagnostics log records it: see
 * `traceSelection`. One describer per window, since each window holds different stores:
 * the repository window picks commits, a ref and files, the commit screen picks files on
 * one of two sides.
 */

import { traceSelection } from '@renderer/diagnostics.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import { useStagingStore } from '@renderer/stores/staging.js';

/** How many picked paths a line names before it counts the rest. */
const MAX_PATHS = 10;

/** `label a, b, c and 4 more`, or nothing when nothing is picked. */
function pathsLine(label: string, paths: readonly string[]): string[]
{
  if (paths.length === 0)
  {
    return [];
  }
  let line = `${label} ${paths.slice(0, MAX_PATHS).join(', ')}`;
  if (paths.length > MAX_PATHS)
  {
    line += ` and ${paths.length - MAX_PATHS} more`;
  }
  return [line];
}

/** The repository window: the commit the details describe, the panel's node, the files. */
export function useMainWindowSelectionTrail(): void
{
  const selection = useSelectionStore();
  const objects = useRepoObjectsStore();
  const diff = useDiffStore();
  const fileTree = useFileTreeStore();
  const settings = useSettingsStore();

  traceSelection(() =>
  {
    const lines: string[] = [];
    if (selection.primary)
    {
      let line = `commit ${selection.primary}`;
      if (selection.count > 1)
      {
        line += ` of ${selection.count} selected`;
      }
      lines.push(line);
    }
    const node = objects.selected;
    if (node)
    {
      lines.push(`panel ${node.kind} ${node.ref ?? node.label}`);
    }
    let paths: readonly string[];
    if (settings.settings.filesPaneMode === FILES_PANE_MODE_TREE)
    {
      paths = fileTree.selectedPaths;
    }
    else
    {
      paths = diff.selectedPaths;
    }
    lines.push(...pathsLine('files', paths));
    return lines;
  });
}

/** The commit screen: which side the selection is on, and the files picked there. */
export function useCommitScreenSelectionTrail(): void
{
  const staging = useStagingStore();

  traceSelection(() => pathsLine(`${staging.side}`, staging.selectedPaths));
}
