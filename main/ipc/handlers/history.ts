/**
 * Reading history: the revision log (streamed, since a large repository's is), one
 * file's history and blame, and searching what the files contain.
 */

import { BrowserWindow } from 'electron';
import { createRevisionStream } from '../revisionStream.js';
import { describeRevision, getCommitDetails } from '@main/git/commitDetails.js';
import { countCommits, readLog } from '@main/git/log.js';
import { readBlame } from '@main/git/blame.js';
import { searchGrep } from '@main/git/grep.js';
import {
  handle,
  handleFromWindow
} from '../register.js';

export function registerHistoryHandlers(): void
{
  // Addressed to one window rather than broadcast: a log batch is an answer to the window
  // that asked, and every other window (a dialog, the console, a second repository) either
  // discards it or, worse, renders it.
  const revisionStream = createRevisionStream((windowId, channel, payload) =>
  {
    const win = BrowserWindow.fromId(windowId);
    if (win && !win.isDestroyed())
    {
      win.webContents.send(channel, payload);
    }
  });

  // ── Revision log ────────────────────────────────────────────────────────────
  // `handleFromWindow`, because a request id is only unique within one renderer: both
  // repository windows number their first request 1.
  handleFromWindow('revisions:start', (sender, requestId, repoPath, options) =>
    revisionStream.start(sender?.id ?? 0, requestId, repoPath, options)
  );
  handleFromWindow('revisions:cancel', (sender, requestId) =>
    revisionStream.cancel(sender?.id ?? 0, requestId)
  );
  handle('revisions:count', (repoPath, options) => countCommits(repoPath, options));
  handle('revisions:details', (repoPath, sha) => getCommitDetails(repoPath, sha));
  handle('revisions:describe', (repoPath, rev) => describeRevision(repoPath, rev));

  // ── File history & blame ─────────────────────────────────────────────────────
  handle('file:history', (repoPath, path) => readLog(repoPath, { paths: [path], follow: true }));
  handle('file:blame', (repoPath, revision, path) => readBlame(repoPath, revision, path));

  // ── Searching file contents ─────────────────────────────────────────────────
  handle('search:grep', (repoPath, options) => searchGrep(repoPath, options));

}
