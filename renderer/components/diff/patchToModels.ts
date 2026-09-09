/**
 * Patch to whole files for diff editor, and original line numbers.
 * Independent reason to change from editor crossfade.
 */

import type * as monaco from '@renderer/monaco.js';
import { LINE_KIND_ADD, LINE_KIND_CONTEXT, LINE_KIND_DELETE, type PatchFile } from '@renderer/model/patch.js';


/** One side: text and original line numbers. */
export interface Side {
  text: string;
  /** Original file line numbers by model line. */
  numbers: number[];
}

/**
 * Rebuild both whole files from patch. git diff emits hunks only;
 * Monaco wants both files.
 *
 * line 1 is not the file's line 1, so each side carries its real numbers along.
 */
export function sidesOf(file: PatchFile | null): { original: Side; modified: Side }
{
  const original: string[] = [];
  const modified: string[] = [];
  const originalNumbers: number[] = [];
  const modifiedNumbers: number[] = [];

  for (const hunk of file?.hunks ?? [])
  {
    for (const line of hunk.lines)
    {
      if (line.kind === LINE_KIND_CONTEXT || line.kind === LINE_KIND_DELETE)
      {
        original.push(line.text);
        originalNumbers.push(line.oldNumber!);
      }
      if (line.kind === LINE_KIND_CONTEXT || line.kind === LINE_KIND_ADD)
      {
        modified.push(line.text);
        modifiedNumbers.push(line.newNumber!);
      }
    }
  }

  return {
    original: { text: original.join('\n'), numbers: originalNumbers },
    modified: { text: modified.join('\n'), numbers: modifiedNumbers }
  };
}

/** Draw the file's line numbers rather than the model's, which start at 1 regardless. */
export function applyLineNumbers(pane: monaco.editor.ICodeEditor, numbers: number[]): void
{
  if (numbers.length > 0)
  {
    pane.updateOptions({ lineNumbers: (n) => String(numbers[n - 1] ?? n) });
  }
  else
  {
    pane.updateOptions({ lineNumbers: 'on' });
  }
}
