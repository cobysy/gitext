/**
 * The Clean Up Branches scan as a window asks for it: its progress goes to that window
 * alone, and the scan stops once its answer is unwanted, because the same window asked
 * again (a different comparison) or closed.
 */

import type { BrowserWindow } from 'electron';
import type { BranchCleanupReport } from '@shared/types.js';
import { listStaleBranches } from '@main/git/branchCleanup.js';
import { createLatestOnly } from './latestOnly.js';
import { sendTo } from './register.js';

/** Keyed by window: request ids are per renderer, and each window shows one scan. */
const scans = createLatestOnly<number>();

const NO_WINDOW = 0;

export async function scanForCleanup(
  win: BrowserWindow | null,
  requestId: number,
  repoPath: string,
  comparison: string
): Promise<BranchCleanupReport | null>
{
  const windowId = win?.id ?? NO_WINDOW;
  const abandon = (): void => scans.abandon(windowId);
  win?.once('closed', abandon);
  try
  {
    return await scans.run(windowId, (signal) =>
      listStaleBranches(repoPath, comparison, {
        signal,
        onProgress: (progress) => sendTo(win, 'event:cleanupProgress', { requestId, ...progress })
      })
    );
  }
  finally
  {
    if (win && !win.isDestroyed())
    {
      win.removeListener('closed', abandon);
    }
  }
}
