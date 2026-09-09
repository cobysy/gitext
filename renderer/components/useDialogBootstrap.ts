/**
 * Load dialog window's settings/theme and adopt repository from payload.
 * Independent of dialog content/keyboard behavior.
 */

import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { api } from '@renderer/api.js';
import { DIALOG_WINDOWS, type DialogName, type DialogPayload } from '@shared/dialogs.js';
import { applyInvalidation } from '@renderer/composables/useRepoInvalidation.js';
import type { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import type { useRepoStore } from '@renderer/stores/repo.js';
import { resolveTheme, type useSettingsStore } from '@renderer/stores/settings.js';

export interface DialogBootstrapDeps {
  name: DialogName | null;
  payload: DialogPayload;
  settings: ReturnType<typeof useSettingsStore>;
  repo: ReturnType<typeof useRepoStore>;
  objects: ReturnType<typeof useRepoObjectsStore>;
}

/**
 * Held back until repo loaded: dialogs read branch/refs/dirty state at mount time.
 */
export function useDialogBootstrap({ name, payload, settings, repo, objects }: DialogBootstrapDeps): {
  ready: Ref<boolean>;
}
{
  const ready = ref(false);
  const unsubscribers: (() => void)[] = [];

  onMounted(async () =>
  {
    // Set here: determines window name in menu, dock, screenshots.
    if (name)
    {
      document.title = DIALOG_WINDOWS[name].title;
    }

    await settings.load();
    settings.applyTheme(resolveTheme(settings.settings.theme));

    unsubscribers.push(
      api.on('event:theme', (theme) => settings.applyTheme(theme)),
      // All windows broadcast settings; each holds its own copy.
      api.on('event:settings', (next) => settings.apply(next))
    );

    const repoPath = payload.repoPath;
    if (repoPath)
    {
      await repo.adopt(repoPath);
      // Load refs, remotes, stashes for pickers.
      await objects.load(repoPath);

      // Dialog has two stores, no grid: applyInvalidation takes them from caller.
      unsubscribers.push(
        api.on('event:repoChanged', (change) =>
        {
          if (change.path !== repoPath)
          {
            return;
          }
          applyInvalidation(change.facets, [
            {
              facets: ['head', 'refs', 'worktree', 'index'],
              run: () => void repo.refresh()
            },
            {
              // head included: which branch is current is property of ref list.
              facets: ['head', 'refs', 'stashes', 'remotes', 'submodules', 'worktrees', 'config'],
              run: () => void objects.load(repoPath)
            }
          ]);
        })
      );
    }

    ready.value = true;
  });

  onUnmounted(() =>
  {
    for (const off of unsubscribers)
    {
      off();
    }
  });

  return { ready };
}
