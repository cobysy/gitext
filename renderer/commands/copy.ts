/**
 * Copy items from Edit menu. No git runs (fields already loaded).
 * Selection copied in display order (how grid drew it), not pick order.
 */

import { defineCommand, type CommandContext } from './registry.js';
import { copyText } from '@renderer/clipboard.js';
import { shortSha } from '@renderer/format.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import type { CommitRow } from '@shared/types.js';

/**
 * Copying needs an object behind the row. The working-tree and index rows have no
 * SHA, author or message: the details pane already says so rather than showing
 * blanks, and the menu greys these for the same reason.
 */
const GROUP_COPY = 'Copy';

const commitsSelected = (c: CommandContext): boolean =>
  c.hasRepo && c.selectionCount > 0 && !c.hasArtificialSelection;

/** The selected commits, top-down as the grid draws them. */
function selectedCommits(): CommitRow[]
{
  const revisions = useRevisionsStore();
  return useSelectionStore()
    .inDisplayOrder(revisions.rows)
    .map((sha) => revisions.commitOf(sha))
    .filter((commit): commit is CommitRow => commit !== undefined);
}

/** Copy one field of every selected commit, one per line. */
function copyField(field: (commit: CommitRow) => string, what: string): void
{
  const values = selectedCommits().map(field).filter((value) => value !== '');
  if (values.length === 0)
  {
    return;
  }
  let label: string;
  if (values.length > 1)
  {
    label = `${values.length} ${what}s`;
  }
  else
  {
    label = what;
  }
  void copyText(values.join('\n'), label);
}

export function registerCopyCommands(): void
{
  defineCommand({
    id: 'copy.sha',
    label: 'Copy SHA-1',
    group: GROUP_COPY,
    keys: ['Mod+Shift+S'],
    when: commitsSelected,
    run: () => copyField((c) => c.sha, 'SHA')
  });

  // Both, because the two get pasted into different places: the full SHA into a git
  // command or a commit message trailer, the short one into prose and chat.
  defineCommand({
    id: 'copy.shortSha',
    label: 'Copy Short SHA-1',
    group: GROUP_COPY,
    when: commitsSelected,
    run: () => copyField((c) => shortSha(c.sha), 'short SHA')
  });

  defineCommand({
    id: 'copy.subject',
    label: 'Copy Message Subject',
    group: GROUP_COPY,
    when: commitsSelected,
    run: () => copyField((c) => c.subject, 'subject')
  });

  // The whole message, body included. Multi-line, so with several commits selected
  // the newline join stops being a list: hence the blank line between them.
  defineCommand({
    id: 'copy.message',
    label: 'Copy Full Message',
    group: GROUP_COPY,
    when: commitsSelected,
    run: () =>
    {
      const messages = selectedCommits().map((c) =>
      {
        if (c.body)
        {
          return `${c.subject}\n\n${c.body}`;
        }
        else
        {
          return c.subject;
        }
      });
      if (messages.length === 0)
      {
        return;
      }
      let label: string;
      if (messages.length > 1)
      {
        label = `${messages.length} messages`;
      }
      else
      {
        label = 'message';
      }
      void copyText(messages.join('\n\n'), label);
    }
  });

  defineCommand({
    id: 'copy.author',
    label: 'Copy Author',
    group: GROUP_COPY,
    when: commitsSelected,
    run: () => copyField((c) => `${c.authorName} <${c.authorEmail}>`, 'author')
  });

  // Every ref pointing at the selected commits. Greyed when none do, rather than
  // copying an empty string and toasting that something was copied.
  //
  // The predicate walks the selection, not the rows: `when` runs on every keystroke
  // through the hotkey handler, and `inDisplayOrder` scans the whole history to sort
  // its result: fine once per copy, far too much per key.
  defineCommand({
    id: 'copy.refs',
    label: 'Copy Branch or Tag Name',
    group: GROUP_COPY,
    when: (c) =>
    {
      if (!commitsSelected(c))
      {
        return false;
      }
      const revisions = useRevisionsStore();
      return useSelectionStore().ordered.some((sha) =>
      {
        const commit = revisions.commitOf(sha);
        return commit !== undefined && commit.refs.length > 0;
      });
    },
    run: () => copyField((c) => c.refs.map((ref) => ref.name).join('\n'), 'ref')
  });
}
