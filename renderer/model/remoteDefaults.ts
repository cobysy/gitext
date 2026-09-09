import type { RemoteEntry } from '@shared/types.js';

/** Git's default remote name. */
export const DEFAULT_REMOTE_NAME = 'origin';

/** `origin`, first remote, or '' if none. */
export function defaultRemoteName(remotes: readonly RemoteEntry[]): string
{
  return remotes.find((entry) => entry.name === DEFAULT_REMOTE_NAME)?.name ?? remotes[0]?.name ?? '';
}
