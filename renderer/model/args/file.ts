/**
 * Working-tree file operations (git mv). Preview and run use same argv.
 * Ignore rules excluded: file writes, not git commands.
 */

import { PATH_SEPARATOR } from '@shared/diff.js';

/**
 * `git mv`: moves file and index entry together, records rename not add.
 * -- matters: file called -f is legal name, illegal option.
 */
const CMD_MV = 'mv';

/** Check if move is valid: both non-empty and different. */
function isValidMove(source: string, target: string): boolean
{
  return !!source && !!target && source !== target;
}

export function buildMoveArgs(from: string, to: string): string[]
{
  const source = from.trim();
  const target = to.trim();
  if (!isValidMove(source, target))
  {
    return [];
  }
  return [CMD_MV, PATH_SEPARATOR, source, target];
}
