/**
 * Working-directory switcher: three ways to move (superproject/submodule/recent).
 * Entries are paths, not commands (built here, not from registry).
 */

import type { SubmoduleEntry } from '@shared/types.js';

export interface SwitcherEntry {
  /** Which of the three ways this entry moves. Drives its glyph. */
  kind: 'superproject' | 'submodule' | 'recent';
  /** Absolute working-tree path: what `repo:open` is handed. */
  path: string;
  /** The name shown; the path itself is the second line and the tooltip. */
  name: string;
  /**
   * False for a submodule git has not populated yet. Shown anyway: an absent row would
   * say the submodule does not exist, when what is true is that it has no working tree
   * to open until `submodule update` runs.
   */
  enabled: boolean;
  /** Why it cannot be opened, when `enabled` is false. */
  reason?: string;
}

export interface SwitcherSection {
  label: string;
  entries: SwitcherEntry[];
}

export interface SwitcherInput {
  /** The open repository's working-tree root, or null when none is open. */
  currentPath: string | null;
  superprojectPath: string | null;
  submodules: readonly SubmoduleEntry[];
  recentRepos: readonly string[];
}

/** The last path segment, tolerating either separator and a trailing one. */
export function basename(path: string): string
{
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Join a submodule's repo-relative path onto its parent.
 *
 * git always reports the relative path with forward slashes, including on Windows, so
 * the separator has to come from the parent path rather than from the piece being
 * appended: otherwise a Windows repo grows a row reading `C:\repo\sub/module`.
 */
function joinPath(base: string, relative: string): string
{
  let separator;
  if (base.includes('\\') && !base.includes('/'))
  {
    separator = '\\';
  }
  else
  {
    separator = '/';
  }
  const trimmed = base.replace(/[\\/]+$/, '');
  return `${trimmed}${separator}${relative.split('/').join(separator)}`;
}

/**
 * Build the switcher's sections for the current repository.
 *
 * A path appears once: the repository that is already open is not offered, and a
 * submodule that is also in the recent list stays under Submodules, where it says
 * something about *this* repository rather than about what was opened last week.
 * Empty sections are dropped, so the panel is only as tall as it has content for.
 */
export function buildSwitcherSections(input: SwitcherInput): SwitcherSection[]
{
  const sections: SwitcherSection[] = [];
  const seen = new Set<string>();
  if (input.currentPath)
  {
    seen.add(input.currentPath);
  }

  const take = (entry: SwitcherEntry): SwitcherEntry | null =>
  {
    if (seen.has(entry.path))
    {
      return null;
    }
    seen.add(entry.path);
    return entry;
  };

  if (input.superprojectPath)
  {
    const entry = take({
      kind: 'superproject',
      path: input.superprojectPath,
      name: basename(input.superprojectPath),
      enabled: true
    });
    if (entry)
    {
      sections.push({ label: 'Superproject', entries: [entry] });
    }
  }

  if (input.currentPath)
  {
    const base = input.currentPath;
    const entries = input.submodules
      .map((submodule) =>
      {
        const candidate: Parameters<typeof take>[0] = {
          kind: 'submodule',
          path: joinPath(base, submodule.path),
          name: submodule.path,
          enabled: submodule.initialized
        };
        if (!submodule.initialized)
        {
          candidate.reason = 'Not initialized';
        }
        return take(candidate);
      })
      .filter((entry): entry is SwitcherEntry => entry !== null);
    if (entries.length > 0)
    {
      sections.push({ label: 'Submodules', entries });
    }
  }

  const recents = input.recentRepos
    .map((path) => take({ kind: 'recent', path, name: basename(path), enabled: true }))
    .filter((entry): entry is SwitcherEntry => entry !== null);
  if (recents.length > 0)
  {
    sections.push({ label: 'Recent', entries: recents });
  }

  return sections;
}
