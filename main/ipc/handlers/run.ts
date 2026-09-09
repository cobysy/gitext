/**
 * The escape hatch: an argv the renderer built, run as-is. Two channels for it, one that
 * returns what git said and one that streams it into a console window as it happens, and
 * both take the facets they invalidate as an argument because only the caller knows them.
 */

import { createOutputStream } from '../outputStream.js';
import { reportMenuState } from '@main/menu.js';
import { readMessageFile, writeMessageFile } from '@main/git/messageFile.js';
import { setRemoteEnabled } from '@main/git/remote.js';
import {
  runGit
} from '@main/git/runner.js';
import {
  broadcast,
  handle,
  handleFromWindow,
  handleWrite,
  writeFinished,
  writeStarted
} from '../register.js';

export function registerRunHandlers(): void
{
  // `writeFinished` rather than `changed` alone: the stream's `finally` is where a
  // watched run ends, and it has to release the hold `stream:start` took below.
  const outputStream = createOutputStream(broadcast, writeFinished);

  // ── Escape hatch ────────────────────────────────────────────────────────────
  // The one channel whose facets are an argument, not a property of the channel: it
  // carries argv from every dialog. That declaration also settles read/write, which no
  // argv sniff could (can't tell `branch --list` from `branch -d`).
  handle('git:run', async (repoPath, argv, facets) =>
  {
    if (facets.length === 0)
    {
      return runGit(repoPath, argv, { kind: 'read' });
    }
    writeStarted(repoPath, facets);
    try
    {
      return await runGit(repoPath, argv, { kind: 'write' });
    }
    finally
    {
      writeFinished(repoPath, facets);
    }
  });

  // The same escape hatch, for a run whose *running* matters on screen, not its result.
  // Facets are an argument for the identical reason. The hold is taken here and released
  // by the stream's own `finally`, through the `writeFinished` injected above: `start`
  // returns as soon as the process is running, so this handler is not where the run ends.
  handle('stream:start', (requestId, repoPath, argv, facets) =>
  {
    writeStarted(repoPath, facets);
    outputStream.start(requestId, repoPath, argv, facets);
  });
  handle('stream:cancel', (requestId) => outputStream.cancel(requestId));
  handle('stream:state', (requestId) => outputStream.state(requestId));

  handle('git:writeMessageFile', (repoPath, name, message) =>
    writeMessageFile(repoPath, name, message)
  );
  handle('git:readMessageFile', (repoPath, name) => readMessageFile(repoPath, name));

  // Enabling a remote rewrites its `fetch` refspec, so which remote-tracking refs exist changes with it.
  handleWrite('remote:setEnabled', ['remotes', 'refs', 'config'], (repoPath, name, enabled) =>
    setRemoteEnabled(repoPath, name, enabled)
  );

  // The menu bar's ticks and greyed rows: the predicates read the renderer's stores, so the window that can answer them reports.
  handleFromWindow('menu:state', (win, states) =>
  {
    if (win)
    {
      reportMenuState(win, states);
    }
  });

}
