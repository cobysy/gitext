/**
 * IPC handler registration, in one module per subject. Handlers are thin: they validate
 * nothing beyond what the type system guarantees and delegate straight to `main/git/*`;
 * errors propagate (Electron serializes them, the renderer rethrows, see
 * `renderer/api.ts`). How a handler is registered at all is `./register.ts`.
 */

import type { GitCommandRecord } from '@shared/types.js';
import { ALL_FACETS } from '@shared/invalidation.js';
import { runnerEvents } from '@main/git/runner.js';
import { watcherEvents } from '@main/watcher.js';
import { announce, isEcho } from './repoChanges.js';
import { broadcast } from './register.js';
import { registerAppHandlers } from './handlers/app.js';
import { registerDialogHandlers } from './handlers/dialogs.js';
import { registerFileHandlers } from './handlers/files.js';
import { registerHistoryHandlers } from './handlers/history.js';
import { registerRepoHandlers } from './handlers/repo.js';
import { registerRunHandlers } from './handlers/run.js';

export function registerIpcHandlers(): void
{
  registerAppHandlers();
  registerRepoHandlers();
  registerDialogHandlers();
  registerHistoryHandlers();
  registerFileHandlers();
  registerRunHandlers();

  // ── Main → renderer streams ─────────────────────────────────────────────────
  runnerEvents.on('record', (record: GitCommandRecord) =>
  {
    broadcast('event:gitCommand', record);
  });

  watcherEvents.on('changed', (repoPath: string) =>
  {
    // A change made outside the app: a commit in a terminal, a branch deleted by a
    // script. Our own writes come back here too, after the channel that made them
    // already announced exactly; re-announcing would cost a second, wider reload for nothing.
    if (isEcho(repoPath))
    {
      return;
    }
    announce(repoPath, ALL_FACETS, (change) => broadcast('event:repoChanged', change));
  });
}
