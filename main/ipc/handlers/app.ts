/**
 * The application's own state rather than a repository's: the settings file, the git
 * binary and the health check that reads it, and the command log every window shows.
 */

import { app, dialog, nativeTheme } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toDisplayLocale } from '@shared/locale.js';
import { resolveGit } from '@main/git/env.js';
import { healthCheck } from '@main/git/health.js';
import {
  clearCommandLog,
  getCommandLog,
  setCommandLogDepth
} from '@main/git/runner.js';
import { buildReport, noteSettingsChange, record } from '@main/diagnostics/index.js';
import { getSettings, patchSettings } from '@main/settings.js';
import {
  broadcast,
  handle
} from '../register.js';

export function registerAppHandlers(): void
{
  // ── Settings ────────────────────────────────────────────────────────────────
  handle('settings:get', () => getSettings());
  handle('settings:patch', async (patch) =>
  {
    const next = patchSettings(patch);
    noteSettingsChange(patch);
    if (patch.commandLogDepth !== undefined)
    {
      setCommandLogDepth(next.commandLogDepth);
    }
    if (patch.gitPath !== undefined)
    {
      await resolveGit(next.gitPath);
    }
    // The colour scheme is main's to resolve: 'system' is whatever the OS says, and
    // this also paints a dialog before its renderer exists. `event:theme` is pushed
    // rather than left to `nativeTheme.on('updated')`, which only fires when the *resolved* scheme moves.
    if (patch.theme !== undefined)
    {
      nativeTheme.themeSource = next.theme;
      let resolvedTheme: 'dark' | 'light';
      if (nativeTheme.shouldUseDarkColors)
      {
        resolvedTheme = 'dark';
      }
      else
      {
        resolvedTheme = 'light';
      }
      broadcast('event:theme', resolvedTheme);
    }
    // Every window holds its own copy of settings, and a dialog is a window: without
    // this a changed preference sits unseen until the app restarts.
    broadcast('event:settings', next);
    return next;
  });

  // ── Environment & health ────────────────────────────────────────────────────
  handle('env:git', () => resolveGit(getSettings().gitPath));
  handle('env:health', (repoPath) => healthCheck(repoPath));
  // `getSystemLocale` is the OS's, not the app's: on macOS it's `NSLocale
  // currentLocale`, carrying the region override. `app.getLocale()`/`navigator.language` give the app's language and lose the part that decides date order.
  handle('env:app', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron ?? ''
  }));
  handle('env:locale', () => toDisplayLocale(app.getSystemLocale()));


  // ── Command log ─────────────────────────────────────────────────────────────
  handle('log:list', () => getCommandLog());
  handle('log:clear', () => clearCommandLog());

  // ── Diagnostics ─────────────────────────────────────────────────────────────
  handle('diagnostics:record', (kind, text, detail, durationMs) =>
  {
    const extra: Parameters<typeof record>[2] = {};
    if (detail && detail.length > 0)
    {
      extra.detail = detail;
    }
    if (durationMs !== undefined)
    {
      extra.durationMs = durationMs;
    }
    record(kind, text, extra);
  });

  handle('diagnostics:save', async () =>
  {
    const redact = getSettings().redactDiagnostics;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    // Said here rather than in a confirmation the user would dismiss unread: this is the
    // moment the file gets a name, and the only moment a warning can change a mind.
    let warning: string;
    if (redact)
    {
      warning = 'Paths, remote credentials and commit message bodies are removed.';
    }
    else
    {
      warning = 'Contains paths, branch names, commit messages and git output.';
    }
    const picked = await dialog.showSaveDialog({
      title: 'Save Diagnostics',
      defaultPath: join(app.getPath('downloads'), `gitext-diagnostics-${stamp}.txt`),
      filters: [
        { name: 'Text', extensions: ['txt'] },
        { name: 'JSON Lines', extensions: ['jsonl'] }
      ],
      message: warning
    });
    if (picked.canceled || !picked.filePath)
    {
      return null;
    }
    // The extension is the choice: one object per line for counting and grouping, the
    // laid-out text for reading. Asking twice at the save dialog would be one question
    // too many for a difference the file name already states.
    await writeFile(picked.filePath, buildReport(redact, picked.filePath.endsWith('.jsonl')), 'utf8');
    return picked.filePath;
  });

}
