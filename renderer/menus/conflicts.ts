/**
 * The conflicted-file list's menu, in the Solve Merge Conflicts window.
 *
 * **The one menu in the app that is not a rendering of the command registry**, which is a
 * decision rather than an omission. Every other surface resolves ids because its commands
 * have to be reachable from the palette and the menu bar too; these three cannot be. The
 * resolver is a dialog window: it mounts `DialogHost`, builds no `CommandContext` and draws
 * no palette, so a registry command declared for it would appear only in the *repository*
 * window's palette, where the resolver is not open and the selection it acts on does not
 * exist. That is a row that cannot work where it is offered, which is the defect
 * `staging.*`'s missing scope turned out to be.
 *
 * Their labels are data for the same reason their home is: what the rows say depends on how
 * many files are picked, which no registry label can carry.
 *
 * So it lives here, beside the menu declarations it is not one of, and it is a pure
 * function of the selection so the availability rules can be tested rather than clicked.
 */

import type { ResolvedCommand } from './resolve.js';

/** What the dialog dispatches on. Local to that window, so plain strings, not command ids. */
export const CONFLICT_MENU_MERGETOOL = 'mergetool';
export const CONFLICT_MENU_RESOLVE_HERE = 'resolveHere';
export const CONFLICT_MENU_RESOLVED = 'resolved';

const KIND_COMMAND = 'command';

/** "this file" or "these 3 files": the rows name what they will act on, not a count. */
function noun(count: number): string
{
  if (count === 1)
  {
    return 'this file';
  }
  return `these ${count} files`;
}

export function conflictRowMenu(paths: readonly string[]): ResolvedCommand[]
{
  return [
    {
      kind: KIND_COMMAND,
      id: CONFLICT_MENU_MERGETOOL,
      label: `Open ${noun(paths.length)} in merge tool`,
      enabled: paths.length > 0
    },
    {
      kind: KIND_COMMAND,
      id: CONFLICT_MENU_RESOLVE_HERE,
      label: 'Resolve here…',
      // One file at a time: the editor opens on a single conflict, no bulk version.
      enabled: paths.length === 1
    },
    {
      kind: KIND_COMMAND,
      id: CONFLICT_MENU_RESOLVED,
      label: `Mark ${noun(paths.length)} resolved as-is`,
      enabled: paths.length > 0
    }
  ];
}
