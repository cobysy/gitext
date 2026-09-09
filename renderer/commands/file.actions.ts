/**
 * The file commands, in three modules by what they do: change the repository, change
 * what git tracks, or open something. They share what they act on (`file/context.ts`)
 * and nothing else, and this file is the one name `commands/index.ts` calls.
 *
 * Imports stores: must NOT be listed in `tsconfig.node.json`.
 */

import { implementFileChangeCommands } from './file/changes.actions.js';
import { implementFileOpenCommands } from './file/open.actions.js';
import { implementFileTrackingCommands } from './file/tracking.actions.js';

export function implementFileCommands(): void
{
  implementFileChangeCommands();
  implementFileTrackingCommands();
  implementFileOpenCommands();
}
