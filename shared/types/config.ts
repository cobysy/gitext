/** Config scope: which file a read or write targets. Everything here must be
    structured-clone-safe (crosses IPC). */

/**
 * `effective`: what git resolves (local > global > system). The other two name files
 * for an editor, so you can edit one scope without accidentally shadowing an unseen value.
 */
export type ConfigScope = 'effective' | 'global' | 'local';

export const CONFIG_SCOPE_EFFECTIVE: ConfigScope = 'effective';

/** The scopes that name a file, so a write knows where to land. */
export type ConfigWriteScope = Exclude<ConfigScope, 'effective'>;
